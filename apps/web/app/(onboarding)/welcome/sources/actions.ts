"use server";

import { recommend } from "../../../../lib/ai/sources";
import type { SourcesResult } from "../../../../lib/ai/sources";
import { toFailureState } from "../../../../lib/ai/outcome";
import { orgSlugSchema, parseInput } from "../../../../lib/validation";
import { captureForViewer } from "../../../../lib/analytics";
import { getActiveIcp } from "../../../../lib/data/icp";
import { requireOrgId } from "../../../../lib/data/org";
import { resolveDataSource } from "../../../../lib/data/source";

/**
 * §10 — source discovery.
 *
 * ── What changed, and why it matters more than it looks ──────────────────
 *
 * The ICP used to arrive **from the client**, out of `sessionStorage`. The
 * comment defending that was careful and its reasoning was sound at the time:
 * `recommend_sources` constrains every recommendation's basis to the elements
 * of whatever profile it is handed, so a tampered ICP produces recommendations
 * traceable to that ICP and nothing more — there was nothing to escalate with.
 *
 * It is still true, and it is no longer the point. The ICP is now a row
 * (`0024`'s flow writes it in the previous step), and reading it from the
 * database rather than from the browser means the recommendations are
 * justified by *the profile this workspace actually has* — not by a copy that
 * a refresh, a second tab, or a device change could have made stale. The two
 * were the same object only for as long as the flow was one uninterrupted
 * sitting, which is not a property a setup flow should depend on.
 */

export interface SourcesState {
  result?: SourcesResult;
  error?: string;
  /** Present when `error` is a rate-limit refusal. See lib/ai/outcome.ts. */
  rateLimited?: { retryAt: string | null };
  /** True when there is no profile to recommend from — a state, not a failure. */
  noIcp?: boolean;
}

export async function recommendSourcesAction(org: string): Promise<SourcesState> {
  const slug = parseInput(orgSlugSchema, org, "organisation");
  if (!slug.ok) return { error: slug.error };

  /*
   * Demo mode has no membership to resolve, and `requireOrgId` is right to
   * refuse one — it exists to make a live request that slipped past the
   * layout's 404 fail loudly rather than return an empty list.
   *
   * So it is only asked when there is a database. `getActiveIcp` ignores the
   * id and returns its fixture when there is none, which is what lets the last
   * step of onboarding be walked through on a fresh checkout. Passing a
   * placeholder is safe precisely because nothing reads it in that branch.
   */
  const { db } = await resolveDataSource();

  let orgId = "demo";
  if (db) {
    /* Caught rather than propagated: this is a setup screen, and a 500 on the
       last step loses everything the user has done, where a message does not. */
    try {
      orgId = await requireOrgId(slug.value, "recommendSources");
    } catch {
      return { error: "You are not a member of this workspace." };
    }
  }

  const { data: icp } = await getActiveIcp(orgId);
  if (!icp) return { noIcp: true };

  const outcome = await recommend(slug.value, icp);

  // No part of the ICP is sent to analytics. It is the customer's description
  // of who they sell to, which is close to the most commercially sensitive
  // thing they will type into this product.
  await captureForViewer(
    outcome.ok ? "onboarding_step_completed" : "onboarding_step_failed",
    {
      step: "sources",
      ...(outcome.ok
        ? { aiConfigured: outcome.result.source === "live" }
        : { reason: outcome.kind === "rate_limited" ? "rate_limited" : "model_refused" }),
    },
  );

  return outcome.ok ? { result: outcome.result } : toFailureState(outcome);
}
