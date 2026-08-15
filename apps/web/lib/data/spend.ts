import type { TenantClient } from "@huntloop/db";
import { load, type Loaded } from "./source";

/**
 * What the model calls cost, read out of `ai_runs`.
 *
 * ANL-02. The schema, the cache-aware cost model in `packages/ai/src/models.ts`,
 * and the invariant that the row is written *before* the call have all existed
 * since the beginning — and nothing read the table. All the hard work was
 * already done and there was no screen.
 *
 * ── Why this query is safe to write before there is a database to run it on ──
 *
 * `lib/data/opportunities.ts` deliberately throws rather than returning a
 * guess, on the reasoning that assembling the §47 page needs evidence,
 * triggers and buyers joined in, and writing that blind produces a query that
 * reads as finished and has never returned a row. That reasoning is right, and
 * it does not apply here: this is one table, no joins, and every column it
 * touches is asserted by the migration test. The failure modes of a
 * single-table aggregate are visible by reading it.
 *
 * It still goes through `load()`, so an unconfigured or unmigrated deployment
 * gets the demo figures and the banner that says they are demo figures.
 */

export interface SpendRun {
  id: string;
  task: string;
  model: string;
  status: "started" | "succeeded" | "failed";
  costCents: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  latencyMs: number | null;
  createdAt: string;
}

export interface SpendSummary {
  runs: SpendRun[];
  totalCents: number;
  /** Runs that never reported an outcome — see the note in the page. */
  strandedCount: number;
  failedCount: number;
  byTask: { task: string; runs: number; cents: number }[];
  byModel: { model: string; runs: number; cents: number }[];
  /**
   * Share of input tokens served from the prompt cache.
   *
   * Worth surfacing rather than burying: the system prompt is byte-identical
   * across every company researched under one ICP, so this should be high from
   * the second call onward. If it collapses, prompt caching has broken and the
   * bill is about to be roughly ten times larger — this number is how anyone
   * would find out.
   */
  cacheHitRate: number | null;
}

/** How far back the screen looks. Thirty days is a billing period. */
const WINDOW_DAYS = 30;

/** Guards against a runaway table making the page unloadable. */
const MAX_ROWS = 500;

function summarise(runs: SpendRun[]): SpendSummary {
  const byTask = new Map<string, { runs: number; cents: number }>();
  const byModel = new Map<string, { runs: number; cents: number }>();

  let totalCents = 0;
  let strandedCount = 0;
  let failedCount = 0;
  let cachedInput = 0;
  let totalInput = 0;

  for (const run of runs) {
    totalCents += run.costCents;
    if (run.status === "started") strandedCount++;
    if (run.status === "failed") failedCount++;

    cachedInput += run.cacheReadTokens;
    totalInput += run.inputTokens + run.cacheReadTokens;

    const task = byTask.get(run.task) ?? { runs: 0, cents: 0 };
    byTask.set(run.task, { runs: task.runs + 1, cents: task.cents + run.costCents });

    const model = byModel.get(run.model) ?? { runs: 0, cents: 0 };
    byModel.set(run.model, { runs: model.runs + 1, cents: model.cents + run.costCents });
  }

  const rank = <T extends { cents: number }>(entries: T[]) =>
    [...entries].sort((a, b) => b.cents - a.cents);

  return {
    runs,
    totalCents,
    strandedCount,
    failedCount,
    byTask: rank([...byTask].map(([task, v]) => ({ task, ...v }))),
    byModel: rank([...byModel].map(([model, v]) => ({ model, ...v }))),
    // Null rather than 0 when nothing has run. "0% cache hit rate" is a claim
    // about caching; "no data" is the truth, and §7 is the whole reason this
    // codebase distinguishes them.
    cacheHitRate: totalInput > 0 ? cachedInput / totalInput : null,
  };
}

interface AiRunRow {
  id: string;
  task: string;
  model: string;
  status: string;
  cost_cents: number | string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cache_read_tokens: number | null;
  latency_ms: number | null;
  created_at: string;
}

