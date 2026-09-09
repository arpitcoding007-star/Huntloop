import "server-only";
import type { TenantClient } from "@huntloop/db";

/**
 * Have `0024`–`0026` been applied?
 *
 * ── Why this exists ──────────────────────────────────────────────────────
 *
 * Because code and migrations do not land atomically. A Vercel deployment goes
 * live the moment the build finishes; the migration is a separate act by a
 * person, and on a good day it happens a minute later. In that minute — and on
 * a bad day, for an hour — the new code is talking to the old schema.
 *
 * Without this the failure is severe and silent in the worst way:
 * `listMemberships` selects `onboarding_step`, PostgREST answers `42703
 * column does not exist`, the query returns no rows, and
 * `resolveDestination` concludes the user belongs to no organisation and
 * sends them to `/welcome`. Every existing customer would be walked into
 * onboarding for a workspace they already have — and the ones who completed it
 * would end up with a second ICP.
 *
 * So the new columns are treated as a *capability* rather than an assumption,
 * probed once, exactly like `isSchemaApplied()` in `source.ts` treats the
 * schema as a whole. Before the migration the product behaves as it did
 * before this work: no setup card, no role-based layout, existing workspaces
 * reachable. After it, everything switches on with no second deploy.
 *
 * ── Why the answer is cached for the process ─────────────────────────────
 *
 * Same reasoning as `source.ts`: the answer changes exactly once, and probing
 * per request would add a round trip to every render forever to detect a
 * one-time transition. A migration involves a restart or a new deployment
 * either way, and both re-probe.
 *
 * The cache is deliberately one-way in practice — it can flip from false to
 * true when a process restarts after the migration, and there is no path that
 * un-applies a column.
 */

let applied: boolean | null = null;

/** Test seam. Resets the memoised answer. */
export function resetOnboardingSchemaProbe(): void {
  applied = null;
}

export async function hasOnboardingSchema(db: TenantClient): Promise<boolean> {
  if (applied !== null) return applied;

  const { error } = await db
    .from("organizations")
    .select("id, onboarding_step")
    .limit(1);

  if (!error) {
    applied = true;
    return true;
  }

  /*
   * `42703` is undefined_column and `PGRST204` is PostgREST's own "column not
   * found in schema cache". Both mean the migration has not run.
   *
   * Anything else — a network blip, a permissions problem — is NOT treated as
   * a missing column. Answering "not applied" for a transient failure would
   * silently downgrade a fully-migrated deployment for the life of the
   * process, and the memoisation means it would stay downgraded. So an
   * unrecognised error returns false *without caching*, and the next request
   * asks again.
   */
  const missing =
    error.code === "42703" ||
    error.code === "PGRST204" ||
    /onboarding_step/i.test(error.message);

  if (missing) {
    applied = false;
    return false;
  }

  return false;
}
