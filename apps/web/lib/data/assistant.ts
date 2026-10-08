import "server-only";
import type { TenantClient } from "@huntloop/db";
import { applicableMemories } from "@huntloop/db/memory";
import { currentUserId, requireOrgId } from "./org";
import { load, type Loaded } from "./source";
import { writtenWith, type WrittenWith } from "./written-with";
import { recurringQuestions, type RecurringQuestion } from "../learning/recurring";

/** One stored turn of the workspace assistant (0041), for replay on the page. */
export interface AssistantHistoryTurn {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations: { ref: string; title: string; href: string | null }[];
  actions: { kind: string; ref: string | null; label: string; text: string | null; href: string | null }[];
  at: string;
  /** What an answer was written with (K2). */
  writtenWith: WrittenWith | null;
}

/** One of a person's saved assistant conversations (0045). */
export interface AssistantConversation {
  id: string;
  title: string;
  productId: string | null;
  productName: string | null;
  lastMessageAt: string | null;
}

/**
 * This person's workspace conversations, most recent first. Personal by RLS
 * (0004's `conversation_owner`). Before `0045` there is no `product_id`, so
 * the read falls back to the columns 0041 had — and there is at most one.
 */
export async function listAssistantConversations(orgSlug: string): Promise<Loaded<AssistantConversation[]>> {
  return load(
    async (db) => {
      const orgId = await requireOrgId(orgSlug, "listAssistantConversations");
      const userId = await currentUserId(db);
      if (!userId) return [];
      const base = (columns: string) =>
        db
          .from("conversations")
          .select(columns)
          .eq("org_id", orgId)
          .eq("user_id", userId)
          .eq("scope", "workspace")
          .is("deleted_at", null)
          .order("last_message_at", { ascending: false, nullsFirst: false })
          .order("created_at", { ascending: false })
          .limit(50);
      let { data, error } = await base("id, title, last_message_at, product_id, products(name)");
      if (error) ({ data, error } = await base("id, title, last_message_at"));
      if (error) throw new Error(`listAssistantConversations: ${error.message}`);
      /* eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped embed (DB-03) */
      return ((data ?? []) as any[]).map((c) => {
        const product = Array.isArray(c.products) ? c.products[0] : c.products;
        return {
          id: String(c.id),
          title: String(c.title || "Conversation"),
          productId: c.product_id ?? null,
          productName: product?.name ?? null,
          lastMessageAt: c.last_message_at ?? null,
        };
      });
    },
    () => [],
  );
}

/** The turns of one of this person's conversations; empty for a new one. */
export async function getAssistantHistory(
  orgSlug: string,
  conversationId: string | null,
): Promise<Loaded<AssistantHistoryTurn[]>> {
  return load(
    async (db) => {
      const orgId = await requireOrgId(orgSlug, "getAssistantHistory");
      const userId = await currentUserId(db);
      if (!userId || !conversationId) return [];
      const { data: conversation } = await db
        .from("conversations")
        .select("id")
        .eq("org_id", orgId)
        .eq("id", conversationId)
        .eq("user_id", userId)
        .eq("scope", "workspace")
        .is("deleted_at", null)
        .maybeSingle();
      if (!conversation) return [];
      const { data } = await db
        .from("conversation_messages")
        .select("id, role, content, citations, actions, created_at")
        .eq("org_id", orgId)
        .eq("conversation_id", conversation.id)
        .order("created_at", { ascending: true })
        .limit(60);
      const rows = (data ?? []) as Record<string, unknown>[];
      const applied = await writtenWith(
        db,
        "conversation_messages",
        rows.filter((r) => r.role === "assistant").map((r) => String(r.id)),
      );
      return rows
        .filter((r) => r.role === "user" || r.role === "assistant")
        .map((r) => ({
          id: String(r.id),
          writtenWith: applied.get(String(r.id)) ?? null,
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

/**
 * The questions this person asks again and again (K5) — from their own turns
 * in the last 60 days, offered back as one-click suggestions.
 */
export async function getUsualQuestions(orgSlug: string): Promise<RecurringQuestion[]> {
  const { data } = await load<RecurringQuestion[]>(
    async (db) => {
      const orgId = await requireOrgId(orgSlug, "getUsualQuestions");
      const userId = await currentUserId(db);
      if (!userId) return [];
      /* Across all of this person's conversations: a question asked in three
         threads is still one they ask again and again. */
      const { data: conversations } = await db
        .from("conversations")
        .select("id")
        .eq("org_id", orgId)
        .eq("user_id", userId)
        .eq("scope", "workspace")
        .is("deleted_at", null)
        .limit(50);
      const ids = ((conversations ?? []) as { id: string }[]).map((c) => String(c.id));
      if (ids.length === 0) return [];
      const since = new Date(Date.now() - 60 * 86_400_000).toISOString();
      const { data: turns } = await db
        .from("conversation_messages")
        .select("content, created_at")
        .eq("org_id", orgId)
        .in("conversation_id", ids)
        .eq("role", "user")
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(300);
      return recurringQuestions(
        ((turns ?? []) as { content: string; created_at: string }[]).map((t) => ({ content: String(t.content), at: String(t.created_at) })),
      );
    },
    () => [],
  );
  return data;
}

/**
 * "What it can see" (§9.5): the notes an answer may use, counted from the same
 * selector the assistant reads (`applicableMemories`, task
 * `workspace_assistant`), so the panel cannot describe a different set.
 */
export interface AssistantVisibility {
  /** How this person likes answers — theirs alone (K2). */
  yourPreferences: number;
  /** Notes the team taught Huntloop that apply to the assistant. */
  workspaceNotes: number;
}

export async function getAssistantVisibility(orgSlug: string): Promise<AssistantVisibility> {
  const { data } = await load<AssistantVisibility>(
    async (db: TenantClient) => {
      const orgId = await requireOrgId(orgSlug, "getAssistantVisibility");
      const userId = await currentUserId(db);
      if (!userId) return { yourPreferences: 0, workspaceNotes: 0 };
      const memories = await applicableMemories(db, { orgId, userId, task: "workspace_assistant" }).catch(() => []);
      return {
        yourPreferences: memories.filter((m) => m.scope === "user").length,
        workspaceNotes: memories.filter((m) => m.scope !== "user").length,
      };
    },
    () => ({ yourPreferences: 0, workspaceNotes: 0 }),
  );
  return data;
}
