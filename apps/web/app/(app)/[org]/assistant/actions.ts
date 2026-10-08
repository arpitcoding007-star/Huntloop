"use server";

import { writtenWith, type WrittenWith } from "../../../../lib/data/written-with";
import { recordSignal } from "../../../../lib/data/signals";
import { isCorrection } from "../../../../lib/learning/corrections";
import { revalidatePath } from "next/cache";
import type { AssistantAction } from "@huntloop/ai";
import { askWorkspace } from "../../../../lib/ai/workspace-assistant";
import { gatherWorkspaceRecords } from "../../../../lib/ai/workspace-context";
import { getOnboardingState } from "../../../../lib/data/onboarding";
import { canSpend, currentViewer } from "../../../../lib/data/membership";
import { currentUserId, fail, mutate, ok, type ActionResult } from "../../../../lib/data/org";
import { agentQuestionSchema, uuidSchema } from "../../../../lib/validation";

/**
 * The workspace assistant's one write path (COMMAND.md §16.3-G): ask, and keep
 * the turn. Personal — the conversation is the asker's alone (RLS, 0004/0041).
 */

export interface Citation {
  ref: string;
  title: string;
  href: string | null;
}

export interface AssistantTurn {
  answer: string;
  citations: Citation[];
  unresolved: string[];
  actions: (AssistantAction & { href: string | null })[];
  example: boolean;
  /** The stored answer, and what it was written with (K2). Null for a worked example. */
  messageId?: string | null;
  writtenWith?: WrittenWith | null;
  /** The conversation the turn was kept in — new when none was given (0045). */
  conversationId?: string | null;
}

export async function askAssistantAction(
  org: string,
  question: string,
  options: {
    /** Continue this conversation; omitted or null starts a new one. */
    conversationId?: string | null;
    /** A new conversation's product focus. Ignored when continuing one: the focus is the conversation's. */
    productId?: string | null;
  } = {},
): Promise<ActionResult<AssistantTurn>> {
  const parsed = agentQuestionSchema.safeParse(question);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "That question could not be read.");
  for (const id of [options.conversationId, options.productId]) {
    if (id && !uuidSchema.safeParse(id).success) return fail("That reference isn't valid.");
  }

  const viewer = await currentViewer(org);
  if (!canSpend(viewer)) return fail("Your role is read-only, so you cannot ask the assistant.");

  return mutate(org, "askAssistant", async ({ db, orgId }) => {
    const userId = await currentUserId(db);
    if (!userId) return fail("You are no longer signed in.");

    const conversation = await workspaceConversation(db, orgId, userId, {
      id: options.conversationId ?? null,
      productId: options.productId ?? null,
      title: parsed.data,
    });
    if (!conversation) return fail("That conversation could not be opened. It may have been deleted.");
    const conversationId = conversation.id;

    const [{ data: prior }, onboarding, gathered] = await Promise.all([
      db
        .from("conversation_messages")
        .select("role, content")
        .eq("org_id", orgId)
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: true })
        .limit(40),
      getOnboardingState(org),
      gatherWorkspaceRecords(db, { orgSlug: org, orgId, userId, question: parsed.data, productId: conversation.productId }),
    ]);

    const history = ((prior ?? []) as { role: string; content: string }[])
      .filter((r) => r.role === "user" || r.role === "assistant")
      .map((r) => ({ role: r.role as "user" | "assistant", content: String(r.content) }));

    /* K3: "shorter", "as bullets", "from now on…" after an answer is how this
       person likes answers — a signal, and the question itself is this
       answer's task-only instruction. */
    if (history.some((t) => t.role === "assistant") && isCorrection(parsed.data)) {
      await recordSignal(db, orgId, { kind: "assistant_correction", subjectType: "conversation", subjectId: conversationId, note: parsed.data });
    }

    const outcome = await askWorkspace(org, {
      workspaceName: onboarding?.orgName ?? org,
      role: onboarding?.role ?? null,
      records: gathered.records,
      history,
      question: parsed.data,
      preferences: gathered.preferences,
    });
    if (!outcome.ok) return fail(outcome.error);

    const titles = new Map(gathered.records.map((r) => [r.ref, r.title]));
    const citations: Citation[] = outcome.answer.citations.map((ref) => ({
      ref,
      title: titles.get(ref) ?? ref,
      href: gathered.hrefs.get(ref) ?? null,
    }));
    const actions = outcome.answer.actions.map((a) => ({
      ...a,
      href: a.ref ? (gathered.hrefs.get(a.ref) ?? null) : null,
    }));

    let messageId: string | null = null;
    let applied: WrittenWith | null = null;

    /* Both turns in one statement, so a question is never stored without its
       answer. A worked example is not stored: it answered nothing. */
    if (outcome.source === "live") {
      const turns = (applied: boolean) => [
        { org_id: orgId, conversation_id: conversationId, role: "user", content: parsed.data },
        {
          org_id: orgId,
          conversation_id: conversationId,
          role: "assistant",
          content: outcome.answer.answer,
          citations,
          actions,
          /* What the answer was written with (K2). Without `0044` the column
             is missing, and the answer is still worth keeping. */
          ...(applied ? { applied_memory_ids: gathered.appliedMemoryIds } : {}),
        },
      ];
      let { data: stored, error } = await db.from("conversation_messages").insert(turns(true)).select("id, role");
      if (error?.code === "42703") {
        ({ data: stored, error } = await db.from("conversation_messages").insert(turns(false)).select("id, role"));
      }
      const answerRow = ((stored ?? []) as { id: string; role: string }[]).find((r) => r.role === "assistant");
      if (answerRow) {
        messageId = String(answerRow.id);
        applied = (await writtenWith(db, "conversation_messages", [messageId])).get(messageId) ?? null;
      }
      await db
        .from("conversations")
        .update({ last_message_at: new Date().toISOString() })
        .eq("id", conversationId)
        .eq("org_id", orgId);
      if (error) return fail(`The assistant answered, but the conversation could not be saved: ${error.message}`);
    }

    return ok({
      answer: outcome.answer.answer,
      citations,
      unresolved: outcome.answer.unresolved,
      actions,
      example: outcome.source !== "live",
      messageId,
      writtenWith: applied,
      conversationId,
    });
  });
}

/**
 * Delete one of your conversations. Its turns are deleted outright — they are
 * yours alone — and the conversation is soft-deleted so the list drops it.
 */
export async function deleteConversationAction(org: string, conversationId: string): Promise<ActionResult<undefined>> {
  if (!uuidSchema.safeParse(conversationId).success) return fail("That reference isn't valid.");
  return mutate(
    org,
    "deleteConversation",
    async ({ db, orgId }) => {
      const userId = await currentUserId(db);
      if (!userId) return fail("You are no longer signed in.");
      const { data: conversation } = await db
        .from("conversations")
        .select("id")
        .eq("org_id", orgId)
        .eq("id", conversationId)
        .eq("user_id", userId)
        .eq("scope", "workspace")
        .is("deleted_at", null)
        .maybeSingle();
      if (!conversation) return fail("That conversation no longer exists.");
      await db.from("conversation_messages").delete().eq("org_id", orgId).eq("conversation_id", conversationId);
      await db
        .from("conversations")
        .update({ deleted_at: new Date().toISOString() })
        .eq("org_id", orgId)
        .eq("id", conversationId);
      revalidatePath(`/${org}/assistant`);
      return ok(undefined, "Conversation deleted.");
    },
    { minRole: "viewer" },
  );
}

/** Titles are the first question, shortened at a word. */
function titleFrom(question: string): string {
  const flat = question.replace(/\s+/g, " ").trim();
  if (flat.length <= 60) return flat;
  const cut = flat.slice(0, 60);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), 40))}…`;
}

/**
 * The conversation a question belongs to: the one named, if it is this
 * person's; otherwise a new one titled by the question, with its product
 * focus.
 *
 * Degrades before `0045`: without `product_id` the insert is retried without
 * the focus, and while 0041's one-per-person index still exists a second
 * conversation is refused (23505), so the question joins the existing one.
 */
async function workspaceConversation(
  db: import("@huntloop/db").TenantClient,
  orgId: string,
  userId: string,
  want: { id: string | null; productId: string | null; title: string },
): Promise<{ id: string; productId: string | null } | null> {
  const mine = () =>
    db
      .from("conversations")
      .select("*")
      .eq("org_id", orgId)
      .eq("user_id", userId)
      .eq("scope", "workspace")
      .is("deleted_at", null);

  if (want.id) {
    const { data } = await mine().eq("id", want.id).maybeSingle();
    return data ? { id: String(data.id), productId: (data as { product_id?: string | null }).product_id ?? null } : null;
  }

  /* A focus must be one of this workspace's products. */
  let productId = want.productId;
  if (productId) {
    const { data: product } = await db
      .from("products")
      .select("id")
      .eq("org_id", orgId)
      .eq("id", productId)
      .is("deleted_at", null)
      .maybeSingle();
    if (!product) productId = null;
  }

  const row: Record<string, string> = { org_id: orgId, user_id: userId, scope: "workspace", title: titleFrom(want.title) };
  let { data: created, error } = await db
    .from("conversations")
    .insert(productId ? { ...row, product_id: productId } : row)
    .select("id")
    .single();
  if (error?.code === "42703" || error?.code === "PGRST204") {
    productId = null;
    ({ data: created, error } = await db.from("conversations").insert(row).select("id").single());
  }
  if (created) return { id: String(created.id), productId };
  if (error?.code === "23505") {
    const { data: existing } = await mine().limit(1).maybeSingle();
    return existing ? { id: String(existing.id), productId: null } : null;
  }
  return null;
}
