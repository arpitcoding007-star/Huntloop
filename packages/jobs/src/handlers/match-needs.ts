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
 *      required for a match. When the request, the candidates and their
 *      evidence are what they were last time, the stored answer is reused
 *      (0066): an open request is re-matched daily, and a buyer should not pay
 *      daily for the same question.
 *   4. Matches whose offering is paused, removed or no longer fits are deleted.
 *      One that was merely not recalled (a suspended supplier, a category
 *      over the limit) is left as it was.
 */
import { createHash } from "node:crypto";
import { explainMatch, MAX_EXPLAIN_CANDIDATES, type ExplainMatchInput } from "@huntloop/ai";
import { AiUnavailable, runForOrg } from "../ai.ts";
import {
  applyExplanations,
  eligible,
  rankMatches,
  reusableExplanations,
  scoreMatch,
  splitMustHaves,
  type MatchNeed,
  type MatchOffering,
  type MatchResult,
  type StoredExplanation,
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

  const { data: existingRows, error: existingError } = await db
    .from("exchange_matches")
    .select("id, offering_id, explained")
    .eq("need_id", row.id)
    .limit(1000);
  if (existingError) return { ok: false, error: `match_needs: ${existingError.message}` };
  const existing = (existingRows ?? []) as { id: string; offering_id: string; explained: StoredExplanation | null }[];

  /* Read beside the candidates, so a match left over from an earlier run is
     judged by the same rules. */
  const recalledIds = new Set(ids);
  const readIds = [...new Set([...ids, ...existing.map((m) => m.offering_id)])];
  let offerings: unknown[] = [];
  if (readIds.length) {
    const { data, error: offeringsError } = await db
      .from("exchange_offerings")
      .select(
        "id, org_id, category_id, title, description, price_from, price_to, currency, moq, availability, availability_as_of, " +
          "serves_global, serves_countries, exchange_provider_profiles(name, claimed_at, verified_at, deleted_at)",
      )
      .in("id", readIds)
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
  const fits = new Set<string>();
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
    fits.add(raw.id);
    if (!recalledIds.has(raw.id)) continue;
    results.push(scoreMatch(n, offering, ctx.now));
    text.set(raw.id, { title: String(raw.title ?? ""), description: raw.description ?? null, provider: String(provider.name ?? "") });
  }

  results = rankMatches(results);
  const explained = await explain(row, category, results, text, new Map(existing.map((m) => [m.offering_id, m.explained])));
  if (explained) results = rankMatches(explained.results);

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
        explained: explained?.stored.get(r.offeringId) ?? null,
        computed_at: ctx.now.toISOString(),
      })),
      { onConflict: "need_id,offering_id" },
    );
    if (writeError) return { ok: false, error: `match_needs: ${writeError.message}` };
  }

  const stale = existing.filter((m) => !fits.has(m.offering_id)).map((m) => m.id);
  if (stale.length) {
    const { error: staleError } = await db.from("exchange_matches").delete().in("id", stale);
    if (staleError) return { ok: false, error: `match_needs: ${staleError.message}` };
  }

  return {
    ok: true,
    result: {
      candidates: recalledIds.size,
      matched: results.length,
      removed: stale.length,
      explained: explained ? (explained.reused ? "unchanged" : "yes") : "no",
    },
  };
}

/**
 * A key of everything the model would read, and the prompt it would read it
 * with. Candidates are sorted: a different order is the same question.
 */
export function explainKey(input: ExplainMatchInput): string {
  const candidates = [...input.candidates]
    .sort((a, b) => a.offeringId.localeCompare(b.offeringId))
    .map((c) => ({ ...c, evidence: [...c.evidence].sort((a, b) => a.id.localeCompare(b.id)) }));
  return createHash("sha256")
    .update(JSON.stringify({ prompt: explainMatch.prompt.version, need: input.need, candidates }))
    .digest("hex");
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
  previous: Map<string, StoredExplanation | null>,
): Promise<{ results: MatchResult[]; stored: Map<string, StoredExplanation>; reused: boolean } | null> {
  const top = ranked.filter((r) => r.score !== null).slice(0, MAX_EXPLAIN_CANDIDATES);
  if (!top.length) return null;

  const db = OrgScope.global();
  const { data: evidenceRows, error: evidenceError } = await db
    .from("exchange_offering_evidence")
    .select("id, offering_id, kind, claim, source_url")
    .in(
      "offering_id",
      top.map((r) => r.offeringId),
    )
    .order("observed_at", { ascending: false })
    /* A second key, so ties read in one order and the cap keeps the same rows. */
    .order("id", { ascending: true })
    .limit(MAX_EXPLAIN_CANDIDATES * 8);
  /* An unread evidence table must not be judged, or remembered, as no evidence. */
  if (evidenceError) return null;
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

  const key = explainKey(input);
  const counts = new Map(input.candidates.map((c) => [c.offeringId, c.evidence.length]));
  const topIds = top.map((r) => r.offeringId);
  const before = reusableExplanations(key, topIds, previous);
  if (before) {
    return {
      results: applyExplanations(ranked, before, mustHaves.length, counts),
      stored: new Map(topIds.map((id) => [id, previous.get(id)!])),
      reused: true,
    };
  }

  try {
    const run = await runForOrg(new OrgScope(need.org_id), explainMatch, input);
    const answers = new Map(run.output.candidates.map((c) => [c.offeringId, c]));
    return {
      results: applyExplanations(ranked, run.output.candidates, mustHaves.length, counts),
      stored: new Map(topIds.map((id) => [id, { key, candidate: answers.get(id) ?? null }])),
      reused: false,
    };
  } catch (e) {
    if (!(e instanceof AiUnavailable)) {
      console.error(`match_needs ${need.id}: explain_match failed, keeping measured dimensions: ${e instanceof Error ? e.message : String(e)}`);
    }
    return null;
  }
}
