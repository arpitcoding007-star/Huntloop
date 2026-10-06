import "server-only";
import {
  ASSISTANT_MAX_HISTORY,
  ASSISTANT_MAX_QUESTION,
  isAiConfigured,
  ModelRefusalError,
  runTask,
  workspaceAssistant,
  type AgentTurn,
  type AssistantAnswer,
  type AssistantInput,
  type AssistantRecord,
} from "@huntloop/ai";
import { resolveRecorder } from "./recorder";
import { consumeRateLimit, refusal } from "../rate-limit";
import { budgetRefusal, countAiRun, withinAiBudget } from "./budget";
import type { AiFailure } from "./outcome";

/**
 * `workspace_assistant`, wrapped like the per-opportunity agent: the recorder
 * attributes the call, the monthly budget and the rate limit are checked
 * before spending, and with no model configured the answer is a worked
 * example built from the real records — citing what it uses, so the demo shows
 * the behaviour rather than prose about it.
 */

export type AssistantOutcome =
  | { ok: true; source: "live" | "unconfigured"; answer: AssistantAnswer }
  | AiFailure;

export async function askWorkspace(
  orgSlug: string,
  input: { workspaceName: string; role: string | null; records: AssistantRecord[]; history: AgentTurn[]; question: string },
): Promise<AssistantOutcome> {
  const resolved = await resolveRecorder(orgSlug);
  if (!resolved.ok) return { ok: false, error: resolved.error };
  const { recorder, orgId, db } = resolved;

  const task: AssistantInput = {
    ...input,
    history: input.history.slice(-ASSISTANT_MAX_HISTORY),
    question: input.question.slice(0, ASSISTANT_MAX_QUESTION),
  };

  if (!isAiConfigured()) return { ok: true, source: "unconfigured", answer: example(task) };

  if (db) {
    const allowance = await withinAiBudget(db, orgId);
    if (!allowance.allowed) return budgetRefusal(allowance);
  }
  const budget = await consumeRateLimit(orgId, "workspace_assistant");
  if (!budget.allowed) return refusal(budget);

  try {
    const { output } = await runTask(workspaceAssistant, task, { orgId, recorder });
    if (db) await countAiRun(db, orgId);
    return { ok: true, source: "live", answer: output };
  } catch (error) {
    if (error instanceof ModelRefusalError) return { ok: false, error: "The model declined to answer that." };
    return { ok: false, error: error instanceof Error ? error.message : "The assistant could not answer." };
  }
}

/** The worked example: the top of the queue, cited, and honest about the rest. */
function example(input: AssistantInput): AssistantAnswer {
  const needs = input.records.filter((r) => r.type === "needs").slice(0, 3);
  if (!needs.length) {
    return {
      answer:
        "No model is connected on this deployment, so I can't reason over your question. Nothing in your queue needs you right now.",
      citations: [],
      unresolved: ["A model connection (ANTHROPIC_API_KEY) to answer free-form questions."],
      actions: [],
      confidence: null,
    };
  }
  return {
    answer:
      "No model is connected, so this is not an answer to your question — it is the top of your queue, which is where most days start: " +
      needs.map((n) => n.title).join("; ") +
      ".",
    citations: needs.map((n) => n.ref),
    unresolved: ["A model connection (ANTHROPIC_API_KEY) to answer free-form questions."],
    actions: [],
    confidence: null,
  };
}
