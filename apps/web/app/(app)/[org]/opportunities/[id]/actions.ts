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
import { agentQuestionSchema, priorityBandSchema, uuidSchema } from "../../../../../lib/validation";

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

/**
 * A person disagreeing with the verdict — SCO-02.
 *
 * ── Why this is the most valuable write on the page ──────────────────────
 *
 * When a salesperson looks at a `hot` opportunity and marks it `ignore`, they
 * have just supplied a labelled training example for free, about their own
 * market, with a reason attached. `0016` built `human_overrides` to keep those
 * and `record_override` to write them; until now the product had nowhere for a
 * person to disagree at all, so the highest-quality signal it can receive was
 * one it never collected.
 *
 * ── Why the override is recorded by the database, not by this action ─────
 *
 * `record_override` is a function precisely so the change and the record of it
 * cannot diverge. It also refuses a no-op — setting a value to what it already
 * was is somebody re-saving a form, not a correction, and counting it would
 * pollute the one clean signal with noise.
 *
 * ── Why the column is written too, rather than only the override ─────────
 *
 * Because the person means it now. A correction that only feeds a weekly
 * analysis and leaves the wrong band on the screen is a product telling its
 * user it has heard them while visibly not having done so. The score history
 * is untouched — `opportunity_scores` is append-only, and the model's verdict
 * remains readable beside the human's.
 */
export async function overridePriorityAction(
  org: string,
  opportunityId: string,
  priority: string,
  reason: string | null,
): Promise<ActionResult<undefined>> {
  const id = uuidSchema.safeParse(opportunityId);
  if (!id.success) return fail("That opportunity reference isn't valid.");

  const parsed = priorityBandSchema.safeParse(priority);
  if (!parsed.success) return fail("That isn't a priority this product has.");

  return mutate(org, "overridePriority", async ({ db, orgId }) => {
    /* Read first, because the override needs what the system said. Taking the
       previous value from the client would let a caller record a disagreement
       that never happened — and the learning loop reads these as facts. */
    const { data: current } = await db
      .from("opportunities")
      .select("id, priority")
      .eq("id", id.data)
      .eq("org_id", orgId)
      .is("deleted_at", null)
      .maybeSingle();

    if (!current) return fail("That opportunity no longer exists.");

    const previous = String(current.priority ?? "");
    if (previous === parsed.data) {
      /* Not an error, and not recorded. The screen says nothing changed
         rather than claiming a correction was filed. */
      return ok(undefined, `This opportunity is already ${parsed.data}.`);
    }

    const { error } = await db
      .from("opportunities")
      .update({ priority: parsed.data })
      .eq("id", id.data)
      .eq("org_id", orgId);

    if (error) return fail(`That priority could not be changed: ${error.message}`);

    /* The correction. A failure here does not undo the change the user asked
       for — losing a training signal is a reporting problem, and refusing the
       edit over it would be the product punishing them for disagreeing. */
    const { error: overrideError } = await db.rpc("record_override", {
      p_org: orgId,
      p_subject: "opportunity_priority",
      p_entity_type: "opportunity",
      p_entity_id: id.data,
      p_system: previous,
      p_human: parsed.data,
      p_reason: reason?.trim() || null,
    });

    revalidatePath(`/${org}/opportunities/${id.data}`);
    revalidatePath(`/${org}/opportunities`);

    if (overrideError) {
      return ok(
        undefined,
        `Set to ${parsed.data}. The correction itself could not be recorded, ` +
          `so it will not reach the learning loop.`,
      );
    }

    return ok(
      undefined,
      `Set to ${parsed.data}. Your correction is kept, and the weekly analysis ` +
        `reads it alongside the outcomes.`,
    );
  });
}
