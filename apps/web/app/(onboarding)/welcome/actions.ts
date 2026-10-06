"use server";

import { cookies } from "next/headers";
import { canonicalizeDomain, rootLabel } from "@huntloop/db/identity";
import { resolveDataSource } from "../../../lib/data/source";
import { listMemberships, LAST_ORG_COOKIE } from "../../../lib/data/destination";
import {
  completeOnboarding,
  saveGoalsStep,
  saveIcpStep,
  saveSourcesStep,
  saveYouStep,
  setOnboardingStep,
  type Goal,
  type IcpStepInput,
  type OnboardingStep,
  type OutreachChannel,
  type SourceDraft,
  type UserRole,
} from "../../../lib/data/onboarding";
import type { ActionResult } from "../../../lib/data/org";
import { fail, ok } from "../../../lib/data/org";
import {
  goalsStepSchema,
  icpStepSchema,
  onboardingStepSchema,
  orgSlugSchema,
  parseForm,
  parseInput,
  sourcesStepSchema,
  urlInputSchema,
  youStepSchema,
} from "../../../lib/validation";
import { stepIcp } from "../../../lib/onboarding/icp-step";
import { RESERVED_SLUGS, slugify } from "../../../lib/slug";
import { capture, captureForViewer } from "../../../lib/analytics";

/**
 * The onboarding write path.
 *
 * Every function here is a Server Action, which means a public POST endpoint —
 * so every one of them parses its input through `lib/validation.ts` before
 * doing anything, and none of them trusts a TypeScript parameter type to have
 * survived the wire.
 *
 * The actual writes live in `lib/data/onboarding.ts`. This file is the
 * boundary: validate, call, record the funnel event. Keeping the two apart is
 * what lets the persistence be tested without a Next request context.
 */

/* ── Step 1 · You ────────────────────────────────────────────────────────── */

export interface YouResult {
  /** Where to go next, resolved server-side — see the note in `saveYou`. */
  next: string;
}

/**
 * The person's name and role.
 *
 * ── Why this decides its own destination ─────────────────────────────────
 *
 * Because the answer differs by a fact the client does not have. A founder
 * signing up alone goes to company research; somebody who accepted an
 * invitation goes straight to the workspace, because that workspace already
 * has a product, an ICP and sources, and walking them through company research
 * would let them create a second, contradictory profile for a company that
 * already has one.
 *
 * The client cannot tell those apart without being told the user's
 * memberships, which is a list it has no other reason to hold.
 */
export async function saveYou(
  _prev: ActionResult<YouResult> | null,
  formData: FormData,
): Promise<ActionResult<YouResult>> {
  const parsed = parseForm(youStepSchema, {
    fullName: formData.get("fullName"),
    role: formData.get("role"),
  });
  if (!parsed.ok) return fail(parsed.error, parsed.fieldErrors);

  const result = await saveYouStep(
    parsed.value.fullName,
    parsed.value.role as UserRole,
  );
  if (!result.ok) return result;

  await captureForViewer("onboarding_step_completed", { step: "you" });

  /* An existing membership means the workspace is already someone else's
     doing. Send them to it — or to wherever its own setup stopped, which is
     the case where a teammate was invited mid-flow. */
  /* Unless they asked for another workspace (`/welcome?new=1`, from the
     picker or "Set up another client"). Forwarding them to the existing one
     made a second workspace impossible to create (M-02). */
  const creatingAnother = formData.get("new") === "1";
  const memberships = creatingAnother ? null : await listMemberships();
  const existing = memberships?.[0];
  if (existing) {
    const done = Boolean(existing.completedAt) || existing.step === "done";
    return ok({
      next: done
        ? `/${existing.slug}/dashboard`
        : `/welcome/company?org=${existing.slug}`,
    });
  }

  return ok({ next: "/welcome/company" });
}

/* ── Step 2 · The workspace, from a domain ───────────────────────────────── */

export interface WorkspaceResult {
  slug: string;
}

/**
 * Creates the organisation, keyed to the company's own domain.
 *
 * ── Why the domain and not a typed name ──────────────────────────────────
 *
 * The old first step asked for an organisation name on an otherwise empty
 * screen, before Huntloop knew anything, and slugified whatever came back.
 * That is a worse default than the one sitting in the URL the user is about to
 * paste anyway: `acme.com` yields `acme`, which is what they would have typed,
 * spelled the way their domain spells it.
 *
 * It also deletes a screen. The website is the only thing step two genuinely
 * needs, so asking for a name first was a question whose answer we were about
 * to derive.
 *
 * ── Why the org is created *before* research runs ────────────────────────
 *
 * Research is metered — `resolveRecorder` attributes the model call to an org,
 * `consumeRateLimit` needs one, and `withinAiBudget` reads its counters. A
 * call that cannot be attributed to a tenant is a call nobody is accountable
 * for paying for. So the row has to exist first, and its name is provisional
 * until the research returns the company's own name for itself.
 *
 * ── Slug collisions ──────────────────────────────────────────────────────
 *
 * `organizations.slug` is globally unique, so two customers at the same domain
 * collide — which is not exotic: it is exactly what happens when a second team
 * at a large company signs up independently. The suffix loop is deliberately
 * small and deliberately silent; the alternative is failing sign-up with
 * "that name is taken" for a name the user never chose.
 */
