import "server-only";
import { requireOrgId } from "./org";
import { load, type Loaded } from "./source";

/**
 * Outreach — master context §46, and `0004`.
 *
 * ── The autonomy level is the load-bearing field ─────────────────────────
 *
 * `campaigns.autonomy_level` is §46's ladder, 0–5, and it is per campaign
 * rather than per organisation on purpose: the same team can run a level-0
 * campaign into a new market and a level-3 one into a segment it understands.
 * Every screen that shows a campaign has to show it, because it is the answer
 * to "will this send without me?" — and a campaign list that omits it is a
 * list of things that might be emailing people right now.
 *
 * ── Why enrollments are counted and not listed ───────────────────────────
 *
 * A campaign's enrollments are opportunities, and the opportunity list is
 * already the screen for those. What this module needs is the count, which is
 * what makes "active" mean something. Soft deletes are filtered in the mapper
 * for the same reason as everywhere else: a top-level `deleted_at is null`
 * does not reach inside an embed.
 */

export interface SequenceStep {
  id: string;
  position: number;
  kind: "email" | "wait" | "condition";
  delayHours: number;
  subject: string | null;
  body: string | null;
}

export interface Sequence {
  id: string;
  name: string;
  version: number;
  steps: SequenceStep[];
}

export interface Campaign {
  id: string;
  name: string;
  status: string;
  autonomyLevel: number;
  icpId: string | null;
  productId: string | null;
  startedAt: string | null;
  updatedAt: string | null;
  enrollmentCount: number;
  sequences: Sequence[];
}

export interface Mailbox {
  id: string;
  email: string;
  provider: string;
  displayName: string | null;
  status: string;
  dailyLimit: number;
  sentToday: number;
  healthScore: number | null;
  warmupStage: string | null;
}

export interface Outreach {
  campaigns: Campaign[];
  mailboxes: Mailbox[];
}

export async function getOutreach(orgSlug: string): Promise<Loaded<Outreach>> {
  return load(
    async (db) => {
      const orgId = await requireOrgId(orgSlug, "getOutreach");

      const [campaigns, mailboxes] = await Promise.all([
        db
          .from("campaigns")
          .select(
            `id, name, status, autonomy_level, icp_id, product_id, started_at, updated_at,
             enrollments(id, deleted_at),
             sequences(id, name, version, deleted_at,
               sequence_steps(id, position, kind, delay_hours, template, deleted_at))`,
          )
          .eq("org_id", orgId)
          .is("deleted_at", null)
          .order("created_at", { ascending: false }),
        db
          .from("mailboxes")
          .select(
            `id, email, provider, display_name, status, daily_limit, sent_today,
             health_score, warmup_stage`,
          )
          .eq("org_id", orgId)
          .is("deleted_at", null)
          .order("email", { ascending: true }),
      ]);

      if (campaigns.error) throw new Error(`getOutreach campaigns: ${campaigns.error.message}`);
      if (mailboxes.error) throw new Error(`getOutreach mailboxes: ${mailboxes.error.message}`);

      return {
        campaigns: (campaigns.data ?? []).map(mapCampaign),
        mailboxes: (mailboxes.data ?? []).map(mapMailbox),
      };
    },
    () => DEMO,
  );
}

/* eslint-disable @typescript-eslint/no-explicit-any --
   Supabase row types for a nested select are generated from a live project's
   schema. Confined to the mappers so the rest of the file is checked. */
function mapCampaign(row: any): Campaign {
  return {
    id: String(row.id),
    name: String(row.name ?? ""),
    status: String(row.status ?? "draft"),
    autonomyLevel: Number(row.autonomy_level ?? 0),
    icpId: row.icp_id ?? null,
    productId: row.product_id ?? null,
    startedAt: row.started_at ?? null,
    updatedAt: row.updated_at ?? null,
    enrollmentCount: (Array.isArray(row.enrollments) ? row.enrollments : []).filter(
      (e: any) => !e.deleted_at,
    ).length,
    sequences: (Array.isArray(row.sequences) ? row.sequences : [])
      .filter((s: any) => !s.deleted_at)
      .map(mapSequence),
  };
}

function mapSequence(row: any): Sequence {
  return {
    id: String(row.id),
    name: String(row.name ?? ""),
    version: Number(row.version ?? 1),
    steps: (Array.isArray(row.sequence_steps) ? row.sequence_steps : [])
      .filter((s: any) => !s.deleted_at)
      .map(mapStep)
      // PostgREST does not order embedded rows, and a sequence rendered out of
      // order is a different sequence. Sorted here rather than trusted.
      .sort((a: SequenceStep, b: SequenceStep) => a.position - b.position),
  };
}

function mapStep(row: any): SequenceStep {
  /* `template` is jsonb, so its shape is a contract this file defines — the
     same arrangement, and the same risk, as `icps.criteria`. Subject and body
     are the two keys anything reads; both degrade to null rather than
     throwing on a row written by an older version. */
  const template = (row.template ?? {}) as Record<string, unknown>;
  return {
    id: String(row.id),
    position: Number(row.position ?? 0),
    kind: (["email", "wait", "condition"] as const).includes(row.kind)
      ? row.kind
      : "email",
    delayHours: Number(row.delay_hours ?? 0),
    subject: typeof template.subject === "string" ? template.subject : null,
    body: typeof template.body === "string" ? template.body : null,
  };
}

