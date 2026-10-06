"use server";

import { revalidatePath } from "next/cache";
import type { TenantClient } from "@huntloop/db";
import { currentUserId, fail, mutate, ok, type ActionResult } from "../../../../../lib/data/org";
import {
  logActivitySchema,
  nextStepSchema,
  outcomeReasonSchema,
  parseForm,
  uuidSchema,
} from "../../../../../lib/validation";

/**
 * The daily loop's writes on one opportunity — 0037, COMMAND.md §16.5.
 *
 * ── Why logging a touch can move the stage ───────────────────────────────
 *
 * Because the alternative is two clicks for one fact. A person who logs "sent
 * a LinkedIn message" has contacted the company; one who logs "they replied"
 * has a reply. Making them also drag the card is how pipelines go stale, and a
 * stale pipeline is a wrong one. So a logged touch moves the stage *forward*
 * when the fact implies it, and never backward — the same guarded update the
 * sender and the mailbox sync already use. The stage change is recorded by the
 * ledger's trigger like any other, with the person as its actor.
 *
 * ── Why a reply logged by hand is an outcome ─────────────────────────────
 *
 * The learning loop reads `outcomes`. A reply that arrived on LinkedIn is the
 * same signal as one that arrived by email, and leaving it out would teach the
 * loop that LinkedIn never works — which is the opposite of what most
 * founder-led sales teams would find.
 */

const BEFORE_CONTACT = ["discovered", "researching", "qualified", "assigned"];
const BEFORE_REPLY = [...BEFORE_CONTACT, "contacted"];
const BEFORE_MEETING = [...BEFORE_REPLY, "replied"];

const KIND_SUMMARY: Record<string, (channel: string, direction: string) => string> = {
  note: () => "Note",
  call: (_c, d) => (d === "inbound" ? "They called" : "Call"),
  meeting: () => "Meeting",
  message: (c, d) => `${d === "inbound" ? "They replied" : "Message sent"}${c === "email" ? " by email" : c === "linkedin" ? " on LinkedIn" : ""}`,
  connection_request: () => "Connection request sent",
};

function revalidateOpportunity(org: string, id: string) {
  revalidatePath(`/${org}/opportunities/${id}`);
  revalidatePath(`/${org}/opportunities`);
  revalidatePath(`/${org}/pipeline`);
  revalidatePath(`/${org}/dashboard`);
  revalidatePath(`/${org}/needs-you`);
}

async function readOpportunity(db: TenantClient, orgId: string, id: string) {
  const { data } = await db
    .from("opportunities")
    .select("id, company_id, status, priority, next_step")
    .eq("id", id)
    .eq("org_id", orgId)
    .is("deleted_at", null)
    .maybeSingle();
  return data as
    | { id: string; company_id: string; status: string; priority: string; next_step: string | null }
    | null;
}

/** Forward-only stage moves. Returns the stage moved to, or null. */
async function advanceStage(
  db: TenantClient,
  orgId: string,
  id: string,
  to: "contacted" | "replied" | "meeting",
  from: string[],
): Promise<string | null> {
  const { data } = await db
    .from("opportunities")
    .update({ status: to })
    .eq("id", id)
    .eq("org_id", orgId)
    .in("status", from)
    .select("id");
  return data && data.length > 0 ? to : null;
}

/** One outcome per opportunity and kind — the pipeline board's rule (FLOW-006). */
async function recordOutcomeOnce(db: TenantClient, orgId: string, id: string, kind: "reply" | "meeting") {
  const { data: already } = await db
    .from("outcomes")
    .select("id")
    .eq("org_id", orgId)
    .eq("opportunity_id", id)
    .eq("kind", kind)
    .limit(1);
  if (!already?.length) {
    await db.from("outcomes").insert({ org_id: orgId, opportunity_id: id, kind });
  }
}

export interface LogActivityInput {
  kind: string;
  channel: string;
  direction: string;
  summary?: string;
  body?: string;
  occurredAt?: string;
  personId?: string | null;
  nextStep?: { text: string; dueAt: string | null } | null;
}

