/**
 * Performance — what happened, and what it means. COMMAND.md §16.3-E.
 *
 * ── Why this is pure ─────────────────────────────────────────────────────
 *
 * Every number on the Performance screen, and every sentence that interprets
 * one, comes from this file and nothing else. It takes rows and returns
 * figures; it reads no clock but the one it is given and touches no database.
 * That is what makes `compute.test.ts` able to pin each definition — and a
 * performance screen whose definitions are not pinned is one whose numbers
 * drift until nobody trusts them.
 *
 * ── The definitions, stated once ─────────────────────────────────────────
 *
 *   Contacted (cohort)  opportunities whose FIRST outbound touch, on any
 *                       channel, fell in the window. Rates are measured on this
 *                       cohort, so "reply rate" means "of the companies you
 *                       started talking to in this period, how many answered
 *                       — at any time up to now". A rate over events in the
 *                       window (replies ÷ sends) would credit this month's
 *                       replies to last month's work.
 *   Replied             in the cohort, any inbound touch at or after the first
 *                       outbound one.
 *   Meeting             in the cohort, a meeting outcome or a logged meeting
 *                       after the first outbound touch.
 *   Funnel counts       events in the window: found, qualified (found and
 *                       HOT/WARM), first contacted, first replied, and recorded
 *                       outcomes by kind.
 *
 * ── Why the insights are statistics, not prose ───────────────────────────
 *
 * "LinkedIn works better than email" is a sentence a model will write about
 * three replies. Here a segment is called better or worse only when its 95%
 * Wilson interval does not overlap the rest of the cohort's, with at least
 * MIN_SEGMENT companies on each side; a period is called better or worse only
 * when a two-proportion test clears 1.96 with MIN_PERIOD on each side. Below
 * those, the screen says there is not enough data — which is true, and is the
 * single most useful thing to know about a small sample.
 */

export type Priority = "hot" | "warm" | "watch" | "ignore";

export interface PerfOpportunity {
  id: string;
  company: string;
  firstSeenAt: string;
  priority: Priority;
  status: string;
  ownerId: string | null;
  via: string | null;
  triggerType: string | null;
}

export interface PerfTouch {
  opportunityId: string;
  kind: string;
  channel: string;
  direction: "outbound" | "inbound";
  occurredAt: string;
  actorId: string | null;
}

export interface PerfOutcome {
  opportunityId: string | null;
  kind: string;
  occurredAt: string;
  reasonCategory: string | null;
  competitorId: string | null;
}

export interface PerfWindow {
  from: Date;
  to: Date;
}

export interface PerfSpend {
  aiCents: number;
  providerCredits: number;
}

export interface PerfInput {
  opportunities: PerfOpportunity[];
  touches: PerfTouch[];
  outcomes: PerfOutcome[];
  window: PerfWindow;
  previous: PerfWindow;
  spend: { current: PerfSpend; previous: PerfSpend };
  ownerNames: Map<string, string>;
  competitorNames: Map<string, string>;
  now: Date;
}

export interface Funnel {
  discovered: number;
  qualified: number;
  contacted: number;
  replied: number;
  positive: number;
  meetings: number;
  proposals: number;
  won: number;
  lost: number;
  disqualified: number;
}

export interface Cohort {
  contacted: number;
  replied: number;
  meetings: number;
  replyRate: number | null;
  meetingRate: number | null;
  medianDaysToReply: number | null;
  medianDaysToMeeting: number | null;
}

export interface Segment {
  key: string;
  label: string;
  contacted: number;
  replied: number;
  meetings: number;
  replyRate: number | null;
  /** 95% Wilson interval on the reply rate, or null with no contacts. */
  interval: [number, number] | null;
  /** Up to 25 companies behind the number, for the drill-down. */
  companies: { id: string; name: string }[];
}

export type BreakdownKey = "channel" | "source" | "owner" | "trigger" | "priority";

export interface Tally {
  key: string;
  label: string;
  count: number;
}