function mapMailbox(row: any): Mailbox {
  return {
    id: String(row.id),
    email: String(row.email ?? ""),
    provider: String(row.provider ?? "smtp"),
    displayName: row.display_name ?? null,
    status: String(row.status ?? "connected"),
    dailyLimit: Number(row.daily_limit ?? 0),
    sentToday: Number(row.sent_today ?? 0),
    healthScore: typeof row.health_score === "number" ? row.health_score : null,
    warmupStage: row.warmup_stage ?? null,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * Demo outreach.
 *
 * One campaign at autonomy 0 — drafts only, nothing sends without approval —
 * because that is what a new organisation starts at and what the screen should
 * teach. A demo showing level 4 would suggest the product ships sending
 * autonomously by default, which is the opposite of §46.
 *
 * No mailbox, deliberately: connecting one needs OAuth that is not built, and
 * a demo mailbox reading "connected · healthy" would advertise a capability
 * that does not exist.
 */
const DEMO: Outreach = {
  campaigns: [
    {
      id: "demo-campaign-1",
      name: "Agent infrastructure — Q3",
      status: "draft",
      autonomyLevel: 0,
      icpId: null,
      productId: null,
      startedAt: null,
      updatedAt: null,
      enrollmentCount: 0,
      sequences: [
        {
          id: "demo-sequence-1",
          name: "First touch",
          version: 1,
          steps: [
            {
              id: "demo-step-1",
              position: 0,
              kind: "email",
              delayHours: 0,
              subject: "The policy layer your agents are missing",
              body: "Saw you shipped an agent that moves funds last month — how are you gating it today?",
            },
            {
              id: "demo-step-2",
              position: 1,
              kind: "wait",
              delayHours: 72,
              subject: null,
              body: null,
            },
            {
              id: "demo-step-3",
              position: 2,
              kind: "email",
              delayHours: 0,
              subject: "One more thought",
              body: "Following up with the two questions most teams ask us at this stage.",
            },
          ],
        },
      ],
    },
  ],
  mailboxes: [],
};

/**
 * The campaigns a selection of opportunities could be added to.
 *
 * ── Why this is not `getOutreach()` ──────────────────────────────────────
 *
 * The Opportunities screen needs three fields and a yes/no. Reusing the full
 * loader there would pull every sequence, every step's template body, and
 * every mailbox into a page that renders none of them — on the one screen most
 * likely to be holding a few hundred rows already.
 *
 * ── `sendable`, and why the screen is told rather than left to infer ─────
 *
 * A campaign with no sequence, or a sequence with no email step, accepts
 * enrollments and then advances them into nothing: the engine reads past the
 * last step, marks the enrollment finished, and the user watches a number go
 * up and nothing happen. That is a worse outcome than being unable to enrol,
 * so the picker shows those campaigns disabled with the reason rather than
 * hiding them — hiding a campaign somebody just created reads as a bug in the
 * thing they created, not as a missing step.
 *
 * Archived campaigns are excluded outright. That is a decision the user has
 * already made about the campaign, not a state to warn them out of.
 */
export interface CampaignTarget {
  id: string;
  name: string;
  status: string;
  autonomyLevel: number;
  /** False when the campaign has no email step for an enrollment to reach. */
  sendable: boolean;
}

export async function listCampaignTargets(
  orgSlug: string,
): Promise<Loaded<CampaignTarget[]>> {
  return load(
    async (db) => {
      const orgId = await requireOrgId(orgSlug, "listCampaignTargets");

      const { data, error } = await db
        .from("campaigns")
        .select(
          `id, name, status, autonomy_level,
           sequences(id, deleted_at, sequence_steps(id, kind, deleted_at))`,
        )
        .eq("org_id", orgId)
        .is("deleted_at", null)
        .neq("status", "archived")
        .order("created_at", { ascending: false });

      if (error) throw new Error(`listCampaignTargets: ${error.message}`);

      return (data ?? []).map(mapTarget);
    },
    () => DEMO.campaigns.map((c) => ({
      id: c.id,
      name: c.name,
      status: c.status,
      autonomyLevel: c.autonomyLevel,
      sendable: c.sequences.some((s) => s.steps.some((step) => step.kind === "email")),
    })),
  );
}

/* eslint-disable @typescript-eslint/no-explicit-any --
   Same reason as the mappers above: a nested select has no generated row type
   without a live project schema. Confined to this function. */
function mapTarget(row: any): CampaignTarget {
  /* Soft deletes are filtered in the mapper, not the query: a top-level
     `deleted_at is null` does not reach inside an embed, so a campaign whose
     only sequence was deleted would otherwise still look sendable. */
  const sendable = (Array.isArray(row.sequences) ? row.sequences : [])
    .filter((s: any) => !s.deleted_at)
    .some((s: any) =>
      (Array.isArray(s.sequence_steps) ? s.sequence_steps : []).some(
        (step: any) => !step.deleted_at && step.kind === "email",
      ),
    );

  return {
    id: String(row.id),
    name: String(row.name ?? ""),
    status: String(row.status ?? "draft"),
    autonomyLevel: Number(row.autonomy_level ?? 0),
    sendable,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */
