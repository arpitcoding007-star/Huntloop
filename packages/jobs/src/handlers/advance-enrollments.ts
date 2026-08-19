/**
 * `advance_enrollments` — move every due enrollment one step along.
 *
 * ── The shape, and why it is a sweeper like `schedule_scans` ─────────────
 *
 * `enrollments.next_action_at` is the schedule, exactly as `next_scan_at` is
 * for sources, and for the same reason: enrollments are user data that appears
 * and disappears constantly, and a per-enrollment timer would be a second
 * system that can disagree with the rows.
 *
 * ── What "one step" means, and what it refuses to do ─────────────────────
 *
 * A step is either a wait — advance the pointer, set the next time, done — or
 * an email, which becomes a `messages` row and, at the right autonomy level, a
 * `send_message` job. This handler never sends. It decides *what should be
 * sent*, and §46's autonomy ladder decides whether a human sees it first:
 *
 *   level 0–1   drafted and left for approval. `scheduled_at` stays null.
 *   level 2+    drafted and queued to send.
 *
 * Splitting drafting from sending is what makes the approval queue possible at
 * all. A design that generated and sent in one step would have no state in
 * which a message exists and has not gone.
 *
 * ── The four things that stop a sequence dead ────────────────────────────
 *
 * A reply, an unsubscribe, a suppression, and running out of steps. The first
 * three are checked here rather than at send time as well, because an
 * enrollment that keeps drafting messages nobody will send is a bill and a
 * queue of drafts a person has to dismiss.
 */
import { personalizeMessage, type MessageEvidence } from "@huntloop/ai";
import { AiUnavailable, runForOrg } from "../ai.ts";
import { pickMailbox } from "../mailbox/index.ts";
import { enqueue } from "../queue.ts";
import { OrgScope } from "../scope.ts";
import type { JobContext, JobOutcome } from "../registry.ts";

const MAX_PER_TICK = 25;

/** How much evidence a drafting run may cite. Newest first. */
const MAX_EVIDENCE = 12;

export async function advanceEnrollments(ctx: JobContext): Promise<JobOutcome> {
  /* The cross-tenant read, immediately fanned out per org — the same pattern
     and the same justification as `schedule_scans`. */
  const db = OrgScope.global();

  const { data, error } = await db
    .from("enrollments")
    .select("id, org_id, campaign_id, opportunity_id, current_step, mailbox_id")
    .eq("status", "active")
    .is("deleted_at", null)
    .not("next_action_at", "is", null)
    .lte("next_action_at", ctx.now.toISOString())
    .order("next_action_at", { ascending: true })
    .limit(MAX_PER_TICK);

  if (error) return { ok: false, error: `advance_enrollments: ${error.message}` };

  const due = data ?? [];
  let drafted = 0;
  let queued = 0;
  let stopped = 0;
  let waited = 0;
  const problems: string[] = [];

  for (const row of due) {
    const scope = new OrgScope(String(row.org_id));
    try {
      const outcome = await advanceOne(scope, String(row.id));
      if (outcome === "drafted") drafted++;
      else if (outcome === "queued") queued++;
      else if (outcome === "stopped") stopped++;
      else waited++;
    } catch (e) {
      /* One enrollment failing is not the sweep failing. It is parked with the
         reason on the row, which is where the person looking at that campaign
         will find it — an error only in the job log is invisible from the
         screen where the enrollment is. */
      const reason = e instanceof Error ? e.message : String(e);
      problems.push(`${row.id}: ${reason}`);
      await scope
        .update("enrollments", {
          status: "parked",
          parked_reason: reason.slice(0, 500),
          next_action_at: null,
        })
        .eq("id", row.id);
    }
  }

  return {
    ok: true,
    result: { due: due.length, drafted, queued, stopped, waited, problems: problems.slice(0, 5) },
  };
}

type Outcome = "drafted" | "queued" | "stopped" | "waited";