function toRun(row: AiRunRow): SpendRun {
  return {
    id: row.id,
    task: row.task,
    model: row.model,
    status:
      row.status === "succeeded" || row.status === "failed" ? row.status : "started",
    // `cost_cents` is `numeric`, which PostgREST returns as a string to avoid
    // the precision loss a float would introduce. Number() here is safe for
    // display; it must not become the basis of an invoice.
    costCents: Number(row.cost_cents ?? 0),
    inputTokens: row.input_tokens ?? 0,
    outputTokens: row.output_tokens ?? 0,
    cacheReadTokens: row.cache_read_tokens ?? 0,
    latencyMs: row.latency_ms,
    createdAt: row.created_at,
  };
}

export async function getSpend(orgId: string): Promise<Loaded<SpendSummary>> {
  return load(
    async (db: TenantClient) => {
      const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString();

      const { data, error } = await db
        .from("ai_runs")
        .select(
          "id, task, model, status, cost_cents, input_tokens, output_tokens, cache_read_tokens, latency_ms, created_at",
        )
        .eq("org_id", orgId)
        .gte("created_at", since)
        // Matches `ai_runs_cost_idx (org_id, task, created_at desc)` on its
        // first and third columns, so the ordering is index-supported rather
        // than a sort of the whole window.
        .order("created_at", { ascending: false })
        .limit(MAX_ROWS);

      // Not caught and downgraded to fixtures. A configured deployment that
      // quietly showed invented spend instead of an error would be showing
      // someone a number they might act on.
      if (error) throw new Error(`Could not read ai_runs: ${error.message}`);

      return summarise((data ?? []).map(toRun));
    },
    () => summarise(DEMO_RUNS),
  );
}

/**
 * Demo figures.
 *
 * Shaped like a real week rather than picked to look good: the run that is
 * still `started` is there because that state is the whole point of writing
 * the accounting row before the call, and a demo that never shows it teaches
 * the wrong thing about the screen.
 */
const DEMO_RUNS: SpendRun[] = [
  {
    id: "run_01",
    task: "qualify_opportunity",
    model: "claude-opus-5",
    status: "succeeded",
    costCents: 41.2,
    inputTokens: 4_800,
    outputTokens: 2_100,
    cacheReadTokens: 38_400,
    latencyMs: 24_800,
    createdAt: "2026-08-13T09:12:00Z",
  },
  {
    id: "run_02",
    task: "research_company",
    model: "claude-opus-5",
    status: "succeeded",
    costCents: 88.6,
    inputTokens: 12_300,
    outputTokens: 3_400,
    cacheReadTokens: 41_000,
    latencyMs: 51_300,
    createdAt: "2026-08-13T08:44:00Z",
  },
  {
    id: "run_03",
    task: "explain_why_now",
    model: "claude-opus-5",
    status: "succeeded",
    costCents: 12.4,
    inputTokens: 2_100,
    outputTokens: 900,
    cacheReadTokens: 38_400,
    latencyMs: 9_100,
    createdAt: "2026-08-13T08:41:00Z",
  },
  {
    id: "run_04",
    task: "qualify_opportunity",
    model: "claude-opus-5",
    status: "failed",
    costCents: 6.1,
    inputTokens: 1_200,
    outputTokens: 0,
    cacheReadTokens: 38_400,
    latencyMs: 3_200,
    createdAt: "2026-08-12T16:02:00Z",
  },
  {
    id: "run_05",
    task: "research_company",
    model: "claude-opus-5",
    status: "started",
    costCents: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    latencyMs: null,
    createdAt: "2026-08-12T15:58:00Z",
  },
  {
    id: "run_06",
    task: "recommend_sources",
    model: "claude-opus-5",
    status: "succeeded",
    costCents: 19.8,
    inputTokens: 3_100,
    outputTokens: 1_600,
    cacheReadTokens: 12_000,
    latencyMs: 14_400,
    createdAt: "2026-08-11T11:20:00Z",
  },
];
