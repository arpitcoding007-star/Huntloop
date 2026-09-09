import "server-only";
import { scoreIcp } from "@huntloop/db/icp";
import { getOnboardingIcp } from "./onboarding";

/**
 * How complete this workspace's profile is, and what would sharpen it.
 *
 * ── Why the score is recomputed rather than read ─────────────────────────
 *
 * `icps.quality_score` is a column, written by onboarding and by
 * `bump_icp_version_for_org`. Reading it would be one fewer parse — and it
 * would be *stale the moment somebody edits the ICP from the settings screen*,
 * which writes `criteria` without touching the score.
 *
 * `scoreIcp` is deterministic, pure, and a weighted count of populated fields.
 * Recomputing it costs nothing and cannot disagree with what the user is
 * looking at. The stored column stays useful for exactly the thing a live
 * recomputation cannot do: telling you what the score *was* at the version a
 * given opportunity was judged against.
 *
 * ── Why suggestions rather than a number ─────────────────────────────────
 *
 * "Your ICP is 72% complete" is a scold. It tells somebody they are wrong
 * without telling them what to do, and the only available action is to go and
 * hunt through a settings screen for whichever field is missing.
 *
 * `scoreIcp` already returns the missing factors sorted by weight, each with a
 * hint written beside the constraint it belongs to. Those hints are the whole
 * value here; the number is context for them.
 */

export interface IcpQualityCard {
  score: number;
  /** Highest-weight missing factors first. Empty when the profile is complete. */
  suggestions: string[];
}

export async function getIcpQuality(orgSlug: string): Promise<IcpQualityCard | null> {
  const icp = await getOnboardingIcp(orgSlug);

  /* No profile is not a low-quality profile, and must not be reported as one.
     A workspace without an ICP has a different problem with a different fix,
     and `SetupCard` is the thing that says so. */
  if (!icp) return null;

  const quality = scoreIcp(icp);

  // A complete profile gets no card. Congratulating somebody on a screen they
  // opened to do work is noise.
  if (quality.suggestions.length === 0) return null;

  return {
    score: quality.score,
    /* Two, not nine. The list is sorted by weight, so the first two are the
       highest-leverage things this profile is missing — and a card offering
       nine improvements is a backlog, which nobody actions. */
    suggestions: quality.suggestions.slice(0, 2),
  };
}
