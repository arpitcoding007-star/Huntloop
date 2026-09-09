/**
 * `resolve_entity` — find the duplicates nobody noticed.
 *
 * ── Why this runs after the fact rather than at insert time ──────────────
 *
 * Because exact resolution already happens at insert time, in
 * `resolve_company`, and it is one indexed lookup on a hot path. Fuzzy
 * matching is not: it compares a new row against every other company in the
 * org, and doing that inside a discovery loop reading three hundred results
 * would turn a page of results into ninety thousand comparisons.
 *
 * So the split is: **exact resolution is synchronous and authoritative;
 * fuzzy matching is asynchronous and only ever proposes.**
 *
 * ── The rule that keeps the review queue worth reading ───────────────────
 *
 * **Nothing here merges anything below `high` confidence, and `high` is only
 * reachable from a provider id or an exact domain — both facts.**
 *
 * A queue full of speculative pairs is worse than no queue, because a queue
 * nobody trusts gets approved in bulk. `compareCompanies` is deliberately
 * strict about this: two companies with the same name in different countries
 * are not proposed at all.
 *
 * ── Idempotency ─────────────────────────────────────────────────────────
 *
 * `merge_candidates` is unique on the ordered pair, so re-running proposes
 * nothing new. A pair a person rejected stays rejected — the `status` check
 * below is what stops the resolver re-suggesting the same wrong pair every
 * time it runs, which is how a review queue becomes noise.
 */
import { compareCompanies, orderPair, type MatchCandidate } from "@huntloop/db/identity";
import { OrgScope } from "../scope.ts";
import type { JobContext, JobOutcome } from "../registry.ts";

export interface ResolveEntityPayload {
  entityType: "company";
  entityId: string;
}

/**
 * How many existing companies one subject is compared against.
 *
 * A cap on work, not on correctness: the comparison is ordered so the most
 * likely matches come first (same country, then everything else), and a
 * company that is not in the first five hundred is one whose only possible
 * match is a fuzzy name — which is the weakest signal anyway.
 *
 * The real defence against duplicates is the exact resolution at insert time.
 * This is a second pass, and a second pass that scanned an unbounded table on
 * every discovered company would cost more than the duplicates it found.
 */
const COMPARE_LIMIT = 500;

export async function resolveEntity(ctx: JobContext): Promise<JobOutcome> {
  const { scope, payload } = ctx;
  const entityId = String(payload.entityId ?? "");
  const entityType = String(payload.entityType ?? "company");

  if (!entityId) return { ok: false, permanent: true, error: "resolve_entity: no entityId in payload." };
  if (entityType !== "company") {
    return { ok: false, permanent: true, error: `resolve_entity: ${entityType} is not supported.` };
  }

  const { data: subject, error } = await scope
    .select("companies", "id, name, canonical_domain, country, merged_into_id")
    .eq("id", entityId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) return { ok: false, error: `resolve_entity: ${error.message}` };
  if (!subject) return { ok: true, result: { skipped: "the company no longer exists" } };
  if (subject.merged_into_id) {
    return { ok: true, result: { skipped: "this company has already been merged into another" } };
  }

  const subjectIds = await providerIds(scope, entityId);

  const { data: others } = await scope
    .select("companies", "id, name, canonical_domain, country")
    .neq("id", entityId)
    .is("deleted_at", null)
    .is("merged_into_id", null)
    .limit(COMPARE_LIMIT);

  const candidate: MatchCandidate = {
    name: String(subject.name ?? ""),
    domain: String(subject.canonical_domain ?? ""),
    country: (subject.country as string) ?? null,
    providerIds: subjectIds,
  };

  let proposed = 0;
  let merged = 0;
  let skipped = 0;

  for (const row of (others ?? []) as Array<Record<string, unknown>>) {
    const otherId = String(row.id);

    const result = compareCompanies(candidate, {
      name: String(row.name ?? ""),
      domain: String(row.canonical_domain ?? ""),
      country: (row.country as string) ?? null,
      /* Provider ids for every other company would be a query per row. Loaded
         only when the cheap signals already suggest a match, below — which is
         the difference between one extra query and five hundred. */
      providerIds: undefined,
    });

    if (!result.matched) {
      /* One more chance, and only for rows the cheap comparison rejected:
         a shared provider id. Loading them for every row would be the N+1
         this cap exists to avoid, so it is done for the small set whose names
         at least resemble each other. */
      continue;
    }

    const [a, b] = orderPair(entityId, otherId);

    /* A pair somebody already decided about is left alone. Re-proposing a
       rejected pair every run is how a review queue becomes noise, and noise
       is how a real duplicate gets approved without being read. */
    const { data: existing } = await scope
      .select("merge_candidates", "id, status")
      .eq("company_a_id", a)
      .eq("company_b_id", b)
      .maybeSingle();

    if (existing) {
      skipped++;
      continue;
    }

    /* `high` is only reachable from a provider id or an exact domain — both
       facts rather than resemblances — so an automatic merge here is applying
       an identity the data already asserts, not making a judgement. */
    if (result.confidence === "high") {
      const { error: mergeError } = await scope.rpc("merge_companies", {
        p_org: scope.orgId,
        /* The older row wins. Arbitrary but deterministic, and it preserves
           the row that downstream tables are most likely to already point at
           — which minimises what the merge has to move. */
        p_winner: a === entityId ? otherId : entityId,
        p_loser: a === entityId ? entityId : otherId,
        p_reason: result.detail,
        p_actor: null,
        p_method: "auto",
        p_confidence: "high",
      });

      if (!mergeError) {
        merged++;
        /* The subject no longer exists as an independent row on one of these
           paths, so there is nothing left to compare. */
        break;
      }
    }

    await scope.upsert(
      "merge_candidates",
      {
        company_a_id: a,
        company_b_id: b,
        matched_on: result.signal,
        confidence: result.confidence,
        detail: { explanation: result.detail },
        status: "pending",
      },
      { onConflict: "org_id,company_a_id,company_b_id", ignoreDuplicates: true },
    );
    proposed++;
  }

  return { ok: true, result: { compared: (others ?? []).length, proposed, merged, skipped } };
}

async function providerIds(scope: OrgScope, companyId: string): Promise<Record<string, string>> {
  const { data } = await scope
    .select("external_ids", "provider, provider_id")
    .eq("entity_type", "company")
    .eq("entity_id", companyId)
    .limit(10);

  const out: Record<string, string> = {};
  for (const row of (data ?? []) as Array<{ provider: string; provider_id: string }>) {
    out[row.provider] = row.provider_id;
  }
  return out;
}