async function advanceOne(scope: OrgScope, enrollmentId: string): Promise<Outcome> {
  const { data: enrollment } = await scope
    .select(
      "enrollments",
      `id, campaign_id, opportunity_id, current_step, mailbox_id,
       campaigns!inner(id, name, status, autonomy_level, product_id),
       opportunities!inner(id, company_id, primary_person_id, outreach_angle, status)`,
    )
    .eq("id", enrollmentId)
    .maybeSingle();

  if (!enrollment) return "stopped";

  /* eslint-disable @typescript-eslint/no-explicit-any --
     Embedded-row typing comes from a generated schema this package lacks. */
  const campaign = one((enrollment as any).campaigns);
  const opportunity = one((enrollment as any).opportunities);
  /* eslint-enable @typescript-eslint/no-explicit-any */

  if (!campaign || campaign.status !== "active") {
    await park(scope, enrollmentId, "The campaign is not running.");
    return "stopped";
  }

  /* §78 and the whole point of the inbox: a person who answered is not still
     in a sequence. Checked from the opportunity's own status, which the reply
     handler moves — rather than from a second flag that could disagree. */
  if (["replied", "meeting", "proposal", "won", "lost"].includes(String(opportunity?.status))) {
    await stop(scope, enrollmentId, "They replied. Sequences stop when somebody answers.");
    return "stopped";
  }

  const step = await nextStep(scope, String(enrollment.campaign_id), Number(enrollment.current_step));
  if (!step) {
    await stop(scope, enrollmentId, "The sequence finished.");
    return "stopped";
  }

  /* A wait is not a step that does nothing — it is the step that makes the
     gap between two emails a property of the sequence rather than of when the
     scheduler happened to run. */
  if (step.kind === "wait" || step.kind === "condition") {
    await scope
      .update("enrollments", {
        current_step: step.position + 1,
        last_step_at: new Date().toISOString(),
        next_action_at: new Date(Date.now() + step.delayHours * 3600_000).toISOString(),
      })
      .eq("id", enrollmentId);
    return "waited";
  }

  const recipient = await resolveRecipient(scope, String(opportunity?.company_id), opportunity?.primary_person_id);
  if (!recipient) {
    await park(
      scope,
      enrollmentId,
      "No verified email address for anyone at this company. Enrich or add a contact.",
    );
    return "stopped";
  }

  /* Suppression, before drafting rather than only before sending. An
     enrollment that keeps producing messages nobody will send is a bill and a
     queue of drafts somebody has to dismiss one at a time. */
  const { data: suppressed } = await scope.rpc("is_suppressed", {
    p_org: scope.orgId,
    p_email: recipient.email,
  });
  if (suppressed === true) {
    await stop(scope, enrollmentId, `${recipient.email} is on this organisation's suppression list.`);
    return "stopped";
  }

  const draft = await draftMessage(scope, {
    opportunity,
    campaign,
    step,
    recipient,
  });

  const mailboxId = enrollment.mailbox_id ?? (await pickMailbox(scope));
  const autonomous = Number(campaign.autonomy_level ?? 0) >= 2;

  const { data: message, error: messageError } = await scope
    .insert("messages", {
      enrollment_id: enrollmentId,
      step_id: step.id,
      mailbox_id: mailboxId,
      direction: "outbound",
      subject: draft.subject,
      body_text: draft.body,
      ai_generated: draft.aiGenerated,
      // §62 rule 9, as a column. A message whose evidence_ids do not cover its
      // claims fails review; one that cites nothing is a generic email, which
      // is a different and lesser thing but still honest about itself.
      evidence_ids: draft.citedEvidenceIds,
      to_email: recipient.email,
      // Null until approved. This column is what distinguishes a draft
      // awaiting a human from a message on its way out, and §46's ladder is
      // the only thing that sets it.
      scheduled_at: autonomous ? new Date().toISOString() : null,
    })
    .select("id")
    .maybeSingle();

  if (messageError || !message) {
    throw new Error(`the message could not be stored: ${messageError?.message ?? "no row"}`);
  }

  await scope
    .update("enrollments", {
      current_step: step.position + 1,
      last_step_at: new Date().toISOString(),
      mailbox_id: mailboxId,
      /* The next action is scheduled from *this* step's delay, not the next
         one's: a step's delay is how long to wait after it, which is the
         reading that makes "send, then wait three days" one step. */
      next_action_at: new Date(
        Date.now() + Math.max(step.delayHours, 24) * 3600_000,
      ).toISOString(),
    })
    .eq("id", enrollmentId);

  if (autonomous) {
    await enqueue({
      orgId: scope.orgId,
      name: "send_message",
      payload: { messageId: String(message.id) },
      idempotencyKey: `send:${message.id}`,
    });
    return "queued";
  }

  return "drafted";
}

