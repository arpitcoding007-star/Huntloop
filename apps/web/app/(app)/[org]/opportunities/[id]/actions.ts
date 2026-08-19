"use server";

import { revalidatePath } from "next/cache";
import type { QualificationEvidence } from "@huntloop/ai";
import { ask } from "../../../../../lib/ai/agent";
import {
  currentUserId,
  fail,
  mutate,
  ok,
  type ActionResult,
} from "../../../../../lib/data/org";
import { agentQuestionSchema, uuidSchema } from "../../../../../lib/validation";

/**
 * Ask the per-opportunity agent something — master context §19.
 *
 * ── Why this is a write action rather than a read ────────────────────────
 *
 * Because the question and the answer are both kept. §19 asks for a discussion
 * window that remembers, and a conversation that evaporates on navigation is
 * not one — "give me a different angle" has no meaning without the previous
 * one. So the turn is persisted before it is returned.
 *
 * ── The three things the model is not allowed to be told ─────────────────
 *
 * The ICP, the evidence, and the narrative all come from the database inside
 * this action. None of them crosses from the client, and that is the whole
 * safety property: the answer to "what do we actually know about them" cannot
 * be shaped by the page that asked. A client-supplied evidence list would let
 * a caller ask the agent to reason from claims nobody gathered, which is the
 * §7 failure the task's citation enum exists to make unrepresentable — and it
 * would hand it back through the front door.
 *
 * ── Why a failed run stores nothing at all ───────────────────────────────
 *
 * Not even the question. A question sitting alone in the history reads as an
 * answer that was lost, and worse, the next turn would replay it to the model
 * as though it had been answered. When the run fails, nothing is written and
 * the error comes back — the user retries the question still in the box.
 */
export async function askAgentAction(
  org: string,
  opportunityId: string,
  question: string,
): Promise<ActionResult<{ answer: string; citedClaims: string[]; unresolved: string[] }>> {
  const parsed = agentQuestionSchema.safeParse(question);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "That question could not be read.");
  }

  return mutate(org, "askAgent", async ({ db, orgId }) => {
    const id = uuidSchema.safeParse(opportunityId);
    if (!id.success) return fail("That opportunity reference isn't valid.");

    const { data: opportunity, error: readError } = await db
      .from("opportunities")
      .select(
        `id, priority, priority_reason, why_this_company, identified_problem,
         current_approach, why_now, outreach_angle,
         companies!inner(name, canonical_domain)`,
      )
      .eq("id", id.data)
      .eq("org_id", orgId)
      .is("deleted_at", null)
      .maybeSingle();

    if (readError) return fail(`That opportunity could not be read: ${readError.message}`);
    if (!opportunity) return fail("That opportunity no longer exists.");

    /* Ids as well as claims: the answer cites claims, and what gets stored is
       the id behind each one — see `ConversationTurn.citedClaims` for why the
       column stays a uuid array. */
    const { data: evidenceRows } = await db
      .from("evidence")
      .select("id, claim, kind, confidence, source_url, excerpt")
      .eq("org_id", orgId)
      .eq("subject_type", "opportunity")
      .eq("subject_id", id.data)
      .is("deleted_at", null)
      .is("superseded_by", null)
      .order("observed_at", { ascending: false });

    const rows = (evidenceRows ?? []) as Record<string, unknown>[];
    const evidence: QualificationEvidence[] = rows.map((row) => ({
      claim: String(row.claim ?? ""),
      kind: row.kind as QualificationEvidence["kind"],
      confidence: (row.confidence as QualificationEvidence["confidence"]) ?? null,
      sourceUrl: (row.source_url as string | null) ?? null,
      excerpt: (row.excerpt as string | null) ?? null,
    }));
    const idByClaim = new Map(rows.map((row) => [String(row.claim ?? ""), String(row.id)]));

    /* The conversation row, created on the first question rather than
       speculatively — an opportunity nobody has asked about has no
       conversation, which is what `getConversation` reports. */
    const userId = await currentUserId(db);
    if (!userId) return fail("You are no longer signed in.");

    const { data: conversation, error: conversationError } = await db
      .from("conversations")
      .upsert(
        {
          org_id: orgId,
          opportunity_id: id.data,
          user_id: userId,
          last_message_at: new Date().toISOString(),
        },
        { onConflict: "org_id,opportunity_id,user_id" },
      )
      .select("id")
      .single();

    if (conversationError) {
      return fail(`That conversation could not be opened: ${conversationError.message}`);
    }

    const conversationId = String(conversation.id);

    const { data: priorRows } = await db
      .from("conversation_messages")
      .select("role, content, created_at")
      .eq("org_id", orgId)
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true });

    const history = ((priorRows ?? []) as Record<string, unknown>[])
      .filter((row) => row.role === "user" || row.role === "assistant")
      .map((row) => ({
        role: row.role as "user" | "assistant",
        content: String(row.content ?? ""),
      }));

    /* eslint-disable-next-line @typescript-eslint/no-explicit-any --
       One embedded relation, no generated row type. */
    const company = (opportunity as any).companies;

    const outcome = await ask(org, {
      companyName: String(company?.name ?? ""),
      canonicalDomain: String(company?.canonical_domain ?? ""),
      priority: opportunity.priority,
      priorityReason: String(opportunity.priority_reason ?? ""),
      narrative: {
        whyThisCompany: (opportunity.why_this_company as string | null) ?? null,
        identifiedProblem: (opportunity.identified_problem as string | null) ?? null,
        currentApproach: (opportunity.current_approach as string | null) ?? null,
        whyNow: (opportunity.why_now as string | null) ?? null,
        outreachAngle: (opportunity.outreach_angle as string | null) ?? null,
      },
      evidence,
      history,
      question: parsed.data,
    });

    if (!outcome.ok) return fail(outcome.error);

    const answer = outcome.result.answer;

    /* Both turns in one statement, so a question can never be stored without
       its answer — the state that would replay to the model as though it had
       been answered. */
    const { error: writeError } = await db.from("conversation_messages").insert([
      {
        org_id: orgId,
        conversation_id: conversationId,
        role: "user",
        content: parsed.data,
      },
      {
        org_id: orgId,
        conversation_id: conversationId,
        role: "assistant",
        content: answer.answer,
        cited_evidence_ids: answer.citedClaims
          .map((claim) => idByClaim.get(claim))
          .filter((value): value is string => Boolean(value)),
      },
    ]);

    if (writeError) {
      /* The answer is in hand and is what the user asked for, so it is
         returned — but the failure is reported with it, because a conversation
         that silently loses turns will replay wrong on the next question. */
      return fail(
        `The agent answered, but the conversation could not be saved: ${writeError.message}`,
      );
    }

    revalidatePath(`/${org}/opportunities/${id.data}`);

    return ok({
      answer: answer.answer,
      citedClaims: answer.citedClaims,
      unresolved: answer.unresolved,
    });
  });
}