export async function logActivityAction(
  org: string,
  opportunityId: string,
  input: LogActivityInput,
): Promise<ActionResult<undefined>> {
  const id = uuidSchema.safeParse(opportunityId);
  const badId = id.success ? null : "That opportunity reference isn't valid.";

  const summary =
    input.summary?.trim() || KIND_SUMMARY[input.kind]?.(input.channel, input.direction) || "";
  const parsed = parseForm(logActivitySchema, { ...input, summary });
  if (!parsed.ok) return fail(parsed.error, parsed.fieldErrors);
  const value = parsed.value;

  let nextStep: { text: string; dueAt: string | null } | null = null;
  if (input.nextStep && input.nextStep.text.trim()) {
    const step = parseForm(nextStepSchema, input.nextStep);
    if (!step.ok) return fail(step.error, Object.fromEntries(Object.entries(step.fieldErrors).map(([k, v]) => [`nextStep.${k}`, v])));
    nextStep = step.value;
  }

  return mutate(org, "logActivity", async ({ db, orgId }) => {
    if (badId || !id.success) return fail(badId ?? "That reference isn't valid.");
    const opp = await readOpportunity(db, orgId, id.data);
    if (!opp) return fail("That opportunity no longer exists.");
    const userId = await currentUserId(db);
    if (!userId) return fail("Your session expired. Sign in again.");

    if (value.personId) {
      const { data: person } = await db
        .from("people")
        .select("id")
        .eq("id", value.personId)
        .eq("org_id", orgId)
        .eq("company_id", opp.company_id)
        .maybeSingle();
      if (!person) return fail("That person is not at this company.");
    }

    const { error } = await db.from("activities").insert({
      org_id: orgId,
      opportunity_id: opp.id,
      company_id: opp.company_id,
      person_id: value.personId ?? null,
      kind: value.kind,
      channel: value.kind === "note" ? "other" : value.channel,
      direction: value.kind === "note" ? "internal" : value.direction,
      actor_type: "user",
      actor_id: userId,
      occurred_at: value.occurredAt ?? new Date().toISOString(),
      summary: value.summary,
      body: value.body || null,
      origin: "manual",
    });
    if (error) return fail(`That could not be logged: ${error.message}`);

    /* Forward-only stage moves implied by what was logged. */
    let moved: string | null = null;
    if (value.kind === "meeting") {
      moved = await advanceStage(db, orgId, opp.id, "meeting", BEFORE_MEETING);
      if (moved) await recordOutcomeOnce(db, orgId, opp.id, "meeting");
    } else if (value.kind !== "note" && value.direction === "inbound") {
      moved = await advanceStage(db, orgId, opp.id, "replied", BEFORE_REPLY);
      await recordOutcomeOnce(db, orgId, opp.id, "reply");
    } else if (value.kind !== "note" && value.direction === "outbound") {
      moved = await advanceStage(db, orgId, opp.id, "contacted", BEFORE_CONTACT);
    }

    if (nextStep) {
      await db
        .from("opportunities")
        .update({
          next_step: nextStep.text,
          next_step_due_at: nextStep.dueAt,
          next_step_set_by: userId,
          next_step_set_at: new Date().toISOString(),
        })
        .eq("id", opp.id)
        .eq("org_id", orgId);
    }

    revalidateOpportunity(org, opp.id);
    const parts = ["Logged."];
    if (moved) parts.push(`Moved to ${moved}.`);
    if (nextStep) parts.push("Next step set.");
    return ok(undefined, parts.join(" "));
  });
}

export async function setNextStepAction(
  org: string,
  opportunityId: string,
  input: { text: string; dueAt: string | null },
): Promise<ActionResult<undefined>> {
  const id = uuidSchema.safeParse(opportunityId);
  const badId = id.success ? null : "That opportunity reference isn't valid.";
  const parsed = parseForm(nextStepSchema, input);
  if (!parsed.ok) return fail(parsed.error, parsed.fieldErrors);

  return mutate(org, "setNextStep", async ({ db, orgId }) => {
    if (badId || !id.success) return fail(badId ?? "That reference isn't valid.");
    const userId = await currentUserId(db);
    const { data, error } = await db
      .from("opportunities")
      .update({
        next_step: parsed.value.text,
        next_step_due_at: parsed.value.dueAt,
        next_step_set_by: userId,
        next_step_set_at: new Date().toISOString(),
      })
      .eq("id", id.data)
      .eq("org_id", orgId)
      .is("deleted_at", null)
      .select("id");
    if (error) return fail(`The next step could not be saved: ${error.message}`);
    if (!data?.length) return fail("That opportunity no longer exists.");

    revalidateOpportunity(org, id.data);
    return ok(undefined, "Next step saved. It shows in Needs you when it is due.");
  });
}

/**
 * Clear the next step — either because it is done, or because it no longer
 * applies. Done is worth a line on the timeline; withdrawn is not.
 */
