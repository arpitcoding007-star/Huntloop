/**
 * `match_needs` — match one open Exchange need against active offerings
 * (build plan DN-50, DN-41, DN-44).
 *
 * Runs only when the need's category has `matching_enabled` (0060): a
 * category without supply is gated, and the need stays saved and counted.
 * Reads across workspaces with the service client — needs and offerings live
 * in different ones by design — and writes `exchange_matches`, which no
 * session can write (0060). The firewall holds: nothing here touches people,
 * contact points, enrichment or sequences.
 *
 * Steps:
 *   1. Recall (0062): the category's active offerings, best text match to the
 *      need's words first, so a large category keeps its most relevant 500.
 *   2. Hard filters and the measured dimensions (`exchange-match.ts`).
 *   3. `explain_match` on the top 20 scored: must-haves against published
 *      evidence (the `requirement` dimension) and one reason each. Charged to
 *      the buyer's workspace. With no model, a pause or no budget, the
 *      deterministic result stands — the model adds a dimension, it is never
 *      required for a match.
 */
import { explainMatch, MAX_EXPLAIN_CANDIDATES, type ExplainMatchInput } from "@huntloop/ai";
import { AiUnavailable, runForOrg } from "../ai.ts";
import {
  applyExplanations,
  eligible,
  rankMatches,
  scoreMatch,
  splitMustHaves,
  type MatchNeed,
  type MatchOffering,
  type MatchResult,
} from "../exchange-match.ts";
import { OrgScope, embedded } from "../scope.ts";
import type { JobContext, JobOutcome } from "../registry.ts";

const MAX_CANDIDATES = 500;

type Requirement = Record<string, { value: string | null; kind: string } | undefined>;

