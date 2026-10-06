"use server";

import { revalidatePath } from "next/cache";
import type { AssistantAction } from "@huntloop/ai";
import { askWorkspace } from "../../../../lib/ai/workspace-assistant";
import { gatherWorkspaceRecords } from "../../../../lib/ai/workspace-context";
import { getOnboardingState } from "../../../../lib/data/onboarding";
import { canSpend, currentViewer } from "../../../../lib/data/membership";
import { currentUserId, fail, mutate, ok, type ActionResult } from "../../../../lib/data/org";
import { agentQuestionSchema } from "../../../../lib/validation";

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
}

export async function askAssistantAction(
  org: string,
  question: string,
): Promise<ActionResult<AssistantTurn>> {
  const parsed = agentQuestionSchema.safeParse(question);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "That question could not be read.");

  const viewer = await currentViewer(org);
  if (!canSpend(viewer)) return fail("Your role is read-only, so you cannot ask the assistant.");

  return mutate(org, "askAssistant", async ({ db, orgId }) => {
    const userId = await currentUserId(db);
    if (!userId) return fail("You are no longer signed in.");

    const conversationId = await workspaceConversation(db, orgId, userId);
    if (!conversationId) return fail("Your conversation could not be opened.");

    const [{ data: prior }, onboarding, gathered] = await Promise.all([
      db
        .from("conversation_messages")
        .select("role, content")
        .eq("org_id", orgId)
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: true })
        .limit(40),
      getOnboardingState(org),
      gatherWorkspaceRecords(db, { orgSlug: org, orgId, userId, question: parsed.data }),
    ]);

    const history = ((prior ?? []) as { role: string; content: string }[])
      .filter((r) => r.role === "user" || r.role === "assistant")
      .map((r) => ({ role: r.role as "user" | "assistant", content: String(r.content) }));

    const outcome = await askWorkspace(org, {
      workspaceName: onboarding?.orgName ?? org,
      role: onboarding?.role ?? null,
      records: gathered.records,
      history,
      question: parsed.data,
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

    /* Both turns in one statement, so a question is never stored without its
       answer. A worked example is not stored: it answered nothing. */
    if (outcome.source === "live") {
      const { error } = await db.from("conversation_messages").insert([
        { org_id: orgId, conversation_id: conversationId, role: "user", content: parsed.data },
        {
          org_id: orgId,
          conversation_id: conversationId,
          role: "assistant",
          content: outcome.answer.answer,
          citations,
          actions,
        },
      ]);
      await db
        .from("conversations")
        .update({ last_message_at: new Date().toISOString() })
        .eq("id", conversationId)
        .eq("org_id", orgId);
      if (error) return fail(`The assistant answered, but the conversation could not be saved: ${error.message}`);
      revalidatePath(`/${org}/assistant`);
    }

    return ok({
      answer: outcome.answer.answer,
      citations,
      unresolved: outcome.answer.unresolved,
      actions,
      example: outcome.source !== "live",
    });
  });
}

/** Start the conversation over. The old turns are deleted — they are yours alone. */
export async function clearAssistantAction(org: string): Promise<ActionResult<undefined>> {
  return mutate(
    org,
    "clearAssistant",
    async ({ db, orgId }) => {
      const userId = await currentUserId(db);
      if (!userId) return fail("You are no longer signed in.");
      const { data: conversation } = await db
        .from("conversations")
        .select("id")
        .eq("org_id", orgId)
        .eq("user_id", userId)
        .eq("scope", "workspace")
        .is("deleted_at", null)
        .maybeSingle();
      if (conversation) {
        await db.from("conversation_messages").delete().eq("org_id", orgId).eq("conversation_id", conversation.id);
      }
      revalidatePath(`/${org}/assistant`);
      return ok(undefined, "Started over.");
    },
    { minRole: "viewer" },
  );
}

/** The asker's workspace conversation, created on first use. */
async function workspaceConversation(
  db: import("@huntloop/db").TenantClient,
  orgId: string,
  userId: string,
): Promise<string | null> {
  const find = () =>
    db
      .from("conversations")
      .select("id")
      .eq("org_id", orgId)
      .eq("user_id", userId)
      .eq("scope", "workspace")
      .is("deleted_at", null)
      .maybeSingle();
  const { data: existing } = await find();
  if (existing) return String(existing.id);

  const { data: created, error } = await db
    .from("conversations")
    .insert({ org_id: orgId, user_id: userId, scope: "workspace", title: "Workspace assistant" })
    .select("id")
    .single();
  if (created) return String(created.id);
  // 23505: a second tab created it first. Read the one that won.
  if (error?.code === "23505") {
    const { data: again } = await find();
    return again ? String(again.id) : null;
  }
  return null;
}
