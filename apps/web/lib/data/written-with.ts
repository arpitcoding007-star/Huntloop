import "server-only";
import type { TenantClient } from "@huntloop/db";
import { currentUserId } from "./org";

/**
 * "Written with" — which preferences an output was given (K2, `0044`).
 *
 * `messages.applied_memory_ids` and `conversation_messages.applied_memory_ids`
 * record them at write time. Reading them back goes through RLS, which is the
 * point: a draft written with its sender's private preferences shows a
 * colleague reviewing it *that* there were some, never what they say.
 *
 * Read separately from the caller's main query and tolerant of a database
 * without `0044`, so the inbox and the assistant still load before it.
 */

export interface AppliedItem {
  id: string;
  text: string;
  /** The viewer's own preference — they may switch it off from here. */
  mine: boolean;
  origin: "stated" | "learned" | "promoted";
  scope: string;
}

export interface WrittenWith {
  items: AppliedItem[];
  /** Applied, and private to somebody else. */
  hidden: number;
}

/* eslint-disable @typescript-eslint/no-explicit-any -- untyped PostgREST rows (DB-03). */

export async function writtenWith(
  db: TenantClient,
  table: "messages" | "conversation_messages",
  ids: string[],
): Promise<Map<string, WrittenWith>> {
  const out = new Map<string, WrittenWith>();
  if (ids.length === 0) return out;

  const { data, error } = await db.from(table).select("id, applied_memory_ids").in("id", ids);
  if (error || !data) return out;

  const byRow = new Map<string, string[]>();
  for (const row of data as any[]) {
    const applied = Array.isArray(row.applied_memory_ids) ? row.applied_memory_ids.map(String) : [];
    if (applied.length) byRow.set(String(row.id), applied);
  }
  const all = [...new Set([...byRow.values()].flat())];
  if (all.length === 0) return out;

  const [me, memories] = await Promise.all([
    currentUserId(db),
    db.from("memories").select("id, content, scope, scope_id, origin").in("id", all),
  ]);
  const visible = new Map<string, any>(((memories.data ?? []) as any[]).map((m) => [String(m.id), m]));

  for (const [rowId, applied] of byRow) {
    const items: AppliedItem[] = [];
    let hidden = 0;
    for (const id of applied) {
      const m = visible.get(id);
      if (!m) {
        hidden++;
        continue;
      }
      items.push({
        id,
        text: String(m.content ?? ""),
        mine: m.scope === "user" && String(m.scope_id) === me,
        origin: m.origin === "learned" || m.origin === "promoted" ? m.origin : "stated",
        scope: String(m.scope),
      });
    }
    out.set(rowId, { items, hidden });
  }
  return out;
}

/* eslint-enable @typescript-eslint/no-explicit-any */
