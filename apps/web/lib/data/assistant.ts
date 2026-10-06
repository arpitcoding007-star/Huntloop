import "server-only";
import { currentUserId, requireOrgId } from "./org";
import { load, type Loaded } from "./source";

/** One stored turn of the workspace assistant (0041), for replay on the page. */
export interface AssistantHistoryTurn {
  role: "user" | "assistant";
  content: string;
  citations: { ref: string; title: string; href: string | null }[];
  actions: { kind: string; ref: string | null; label: string; text: string | null; href: string | null }[];
  at: string;
}

export async function getAssistantHistory(orgSlug: string): Promise<Loaded<AssistantHistoryTurn[]>> {
  return load(
    async (db) => {
      const orgId = await requireOrgId(orgSlug, "getAssistantHistory");
      const userId = await currentUserId(db);
      if (!userId) return [];
      const { data: conversation } = await db
        .from("conversations")
        .select("id")
        .eq("org_id", orgId)
        .eq("user_id", userId)
        .eq("scope", "workspace")
        .is("deleted_at", null)
        .maybeSingle();
      if (!conversation) return [];
      const { data } = await db
        .from("conversation_messages")
        .select("role, content, citations, actions, created_at")
        .eq("org_id", orgId)
        .eq("conversation_id", conversation.id)
        .order("created_at", { ascending: true })
        .limit(60);
      return ((data ?? []) as Record<string, unknown>[])
        .filter((r) => r.role === "user" || r.role === "assistant")
        .map((r) => ({
          role: r.role as "user" | "assistant",
          content: String(r.content ?? ""),
          citations: Array.isArray(r.citations) ? (r.citations as AssistantHistoryTurn["citations"]) : [],
          actions: Array.isArray(r.actions) ? (r.actions as AssistantHistoryTurn["actions"]) : [],
          at: String(r.created_at),
        }));
    },
    () => [],
  );
}
