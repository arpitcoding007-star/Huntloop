import { nullRecorder, type RunFinish, type RunRecorder, type RunStart } from "@huntloop/ai";
import { resolveDataSource } from "../data/source";

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
}

/**
 * Resolves the org and returns a recorder for it.
 *
 * Falls back to `nullRecorder` when there is no database yet — which is the
 * normal state during setup, before the migrations are applied. That is a
 * deliberate trade and it is the smaller of two harms: refusing to run without
 * cost accounting would make onboarding untestable before Supabase is wired up,
 * while running unmetered is visible (the screen says so) and bounded (nothing
 * is scheduled yet, so a runaway loop cannot exist).
 */
export async function resolveRecorder(orgSlug: string): Promise<ResolvedRecorder> {
  const unmetered = { recorder: nullRecorder, orgId: orgSlug, recorded: false };

  const { db } = await resolveDataSource();
  if (!db) return unmetered;

  const { data: org } = await db
    .from("organizations")
    .select("id")
    .eq("slug", orgSlug)
    .maybeSingle();

  if (!org) return unmetered;
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

  return { recorder, orgId, recorded: true };
}
