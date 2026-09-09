import "server-only";
import { ONBOARDING_STEPS, type OnboardingStep } from "./onboarding";
import { resolveDataSource } from "./source";
import { hasOnboardingSchema } from "./onboarding-schema";

/**
 * Where a signed-in person should be sent.
 *
 * ── The defect this fixes ────────────────────────────────────────────────
 *
 * `NAV-01`. Nothing in the codebase referenced `/welcome` outside its own
 * folder. `auth/callback` forwarded to `safeNextPath(next)`, which defaults to
 * `"/"`, and `app/page.tsx` redirected `"/"` to `/login`. So a user who
 * completed sign-up — magic link clicked, session established, cookies set —
 * landed back on the sign-in page. There was no code anywhere that answered
 * "which organisation does this person belong to", so even a returning member
 * with exactly one workspace had no automatic way into it.
 *
 * Four screens of onboarding existed and were unreachable except by typing the
 * URL.
 *
 * ── Why this is one function ─────────────────────────────────────────────
 *
 * Because the question is asked from three places — the auth callback, the
 * root route, and the org picker — and three implementations of "where should
 * this person go" would disagree within a release. The rules below are
 * genuinely subtle (a member of a configured org resumes nothing; a member of
 * an unconfigured one resumes exactly where the *workspace* stopped), and each
 * one is a redirect loop if it is got wrong in one place and not the others.
 *
 * ── What this is not ─────────────────────────────────────────────────────
 *
 * Not an authorization check. Every destination it can return is independently
 * guarded — the org layout 404s a non-member and RLS refuses the rows anyway.
 * This decides where to *point* somebody, and the worst a bug here can do is
 * send a legitimate user to a page that turns them away.
 */

export type Destination =
  /** No session. */
  | { kind: "anonymous"; path: "/login" }
  /** Signed in, belongs to nothing yet. */
  | { kind: "new-user"; path: "/welcome" }
  /** Signed in, one workspace, still being set up. */
  | { kind: "resume"; path: string; orgSlug: string; step: OnboardingStep }
  /** Signed in, one workspace, configured. */
  | { kind: "workspace"; path: string; orgSlug: string }
  /** Signed in, several workspaces. */
  | { kind: "choose"; path: "/orgs" }
  /** No database. The demo workspace is the only thing that exists. */
  | { kind: "demo"; path: string };

export interface Membership {
  orgId: string;
  slug: string;
  name: string;
  role: string;
  step: OnboardingStep;
  completedAt: string | null;
}

/**
 * The path for a workspace at a given step.
 *
 * `building` and `review` are real screens with their own routes; every other
 * step maps to a `/welcome` segment. `done` never reaches here — a completed
 * workspace goes to its dashboard — but it is handled rather than left to fall
 * through, because a fall-through would be an undefined path in a redirect.
 */
export function stepPath(orgSlug: string, step: OnboardingStep): string {
  const q = `?org=${encodeURIComponent(orgSlug)}`;
  switch (step) {
    case "you":
      return `/welcome${q}`;
    case "company":
      return `/welcome/company${q}`;
    case "goals":
      return `/welcome/goals${q}`;
    case "icp":
      return `/welcome/icp${q}`;
    case "sources":
      return `/welcome/sources${q}`;
    case "building":
      return `/welcome/building${q}`;
    case "review":
      return `/welcome/review${q}`;
    case "done":
      return `/${orgSlug}/dashboard`;
  }
}

/**
 * Every workspace this user belongs to, newest membership last.
 *
 * Readable through `membership_read` and `org_read` from `0001` — a user may
 * always see the orgs they are a member of — so this needs no privileged
 * client and no new policy.
 */
