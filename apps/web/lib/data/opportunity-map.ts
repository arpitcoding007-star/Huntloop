import type { EvidenceItem, Priority, ScoreDimension } from "@huntloop/ui";
import {
  isPlaceholderEmail,
  isSendableEmail,
  isVerifiedEmail,
  verificationLabel,
} from "@huntloop/db/contact";
import { DEFAULT_QUIET_AFTER_BUSINESS_DAYS } from "@huntloop/db/org-profile";
import {
  legacyRecommendation,
  nextAction,
  type NextAction,
  type NextActionInput,
} from "../needs-you/next-action";

function verificationLabelFor(c: { verification_status: string | null } | undefined): string | null {
  return c ? verificationLabel(c.verification_status) : null;
}

/**
 * Database rows → what the opportunity screens render.
 *
 * Extracted from `opportunities.ts` for the same reason `safe-next.ts` was
 * extracted from the auth callback: this is where the product's rules about
 * *not asserting things* actually live, it was the only implementation, and it
 * had no test. Everything here is pure, so it can have one.
 *
 * The rules being defended, each with a test naming it:
 *
 *   · A NULL score dimension is UNKNOWN, never 0 (§78). A zero asserts "we
 *     measured this and it is bad", a finding Huntloop did not make.
 *   · A NULL narrative field stays null, so the page can say "not
 *     established" rather than render an empty section that reads as though
 *     nothing was wrong.
 *   · An unverified email address is not an address (§78, "do not fabricate
 *     contact details"). A guess rendered as a mailto is a guess that gets
 *     sent.
 *   · Soft-deleted rows are gone, including the embedded ones — a top-level
 *     `deleted_at is null` does not reach under a nested select.
 *
 * The query lives next door in `opportunities.ts`; this file never touches a
 * client, which is what makes it testable without a database.
 */

/* ── Screen shapes ───────────────────────────────────────────────────────── */

export interface OpportunityRow {
  id: string;
  company: string;
  domain: string;
  priority: Priority;
  priorityReason: string;
  score: number;
  scoreExplanation: string;
  confidence: "high" | "medium" | "low";
  dimensions: ScoreDimension[];
  status: string;
  trigger: string;
  /** Null when no trigger is on file — never the date the company was first seen. */
  triggerDate: string | null;
  evidence: { kind: "fact" | "inference" | "unknown" }[];
  industry: string;
}

export interface OpportunityDetail {
  id: string;
  /** The company row, for the brief's company-level sections. Null on fixtures. */
  companyId: string | null;
  company: string;
  domain: string;
  industry: string;
  location: string;
  employees: string;
  priority: Priority;
  priorityReason: string;
  score: number;
  scoreExplanation: string;
  confidence: "high" | "medium" | "low";
  dimensions: ScoreDimension[];
  status: string;
  owner: string | null;
  /**
   * The raw id, alongside the label above.
   *
   * `owner` answers "who does this belong to" for a reader — "You", or
   * "another member", because §21 keeps colleagues' identities out of a screen
   * that does not need them. The control that *changes* the owner needs the id
   * the select is bound to, and those are different questions.
   */
  ownerId: string | null;
  /** Null when no trigger is on file — never the date the company was first seen. */
  triggerDate: string | null;
  whyThisCompany: string | null;
  whatTheyDo: string | null;
  identifiedProblem: string | null;
  potentialGap: string | null;
  currentApproach: string | null;
  whyNow: string | null;
  potentialUseCase: string | null;
  outreachAngle: string | null;
  /** The sentence of `nextAction`, kept for callers that only need the words. */
  recommendedAction: string;
  /** What to do next, with the facts it rests on (0037, `needs-you/next-action.ts`). */
  nextAction: NextAction;
  /** The raw `opportunity_status`, for logic; `status` above is its label. */
  stage: string;
  /** One next step per opportunity, or null. */
  nextStep: { text: string; dueAt: string | null } | null;
  buyers: {
    /** `people.id`, so an activity can be logged against this person. */
    id: string;
    name: string;
    title: string;
    isDecisionMaker: boolean;
    email: string | null;
    emailConfidence: "high" | "medium" | "low" | null;
    /**
     * An address outreach would still send to but nobody has checked — shown
     * as text with its status, never as a link. Null when `email` is set.
     */
    unverifiedEmail: string | null;
    /** The status word for whichever address is shown. */
    emailStatus: string | null;
    linkedin: string | null;
    /**
     * `contact_fit_scores.score`, 0–100, or null when this person has not
     * been ranked yet.
     *
     * `0016` made `is_decision_maker` a *derived* summary maintained by the
     * ranking job rather than the authoritative answer, and said so in the
     * column's own comment. This is the authoritative answer: a number with
     * an explanation beside it. Null is a real state — a company whose
     * contacts arrived before the ranker ran has people and no scores — and
     * it renders as no score rather than as a zero, for the same reason an
     * unmeasured score dimension reads UNKNOWN.
     */
    fitScore: number | null;
    /** Why that number. Never optional when a score exists — `0016` again. */
    fitReason: string | null;
  }[];
  evidence: EvidenceItem[];
  triggers: { type: string; date: string; strength: number | null }[];
  /** Optional, typed by a person (0040). Null means nobody said. */
  estimatedValueCents: number | null;
}

