"use server";

import { research } from "../../../../lib/ai/research";
import type { ResearchResult } from "../../../../lib/ai/research";
import { toFailureState } from "../../../../lib/ai/outcome";
import type { CompanyUnderstanding } from "@huntloop/ai";
import { orgSlugSchema, parseInput, urlInputSchema, uuidSchema } from "../../../../lib/validation";
import { captureForViewer } from "../../../../lib/analytics";
import { saveCompanyStep } from "../../../../lib/data/onboarding";
import { fail, type ActionResult } from "../../../../lib/data/org";
import { createWorkspace } from "../actions";
import { claimResearch } from "../../../../lib/data/onboarding";
import { canonicalizeDomain } from "@huntloop/db/identity";
import { requestToJoin } from "../../../../lib/data/directory";

/**
 * Step two's two actions: read the site, then keep what the user confirmed.
 *
 * ── Why creating the workspace happens here ──────────────────────────────
 *
 * Research is metered. `resolveRecorder` attributes the model call to an org,
 * `consumeRateLimit` needs one, and `withinAiBudget` reads its counters — so a
 * call that cannot be attributed to a tenant is a call nobody is accountable
 * for paying for. The organisation therefore has to exist *before* the
 * research runs, which is why this action creates it rather than a separate
 * screen asking for a name.
 *
 * The name it is created with is provisional — the domain's root label — and
 * is replaced by the company's own name for itself once the research returns.
 * The slug is not: it is in every URL from this moment on, `0001` makes it
 * globally unique, and renaming it later could collide with another tenant's.
 */

export interface ResearchState {
  result?: ResearchResult;
  /** The workspace the research was attributed to. Needed by every later step. */
  org?: string;
  error?: string;
  /** Present when `error` is a rate-limit refusal. See lib/ai/outcome.ts. */
  rateLimited?: { retryAt: string | null };
}

export async function researchCompanyAction(
  url: string,
  existingOrg?: string,
): Promise<ResearchState> {
  const target = parseInput(urlInputSchema, url, "address");
  if (!target.ok) return { error: target.error };

  /* An org may already exist — the user came back to this step, or was
     invited, or is re-running research from settings. Reusing it is what stops
     a refresh on this screen producing a second workspace nobody asked for. */
  let slug: string;
  if (existingOrg) {
    const parsed = parseInput(orgSlugSchema, existingOrg, "organisation");
    if (!parsed.ok) return { error: parsed.error };
    slug = parsed.value;
  } else {
    const created = await createWorkspace(target.value);
    if (!created.ok) return { error: created.error };
    slug = created.data.slug;
  }

  /*
   * The reading may already exist.
   *
   * Somebody who typed their domain on the landing page has been researched
   * once already, anonymously. Claiming that instead of running the task again
   * saves the most expensive call in the product — several page fetches plus
   * Opus at high effort — and, more to the point, means the profile they were
   * shown before signing up is the profile they get afterwards. A second run
   * would produce a slightly different reading, and they would have signed up
   * on the strength of one and received the other.
   *
   * Only when it is about the same company. `claim_research` matches on the
   * caller's verified email domain, which can legitimately differ from the site
   * they are now entering — an agency setting up a client, most obviously — and
   * substituting one for the other would be worse than paying for the call.
   */
  const claimed = await claimResearch();
  if (claimed && sameCompany(claimed.domain, target.value)) {
    await captureForViewer("onboarding_step_completed", {
      step: "company",
      aiConfigured: claimed.isLive,
    });
    return {
      result: {
        source: claimed.isLive ? "live" : "unconfigured",
        metered: false,
        understanding: claimed.understanding,
      },
      org: slug,
    };
  }

  const outcome = await research(slug, target.value);

  /*
   * Completed *or* failed, both recorded.
   *
   * A funnel built only from successes cannot distinguish "people stop here"
   * from "this step breaks here", and those call for opposite responses — one
   * is a copy problem, the other is an outage. `aiConfigured` separates a real
   * research run from the worked example, so a deployment with no key does not
   * quietly inflate the completion rate.
   *
   * The URL the user pasted is never sent. It is their own company's address
   * during onboarding, and it is exactly the kind of thing that ends up in a
   * telemetry pipeline by accident.
   */
  await captureForViewer(
    outcome.ok ? "onboarding_step_completed" : "onboarding_step_failed",
    {
      step: "company",
      ...(outcome.ok
        ? { aiConfigured: outcome.result.source === "live" }
        : { reason: outcome.kind === "rate_limited" ? "rate_limited" : "model_refused" }),
    },
  );

  return outcome.ok
    ? { result: outcome.result, org: slug }
    : { ...toFailureState(outcome), org: slug };
}