export async function createWorkspace(
  website: string,
  preferredSlug?: string,
): Promise<ActionResult<WorkspaceResult>> {
  const target = parseInput(urlInputSchema, website, "address");
  if (!target.ok) return fail(target.error);

  const domain = canonicalizeDomain(target.value);
  if (!domain) {
    return fail("That doesn't look like a website address.");
  }

  return provision({ name: rootLabel(domain) ?? domain, domain, preferredSlug });
}

/**
 * A workspace for a company described by hand — no website required.
 *
 * The "describe it yourself" path: pre-launch, stealth, or a site that says
 * too little to read. The address comes from the website when one was given
 * (it is what the user would have typed) and from the name otherwise.
 */
export async function createNamedWorkspace(
  name: string,
  website?: string,
  preferredSlug?: string,
): Promise<ActionResult<WorkspaceResult>> {
  const trimmed = name.trim().slice(0, 200);
  if (!trimmed) return fail("What's the company called?");

  let domain: string | null = null;
  if (website?.trim()) {
    domain = canonicalizeDomain(website.trim());
    if (!domain) return fail("That doesn't look like a website address.");
  }

  return provision({ name: trimmed, domain, preferredSlug });
}

/**
 * The shared half: pick a slug, create the org and its owner membership.
 *
 * A slug the user typed is honoured exactly or refused — silently suffixing a
 * name somebody chose on purpose would hand them an address they never saw.
 * A derived slug keeps the silent suffix loop described above.
 */
async function provision({
  name,
  domain,
  preferredSlug,
}: {
  name: string;
  domain: string | null;
  preferredSlug?: string;
}): Promise<ActionResult<WorkspaceResult>> {
  let chosen: string | null = null;
  if (preferredSlug?.trim()) {
    const parsed = parseInput(orgSlugSchema, preferredSlug.trim(), "workspace address");
    if (!parsed.ok) {
      return fail("Use lowercase letters, numbers and single hyphens for the workspace address.");
    }
    if (RESERVED_SLUGS.has(parsed.value)) {
      return fail("That workspace address is reserved. Try another.");
    }
    chosen = parsed.value;
  }

  const base = chosen ?? slugify(domain ? (rootLabel(domain) ?? domain) : name);
  if (!base) {
    return fail("We couldn't build a workspace address from that. Type one below.");
  }

  const { db } = await resolveDataSource();
  if (!db) {
    /* No database. Onboarding continues against fixtures rather than dead-
       ending — the banner inside the app already says the data is not real,
       and blocking here would make the whole flow unreviewable before the
       migrations are applied. */
    return ok({ slug: base });
  }

  const { data: auth } = await db.auth.getUser();
  if (!auth.user) return fail("Your session expired. Sign in again.");

  /* Already got one for this address? Re-running step two must not create a
     second workspace — which is what a refresh on this screen would otherwise
     do, and the user would never find out until they had two. */
  const memberships = await listMemberships();
  const owned = memberships?.find((m) =>
    chosen ? m.slug === chosen : m.slug === base || m.slug.startsWith(`${base}-`),
  );
  if (owned) return ok({ slug: owned.slug });

  const attempts = chosen ? 1 : 12;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const slug = attempt === 0 ? base : `${base}-${attempt + 1}`;
    if (RESERVED_SLUGS.has(slug)) continue;

    /* One call creates the workspace and the owner membership together.
       Through the tenant client this was two inserts that RLS could never
       allow — no insert policy on organizations, and membership_write wants
       an admin of an org that does not exist yet. See migration 0030. */
    const { data: orgId, error } = await db.rpc("create_organization", {
      p_name: name,
      p_slug: slug,
      p_domain: domain,
    });

    if (error) {
      // 23505 is unique_violation — the slug is taken by someone else's
      // workspace. A derived slug tries the next suffix; a chosen one says so.
      if (error.code === "23505") {
        if (chosen) return fail(`/${chosen} is already taken. Try another address.`);
        continue;
      }
      return fail(error.message);
    }

    await capture("onboarding_step_completed", auth.user.id, {
      step: "organisation",
      orgId: String(orgId),
    });

    return ok({ slug });
  }

  return fail(
    "We couldn't find a free workspace address for that. Type one yourself below.",
  );
}