/* ── Row types.
 *
 * Hand-written because `supabase gen types` needs a project ref and a CI
 * secret (DB-03). They describe what the queries in `opportunities.ts`
 * actually returned, which is why the embedded relations are arrays:
 * PostgREST returns a to-many embed as a list even when at most one row can
 * come back.
 * ─────────────────────────────────────────────────────────────────────────── */

export interface ScoreRow {
  score: number;
  explanation: string;
  confidence: "high" | "medium" | "low" | null;
  computed_at: string;
  icp_fit: number | null;
  problem_severity: number | null;
  evidence_strength: number | null;
  trigger_strength: number | null;
  trigger_freshness: number | null;
  buying_likelihood: number | null;
  product_relevance: number | null;
  decision_maker_accessibility: number | null;
}

export interface TriggerRow {
  trigger_type: string;
  event_date: string;
  strength?: number | null;
  deleted_at: string | null;
}

export interface ListQueryRow {
  id: string;
  priority: Priority;
  priority_reason: string;
  status: string;
  first_seen_at: string;
  companies: {
    name: string;
    canonical_domain: string;
    industry: string | null;
    company_triggers: TriggerRow[];
  };
  opportunity_scores: ScoreRow[];
}

export interface DetailQueryRow {
  id: string;
  company_id: string;
  /** 0040 — absent on rows read before the migration. */
  estimated_value_cents?: number | null;
  priority: Priority;
  priority_reason: string;
  status: string;
  confidence: "high" | "medium" | "low" | null;
  first_seen_at: string;
  owner_id: string | null;
  why_this_company: string | null;
  identified_problem: string | null;
  potential_gap: string | null;
  why_now: string | null;
  current_approach: string | null;
  potential_use_case: string | null;
  outreach_angle: string | null;
  /** 0037 — absent on rows read before the migration. */
  next_step?: string | null;
  next_step_due_at?: string | null;
  companies: {
    name: string;
    canonical_domain: string;
    industry: string | null;
    region: string | null;
    employee_count: number | null;
    description: string | null;
    company_triggers: TriggerRow[];
    people: {
      id: string;
      first_name: string | null;
      last_name: string | null;
      title: string | null;
      is_decision_maker: boolean;
      linkedin_url: string | null;
      deleted_at: string | null;
      contact_points: {
        kind: string;
        value: string;
        confidence: "high" | "medium" | "low" | null;
        verification_status: string;
        deleted_at: string | null;
      }[];
    }[];
  };
  opportunity_scores: ScoreRow[];
}

export interface EvidenceQueryRow {
  claim: string;
  kind: "fact" | "inference" | "unknown";
  confidence: "high" | "medium" | "low" | null;
  source_url: string | null;
  excerpt: string | null;
  event_date: string | null;
  observed_at: string | null;
  /** 0020's reliability band; absent on loaders that do not select it. */
  reliability?: string | null;
}

/* ── Guards and small rules ──────────────────────────────────────────────── */

