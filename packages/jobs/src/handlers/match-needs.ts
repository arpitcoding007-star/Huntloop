/**
 * `match_needs` — match one open Exchange need against active offerings
 * (build plan DN-50).
 *
 * Runs only when the need's category has `matching_enabled` (0060): a
 * category without supply is gated, and the need stays saved and counted.
 * Reads across workspaces with the service client — needs and offerings live
 * in different ones by design — and writes `exchange_matches`, which no
 * session can write (0060). The firewall holds: nothing here touches people,
 * contact points, enrichment or sequences.
 */
import { eligible, rankMatches, scoreMatch, type MatchNeed, type MatchOffering } from "../exchange-match.ts";
import { OrgScope, embedded } from "../scope.ts";
import type { JobContext, JobOutcome } from "../registry.ts";

const MAX_CANDIDATES = 500;

export async function matchNeeds(ctx: JobContext): Promise<JobOutcome> {
  const needId = String(ctx.payload.needId ?? "");
  if (!needId) return { ok: false, permanent: true, error: "match_needs: no needId in payload." };
  const db = OrgScope.global();

  const { data: need, error } = await db
    .from("exchange_needs")
    .select(
      "id, org_id, category_id, quantity, budget_min, budget_max, currency, country, status, deleted_at, " +
        "exchange_categories(matching_enabled, active)",
    )
    .eq("id", needId)
    .maybeSingle();
  if (error) return { ok: false, error: `match_needs: ${error.message}` };
  if (!need) return { ok: true, result: { skipped: "the need no longer exists" } };

  const row = need as unknown as MatchNeed & {
    status: string;
    deleted_at: string | null;
    exchange_categories: unknown;
  };
  if (row.deleted_at || row.status !== "open") return { ok: true, result: { skipped: `the need is ${row.deleted_at ? "removed" : row.status}` } };
  if (!row.category_id) return { ok: true, result: { skipped: "the need has no category yet" } };
  const category = embedded<{ matching_enabled: boolean; active: boolean }>(row.exchange_categories);
  if (!category?.active || !category.matching_enabled) {
    return { ok: true, result: { skipped: "matching is not switched on for this category yet", gated: true } };
  }

  const { data: offerings, error: offeringsError } = await db
    .from("exchange_offerings")
    .select(
      "id, org_id, category_id, price_from, price_to, currency, moq, availability, availability_as_of, " +
        "serves_global, serves_countries, exchange_provider_profiles(claimed_at, verified_at, deleted_at)",
    )
    .eq("category_id", row.category_id)
    .eq("status", "active")
    .is("deleted_at", null)
    .limit(MAX_CANDIDATES);
  if (offeringsError) return { ok: false, error: `match_needs: ${offeringsError.message}` };

  const results = [];
  for (const raw of (offerings ?? []) as unknown as (Omit<MatchOffering, "provider"> & { exchange_provider_profiles: unknown })[]) {
    const provider = embedded<{ claimed_at: string | null; verified_at: string | null; deleted_at: string | null }>(
      raw.exchange_provider_profiles,
    );
    if (!provider || provider.deleted_at) continue;
    const offering: MatchOffering = {
      ...raw,
      serves_countries: Array.isArray(raw.serves_countries) ? raw.serves_countries : [],
      price_from: raw.price_from === null ? null : Number(raw.price_from),
      price_to: raw.price_to === null ? null : Number(raw.price_to),
      moq: raw.moq === null ? null : Number(raw.moq),
      provider,
    };
    const n: MatchNeed = {
      ...row,
      quantity: row.quantity === null ? null : Number(row.quantity),
      budget_min: row.budget_min === null ? null : Number(row.budget_min),
      budget_max: row.budget_max === null ? null : Number(row.budget_max),
    };
    if (!eligible(n, offering)) continue;
    results.push(scoreMatch(n, offering, ctx.now));
  }

  const ranked = rankMatches(results);
  if (ranked.length) {
    const { error: writeError } = await db.from("exchange_matches").upsert(
      ranked.map((r) => ({
        need_id: row.id,
        offering_id: r.offeringId,
        org_id: row.org_id,
        score: r.score,
        dimensions: r.dimensions,
        explanation: r.explanation,
        computed_at: ctx.now.toISOString(),
      })),
      { onConflict: "need_id,offering_id" },
    );
    if (writeError) return { ok: false, error: `match_needs: ${writeError.message}` };
  }

  return { ok: true, result: { candidates: (offerings ?? []).length, matched: ranked.length } };
}
