/**
 * Running a model task from a background job.
 *
 * ── Why this is not `apps/web/lib/ai/recorder.ts` ────────────────────────
 *
 * That one is the right shape for a request: it resolves the org through the
 * caller's own session, so a cost row is written under RLS and a caller who is
 * not a member of the org they named gets refused before a single token is
 * spent. Cost attribution is a boundary there, because a Server Action is a
 * public POST endpoint.
 *
 * A job has no caller. The org id did not come from a request — it came from a
 * row this process read, or from a job payload this process enqueued. There is
 * nobody to attribute to and nobody to refuse, so the check that file performs
 * would be checking the service-role client against itself.
 *
 * What survives is the invariant that matters either way, plan §6 invariant 2:
 * the `ai_runs` row is written **before** the call. The calls that go wrong are
 * the slow, expensive, retried ones, and a row written on success records none
 * of them while Anthropic bills for all of them.
 *
 * ── Budget ───────────────────────────────────────────────────────────────
 *
 * A background job can loop. That is the whole point of one, and it is also
 * the failure mode: a scheduler that enqueues a scan per source per hour, each
 * extracting signals from forty documents, is a bill that arrives before
 * anybody notices the scan is stuck. `withinBudget` is checked before every
 * task, against the same `usage_counters` the plan quota uses — so the ceiling
 * a customer sees on the billing screen is the ceiling the engine obeys.
 */
import {
  isAiConfigured,
  runTask,
  type LLMTask,
  type RunFinish,
  type RunRecorder,
  type RunStart,
  type TaskResult,
} from "@huntloop/ai";
import type { OrgScope } from "./scope.ts";

export class AiUnavailable extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "AiUnavailable";
  }
}

/**
 * `ai_runs`, written through the service-role client.
 *
 * A failure to record does not cancel the work, for the same reason it does
 * not in the request path: trading a model outage for a reporting problem is
 * the wrong direction. It is logged, and the run proceeds unmetered — which is
 * visible on the spend screen as a gap rather than as a plausible number.
 */
function recorder(scope: OrgScope): RunRecorder {
  return {
    async started(run: RunStart) {
      const { data, error } = await scope
        .insert("ai_runs", {
          task: run.task,
          model: run.model,
          prompt_version: run.promptVersion,
          input_hash: run.inputHash,
          entity_type: run.entityType ?? null,
          entity_id: run.entityId ?? null,
          status: "started",
        })
        .select("id")
        .single();

      if (error) {
        console.error(`ai_runs insert failed; running unmetered: ${error.message}`);
        return null;
      }
      return String(data.id);
    },

    async succeeded(runId: string, finish: RunFinish) {
      await scope.update("ai_runs", {
          status: "succeeded",
          input_tokens: finish.usage.inputTokens,
          output_tokens: finish.usage.outputTokens,
          cache_read_tokens: finish.usage.cacheReadTokens,
          cost_cents: finish.costCents,
          latency_ms: finish.latencyMs,
        })
        .eq("id", runId);
    },

    async failed(runId: string, error: string, latencyMs: number) {
      await scope.update("ai_runs", { status: "failed", error, latency_ms: latencyMs })
        .eq("id", runId);
    },
  };
}

/**
 * Whether this org may spend another model call this month.
 *
 * Read-only. The counter is incremented after a successful run rather than
 * before, because a refused or crashed call has not produced anything the org
 * asked for — the *cost* of it is still in `ai_runs`, which is where cost
 * belongs. Quota measures work delivered; `ai_runs` measures money spent, and
 * conflating them makes one of the two wrong.
 */
async function withinBudget(scope: OrgScope): Promise<{ ok: boolean; used: number; limit: number | null }> {
  const { data, error } = await scope.rpc("check_quota_internal", {
    p_org: scope.orgId,
    p_metric: "ai_runs",
  });

  /* A quota that cannot be read does not stop the engine. Same call as
     `lib/data/usage.ts` makes and for the same reason: the cost of failing
     open is a reconciliation, and it is ours. */
  if (error) return { ok: true, used: 0, limit: null };

  const row = (Array.isArray(data) ? data[0] : data) as
    | { used?: number; quota?: number | null; allowed?: boolean }
    | undefined;
  if (!row) return { ok: true, used: 0, limit: null };

  return {
    ok: Boolean(row.allowed),
    used: Number(row.used ?? 0),
    limit: row.quota === null || row.quota === undefined ? null : Number(row.quota),
  };
}

/**
 * Runs one task for one org, metered and bounded.
 *
 * Throws `AiUnavailable` when there is no key or no budget. The caller decides
 * what that means: `scan_source` treats it as "ingest the documents and skip
 * extraction", which leaves a scan that did real work and says what it could
 * not do — rather than a scan that reports success having produced nothing.
 */
export async function runForOrg<TInput, TOutput>(
  scope: OrgScope,
  task: LLMTask<TInput, TOutput>,
  input: TInput,
): Promise<TaskResult<TOutput>> {
  if (!isAiConfigured()) {
    throw new AiUnavailable(
      "ANTHROPIC_API_KEY is not set on this deployment, so nothing can be extracted, " +
        "qualified or written. The documents were still fetched and stored.",
    );
  }

  const budget = await withinBudget(scope);
  if (!budget.ok) {
    throw new AiUnavailable(
      `This organisation has used ${budget.used} of its ${budget.limit} model runs ` +
        `this month. The plan limit resets at the start of next month.`,
    );
  }

  const result = await runTask(task, input, { orgId: scope.orgId, recorder: recorder(scope) });

  // Counted after the fact, and not awaited for its answer: the work is done,
  // and a failed counter increment must not turn a completed run into an error.
  await scope.rpc("increment_usage_internal", {
    p_org: scope.orgId,
    p_metric: "ai_runs",
    p_amount: 1,
  });

  return result;
}