/**
 * Rejects anything that is not a UUID before it reaches a `uuid` comparison.
 *
 * Postgres raises `22P02 invalid input syntax for type uuid` rather than
 * returning no rows, so without this a stale link to a fixture slug —
 * `/opportunities/alphio-ai`, which this app served for months — is a 500
 * where a 404 belongs.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID.test(value);
}

/**
 * `opportunity_status` is a lowercase Postgres enum and the UI shows it in a
 * badge. Mapped explicitly rather than title-cased, so a value added to the
 * enum has to be given a label here instead of silently rendering as
 * `in_progress`.
 */
const STATUS_LABELS: Record<string, string> = {
  discovered: "Discovered",
  researching: "Researching",
  qualified: "Qualified",
  assigned: "Assigned",
  contacted: "Contacted",
  replied: "Replied",
  meeting: "Meeting",
  proposal: "Proposal",
  won: "Won",
  lost: "Lost",
  archived: "Archived",
};

export function statusLabel(raw: string): string {
  return STATUS_LABELS[raw] ?? raw;
}

/** Postgres sorts enums by declaration order; this makes HOT sort first. */
const PRIORITY_ORDER: Priority[] = ["hot", "warm", "watch", "ignore"];

/**
 * Ranked by verdict, then by score within it.
 *
 * Typed structurally rather than as `OpportunityRow`, because the dashboard
 * ranks a narrower shape by exactly the same rule — and one ordering used by
 * two screens is one ordering, not two that happen to agree today.
 */
export function byPriorityThenScore(
  a: { priority: Priority; score: number },
  b: { priority: Priority; score: number },
): number {
  const p = PRIORITY_ORDER.indexOf(a.priority) - PRIORITY_ORDER.indexOf(b.priority);
  return p !== 0 ? p : b.score - a.score;
}

/**
 * Newest score wins.
 *
 * Several may exist: §58 keeps history rather than clobbering, so "the score"
 * is always a choice among rows and never simply the row.
 */
export function latestScore(scores: ScoreRow[]): ScoreRow | undefined {
  return [...scores].sort(
    (a, b) => Date.parse(b.computed_at) - Date.parse(a.computed_at),
  )[0];
}

/**
 * NULL stays "unknown" — never coerced to 0. §78: a zero would assert "we
 * measured this and it is bad", a finding Huntloop never made.
 */
export function dimensionsOf(score: ScoreRow | undefined): ScoreDimension[] {
  return [
    { label: "ICP fit", value: score?.icp_fit ?? "unknown" },
    { label: "Problem severity", value: score?.problem_severity ?? "unknown" },
    { label: "Evidence strength", value: score?.evidence_strength ?? "unknown" },
    { label: "Trigger strength", value: score?.trigger_strength ?? "unknown" },
    { label: "Trigger freshness", value: score?.trigger_freshness ?? "unknown" },
    { label: "Buying likelihood", value: score?.buying_likelihood ?? "unknown" },
    { label: "Product relevance", value: score?.product_relevance ?? "unknown" },
    {
      label: "Decision-maker accessibility",
      value: score?.decision_maker_accessibility ?? "unknown",
    },
  ];
}

/**
 * Live rows, newest first, with soft-deleted ones dropped.
 *
 * The filter is here rather than in the query because these arrive as an
 * embedded select, where the statement's own `deleted_at is null` applies to
 * the opportunity and not to what hangs off it.
 */
export function liveTriggers(triggers: TriggerRow[]): TriggerRow[] {
  return triggers
    .filter((t) => t.deleted_at === null)
    .sort((a, b) => Date.parse(b.event_date) - Date.parse(a.event_date));
}

/** "techcrunch.com" from a URL, or undefined if it will not parse. */
export function hostOf(url: string): string | undefined {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return undefined;
  }
}

/**
 * What to do next, derived rather than stored.
 *
 * There is no `recommended_action` column, and adding one would mean storing a
 * sentence a model wrote and no longer being able to say what it was derived
 * from. These four cases are a function of the verdict and whether a buyer has
 * been identified — both of which are on the page directly above it, so a user
 * can check the recommendation against its inputs.
 *
 * When there is a model in the loop this becomes its output, with the
 * reasoning attached. Until then it says only what the data supports.
 */
