/**
 * The two rows a question and its answer are stored as.
 *
 * ── Why both rows carry every column ─────────────────────────────────────
 *
 * They go in as one insert, so a question is never stored without its answer.
 * For an array insert supabase-js names the union of the rows' keys, and
 * PostgREST sends null for any key a row lacks. `cited_evidence_ids`,
 * `citations`, `actions` and `applied_memory_ids` are all `not null default`,
 * so a user row without them failed the whole insert with 23502 and neither
 * chat could save a conversation (pass 22, V-01 and V-02).
 *
 * `AI-TURNS` in scripts/audit.mjs fails if a conversation is stored any other way.
 */
export interface AssistantTurn extends Record<string, unknown> {
  content: string;
}

export function conversationTurns(
  ids: { orgId: string; conversationId: string },
  question: string,
  answer: AssistantTurn,
): Record<string, unknown>[] {
  const base = { org_id: ids.orgId, conversation_id: ids.conversationId };
  const { content, ...extra } = answer;
  /* Every extra column on an answer is a list; a question has an empty one. */
  const none = Object.fromEntries(Object.keys(extra).map((k) => [k, []]));
  return [
    { ...base, role: "user", content: question, ...none },
    { ...base, role: "assistant", content, ...extra },
  ];
}
