import "server-only";
import { requireOrgId } from "./org";
import { load, type Loaded } from "./source";

/**
 * What a pipeline card needs beyond who and what stage — §8.3.
 *
 * The board answers "where is each deal", and a stage alone cannot say whether
 * a deal is moving: a Contacted card touched yesterday and one touched six
 * weeks ago look the same. So each card also carries the last touch, the next
 * step and when it is due, how far an active sequence has got, and the deal
 * value a person entered. Four bounded reads, each allowed to come back empty:
 * missing context costs a line on a card, never the board.
 */

export interface PipelineExtra {
  lastTouch: { at: string; direction: "inbound" | "outbound"; channel: string } | null;
  nextStep: string | null;
  nextStepDueAt: string | null;
  valueCents: number | null;
  /** Emails sent / email steps, for an active sequence. */
  sequence: { sent: number; total: number } | null;
}

const TOUCH_KINDS = ["email_sent", "email_received", "message", "call", "meeting", "connection_request"];
const BOUND = { opportunities: 2000, touches: 5000, enrollments: 2000, messages: 5000 } as const;

/* eslint-disable @typescript-eslint/no-explicit-any -- untyped PostgREST rows (DB-03). */

export async function getPipelineExtras(orgSlug: string): Promise<Loaded<Record<string, PipelineExtra>>> {
  return load(
    async (db) => {
      const orgId = await requireOrgId(orgSlug, "getPipelineExtras");
      const since = new Date(Date.now() - 365 * 24 * 3600_000).toISOString();

      const [opps, touches, enrollments] = await Promise.all([
        db
          .from("opportunities")
          .select("id, next_step, next_step_due_at, estimated_value_cents")
          .eq("org_id", orgId)
          .is("deleted_at", null)
          .limit(BOUND.opportunities),
        db
          .from("activities")
          .select("opportunity_id, direction, channel, occurred_at")
          .eq("org_id", orgId)
          .in("kind", TOUCH_KINDS)
          .neq("direction", "internal")
          .not("opportunity_id", "is", null)
          .gte("occurred_at", since)
          .is("deleted_at", null)
          .order("occurred_at", { ascending: false })
          .limit(BOUND.touches),
        db
          .from("enrollments")
          .select("id, opportunity_id, campaign_id")
          .eq("org_id", orgId)
          .eq("status", "active")
          .is("deleted_at", null)
          .limit(BOUND.enrollments),
      ]);

      const out: Record<string, PipelineExtra> = {};
      for (const o of (opps.data ?? []) as any[]) {
        out[String(o.id)] = {
          lastTouch: null,
          nextStep: o.next_step ?? null,
          nextStepDueAt: o.next_step_due_at ?? null,
          valueCents:
            o.estimated_value_cents === null || o.estimated_value_cents === undefined
              ? null
              : Number(o.estimated_value_cents),
          sequence: null,
        };
      }

      /* Newest first, so the first row seen per opportunity is its last touch. */
      for (const t of (touches.data ?? []) as any[]) {
        const extra = out[String(t.opportunity_id)];
        if (extra && !extra.lastTouch) {
          extra.lastTouch = {
            at: String(t.occurred_at),
            direction: t.direction === "inbound" ? "inbound" : "outbound",
            channel: String(t.channel),
          };
        }
      }

      const active = ((enrollments.data ?? []) as any[]).filter((e) => out[String(e.opportunity_id)]);
      if (active.length > 0) {
        const campaignIds = [...new Set(active.map((e) => String(e.campaign_id)))];
        const [sequences, sent] = await Promise.all([
          db
            .from("sequences")
            .select("id, campaign_id, created_at, sequence_steps(kind, deleted_at)")
            .eq("org_id", orgId)
            .in("campaign_id", campaignIds)
            .is("deleted_at", null)
            .order("created_at", { ascending: false }),
          db
            .from("messages")
            .select("enrollment_id")
            .eq("org_id", orgId)
            .eq("direction", "outbound")
            .in("enrollment_id", active.map((e) => String(e.id)).slice(0, 500))
            .not("sent_at", "is", null)
            .is("deleted_at", null)
            .limit(BOUND.messages),
        ]);

        /* The newest sequence per campaign is the one enrollments run. */
        const emailSteps = new Map<string, number>();
        for (const s of (sequences.data ?? []) as any[]) {
          const campaign = String(s.campaign_id);
          if (emailSteps.has(campaign)) continue;
          const steps = (Array.isArray(s.sequence_steps) ? s.sequence_steps : []).filter(
            (st: any) => st.kind === "email" && !st.deleted_at,
          );
          emailSteps.set(campaign, steps.length);
        }
        const sentBy = new Map<string, number>();
        for (const m of (sent.data ?? []) as any[]) {
          const id = String(m.enrollment_id);
          sentBy.set(id, (sentBy.get(id) ?? 0) + 1);
        }
        for (const e of active) {
          const total = emailSteps.get(String(e.campaign_id)) ?? 0;
          if (total === 0) continue;
          out[String(e.opportunity_id)]!.sequence = {
            sent: Math.min(total, sentBy.get(String(e.id)) ?? 0),
            total,
          };
        }
      }

      return out;
    },
    /* The demo pipeline has no touches, steps or values. */
    () => ({}),
  );
}

/* eslint-enable @typescript-eslint/no-explicit-any */