/**
 * Keeps what the user confirmed.
 *
 * The understanding arrives from the client because that is where it was
 * edited, and the edits are the point: `ProductStep`'s whole design is that a
 * model's reading of your site is a draft you correct. Re-running research on
 * submit would discard exactly the corrections this step exists to collect.
 *
 * It is bounded rather than trusted. What it can influence is this org's own
 * `products` row and its own name — there is nothing here to escalate with,
 * and a tampered payload produces a wrong description for the tenant that sent
 * it and nobody else.
 */
export async function saveCompanyAction(
  org: string,
  understanding: unknown,
  isLive: boolean,
): Promise<ActionResult<{ productId: string }>> {
  const slug = parseInput(orgSlugSchema, org, "organisation");
  if (!slug.ok) return fail(slug.error);

  const parsed = parseUnderstanding(understanding);
  if (!parsed) return fail("That company profile isn't something we can save.");

  /* `isLive` travels from the research result rather than being re-derived:
     whether a model actually ran is a fact about the call that produced this
     understanding, and `isAiConfigured()` read again here could disagree with
     it if a key were added between the two requests. */
  return saveCompanyStep(slug.value, parsed, isLive === true);
}

/**
 * A hand-written parser rather than a Zod schema.
 *
 * `CompanyUnderstanding` is defined in `@huntloop/ai` and its `findings` array
 * is closed over `RESEARCH_FIELDS` — a Zod copy here would be a second
 * definition of the same shape, and the one that decides what the *task*
 * produces is not this one. What matters at this boundary is bounds, and those
 * are cheap to write directly.
 */
function parseUnderstanding(value: unknown): CompanyUnderstanding | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;

  const str = (v: unknown, max: number): string | null =>
    typeof v === "string" && v.trim() && v.length <= max ? v.trim() : null;

  const companyName = str(raw.companyName, 200);
  const url = str(raw.url, 2048);
  const canonicalDomain = str(raw.canonicalDomain, 253);
  if (!companyName || !url || !canonicalDomain) return null;

  if (!Array.isArray(raw.findings)) return null;

  const findings = raw.findings.slice(0, 20).flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const f = item as Record<string, unknown>;
    const field = str(f.field, 40);
    const label = str(f.label, 120);
    const kind = f.kind;
    if (!field || !label) return [];
    if (kind !== "fact" && kind !== "inference" && kind !== "unknown") return [];
    return [
      {
        field,
        label,
        kind,
        // Bounded at 4 000, which is what `products.description` and
        // `value_props` are comfortable holding.
        value: typeof f.value === "string" ? f.value.slice(0, 4000) : "",
        sourceUrl: str(f.sourceUrl, 2048),
        confidence:
          f.confidence === "high" || f.confidence === "medium" || f.confidence === "low"
            ? f.confidence
            : null,
      },
    ];
  });

  return { url, canonicalDomain, companyName, findings } as CompanyUnderstanding;
}

/**
 * Whether a claimed reading is about the site the user is entering.
 *
 * Compared on the canonical domain rather than on the raw strings, so
 * `https://www.Acme.com/pricing` and `acme.com` are recognised as one company —
 * which is the whole reason `canonicalizeDomain` exists. A mismatch is not an
 * error and is not reported: it simply means this is a different company, and
 * the normal research path runs.
 */
function sameCompany(claimedDomain: string, entered: string): boolean {
  const target = canonicalizeDomain(entered);
  return Boolean(target) && target === canonicalizeDomain(claimedDomain);
}

/**
 * Ask to join a workspace a colleague already made.
 *
 * A thin pass-through: `request_to_join` in `0027` does the authorization, and
 * it is the only place that can — the caller is by definition not a member, so
 * every RLS policy in the schema refuses them and `mutate` would too.
 *
 * The uuid is bounded here rather than trusted, for the reason every id
 * crossing this boundary is: it turns a tampered value into a sentence instead
 * of Postgres error `22P02`.
 */
export async function requestJoinAction(
  orgId: string,
): Promise<ActionResult<undefined>> {
  const parsed = parseInput(uuidSchema, orgId, "workspace");
  if (!parsed.ok) return fail(parsed.error);

  return requestToJoin(parsed.value);
}