export interface Insight {
  id: string;
  tone: "strength" | "risk" | "change" | "info";
  headline: string;
  /** The figures the headline rests on, stated plainly. */
  basis: string;
  breakdown?: BreakdownKey;
  segmentKey?: string;
}

export interface Performance {
  window: { from: string; to: string };
  funnel: Funnel;
  previousFunnel: Funnel;
  cohort: Cohort;
  previousCohort: Cohort;
  breakdowns: Record<BreakdownKey, Segment[]>;
  reasons: { lost: Tally[]; disqualified: Tally[]; competitors: Tally[] };
  cost: {
    aiCents: number;
    providerCredits: number;
    perQualifiedCents: number | null;
    perMeetingCents: number | null;
  };
  stalled: { id: string; company: string; stage: string; idleDays: number }[];
  insights: Insight[];
}

export const MIN_SEGMENT = 10;
export const MIN_PERIOD = 30;
const STALL_DAYS = 14;
const DAY = 24 * 3600_000;

/* ── Statistics ──────────────────────────────────────────────────────────── */

/** The 95% Wilson score interval for k successes in n trials. */
export function wilson(k: number, n: number, z = 1.96): [number, number] | null {
  if (n <= 0) return null;
  const p = k / n;
  const denom = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}

/** Two-proportion z statistic; positive when the first proportion is higher. */
export function twoProportionZ(k1: number, n1: number, k2: number, n2: number): number | null {
  if (n1 <= 0 || n2 <= 0) return null;
  const p = (k1 + k2) / (n1 + n2);
  const se = Math.sqrt(p * (1 - p) * (1 / n1 + 1 / n2));
  if (se === 0) return null;
  return (k1 / n1 - k2 / n2) / se;
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

const pct = (r: number | null) => (r === null ? "—" : `${Math.round(r * 100)}%`);
const within = (iso: string, w: PerfWindow) => {
  const t = Date.parse(iso);
  return t >= w.from.getTime() && t < w.to.getTime();
};

/* ── Labels ──────────────────────────────────────────────────────────────── */

const CHANNEL_LABEL: Record<string, string> = {
  email: "Email",
  linkedin: "LinkedIn",
  phone: "Phone",
  meeting: "Meeting",
  chat: "Chat",
  other: "Other",
};

export function sourceLabel(via: string | null): string {
  if (!via || via === "manual") return "Added or analyzed by hand";
  if (via === "scan") return "Source scans";
  if (via === "import") return "CSV import";
  if (via.startsWith("provider:")) {
    const name = via.slice("provider:".length);
    return `${name.charAt(0).toUpperCase()}${name.slice(1)} search`;
  }
  return via.replace(/_/g, " ");
}

export const REASON_LABEL: Record<string, string> = {
  no_need: "No need",
  no_budget: "No budget",
  timing: "Timing",
  chose_competitor: "Chose a competitor",
  missing_capability: "Missing capability",
  no_response: "No response",
  not_a_fit: "Not a fit",
  wrong_contact: "Wrong contact",
  other: "Other",
};

/* ── The computation ─────────────────────────────────────────────────────── */

interface Journey {
  opp: PerfOpportunity;
  firstOutbound: PerfTouch | null;
  firstInboundAfter: PerfTouch | null;
  firstInbound: PerfTouch | null;
  meetingAt: number | null;
  lastTouchAt: number | null;
}

function journeys(input: PerfInput): Map<string, Journey> {
  const byOpp = new Map<string, Journey>();
  for (const opp of input.opportunities) {
    byOpp.set(opp.id, {
      opp,
      firstOutbound: null,
      firstInboundAfter: null,
      firstInbound: null,
      meetingAt: null,
      lastTouchAt: null,
    });
  }
  const touches = [...input.touches].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  for (const t of touches) {
    const j = byOpp.get(t.opportunityId);
    if (!j) continue;
    const at = Date.parse(t.occurredAt);
    j.lastTouchAt = Math.max(j.lastTouchAt ?? 0, at);
    if (t.direction === "outbound" && !j.firstOutbound) j.firstOutbound = t;
    if (t.direction === "inbound") {
      if (!j.firstInbound) j.firstInbound = t;
      if (j.firstOutbound && !j.firstInboundAfter && at >= Date.parse(j.firstOutbound.occurredAt)) {
        j.firstInboundAfter = t;
      }
    }
    if (t.kind === "meeting" && j.firstOutbound && j.meetingAt === null && at >= Date.parse(j.firstOutbound.occurredAt)) {
      j.meetingAt = at;
    }
  }
  for (const o of input.outcomes) {
    if (o.kind !== "meeting" || !o.opportunityId) continue;
    const j = byOpp.get(o.opportunityId);
    if (!j?.firstOutbound) continue;
    const at = Date.parse(o.occurredAt);
    if (at >= Date.parse(j.firstOutbound.occurredAt) && (j.meetingAt === null || at < j.meetingAt)) j.meetingAt = at;
  }
  return byOpp;
}

function cohortOf(all: Journey[], window: PerfWindow): { cohort: Cohort; members: Journey[] } {
  const members = all.filter((j) => j.firstOutbound && within(j.firstOutbound.occurredAt, window));
  const replied = members.filter((j) => j.firstInboundAfter);
  const met = members.filter((j) => j.meetingAt !== null);
  const days = (from: string, to: number) => (to - Date.parse(from)) / DAY;
  return {
    members,
    cohort: {
      contacted: members.length,
      replied: replied.length,
      meetings: met.length,
      replyRate: members.length ? replied.length / members.length : null,
      meetingRate: members.length ? met.length / members.length : null,
      medianDaysToReply: median(
        replied.map((j) => days(j.firstOutbound!.occurredAt, Date.parse(j.firstInboundAfter!.occurredAt))),
      ),
      medianDaysToMeeting: median(met.map((j) => days(j.firstOutbound!.occurredAt, j.meetingAt!))),
    },
  };
}

function funnelOf(input: PerfInput, all: Journey[], window: PerfWindow): Funnel {
  const found = input.opportunities.filter((o) => within(o.firstSeenAt, window));
  const outcomes = input.outcomes.filter((o) => within(o.occurredAt, window));
  const count = (kind: string) => outcomes.filter((o) => o.kind === kind).length;
  return {
    discovered: found.length,
    qualified: found.filter((o) => o.priority === "hot" || o.priority === "warm").length,
    contacted: all.filter((j) => j.firstOutbound && within(j.firstOutbound.occurredAt, window)).length,
    replied: all.filter((j) => j.firstInbound && within(j.firstInbound.occurredAt, window)).length,
    positive: count("positive"),
    meetings: count("meeting"),
    proposals: count("proposal"),
    won: count("won"),
    lost: count("lost"),
    disqualified: count("disqualified"),
  };
}

function segmentsBy(
  members: Journey[],
  keyOf: (j: Journey) => string,
  labelOf: (key: string) => string,
): Segment[] {
  const groups = new Map<string, Journey[]>();
  for (const j of members) {
    const key = keyOf(j);
    groups.set(key, [...(groups.get(key) ?? []), j]);
  }
  return [...groups.entries()]
    .map(([key, list]) => {
      const replied = list.filter((j) => j.firstInboundAfter).length;
      return {
        key,
        label: labelOf(key),
        contacted: list.length,
        replied,
        meetings: list.filter((j) => j.meetingAt !== null).length,
        replyRate: list.length ? replied / list.length : null,
        interval: wilson(replied, list.length),
        companies: list.slice(0, 25).map((j) => ({ id: j.opp.id, name: j.opp.company })),
      };
    })
    .sort((a, b) => b.contacted - a.contacted || a.label.localeCompare(b.label));
}

function tally(values: (string | null)[], labelOf: (k: string) => string): Tally[] {
  const counts = new Map<string, number>();
  for (const v of values) {
    const key = v ?? "unspecified";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([key, count]) => ({ key, label: key === "unspecified" ? "No reason given" : labelOf(key), count }))
    .sort((a, b) => b.count - a.count);
}


function segmentPhrase(breakdown: BreakdownKey, label: string): string {
  switch (breakdown) {
    case "channel":
      return `${label} first touches`;
    case "source":
      return `Companies from ${label.toLowerCase()}`;
    case "owner":
      return `${label}'s accounts`;
    case "trigger":
      return label === "No trigger" ? "Companies with no trigger" : `Companies with a "${label}" trigger`;
    case "priority":
      return `${label.toUpperCase()} companies`;
  }
}

function segmentInsights(breakdowns: Record<BreakdownKey, Segment[]>, total: Cohort): Insight[] {
  const out: (Insight & { effect: number })[] = [];
  for (const [breakdown, segments] of Object.entries(breakdowns) as [BreakdownKey, Segment[]][]) {
    if (segments.length < 2) continue;
    for (const s of segments) {
      const restN = total.contacted - s.contacted;
      const restK = total.replied - s.replied;
      if (s.contacted < MIN_SEGMENT || restN < MIN_SEGMENT || !s.interval) continue;
      const rest = wilson(restK, restN);
      if (!rest) continue;
      const restRate = restK / restN;
      const subject = segmentPhrase(breakdown, s.label);
      if (s.interval[0] > rest[1]) {
        out.push({
          id: `${breakdown}:${s.key}:better`,
          tone: "strength",
          headline: `${subject} get replies more often: ${pct(s.replyRate)} against ${pct(restRate)} for everything else.`,
          basis: `${s.replied} of ${s.contacted} replied, against ${restK} of ${restN}. The 95% ranges do not overlap.`,
          breakdown,
          segmentKey: s.key,
          effect: (s.replyRate ?? 0) - restRate,
        });
      } else if (s.interval[1] < rest[0]) {
        out.push({
          id: `${breakdown}:${s.key}:worse`,
          tone: "risk",
          headline: `${subject} rarely get replies: ${pct(s.replyRate)} against ${pct(restRate)} for everything else.`,
          basis: `${s.replied} of ${s.contacted} replied, against ${restK} of ${restN}. The 95% ranges do not overlap.`,
          breakdown,
          segmentKey: s.key,
          effect: restRate - (s.replyRate ?? 0),
        });
      }
    }
  }
  return out
    .sort((a, b) => b.effect - a.effect)
    .slice(0, 4)
    .map(({ effect: _effect, ...insight }) => insight);
}

export function computePerformance(input: PerfInput): Performance {
  const map = journeys(input);
  const all = [...map.values()];
  const { cohort, members } = cohortOf(all, input.window);
  const { cohort: previousCohort } = cohortOf(all, input.previous);
  const funnel = funnelOf(input, all, input.window);
  const previousFunnel = funnelOf(input, all, input.previous);

  const breakdowns: Record<BreakdownKey, Segment[]> = {
    channel: segmentsBy(members, (j) => j.firstOutbound!.channel, (k) => CHANNEL_LABEL[k] ?? k),
    source: segmentsBy(members, (j) => j.opp.via ?? "manual", (k) => sourceLabel(k)),
    owner: segmentsBy(
      members,
      (j) => j.opp.ownerId ?? "unassigned",
      (k) => (k === "unassigned" ? "Unassigned" : (input.ownerNames.get(k) ?? "A teammate")),
    ),
    trigger: segmentsBy(
      members,
      (j) => j.opp.triggerType ?? "none",
      (k) => (k === "none" ? "No trigger" : k.replace(/_/g, " ")),
    ),
    priority: segmentsBy(members, (j) => j.opp.priority, (k) => k),
  };

  const windowOutcomes = input.outcomes.filter((o) => within(o.occurredAt, input.window));
  const lostOutcomes = windowOutcomes.filter((o) => o.kind === "lost");
  const disqualifiedOutcomes = windowOutcomes.filter((o) => o.kind === "disqualified");
  const reasonOf = (k: string) => REASON_LABEL[k] ?? k;
  const reasons = {
    lost: tally(lostOutcomes.map((o) => o.reasonCategory), reasonOf),
    disqualified: tally(disqualifiedOutcomes.map((o) => o.reasonCategory), reasonOf),
    competitors: tally(
      [...lostOutcomes, ...disqualifiedOutcomes].filter((o) => o.competitorId).map((o) => o.competitorId),
      (k) => input.competitorNames.get(k) ?? "A competitor",
    ),
  };

  const stalled = all
    .filter((j) => j.opp.status === "meeting" || j.opp.status === "proposal")
    .map((j) => ({
      id: j.opp.id,
      company: j.opp.company,
      stage: j.opp.status,
      idleDays: Math.floor((input.now.getTime() - (j.lastTouchAt ?? Date.parse(j.opp.firstSeenAt))) / DAY),
    }))
    .filter((s) => s.idleDays >= STALL_DAYS)
    .sort((a, b) => b.idleDays - a.idleDays);

  const cost = {
    aiCents: input.spend.current.aiCents,
    providerCredits: input.spend.current.providerCredits,
    perQualifiedCents: funnel.qualified > 0 ? input.spend.current.aiCents / funnel.qualified : null,
    perMeetingCents: funnel.meetings > 0 ? input.spend.current.aiCents / funnel.meetings : null,
  };

  return {
    window: { from: input.window.from.toISOString(), to: input.window.to.toISOString() },
    funnel,
    previousFunnel,
    cohort,
    previousCohort,
    breakdowns,
    reasons,
    cost,
    stalled,
    insights: insights({ cohort, previousCohort, breakdowns, reasons, stalled }),
  };
}

function insights(p: {
  cohort: Cohort;
  previousCohort: Cohort;
  breakdowns: Record<BreakdownKey, Segment[]>;
  reasons: Performance["reasons"];
  stalled: Performance["stalled"];
}): Insight[] {
  const out: Insight[] = [];

  if (p.cohort.contacted < MIN_SEGMENT) {
    out.push({
      id: "too-small",
      tone: "info",
      headline: `Not enough outreach in this period to compare channels, sources or people.`,
      basis: `${p.cohort.contacted} ${p.cohort.contacted === 1 ? "company was" : "companies were"} first contacted; comparisons need at least ${MIN_SEGMENT} in each group. Choose a longer period, or keep going.`,
    });
  } else {
    out.push(...segmentInsights(p.breakdowns, p.cohort));
  }

  const z = twoProportionZ(p.cohort.replied, p.cohort.contacted, p.previousCohort.replied, p.previousCohort.contacted);
  if (p.cohort.contacted >= MIN_PERIOD && p.previousCohort.contacted >= MIN_PERIOD && z !== null && Math.abs(z) >= 1.96) {
    out.push({
      id: "reply-rate-change",
      tone: z > 0 ? "strength" : "risk",
      headline: `Reply rate ${z > 0 ? "rose" : "fell"} from ${pct(p.previousCohort.replyRate)} to ${pct(p.cohort.replyRate)} against the previous period.`,
      basis: `${p.cohort.replied} of ${p.cohort.contacted} now, ${p.previousCohort.replied} of ${p.previousCohort.contacted} before. The change is larger than chance would explain (z = ${z.toFixed(1)}).`,
    });
  }

  const now = p.cohort.contacted;
  const before = p.previousCohort.contacted;
  if (Math.max(now, before) >= MIN_SEGMENT && before > 0) {
    const change = (now - before) / before;
    if (Math.abs(change) >= 0.5) {
      out.push({
        id: "volume-change",
        tone: "change",
        headline: `You started ${Math.abs(Math.round(change * 100))}% ${change > 0 ? "more" : "fewer"} conversations than in the previous period.`,
        basis: `${now} companies first contacted now, ${before} before.`,
      });
    }
  }

  const closed = [...p.reasons.lost, ...p.reasons.disqualified];
  const totalClosed = closed.reduce((s, t) => s + t.count, 0);
  const merged = new Map<string, Tally>();
  for (const t of closed) {
    const m = merged.get(t.key);
    merged.set(t.key, { ...t, count: (m?.count ?? 0) + t.count });
  }
  const top = [...merged.values()].filter((t) => t.key !== "unspecified").sort((a, b) => b.count - a.count)[0];
  if (top && totalClosed >= 5 && top.count / totalClosed >= 0.4) {
    out.push({
      id: "top-loss-reason",
      tone: "risk",
      headline:
        top.key === "missing_capability"
          ? `Most deals that ended did so because they needed something you do not offer.`
          : `The most common reason deals ended: ${top.label.toLowerCase()}.`,
      basis: `${top.count} of ${totalClosed} lost or ruled-out opportunities gave that reason.`,
    });
  }

  if (p.stalled.length > 0) {
    out.push({
      id: "stalled",
      tone: "risk",
      headline: `${p.stalled.length} ${p.stalled.length === 1 ? "deal" : "deals"} at meeting or proposal stage ${p.stalled.length === 1 ? "has" : "have"} had no activity for ${STALL_DAYS}+ days.`,
      basis: p.stalled
        .slice(0, 3)
        .map((s) => `${s.company} (${s.idleDays} days)`)
        .join(", "),
    });
  }

  return out;
}

/* ── Goals ───────────────────────────────────────────────────────────────── */

export interface Goals {
  touchesPerWeek: number | null;
  meetingsPerMonth: number | null;
}

export interface GoalProgress {
  touchesThisWeek: number;
  meetingsThisMonth: number;
  /** How far through the week and month we are, 0–1, for pace. */
  weekElapsed: number;
  monthElapsed: number;
}

/** Monday 00:00 UTC of the week containing `now`. */
export function weekStart(now: Date): Date {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const day = (d.getUTCDay() + 6) % 7; // Monday = 0
  d.setUTCDate(d.getUTCDate() - day);
  return d;
}

/**
 * One person's pace against the workspace goals: outbound touches they made
 * this week, and meetings on accounts they own this month.
 */
export function goalProgress(
  input: { touches: PerfTouch[]; outcomes: PerfOutcome[]; opportunities: PerfOpportunity[] },
  userId: string | null,
  now: Date,
): GoalProgress {
  const week = weekStart(now);
  const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const mine = new Set(input.opportunities.filter((o) => userId && o.ownerId === userId).map((o) => o.id));
  return {
    touchesThisWeek: input.touches.filter(
      (t) => t.direction === "outbound" && (!userId || t.actorId === userId) && Date.parse(t.occurredAt) >= week.getTime(),
    ).length,
    meetingsThisMonth: input.outcomes.filter(
      (o) =>
        o.kind === "meeting" &&
        Date.parse(o.occurredAt) >= month.getTime() &&
        (!userId || (o.opportunityId !== null && mine.has(o.opportunityId))),
    ).length,
    weekElapsed: Math.min(1, (now.getTime() - week.getTime()) / (7 * DAY)),
    monthElapsed: Math.min(1, (now.getTime() - month.getTime()) / (nextMonth.getTime() - month.getTime())),
  };
}

/* ── Periods ─────────────────────────────────────────────────────────────── */

export const PERIODS = ["7d", "30d", "90d", "month", "last-month"] as const;
export type Period = (typeof PERIODS)[number];

export const PERIOD_LABEL: Record<Period, string> = {
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
  month: "This month",
  "last-month": "Last month",
};

/** The window for a period, and the equally long window before it. */
export function windowsFor(period: Period, now: Date): { window: PerfWindow; previous: PerfWindow } {
  const end = now;
  let from: Date;
  let to = end;
  if (period === "month") {
    from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  } else if (period === "last-month") {
    from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  } else {
    const days = period === "7d" ? 7 : period === "30d" ? 30 : 90;
    from = new Date(end.getTime() - days * DAY);
  }
  const length = to.getTime() - from.getTime();
  return {
    window: { from, to },
    previous: { from: new Date(from.getTime() - length), to: from },
  };
}
