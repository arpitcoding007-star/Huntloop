import "server-only";
import { expandWithLookAlikes } from "@huntloop/jobs";
import { translateIcp } from "@huntloop/db/discovery";
import { canonicalizeDomain } from "@huntloop/db/identity";
import type { Icp } from "@huntloop/db/icp";

/**
 * "What would these example companies do to my search?" — answered before a
 * search exists.
 *
 * ── The gap this closes (`ONB-22`) ───────────────────────────────────────
 *
 * `SearchPreview` shows what the examples contributed by diffing the *saved*
 * `discovery_queries` row against the profile's own translation. That is the
 * right thing to show for a workspace that has been running, and it is
 * unreachable for the person the feature is aimed at: somebody typing their
 * first example domain has no saved query, so the panel renders nothing and
 * the field appears to do nothing. They find out what it did on the next
 * discovery run — which is the wrong moment to learn that a search they are
 * paying for was widened using attributes they never typed.
 *
 * This runs the same expansion on demand, against the criteria as currently
 * edited, and reports the result without saving anything.
 *
 * ── Why it re-runs the expansion rather than predicting it ───────────────
 *
 * Because a prediction is a second implementation of `expandWithLookAlikes`
 * that agrees with it until one of them changes. Calling the real function
 * means the preview is wrong only when the search would also be wrong — and
 * enrichment results are cached, so the discovery run that follows a preview
 * of the same domains costs nothing extra.
 *
 * ── What it costs, and what bounds it ────────────────────────────────────
 *
 * One metered `company.enrich` call per example, capped at five by
 * `expandWithLookAlikes` itself. It is not separately rate-limited, for the
 * reason `estimateReach` is not: provider spend is bounded by the credit
 * ledger and the budget guard in `@huntloop/providers`, which is the control
 * that actually knows what has been spent. `mutate` establishes a verified
 * membership before the org id reaches this, which is what makes it safe to
 * hand that id to code running under the service-role client.
 */

export interface LookAlikePreview {
  /** Domains that were read. */
  resolved: string[];
  /** What they would contribute, in words. Empty when they add nothing new. */
  added: string[];
  /** Why nothing was added, when nothing was. Null when something was. */
  skipped: string | null;
  /** Entries that are not domains, so were never looked up. */
  notDomains: string[];
  /** Domains past the cap, which this run did not read. */
  beyondCap: string[];
  /** Domains that were tried and could not be read just now. */
  unreadable: string[];
}

/**
 * The cap `expandWithLookAlikes` applies, restated so the preview can say
 * which entries fell past it.
 *
 * A second copy of a constant is a real cost, and the alternative was worse:
 * exporting it would put a tuning detail of the expansion into the package's
 * public surface, and inferring the cap from the length of `resolved` cannot
 * distinguish "we stopped at five" from "the sixth failed to enrich" — which
 * are different sentences to show a user.
 */
const PREVIEW_EXAMPLE_CAP = 5;

export async function previewLookAlikes(
  orgId: string,
  icp: Icp,
): Promise<LookAlikePreview> {
  const examples = icp.criteria.exampleCompanies ?? [];

  /* Classified before the call so the report can name *which* entry did what.
     `expandWithLookAlikes` says "none of these is a domain" only when every
     one failed, which on a form leaves a user who typed "Stripe" beside
     "ramp.com" with a result that looks like it used both. */
  const notDomains: string[] = [];
  const domains: string[] = [];
  for (const value of examples) {
    const domain = canonicalizeDomain(value);
    if (domain) domains.push(domain);
    else notDomains.push(value);
  }

  const beyondCap = domains.slice(PREVIEW_EXAMPLE_CAP);

  /* The baseline is the profile's own translation — the same starting point a
     discovery run uses — so "added" means here exactly what it means on the
     saved-search panel. */
  const { filters } = translateIcp(icp);
  const result = await expandWithLookAlikes(orgId, filters, examples);

  const resolved = new Set(result.resolved);
  const unreadable = domains
    .slice(0, PREVIEW_EXAMPLE_CAP)
    .filter((domain) => !resolved.has(domain));

  return {
    resolved: result.resolved,
    added: result.added,
    skipped: result.skipped,
    notDomains,
    beyondCap,
    unreadable,
  };
}
