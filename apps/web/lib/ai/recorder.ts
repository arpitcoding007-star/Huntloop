import { nullRecorder, type RunFinish, type RunRecorder, type RunStart } from "@huntloop/ai";
import { resolveDataSource } from "../data/source";
import type { TenantClient } from "@huntloop/db";

/**
 * `ai_runs`, written through the caller's own session.
 *
 * Note what this is not: an admin client. Cost rows are tenant data — they say
 * which companies an org researched and when — so they go through RLS like
 * everything else. That has one consequence worth stating out loud: if the
 * policy is wrong, cost accounting breaks *loudly* on the next call instead of
 * quietly writing rows nobody can read.
 */

export interface ResolvedRecorder {
  recorder: RunRecorder;
  orgId: string;
  /** False when the run is happening but nothing is being metered. */
  recorded: boolean;
  /**
   * The client this org was resolved through, or null in demo mode.
   *
   * Handed back so a caller can check the monthly quota and count the run
   * against it without resolving the org a second time — see
   * `lib/ai/budget.ts`. Null exactly when `recorded` is false, and the two are
   * kept separate because one is about metering and the other is about who to
   * ask.
   */
  db: TenantClient | null;
}

/**
 * Either a recorder to run under, or a refusal.
 *
 * The refusal case is the point. See `resolveRecorder`.
 */
export type RecorderOutcome =
  | ({ ok: true } & ResolvedRecorder)
  | { ok: false; error: string };

/**
 * Resolves the org and returns a recorder for it.
 *
 * There are three states here and only two of them may run a model:
 *
 *   no database    Normal during setup, before the migrations are applied.
 *                  Runs unmetered. That is a deliberate trade and the smaller
 *                  of two harms: refusing would make onboarding untestable
 *                  before Supabase is wired up, while running unmetered is
 *                  visible (the screen says so) and bounded (nothing is
 *                  scheduled, so a runaway loop cannot exist).
 *   org resolved   Metered, normally.
 *   org NOT
 *   resolved       **Refused.**
 *
 * That last case used to fall back to `nullRecorder` alongside the first, and
 * the two are not alike. `organizations` is behind RLS resolving through
 * `user_org_ids()`, so "no row" does not mean "no such org" — it means *this
 * caller is not a member of it*. Server Actions are public POST endpoints, so
 * treating that as unmetered-but-proceed meant any caller could name an org
 * they don't belong to and get a real Opus call with web_fetch, billed to us
 * and recorded against nothing. RLS cannot defend this: the tenant boundary
 * protects rows, and the Anthropic bill is not a row.
 *
 * Cost accounting is a boundary here, not just reporting. If the run cannot be
 * attributed to an org the caller belongs to, the run does not happen.
 */
export async function resolveRecorder(orgSlug: string): Promise<RecorderOutcome> {
  const { db } = await resolveDataSource();
  if (!db) {
    return { ok: true, recorder: nullRecorder, orgId: orgSlug, recorded: false, db: null };
  }

  const { data: org } = await db
    .from("organizations")
    .select("id")
    .eq("slug", orgSlug)
    .maybeSingle();

  if (!org) {
    // Same wording whether the org is missing or merely not yours — see
    // resolveMembership() in @huntloop/db for why that distinction is not
    // one we hand out.
    return {
      ok: false,
      error: `No organisation “${orgSlug}” is available to you.`,
    };
  }
  const orgId = org.id as string;

  const recorder: RunRecorder = {
    async started(run: RunStart) {
      const { data, error } = await db
        .from("ai_runs")
        .insert({
          org_id: orgId,
          task: run.task,
          model: run.model,
          prompt_version: run.promptVersion,
          input_hash: run.inputHash,
          entity_type: run.entityType,
          entity_id: run.entityId,
          status: "started",
        })
        .select("id")
        .single();

      // A failure to record must not cancel the work. It is logged rather than
      // thrown because the alternative — a model outage caused by a broken cost
      // table — trades a reporting problem for a product one.
      if (error) {
        console.error("ai_runs insert failed; running unmetered", error.message);
        return null;
      }
      return data.id as string;
    },

    async succeeded(runId: string, finish: RunFinish) {
      await db
        .from("ai_runs")
        .update({
          status: "succeeded",
          input_tokens: finish.usage.inputTokens,
          output_tokens: finish.usage.outputTokens,
          cache_read_tokens: finish.usage.cacheReadTokens,
          cost_cents: finish.costCents,
          latency_ms: finish.latencyMs,
          updated_at: new Date().toISOString(),
        })
        .eq("id", runId);
    },

    async failed(runId: string, error: string, latencyMs: number) {
      await db
        .from("ai_runs")
        .update({
          status: "failed",
          error,
          latency_ms: latencyMs,
          updated_at: new Date().toISOString(),
        })
        .eq("id", runId);
    },
  };

  return { ok: true, recorder, orgId, recorded: true, db };
}