/* ── Pieces ──────────────────────────────────────────────────────────────── */

interface Step {
  id: string;
  position: number;
  kind: string;
  delayHours: number;
  subject: string | null;
  body: string | null;
}

async function nextStep(
  scope: OrgScope,
  campaignId: string,
  position: number,
): Promise<Step | null> {
  const { data } = await scope
    .select(
      "sequence_steps",
      "id, position, kind, delay_hours, template, sequences!inner(campaign_id)",
    )
    .eq("sequences.campaign_id", campaignId)
    .gte("position", position)
    .is("deleted_at", null)
    .order("position", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!data) return null;
  const template = (data.template ?? {}) as Record<string, unknown>;

  return {
    id: String(data.id),
    position: Number(data.position ?? 0),
    kind: String(data.kind ?? "email"),
    delayHours: Number(data.delay_hours ?? 0),
    subject: typeof template.subject === "string" ? template.subject : null,
    body: typeof template.body === "string" ? template.body : null,
  };
}

interface Recipient {
  email: string;
  name: string | null;
  title: string | null;
}

/**
 * Who this message goes to.
 *
 * Prefers the opportunity's named buyer, then any decision maker at the
 * company, and requires an address that is not known to be undeliverable.
 * `risky` counts as undeliverable here — a catch-all domain accepts mail
 * whether or not the mailbox exists, and a spam trap accepts it and punishes
 * you for sending, so neither is a person to write to.
 */
async function resolveRecipient(
  scope: OrgScope,
  companyId: string,
  personId: string | null | undefined,
): Promise<Recipient | null> {
  const { data: people } = await scope
    .select(
      "people",
      "id, first_name, last_name, title, is_decision_maker, contact_points(kind, value, verification_status)",
    )
    .eq("company_id", companyId)
    .is("deleted_at", null);

  /* One annotated boundary, as in `pickMailbox` — the rows arrive untyped from
     PostgREST, and naming their shape once is what lets the chain below infer. */
  const rows = (people ?? []) as Record<string, unknown>[];
  const candidates = rows
    .map((row) => {
      const points = (Array.isArray(row.contact_points) ? row.contact_points : []) as {
        kind: string;
        value: string;
        verification_status: string;
      }[];
      const email = points.find(
        (p) =>
          p.kind === "email" &&
          p.verification_status !== "undeliverable" &&
          p.verification_status !== "risky",
      );
      if (!email) return null;
      return {
        id: String(row.id),
        email: String(email.value).toLowerCase(),
        name: [row.first_name, row.last_name].filter(Boolean).join(" ") || null,
        title: (row.title as string | null) ?? null,
        isDecisionMaker: Boolean(row.is_decision_maker),
      };
    })
    .filter((c): c is NonNullable<typeof c> => c !== null);

  if (candidates.length === 0) return null;

  const named = personId ? candidates.find((c) => c.id === personId) : undefined;
  const decisionMaker = candidates.find((c) => c.isDecisionMaker);
  const chosen = named ?? decisionMaker ?? candidates[0]!;

  return { email: chosen.email, name: chosen.name, title: chosen.title };
}

interface Draft {
  subject: string;
  body: string;
  citedEvidenceIds: string[];
  aiGenerated: boolean;
}

/**
 * The message itself.
 *
 * Falls back to the sequence step's template when there is no model to run —
 * which is a real and honest outcome, not a degraded one. A template with no
 * personalisation is a worse email and a truthful one; a *fabricated*
 * personalisation would be a better-looking email that is wrong about the
 * recipient, which is the failure this whole task is written against.
 *
 * A step with neither a template nor a model throws, and the enrollment parks
 * with that as its reason.
 */
