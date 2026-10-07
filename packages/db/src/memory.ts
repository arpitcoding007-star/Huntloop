/**
 * Memory retrieval — the one place memories are selected by scope.
 *
 * `0004`'s comment on `memories` asks for exactly this: retrieval filters on
 * `(org_id, scope, scope_id)` in `packages/db`, never per call site, so a
 * user-scoped note cannot leak into a colleague's answer because one caller
 * forgot a filter.
 *
 * What applies to a request is the organisation's memories, plus — only when
 * the request is about them — the requesting person's own, the account's
 * (the company) and the opportunity's. Expired memories never apply.
 *
 * Since `0044` this is a view of `resolvePreferences`: the same rows, in the
 * same precedence, with proposed, paused and faded memories left out.
 */
import { resolvePreferences, type PreferenceKind } from "./preferences.ts";

/** The minimal query surface both the tenant and the admin client provide. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = { from: (table: string) => any };

export interface MemoryContext {
  orgId: string;
  /** The person asking. Their user-scoped memories apply to them alone. */
  userId?: string | null;
  /** `companies.id` — account-scoped memories. */
  accountId?: string | null;
  opportunityId?: string | null;
  /** The task reading them, for `applies_to`. */
  task?: string;
}

export interface ApplicableMemory {
  id: string;
  scope: "organization" | "user" | "account" | "opportunity" | "team";
  content: string;
  source: "user" | "derived";
  kind: PreferenceKind;
}

export async function applicableMemories(
  db: Client,
  context: MemoryContext,
): Promise<ApplicableMemory[]> {
  const { applied } = await resolvePreferences(db, { ...context, task: context.task ?? "" });
  return applied
    .filter((p) => p.id !== null && p.scope !== "task")
    .map((p) => ({
      id: p.id!,
      scope: p.scope as ApplicableMemory["scope"],
      content: p.text,
      source: p.origin === "learned" ? "derived" : "user",
      kind: p.kind,
    }));
}
