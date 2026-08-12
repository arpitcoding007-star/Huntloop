/**
 * `LLMTask` — the shape every AI task in Huntloop has, and the one function
 * that runs them.
 *
 * A task owns four things: its prompt, its output schema, how it renders an
 * input, and how it validates what came back. `runTask` owns everything that
 * must happen identically every time and that nobody should be free to skip —
 * routing, the pre-call `ai_runs` row, timing, cost, and the §7 validation
 * boundary. That split is deliberate: the rules the master context calls
 * non-negotiable live where a task author cannot forget them.
 */
import { createAnthropicClient, type ModelClient } from "./client.ts";
import { estimateCostCents, ROUTES, type TaskName } from "./models.ts";
import { inputHash, type Prompt } from "./prompt.ts";
import type { RunRecorder } from "./runs.ts";

export interface LLMTask<TInput, TOutput> {
  name: TaskName;
  prompt: Prompt;
  /**
   * JSON Schema for `output_config.format`, either fixed or derived from the
   * input.
   *
   * The derived form exists for tasks whose *valid* output depends on what was
   * asked — `recommend_sources` constrains its `basis` field to the ICP
   * elements actually sent, so the model cannot justify a recommendation with a
   * criterion the user never wrote. `parse` still re-checks it; the schema
   * turns a failed run into an impossible one, which is the difference between
   * catching the error and paying for it.
   */
  schema: Record<string, unknown> | ((input: TInput) => Record<string, unknown>);
  maxTokens: number;
  /** The per-call payload. Must not repeat anything already in the prompt. */
  renderInput: (input: TInput) => string;
  /** Hosts the model may fetch, derived from the input. Omit to forbid fetching. */
  fetchDomains?: (input: TInput) => string[];
  /**
   * Turns the raw JSON into the task's output type, and rejects anything that
   * violates §7. Throwing here fails the run and writes the reason to
   * `ai_runs.error`, which is what makes a bad prompt version attributable.
   */
  parse: (json: unknown, input: TInput) => TOutput;
  /** What the run is about, for the `ai_runs` entity columns. */
  entity?: (input: TInput) => { type: string; id?: string | null };
}

export interface RunContext {
  orgId: string;
  recorder: RunRecorder;
  /** Defaults to the real Anthropic client. Tests pass a scripted one. */
  client?: ModelClient;
}

export interface TaskResult<TOutput> {
  output: TOutput;
  costCents: number;
  latencyMs: number;
  model: string;
  promptVersion: string;
}

export async function runTask<TInput, TOutput>(
  task: LLMTask<TInput, TOutput>,
  input: TInput,
  ctx: RunContext,
): Promise<TaskResult<TOutput>> {
  const route = ROUTES[task.name];
  const client = ctx.client ?? createAnthropicClient();
  const entity = task.entity?.(input);

  // Before the call. See the comment at the top of runs.ts.
  const runId = await ctx.recorder.started({
    orgId: ctx.orgId,
    task: task.name,
    model: route.model,
    promptVersion: task.prompt.version,
    inputHash: inputHash(task.prompt, input),
    entityType: entity?.type ?? null,
    entityId: entity?.id ?? null,
  });

  const startedAt = Date.now();
  try {
    const result = await client.run({
      model: route.model,
      effort: route.effort,
      maxTokens: task.maxTokens,
      system: task.prompt.text,
      userContent: task.renderInput(input),
      schema: typeof task.schema === "function" ? task.schema(input) : task.schema,
      fetchDomains: task.fetchDomains?.(input),
    });

    // Parse and validate *inside* the try, so a §7 violation is recorded as a
    // failed run rather than escaping as an unattributed exception. The tokens
    // were spent either way; the bill should say so.
    const output = task.parse(result.json, input);

    const latencyMs = Date.now() - startedAt;
    const costCents = estimateCostCents(route.model, result.usage);
    if (runId) {
      await ctx.recorder.succeeded(runId, { usage: result.usage, costCents, latencyMs });
    }
    return {
      output,
      costCents,
      latencyMs,
      model: result.model,
      promptVersion: task.prompt.version,
    };
  } catch (error) {
    const latencyMs = Date.now() - startedAt;
    if (runId) {
      await ctx.recorder.failed(runId, describe(error), latencyMs);
    }
    throw error;
  }
}

function describe(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}