async function draftMessage(
  scope: OrgScope,
  input: {
    /* eslint-disable-next-line @typescript-eslint/no-explicit-any -- embedded rows */
    opportunity: any;
    /* eslint-disable-next-line @typescript-eslint/no-explicit-any -- embedded rows */
    campaign: any;
    step: Step;
    recipient: Recipient;
  },
): Promise<Draft> {
  const { data: company } = await scope
    .select("companies", "name")
    .eq("id", input.opportunity.company_id)
    .maybeSingle();

  const companyName = String(company?.name ?? "this company");

  try {
    const evidence = await loadEvidence(scope, String(input.opportunity.id));
    const product = await loadProduct(scope, input.campaign.product_id);
    const guidance = await loadGuidance(scope);

    const run = await runForOrg(scope, personalizeMessage, {
      companyName,
      recipientName: input.recipient.name,
      recipientTitle: input.recipient.title,
      weSell: product,
      angle: String(input.opportunity.outreach_angle ?? "").trim() || "No angle was recorded.",
      step: input.step.position,
      template: { subject: input.step.subject, body: input.step.body },
      evidence,
      guidance,
    });

    return {
      subject: run.output.subject,
      body: run.output.body,
      citedEvidenceIds: run.output.citedEvidenceIds,
      aiGenerated: true,
    };
  } catch (e) {
    if (!(e instanceof AiUnavailable)) throw e;

    if (!input.step.subject || !input.step.body) {
      throw new Error(
        "This step has no template, and there is no model configured to write " +
          "one. Add a subject and body to the step, or set ANTHROPIC_API_KEY.",
      );
    }

    return {
      /* Substituted, not generated. Two placeholders, both filled from rows —
         so the worst case is a template that reads a little flatly, never one
         that asserts something about the recipient nobody established. */
      subject: fill(input.step.subject, companyName, input.recipient.name),
      body: fill(input.step.body, companyName, input.recipient.name),
      citedEvidenceIds: [],
      aiGenerated: false,
    };
  }
}

function fill(template: string, company: string, name: string | null): string {
  return template
    .replace(/\{\{\s*company\s*\}\}/gi, company)
    .replace(/\{\{\s*first_name\s*\}\}/gi, (name ?? "").split(" ")[0] ?? "there")
    .replace(/\{\{\s*name\s*\}\}/gi, name ?? "there");
}

async function loadEvidence(scope: OrgScope, opportunityId: string): Promise<MessageEvidence[]> {
  const { data } = await scope
    .select("evidence", "id, claim, kind, source_url, event_date")
    .eq("subject_type", "opportunity")
    .eq("subject_id", opportunityId)
    .is("deleted_at", null)
    .is("superseded_by", null)
    .order("event_date", { ascending: false, nullsFirst: false })
    .limit(MAX_EVIDENCE);

  return (data ?? []).map((row: Record<string, unknown>) => ({
    id: String(row.id),
    claim: String(row.claim),
    kind: row.kind as MessageEvidence["kind"],
    sourceUrl: (row.source_url as string | null) ?? null,
    eventDate: (row.event_date as string | null) ?? null,
  }));
}

async function loadProduct(scope: OrgScope, productId: string | null): Promise<string> {
  const query = scope.select("products", "description, name").is("deleted_at", null);
  const { data } = productId
    ? await query.eq("id", productId).maybeSingle()
    : await query.order("created_at", { ascending: true }).limit(1).maybeSingle();

  return String(data?.description ?? data?.name ?? "").trim() || "(not recorded)";
}

/**
 * House style, from `memories`.
 *
 * Organization-scoped only. §37's hierarchy means a user-scoped memory belongs
 * to one salesperson, and a background job has no salesperson — applying one
 * person's tone rule to a colleague's campaign is exactly the leak the scope
 * column exists to prevent.
 */
async function loadGuidance(scope: OrgScope): Promise<string[]> {
  const { data } = await scope
    .select("memories", "content")
    .eq("scope", "organization")
    .eq("kind", "durable")
    .is("deleted_at", null)
    .limit(10);

  return (data ?? []).map((row: Record<string, unknown>) => String(row.content)).filter(Boolean);
}

async function stop(scope: OrgScope, id: string, reason: string): Promise<void> {
  await scope
    .update("enrollments", { status: "stopped", parked_reason: reason, next_action_at: null })
    .eq("id", id);
}

async function park(scope: OrgScope, id: string, reason: string): Promise<void> {
  await scope
    .update("enrollments", { status: "parked", parked_reason: reason, next_action_at: null })
    .eq("id", id);
}

/* eslint-disable-next-line @typescript-eslint/no-explicit-any -- embedded rows */
function one(value: any): any {
  return Array.isArray(value) ? value[0] : value;
}
