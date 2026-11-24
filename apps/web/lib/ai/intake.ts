import "server-only";
import {
  classifyIntake,
  intakeTurn,
  isAiConfigured,
  ModelRefusalError,
  runTask,
  type ClassifyIntakeInput,
  type ClassifyIntakeOutput,
  type IntakeTurnInput,
  type IntakeTurnOutput,
  type LLMTask,
} from "@huntloop/ai";
import { resolveRecorder } from "./recorder";
import { consumeRateLimit, refusal } from "../rate-limit";
import { budgetRefusal, countAiRun, withinAiBudget } from "./budget";
import { publicAiError, type AiFailure } from "./outcome";

/**
 * The Exchange questionnaire's two model calls (`intake_classify`,
 * `intake_turn`), wrapped with the same gates as every other paid call: the
 * monthly ceiling, then the rate limit, then the run, recorded to `ai_runs`.
 *
 * `unconfigured` is a real answer, not a failure: with no key the screen
 * falls back to the plain form, which asks the same fields in the same order
 * (`intake.ts` is deterministic). Nothing here invents an answer.
 */

export type IntakeAi<T> = { ok: true; live: true; output: T } | { ok: true; live: false } | AiFailure;

async function run<I, O>(
  orgSlug: string,
  name: "intake_classify" | "intake_turn",
  task: LLMTask<I, O>,
  input: I,
  refusedMessage: string,
): Promise<IntakeAi<O>> {
  if (!isAiConfigured()) return { ok: true, live: false };

  const resolved = await resolveRecorder(orgSlug);
  if (!resolved.ok) return { ok: false, error: resolved.error };
  const { recorder, orgId, db } = resolved;

  if (db) {
    const allowance = await withinAiBudget(db, orgId);
    if (!allowance.allowed) return budgetRefusal(allowance);
  }
  const budget = await consumeRateLimit(orgId, name);
  if (!budget.allowed) return refusal(budget);

  try {
    const { output } = await runTask(task, input, { orgId, recorder });
    if (db) await countAiRun(db, orgId);
    return { ok: true, live: true, output };
  } catch (error) {
    if (error instanceof ModelRefusalError) return { ok: false, error: refusedMessage };
    return { ok: false, error: publicAiError(error, "The questionnaire could not reach the model.") };
  }
}

export function classify(orgSlug: string, input: ClassifyIntakeInput): Promise<IntakeAi<ClassifyIntakeOutput>> {
  return run(
    orgSlug,
    "intake_classify",
    classifyIntake,
    input,
    "The model declined to read that request. You can describe it in the form below instead.",
  );
}

export function turn(orgSlug: string, input: IntakeTurnInput): Promise<IntakeAi<IntakeTurnOutput>> {
  return run(
    orgSlug,
    "intake_turn",
    intakeTurn,
    input,
    "The model declined that answer. You can fill in the rest in the form below.",
  );
}
