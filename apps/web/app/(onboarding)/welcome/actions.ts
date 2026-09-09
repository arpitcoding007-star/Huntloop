"use server";

import { cookies } from "next/headers";
import { canonicalizeDomain, rootLabel } from "@huntloop/db/identity";
import { resolveDataSource } from "../../../lib/data/source";
import { hasOnboardingSchema } from "../../../lib/data/onboarding-schema";
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
  const memberships = await listMemberships();
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
): Promise<ActionResult<WorkspaceResult>> {
  const target = parseInput(urlInputSchema, website, "address");
  if (!target.ok) return fail(target.error);

  const domain = canonicalizeDomain(target.value);
  if (!domain) {
    return fail("That doesn't look like a website address.");
  }

  const base = slugify(rootLabel(domain) ?? domain);
  if (!base) {
    return fail("We couldn't build a workspace name from that address.");
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

  const migrated = await hasOnboardingSchema(db);

  /* Already got one for this domain? Re-running step two must not create a
     second workspace — which is what a refresh on this screen would otherwise
     do, and the user would never find out until they had two. */
  const memberships = await listMemberships();
  const owned = memberships?.find((m) => m.slug === base || m.slug.startsWith(`${base}-`));
  if (owned) return ok({ slug: owned.slug });

  for (let attempt = 0; attempt < 12; attempt++) {
    const slug = attempt === 0 ? base : `${base}-${attempt + 1}`;
    if (RESERVED_SLUGS.has(slug)) continue;

    const { data: org, error } = await db
      .from("organizations")
      /* `primary_domain` is what lets a colleague find this workspace instead
         of building a second one for the same company (`0027`). Written here
         rather than derived later because this is the one moment the domain is
         unambiguously known — it is what the slug was built from.

         Gated on the migration, like every other new column: writing one
         PostgREST has not seen fails the whole insert, and this insert is the
         workspace. */
      .insert(
        migrated
          ? { name: rootLabel(domain) ?? domain, slug, primary_domain: domain }
          : { name: rootLabel(domain) ?? domain, slug },
      )
      .select("id")
      .single();

    if (error) {
      // 23505 is unique_violation — the slug is taken by someone else's
      // workspace. Try the next suffix rather than telling the user their
      // company's domain is unavailable.
      if (error.code === "23505") continue;
      return fail(error.message);
    }

    const { error: memberError } = await db.from("memberships").insert({
      org_id: org.id,
      user_id: auth.user.id,
      role: "owner",
    });

    if (memberError) {
      /* The org exists but nobody can reach it — an orphan row that also holds
         its slug hostage. Clean it up rather than leaving the user stuck on a
         domain that now silently fails. */
      await db.from("organizations").delete().eq("id", org.id);
      return fail(`Could not add you to the workspace: ${memberError.message}`);
    }

    await capture("onboarding_step_completed", auth.user.id, {
      step: "organisation",
      orgId: org.id as string,
    });

    return ok({ slug });
  }

  return fail(
    "We couldn't find a free workspace address for that domain. " +
      "Contact support and we'll sort it out.",
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

  /* Mapped rather than spread. `IcpCriteria` distinguishes "not stated"
     (null) from "stated as none" ([]) — the rule the whole of
     `packages/db/src/icp.ts` is built on — and a spread of a form payload
     would turn every field the screen did not render into `undefined`, which
     `serializeCriteria` drops but `parseIcp` would then read back as null.
     Same answer, arrived at by accident. Writing it out keeps it deliberate. */
  const stepInput: IcpStepInput = {
    criteria: {
      segments: v.segments ?? null,
      sizes: v.sizes ?? null,
      regions: v.regions ?? null,
      triggers: v.triggers ?? null,
      industries: v.industries ?? null,
      employeeRange: v.employeeRange ?? null,
      revenueBands: null,
      technologies: v.technologies ?? null,
      businessModels: v.businessModels ?? null,
      painPoints: v.painPoints ?? null,
      useCases: v.useCases ?? null,
      buyingSignals: null,
      keywords: null,
      exampleCompanies: v.exampleCompanies ?? null,
      notes: null,
    },
    exclusions: {
      exclusions: v.exclusions ?? null,
      industries: null,
      regions: null,
      sizes: null,
      technologies: null,
      businessModels: null,
      employeeRange: null,
      keywords: null,
      domains: v.excludeDomains ?? null,
      signals: null,
      notes: null,
    },
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
