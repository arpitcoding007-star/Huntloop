/**
 * Cost accounting for model calls (plan §6, invariant 2).
 *
 * The invariant is that the row is written **before** the call, not after. It
 * reads like a detail and it is the difference between a cost dashboard and a
 * cost guess: the calls that go wrong are exactly the ones that are slow,
 * expensive, retried, and killed halfway — and a row written on success records
 * none of them. Anthropic bills for the tokens either way.
 *
 * `packages/ai` deliberately does not import `@huntloop/db`. Job handlers take
 * a tenant-scoped client from their context (plan §6, invariant 3); a package
 * that constructed its own would be a second path to the database and, sooner
 * or later, a second path around RLS. So this file defines the shape and the
 * caller supplies the storage.
 */
import type { TokenUsage } from "./models.ts";
import type { TaskName } from "./models.ts";

export interface RunStart {
  orgId: string;
  task: TaskName;
  model: string;
  promptVersion: string;
  inputHash: string;
  entityType?: string | null;
  entityId?: string | null;
}

export interface RunFinish {
  usage: TokenUsage;
  costCents: number;
  latencyMs: number;
}

export interface RunRecorder {
  /** Called before the model call. Returns a handle, or null if not recorded. */
  started(run: RunStart): Promise<string | null>;
  succeeded(runId: string, finish: RunFinish): Promise<void>;
  failed(runId: string, error: string, latencyMs: number): Promise<void>;
}

/**
 * Records nothing.
 *
 * Exported so a caller with no database — the onboarding flow before migrations
 * are applied, and the task tests — has to *name* that choice at the call site.
 * Making the recorder optional would have let a real code path forget it
 * silently, which is the failure this whole file exists to prevent.
 */
export const nullRecorder: RunRecorder = {
  async started() {
    return null;
  },
  async succeeded() {},
  async failed() {},
};