export function recommendedAction(
  priority: Priority,
  hasBuyer: boolean,
  hasTrigger = true,
): string {
  /* TRUST-005 and the four cases live in `needs-you/next-action.ts` now, as
     the fallback of the state-aware rule. One definition, two callers. */
  return legacyRecommendation(priority, hasBuyer, hasTrigger);
}

/* ── Mappers ─────────────────────────────────────────────────────────────── */

export function mapEvidence(rows: EvidenceQueryRow[]): EvidenceItem[] {
  return rows.map((e) => ({
    claim: e.claim,
    kind: e.kind,
    confidence: e.confidence ?? undefined,
    // The table stores the URL; the label is derived from it rather than
    // stored twice, so the two can never disagree.
    /* TRUST-006: a provider's record is what the provider says, not what
       anyone observed, and the label says which. */
    source: e.source_url
      ? e.reliability === "provider_attested"
        ? `${hostOf(e.source_url)} · provider-reported`
        : hostOf(e.source_url)
      : undefined,
    sourceUrl: e.source_url ?? undefined,
    excerpt: e.excerpt ?? undefined,
    eventDate: e.event_date ?? undefined,
    observedAt: e.observed_at ?? undefined,
  }));
}

export function mapListRow(
  r: ListQueryRow,
  evidence: { kind: "fact" | "inference" | "unknown" }[],
): OpportunityRow {
  const score = latestScore(r.opportunity_scores);
  const newest = liveTriggers(r.companies.company_triggers)[0];

  return {
    id: r.id,
    company: r.companies.name,
    domain: r.companies.canonical_domain,
    industry: r.companies.industry ?? "—",
    priority: r.priority,
    priorityReason: r.priority_reason,
    score: score?.score ?? 0,
    scoreExplanation: score?.explanation ?? "Not scored yet.",
    confidence: score?.confidence ?? "low",
    dimensions: dimensionsOf(score),
    status: statusLabel(r.status),
    /* The "Why now" column. With no trigger on file the honest answer is that
       nothing has been seen, and no date: TRUST-005 — the first-seen date
       used to stand in, so discovery time read as the age of a buying signal. */
    trigger: newest?.trigger_type ?? "No trigger on file",
    triggerDate: newest?.event_date ?? null,
    evidence,
  };
}

/** `person_id` → the latest contact-fit score and its explanation. */
export type ContactFit = Map<string, { score: number; explanation: string | null }>;

/** What the next-action rule needs beyond the row itself. Loaded beside it. */
export interface DetailContext {
  lastTouch: NextActionInput["lastTouch"];
  replyClassification: string | null;
  sequenceActive: boolean;
  quietAfterBusinessDays: number;
  now: Date;
}

const NO_CONTEXT = (): DetailContext => ({
  lastTouch: null,
  replyClassification: null,
  sequenceActive: false,
  quietAfterBusinessDays: DEFAULT_QUIET_AFTER_BUSINESS_DAYS,
  now: new Date(),
});

