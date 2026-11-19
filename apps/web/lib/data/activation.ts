import "server-only";

import { currentViewer } from "./membership";
import { load, type Loaded } from "./source";

/**
 * Is the loop working for this workspace? (ANL-301, migration 0054.)
 *
 * Reads `org_activation`, one row per workspace, derived from tables that
 * already exist. No new tracking, nothing sent anywhere. The view is
 * `security_invoker`, so a session only ever sees its own workspace's row.
 *
 * Workspace-wide on purpose: activation is a fact about the workspace (did
 * anyone here get a reply yet?), not about one person's share of it.
 */

export interface ActivationRow {
  signedUpAt: string;
  onboardingCompletedAt: string | null;
  firstWarmAt: string | null;
  firstSendAt: string | null;
  firstReplyAt: string | null;
  firstMeetingAt: string | null;
  sent30d: number;
  replies30d: number;
  drafts30d: number;
  draftsRejected30d: number;
  meetings30d: number;
}

export interface ActivationStep {
  key: "signup" | "warm" | "send" | "reply" | "meeting";
  label: string;
  /** When it first happened, or null when it has not yet. */
  at: string | null;
  /** Whole days from sign-up to this step; null when it has not happened. */
  daysFromSignup: number | null;
  /** What to do to reach it, shown only while it has not happened. */
  next: string;
  href: string;
}

export interface ActivationSummary {
  steps: ActivationStep[];
  /** The first step that has not happened yet, or null when all have. */
  current: ActivationStep["key"] | null;
  /** First send within 7 days of sign-up: the definition 0054 documents. */
  activated: boolean;
  /** Replies per send over 30 days; null with no sends (not zero: nothing was measured). */
  replyRate30d: number | null;
  /** Rejected drafts per AI draft over 30 days; null with no drafts. */
  rejectionRate30d: number | null;
  sent30d: number;
  replies30d: number;
  drafts30d: number;
  meetings30d: number;
}

const DAY_MS = 24 * 3600_000;

function daysBetween(from: string, to: string | null): number | null {
  if (!to) return null;
  return Math.max(0, Math.floor((Date.parse(to) - Date.parse(from)) / DAY_MS));
}

/** Pure, so it is unit-tested without a database. */
export function summarizeActivation(row: ActivationRow, org: string): ActivationSummary {
  const steps: ActivationStep[] = [
    {
      key: "signup",
      label: "Workspace created",
      at: row.signedUpAt,
      daysFromSignup: 0,
      next: "",
      href: `/${org}/settings`,
    },
    {
      key: "warm",
      label: "First hot or warm opportunity",
      at: row.firstWarmAt,
      daysFromSignup: daysBetween(row.signedUpAt, row.firstWarmAt),
      next: "Sharpen your ICP or add sources, then hunt.",
      href: `/${org}/opportunities`,
    },
    {
      key: "send",
      label: "First email sent",
      at: row.firstSendAt,
      daysFromSignup: daysBetween(row.signedUpAt, row.firstSendAt),
      next: "Connect a mailbox, add an opportunity to a campaign, and approve the draft.",
      href: `/${org}/outreach`,
    },
    {
      key: "reply",
      label: "First reply",
      at: row.firstReplyAt,
      daysFromSignup: daysBetween(row.signedUpAt, row.firstReplyAt),
      next: "Replies are read from your mailbox on every sync. Keep sending to warm opportunities.",
      href: `/${org}/inbox`,
    },
    {
      key: "meeting",
      label: "First meeting",
      at: row.firstMeetingAt,
      daysFromSignup: daysBetween(row.signedUpAt, row.firstMeetingAt),
      next: "Log a meeting on the opportunity when one is booked, so it counts.",
      href: `/${org}/pipeline`,
    },
  ];

  const sendDays = daysBetween(row.signedUpAt, row.firstSendAt);
  return {
    steps,
    current: steps.find((s) => s.at === null)?.key ?? null,
    activated: sendDays !== null && sendDays < 7,
    replyRate30d: row.sent30d > 0 ? row.replies30d / row.sent30d : null,
    rejectionRate30d: row.drafts30d > 0 ? row.draftsRejected30d / row.drafts30d : null,
    sent30d: row.sent30d,
    replies30d: row.replies30d,
    drafts30d: row.drafts30d,
    meetings30d: row.meetings30d,
  };
}

/** The demo workspace: created, with warm opportunities, and no outreach. */
const DEMO_ROW: ActivationRow = {
  signedUpAt: "2026-11-02T09:00:00.000Z",
  onboardingCompletedAt: "2026-11-02T09:20:00.000Z",
  firstWarmAt: "2026-11-02T09:18:00.000Z",
  firstSendAt: null,
  firstReplyAt: null,
  firstMeetingAt: null,
  sent30d: 0,
  replies30d: 0,
  drafts30d: 0,
  draftsRejected30d: 0,
  meetings30d: 0,
};

const n = (v: unknown) => Number(v ?? 0) || 0;
const t = (v: unknown) => (v === null || v === undefined ? null : String(v));

export async function getActivation(orgSlug: string): Promise<Loaded<ActivationSummary | null>> {
  return load(
    async (db) => {
      const viewer = await currentViewer(orgSlug);
      if (!viewer || viewer.kind !== "member") {
        throw new Error(`getActivation: no membership resolved for "${orgSlug}" on a live database.`);
      }
      const { data, error } = await db
        .from("org_activation")
        .select(
          "signed_up_at, onboarding_completed_at, first_warm_at, first_send_at, first_reply_at, " +
            "first_meeting_at, sent_30d, replies_30d, drafts_30d, drafts_rejected_30d, meetings_30d",
        )
        .eq("org_id", viewer.orgId)
        .maybeSingle();
      if (error) throw new Error(`getActivation: ${error.message}`);
      if (!data) return null;
      const r = data as unknown as Record<string, unknown>;
      return summarizeActivation(
        {
          signedUpAt: String(r.signed_up_at),
          onboardingCompletedAt: t(r.onboarding_completed_at),
          firstWarmAt: t(r.first_warm_at),
          firstSendAt: t(r.first_send_at),
          firstReplyAt: t(r.first_reply_at),
          firstMeetingAt: t(r.first_meeting_at),
          sent30d: n(r.sent_30d),
          replies30d: n(r.replies_30d),
          drafts30d: n(r.drafts_30d),
          draftsRejected30d: n(r.drafts_rejected_30d),
          meetings30d: n(r.meetings_30d),
        },
        orgSlug,
      );
    },
    () => summarizeActivation(DEMO_ROW, orgSlug),
  );
}