/* ── Step 3 · Goals ──────────────────────────────────────────────────────── */

export async function saveGoals(
  org: string,
  goals: string[],
  channel: string,
): Promise<ActionResult<undefined>> {
  const slug = parseInput(orgSlugSchema, org, "organisation");
  if (!slug.ok) return fail(slug.error);

  const parsed = parseForm(goalsStepSchema, { goals, channel });
  if (!parsed.ok) return fail(parsed.error, parsed.fieldErrors);

  const result = await saveGoalsStep(
    slug.value,
    parsed.value.goals as Goal[],
    parsed.value.channel as OutreachChannel,
  );
  if (result.ok) {
    await captureForViewer("onboarding_step_completed", { step: "goals" });
  }
  return result;
}

/* ── Step 4 · ICP ────────────────────────────────────────────────────────── */

export async function saveIcp(
  org: string,
  input: unknown,
): Promise<ActionResult<{ icpId: string; quality: number }>> {
  const slug = parseInput(orgSlugSchema, org, "organisation");
  if (!slug.ok) return fail(slug.error);

  const parsed = parseForm(icpStepSchema, input);
  if (!parsed.ok) return fail(parsed.error, parsed.fieldErrors);

  const v = parsed.value;

  /* `stepIcp` maps rather than spreads, and the reason is in that file: the
     ICP type distinguishes "not stated" from "stated as none", and a spread
     erases the difference by accident. It lives in `lib/onboarding` because
     the reach counter and the look-alike preview build the same object from
     the same form, and three hand-written copies of a fifteen-key literal is
     how one of them ends up missing the sixteenth. */
  const { criteria, exclusions } = stepIcp(v);

  const stepInput: IcpStepInput = {
    criteria,
    exclusions,
    persona: v.titles && v.titles.length > 0
      ? {
          name: v.personaName || "Primary buyer",
          titlePatterns: v.titles,
          seniority: v.seniority ?? [],
          departments: v.departments ?? [],
          excludeTitles: v.excludeTitles ?? [],
          painPoints: v.painPoints ?? [],
        }
      : null,
    /* The reach estimate is accepted from the client because that is where the
       counter ran, and it is stored with `addressable_source = 'provider'`.
       That looks like a trust problem and is bounded to one: the number is
       displayed and used to warn about a too-broad or too-narrow profile, and
       nothing spends money or makes a claim to a third party on the strength
       of it. `0013`'s prohibition is on storing a number a *model* invented,
       which this is not — and the alternative, re-running the provider count
       server-side on submit, is a second paid call to re-learn something we
       already know. */
    addressable:
      typeof v.addressableEstimate === "number"
        ? { estimate: v.addressableEstimate, at: new Date().toISOString() }
        : null,
  };

  const result = await saveIcpStep(slug.value, stepInput);
  if (result.ok) {
    await captureForViewer("onboarding_step_completed", { step: "icp" });
  }
  return result;
}

/* ── Step 5 · Sources ────────────────────────────────────────────────────── */

export async function saveSources(
  org: string,
  sources: unknown,
): Promise<ActionResult<{ created: number }>> {
  const slug = parseInput(orgSlugSchema, org, "organisation");
  if (!slug.ok) return fail(slug.error);

  const parsed = parseForm(sourcesStepSchema, { sources });
  if (!parsed.ok) return fail(parsed.error, parsed.fieldErrors);

  const result = await saveSourcesStep(
    slug.value,
    parsed.value.sources as SourceDraft[],
  );
  if (result.ok) {
    await captureForViewer("onboarding_step_completed", { step: "sources" });
  }
  return result;
}

/* ── Finishing ───────────────────────────────────────────────────────────── */

export async function advanceStep(
  org: string,
  step: string,
): Promise<ActionResult<undefined>> {
  const slug = parseInput(orgSlugSchema, org, "organisation");
  if (!slug.ok) return fail(slug.error);

  const parsed = parseInput(onboardingStepSchema, step, "step");
  if (!parsed.ok) return fail(parsed.error);

  return setOnboardingStep(slug.value, parsed.value as OnboardingStep);
}

export async function finishOnboarding(org: string): Promise<ActionResult<undefined>> {
  const slug = parseInput(orgSlugSchema, org, "organisation");
  if (!slug.ok) return fail(slug.error);

  const result = await completeOnboarding(slug.value);

  if (result.ok) {
    /* Remembered so a returning user with several workspaces skips the picker.
       Written here rather than on the picker alone, because the workspace
       somebody just finished setting up is emphatically the one they want
       next. */
    const store = await cookies();
    store.set(LAST_ORG_COOKIE, slug.value, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    });
  }

  return result;
}