export function mapDetail(
  r: DetailQueryRow,
  evidence: EvidenceItem[],
  viewerId: string | null,
  fit: ContactFit = new Map(),
  context: DetailContext = NO_CONTEXT(),
): OpportunityDetail {
  const score = latestScore(r.opportunity_scores);
  const triggers = liveTriggers(r.companies.company_triggers);

  const buyers = r.companies.people
    .filter((p) => p.deleted_at === null)
    .map((p) => {
      const contacts = p.contact_points.filter((c) => c.deleted_at === null);
      /* §78 forbids fabricating contact details, and the migration models the
         difference: an address exists as a row only when one was found, and
         `verification_status` says whether it was checked. An unverified
         address is not shown as a mailto — it is a guess, and a guess rendered
         as a link is a guess that gets sent. */
      const emails = contacts.filter((c) => c.kind === "email" && !isPlaceholderEmail(c.value));
      const email = emails.find((c) => isVerifiedEmail(c.verification_status));
      /* TRUST-004: the sender mails unverified addresses, so hiding them here
         told the user "no address" about the one that would be used. */
      const unverified = email
        ? undefined
        : emails.find((c) => isSendableEmail(c.value, c.verification_status));
      const linkedin = contacts.find((c) => c.kind === "linkedin");
      const ranked = fit.get(p.id);
      return {
        id: p.id,
        name: [p.first_name, p.last_name].filter(Boolean).join(" ") || "Unnamed contact",
        title: p.title ?? "Title unknown",
        isDecisionMaker: p.is_decision_maker,
        email: email?.value ?? null,
        emailConfidence: email?.confidence ?? null,
        unverifiedEmail: unverified?.value ?? null,
        emailStatus: verificationLabelFor(email ?? unverified),
        linkedin: linkedin?.value ?? null,
        fitScore: ranked?.score ?? null,
        fitReason: ranked?.explanation ?? null,
      };
    })
    /*
     * Ranked first, by the score the ranking job actually produced; the
     * decision-maker flag only breaks ties.
     *
     * This ordering is the page's whole answer to "who should I contact",
     * and until now it was a boolean sort — which cannot separate two people
     * who are both flagged, and cannot say why either of them is there.
     * `0016` built `contact_fit_scores` precisely because "the VP of
     * Engineering is the buyer here but the Head of Platform is the one who
     * feels the pain" is not expressible in a boolean.
     *
     * An unranked person sorts last rather than as a zero. The two are not
     * the same: zero means the ranker looked and found nobody worth
     * contacting, and null means it has not run.
     */
    .sort((a, b) => {
      if (a.fitScore !== b.fitScore) {
        if (a.fitScore === null) return 1;
        if (b.fitScore === null) return -1;
        return b.fitScore - a.fitScore;
      }
      return Number(b.isDecisionMaker) - Number(a.isDecisionMaker);
    });

  const nextStep = r.next_step
    ? { text: r.next_step, dueAt: r.next_step_due_at ?? null }
    : null;
  const action = nextAction({
    priority: r.priority,
    status: r.status,
    hasBuyer: buyers.length > 0,
    hasTrigger: triggers.length > 0,
    nextStep,
    lastTouch: context.lastTouch,
    replyClassification: context.replyClassification,
    sequenceActive: context.sequenceActive,
    now: context.now,
    quietAfterBusinessDays: context.quietAfterBusinessDays,
  });

  return {
    id: r.id,
    company: r.companies.name,
    domain: r.companies.canonical_domain,
    industry: r.companies.industry ?? "Industry unknown",
    location: r.companies.region ?? "Location unknown",
    employees:
      r.companies.employee_count === null ? "—" : String(r.companies.employee_count),
    priority: r.priority,
    priorityReason: r.priority_reason,
    score: score?.score ?? 0,
    scoreExplanation: score?.explanation ?? "Not scored yet.",
    confidence: score?.confidence ?? r.confidence ?? "low",
    dimensions: dimensionsOf(score),
    status: statusLabel(r.status),
    /* No lookup of another user's name: that means reading `auth.users`, which
       the tenant client cannot do and should not. An opportunity owned by a
       colleague says so without naming them — worse copy, and a much smaller
       surface than exposing an org's user directory to every member. */
    owner:
      r.owner_id === null ? null : r.owner_id === viewerId ? "You" : "another member",
    ownerId: r.owner_id,
    triggerDate: triggers[0]?.event_date ?? null,
    companyId: r.company_id,
    estimatedValueCents:
      r.estimated_value_cents === null || r.estimated_value_cents === undefined
        ? null
        : Number(r.estimated_value_cents),
    whyThisCompany: r.why_this_company,
    whatTheyDo: r.companies.description,
    identifiedProblem: r.identified_problem,
    potentialGap: r.potential_gap,
    currentApproach: r.current_approach,
    whyNow: r.why_now,
    potentialUseCase: r.potential_use_case,
    outreachAngle: r.outreach_angle,
    recommendedAction: action.text,
    nextAction: action,
    stage: r.status,
    nextStep,
    buyers,
    evidence,
    triggers: triggers.map((t) => ({
      type: t.trigger_type,
      date: t.event_date,
      strength: t.strength ?? null,
    })),
  };
}