export async function clearNextStepAction(
  org: string,
  opportunityId: string,
  done: boolean,
): Promise<ActionResult<undefined>> {
  const id = uuidSchema.safeParse(opportunityId);
  const badId = id.success ? null : "That opportunity reference isn't valid.";

  return mutate(org, "clearNextStep", async ({ db, orgId }) => {
    if (badId || !id.success) return fail(badId ?? "That reference isn't valid.");
    const opp = await readOpportunity(db, orgId, id.data);
    if (!opp) return fail("That opportunity no longer exists.");
    const userId = await currentUserId(db);
    if (!userId) return fail("Your session expired. Sign in again.");

    const { error } = await db
      .from("opportunities")
      .update({ next_step: null, next_step_due_at: null, next_step_set_by: null, next_step_set_at: null })
      .eq("id", opp.id)
      .eq("org_id", orgId);
    if (error) return fail(`The next step could not be cleared: ${error.message}`);

    if (done && opp.next_step) {
      await db.from("activities").insert({
        org_id: orgId,
        opportunity_id: opp.id,
        company_id: opp.company_id,
        kind: "note",
        channel: "other",
        direction: "internal",
        actor_type: "user",
        actor_id: userId,
        occurred_at: new Date().toISOString(),
        summary: `Done: ${opp.next_step}`.slice(0, 200),
        origin: "manual",
      });
    }

    revalidateOpportunity(org, opp.id);
    return ok(undefined, done ? "Marked done." : "Next step cleared.");
  });
}

/**
 * "Not a fit" — the disqualification 0018 made room for and nothing wrote.
 *
 * Three writes, one meaning: an outcome with its reason (what the learning
 * loop reads as its most informative negative label), the band moved to
 * Ignore through the same override record the Disagree panel uses (so the
 * scorer keeps the person's call on the next rescore), and the opportunity
 * closed as archived. The ledger shows it as one event with the reason.
 */
export async function disqualifyAction(
  org: string,
  opportunityId: string,
  input: { category: string | null; reason?: string },
): Promise<ActionResult<undefined>> {
  const id = uuidSchema.safeParse(opportunityId);
  const badId = id.success ? null : "That opportunity reference isn't valid.";
  const parsed = parseForm(outcomeReasonSchema, { category: input.category ?? "not_a_fit", reason: input.reason });
  if (!parsed.ok) return fail(parsed.error, parsed.fieldErrors);

  return mutate(org, "disqualify", async ({ db, orgId }) => {
    if (badId || !id.success) return fail(badId ?? "That reference isn't valid.");
    const opp = await readOpportunity(db, orgId, id.data);
    if (!opp) return fail("That opportunity no longer exists.");
    const userId = await currentUserId(db);
    const reason = parsed.value.reason?.trim() || null;

    const { error } = await db.from("outcomes").insert({
      org_id: orgId,
      opportunity_id: opp.id,
      kind: "disqualified",
      reason_category: parsed.value.category,
      reason,
      recorded_by: userId,
    });
    if (error) return fail(`That could not be recorded: ${error.message}`);

    if (opp.priority !== "ignore") {
      await db
        .from("opportunities")
        .update({ priority: "ignore", priority_set_by: "user" })
        .eq("id", opp.id)
        .eq("org_id", orgId);
      await db.rpc("record_override", {
        p_org: orgId,
        p_subject: "opportunity_priority",
        p_entity_type: "opportunity",
        p_entity_id: opp.id,
        p_system: opp.priority,
        p_human: "ignore",
        p_reason: reason ?? "Marked not a fit",
      });
    }

    await db
      .from("opportunities")
      .update({ status: "archived", next_step: null, next_step_due_at: null })
      .eq("id", opp.id)
      .eq("org_id", orgId)
      .not("status", "in", "(won,lost,archived)");

    revalidateOpportunity(org, opp.id);
    return ok(undefined, "Marked not a fit. The reason goes to the learning loop with it.");
  });
}

/** Soft-delete a manual activity you logged. */
export async function deleteActivityAction(
  org: string,
  activityId: string,
): Promise<ActionResult<undefined>> {
  const id = uuidSchema.safeParse(activityId);
  const badId = id.success ? null : "That activity reference isn't valid.";

  return mutate(org, "deleteActivity", async ({ db, orgId }) => {
    if (badId || !id.success) return fail(badId ?? "That reference isn't valid.");
    const { data, error } = await db
      .from("activities")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", id.data)
      .eq("org_id", orgId)
      .eq("origin", "manual")
      .is("deleted_at", null)
      .select("opportunity_id");
    if (error) return fail(`That could not be removed: ${error.message}`);
    if (!data?.length) return fail("Only an activity you logged yourself can be removed.");

    const opportunityId = data[0]?.opportunity_id;
    if (opportunityId) revalidateOpportunity(org, String(opportunityId));
    return ok(undefined, "Removed from the timeline.");
  });
}