export async function matchNeeds(ctx: JobContext): Promise<JobOutcome> {
  const needId = String(ctx.payload.needId ?? "");
  if (!needId) return { ok: false, permanent: true, error: "match_needs: no needId in payload." };
  const db = OrgScope.global();

  const { data: need, error } = await db
    .from("exchange_needs")
    .select(
      "id, org_id, category_id, quantity, budget_min, budget_max, currency, country, status, deleted_at, summary, requirement, " +
        "exchange_categories(name, matching_enabled, active, attributes)",
    )
    .eq("id", needId)
    .maybeSingle();
  if (error) return { ok: false, error: `match_needs: ${error.message}` };
  if (!need) return { ok: true, result: { skipped: "the need no longer exists" } };

  const row = need as unknown as MatchNeed & {
    status: string;
    deleted_at: string | null;
    summary: string | null;
    requirement: Requirement | null;
    exchange_categories: unknown;
  };
  if (row.deleted_at || row.status !== "open") return { ok: true, result: { skipped: `the need is ${row.deleted_at ? "removed" : row.status}` } };
  if (!row.category_id) return { ok: true, result: { skipped: "the need has no category yet" } };
  const category = embedded<{ name: string; matching_enabled: boolean; active: boolean; attributes: unknown }>(row.exchange_categories);
  if (!category?.active || !category.matching_enabled) {
    return { ok: true, result: { skipped: "matching is not switched on for this category yet", gated: true } };
  }

  const { data: recalled, error: recallError } = await db.rpc("exchange_recall_offerings", {
    p_need: row.id,
    p_limit: MAX_CANDIDATES,
  });
  if (recallError) return { ok: false, error: `match_needs: ${recallError.message}` };
  const ids = ((recalled ?? []) as unknown[]).map((r) =>
    typeof r === "string" ? r : String((r as Record<string, unknown>).exchange_recall_offerings ?? (r as Record<string, unknown>).id),
  );

  let offerings: unknown[] = [];
  if (ids.length) {
    const { data, error: offeringsError } = await db
      .from("exchange_offerings")
      .select(
        "id, org_id, category_id, title, description, price_from, price_to, currency, moq, availability, availability_as_of, " +
          "serves_global, serves_countries, exchange_provider_profiles(name, claimed_at, verified_at, deleted_at)",
      )
      .in("id", ids)
      .eq("status", "active")
      .is("deleted_at", null);
    if (offeringsError) return { ok: false, error: `match_needs: ${offeringsError.message}` };
    offerings = data ?? [];
  }

  const n: MatchNeed = {
    ...row,
    quantity: row.quantity === null ? null : Number(row.quantity),
    budget_min: row.budget_min === null ? null : Number(row.budget_min),
    budget_max: row.budget_max === null ? null : Number(row.budget_max),
  };

  let results: MatchResult[] = [];
  const text = new Map<string, { title: string; description: string | null; provider: string }>();
  for (const raw of offerings as (Omit<MatchOffering, "provider"> & {
    title: string;
    description: string | null;
    exchange_provider_profiles: unknown;
  })[]) {
    const provider = embedded<{ name: string; claimed_at: string | null; verified_at: string | null; deleted_at: string | null }>(
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
    if (!eligible(n, offering)) continue;
    results.push(scoreMatch(n, offering, ctx.now));
    text.set(raw.id, { title: String(raw.title ?? ""), description: raw.description ?? null, provider: String(provider.name ?? "") });
  }

  results = rankMatches(results);
  const explained = await explain(row, category, results, text);
  if (explained) results = rankMatches(explained);

  if (results.length) {
    const { error: writeError } = await db.from("exchange_matches").upsert(
      results.map((r) => ({
        need_id: row.id,
        offering_id: r.offeringId,
        org_id: row.org_id,
        score: r.score,
        dimensions: r.dimensions,
        explanation: r.explanation,
        cited: r.cited,
        computed_at: ctx.now.toISOString(),
      })),
      { onConflict: "need_id,offering_id" },
    );
    if (writeError) return { ok: false, error: `match_needs: ${writeError.message}` };
  }

  return {
    ok: true,
    result: { candidates: offerings.length, matched: results.length, explained: explained ? "yes" : "no" },
  };
}

/**
 * Runs `explain_match` over the top candidates and folds it in. Returns null
 * (keep the deterministic result) when there is nothing to explain or no
 * model to explain it with; a model failure is logged, not fatal.
 */
async function explain(
  need: { id: string; org_id: string; summary: string | null; requirement: Requirement | null },
  category: { name: string; attributes: unknown },
  ranked: MatchResult[],
  text: Map<string, { title: string; description: string | null; provider: string }>,
): Promise<MatchResult[] | null> {
  const top = ranked.filter((r) => r.score !== null).slice(0, MAX_EXPLAIN_CANDIDATES);
  if (!top.length) return null;

  const db = OrgScope.global();
  const { data: evidenceRows } = await db
    .from("exchange_offering_evidence")
    .select("id, offering_id, kind, claim, source_url")
    .in(
      "offering_id",
      top.map((r) => r.offeringId),
    )
    .order("observed_at", { ascending: false })
    .limit(MAX_EXPLAIN_CANDIDATES * 8);
  const evidence = new Map<string, ExplainMatchInput["candidates"][number]["evidence"]>();
  for (const e of (evidenceRows ?? []) as { id: string; offering_id: string; kind: "fact" | "inference" | "unknown"; claim: string; source_url: string | null }[]) {
    const list = evidence.get(e.offering_id) ?? [];
    list.push({ id: String(e.id), claim: e.claim, kind: e.kind, sourceUrl: e.source_url });
    evidence.set(e.offering_id, list);
  }

  const labels = new Map<string, string>();
  for (const a of Array.isArray(category.attributes) ? (category.attributes as { key?: unknown; label?: unknown }[]) : []) {
    if (typeof a?.key === "string" && typeof a.label === "string") labels.set(a.key, a.label);
  }
  const req = need.requirement ?? {};
  const facts = Object.entries(req)
    .filter(([k, v]) => k !== "must_haves" && v?.value)
    .map(([k, v]) => ({ label: labels.get(k) ?? k, value: String(v!.value).slice(0, 300) }));
  const mustHaves = splitMustHaves(req.must_haves?.value ?? null);

  const input: ExplainMatchInput = {
    needId: need.id,
    need: { summary: need.summary ?? "", categoryPath: category.name ?? null, facts, mustHaves },
    candidates: top.map((r) => ({
      offeringId: r.offeringId,
      title: text.get(r.offeringId)?.title ?? "",
      description: text.get(r.offeringId)?.description ?? null,
      provider: text.get(r.offeringId)?.provider ?? "",
      evidence: evidence.get(r.offeringId) ?? [],
    })),
  };

  try {
    const run = await runForOrg(new OrgScope(need.org_id), explainMatch, input);
    const counts = new Map(input.candidates.map((c) => [c.offeringId, c.evidence.length]));
    return applyExplanations(ranked, run.output.candidates, mustHaves.length, counts);
  } catch (e) {
    if (!(e instanceof AiUnavailable)) {
      console.error(`match_needs ${need.id}: explain_match failed, keeping measured dimensions: ${e instanceof Error ? e.message : String(e)}`);
    }
    return null;
  }
}