export async function listMemberships(): Promise<Membership[] | null> {
  const { db } = await resolveDataSource();
  if (!db) return null;

  const { data: auth } = await db.auth.getUser();
  if (!auth.user) return null;

  /*
   * The onboarding columns are a capability, not an assumption.
   *
   * Code and migrations do not land together, and selecting a column that does
   * not exist yet makes PostgREST answer `42703` — which this function would
   * read as "no rows", which `resolveDestination` would read as "belongs to no
   * organisation", which would walk every existing customer into onboarding
   * for a workspace they already have. See `onboarding-schema.ts`.
   */
  const migrated = await hasOnboardingSchema(db);

  const orgColumns = migrated
    ? "id, slug, name, onboarding_step, onboarding_completed_at, deleted_at"
    : "id, slug, name, deleted_at";

  const { data, error } = await db
    .from("memberships")
    .select(`role, created_at, organizations!inner(${orgColumns})`)
    .eq("user_id", auth.user.id)
    .is("deleted_at", null)
    .order("created_at", { ascending: true });

  if (error || !data) return [];

  /* eslint-disable @typescript-eslint/no-explicit-any --
     The row type for an embedded select is generated from a live project's
     schema. Confined to this mapper, as `lib/data/icp.ts` does. */
  return (data as any[])
    .map((row) => {
      const org = Array.isArray(row.organizations) ? row.organizations[0] : row.organizations;
      if (!org || org.deleted_at) return null;

      /*
       * Before the migration, every existing workspace is treated as `done`.
       *
       * That is the correct direction for this uncertainty to fall. These orgs
       * predate the flow entirely, their owners have been using them, and
       * offering setup would be worse than useless — it would invite a second
       * ICP. `0024`'s backfill makes the same judgement with better evidence
       * once it runs; this is the same call made without it.
       */
      const step: OnboardingStep = !migrated
        ? "done"
        : (ONBOARDING_STEPS as readonly string[]).includes(org.onboarding_step)
          ? org.onboarding_step
          : "you";
      return {
        orgId: String(org.id),
        slug: String(org.slug),
        name: String(org.name ?? org.slug),
        role: String(row.role),
        step,
        completedAt: migrated ? (org.onboarding_completed_at ?? null) : new Date(0).toISOString(),
      } satisfies Membership;
    })
    .filter((m): m is Membership => m !== null);
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

/**
 * The destination, resolved.
 *
 * ── The rules, and why each is what it is ────────────────────────────────
 *
 * **No database → the demo workspace.** Not `/login`: with no Supabase there
 * is nothing to sign in to, the whole app runs on fixtures, and sending a
 * reviewer to a sign-in form that cannot work is the "you have one migration
 * left to run" problem the rest of this codebase is careful about.
 *
 * **No session → `/login`.** Uninteresting and correct.
 *
 * **No memberships → `/welcome`.** The founder case. There is no org yet, so
 * there is no slug to carry and the first step creates one.
 *
 * **One membership, finished → its dashboard.** The overwhelmingly common
 * case, and the one that was broken.
 *
 * **One membership, unfinished → resume.** Resume at the *workspace's* step,
 * not the user's. See `lib/data/onboarding.ts` for why that distinction is
 * load-bearing: an invited teammate must not be walked through company
 * research for a workspace that already has an ICP.
 *
 * **Several → `/orgs`.** Guessing would be wrong: an agency user's last
 * workspace is not their default one, and picking the alphabetically-first is
 * a decision dressed up as an answer. The picker remembers the last choice, so
 * the cost is one click on the first visit and none afterwards.
 */
export async function resolveDestination(preferredSlug?: string): Promise<Destination> {
  const { db, source } = await resolveDataSource();

  if (!db) {
    // `acme` is the fixture workspace every demo screen renders. Named here
    // rather than guessed by the caller so there is one definition of it.
    return { kind: "demo", path: source === "unconfigured" ? "/acme/dashboard" : "/acme/dashboard" };
  }

  const { data: auth } = await db.auth.getUser();
  if (!auth.user) return { kind: "anonymous", path: "/login" };

  const memberships = await listMemberships();
  if (!memberships || memberships.length === 0) {
    return { kind: "new-user", path: "/welcome" };
  }

  /* A remembered choice wins, when it is still a workspace they belong to.
     The check matters: a user removed from an org would otherwise be sent to
     a 404 forever by their own cookie. */
  const preferred =
    preferredSlug && memberships.find((m) => m.slug === preferredSlug);

  const chosen = preferred || (memberships.length === 1 ? memberships[0] : null);

  if (!chosen) return { kind: "choose", path: "/orgs" };

  if (chosen.completedAt || chosen.step === "done") {
    return { kind: "workspace", path: `/${chosen.slug}/dashboard`, orgSlug: chosen.slug };
  }

  return {
    kind: "resume",
    path: stepPath(chosen.slug, chosen.step),
    orgSlug: chosen.slug,
    step: chosen.step,
  };
}

/** The cookie the org picker writes so a returning user skips it. */
export const LAST_ORG_COOKIE = "huntloop.org";
