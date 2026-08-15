import type { EvidenceItem, Priority, ScoreDimension } from "@huntloop/ui";

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
  triggerDate: string;
  evidence: { kind: "fact" | "inference" | "unknown" }[];
  industry: string;
}

export interface OpportunityDetail {
  id: string;
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
  triggerDate: string;
  whyThisCompany: string | null;
  whatTheyDo: string | null;
  identifiedProblem: string | null;
  potentialGap: string | null;
  currentApproach: string | null;
  whyNow: string | null;
  potentialUseCase: string | null;
  outreachAngle: string | null;
  recommendedAction: string;
  buyers: {
    name: string;
    title: string;
    isDecisionMaker: boolean;
    email: string | null;
    emailConfidence: "high" | "medium" | "low" | null;
    linkedin: string | null;
  }[];
  evidence: EvidenceItem[];
  triggers: { type: string; date: string; strength: number | null }[];
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
  companies: {
    name: string;
    canonical_domain: string;
    industry: string | null;
    region: string | null;
    employee_count: number | null;
    description: string | null;
    company_triggers: TriggerRow[];
    people: {
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

export function byPriorityThenScore(a: OpportunityRow, b: OpportunityRow): number {
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
export function recommendedAction(priority: Priority, hasBuyer: boolean): string {
  if (priority === "ignore") return "No action — this one is out of scope.";
  if (priority === "watch") return "Keep monitoring — no reason to contact today.";
  if (!hasBuyer) return "Identify a decision maker before reaching out.";
  return priority === "hot"
    ? "Reach out now, while the trigger is fresh."
    : "Research the current approach before contacting.";
}

/* ── Mappers ─────────────────────────────────────────────────────────────── */

export function mapEvidence(rows: EvidenceQueryRow[]): EvidenceItem[] {
  return rows.map((e) => ({
    claim: e.claim,
    kind: e.kind,
    confidence: e.confidence ?? undefined,
    // The table stores the URL; the label is derived from it rather than
    // stored twice, so the two can never disagree.
    source: e.source_url ? hostOf(e.source_url) : undefined,
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
       nothing has been seen, not a blank cell — and the date falls back to
       first_seen_at so the freshness beside it still refers to something
       real. */
    trigger: newest?.trigger_type ?? "No trigger on file",
    triggerDate: newest?.event_date ?? r.first_seen_at,
    evidence,
  };
}

export function mapDetail(
  r: DetailQueryRow,
  evidence: EvidenceItem[],
  viewerId: string | null,
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
      const email = contacts.find(
        (c) => c.kind === "email" && c.verification_status === "verified",
      );
      const linkedin = contacts.find((c) => c.kind === "linkedin");
      return {
        name: [p.first_name, p.last_name].filter(Boolean).join(" ") || "Unnamed contact",
        title: p.title ?? "Title unknown",
        isDecisionMaker: p.is_decision_maker,
        email: email?.value ?? null,
        emailConfidence: email?.confidence ?? null,
        linkedin: linkedin?.value ?? null,
      };
    })
    // Decision makers first: the page's job is to say who to talk to.
    .sort((a, b) => Number(b.isDecisionMaker) - Number(a.isDecisionMaker));

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
    triggerDate: triggers[0]?.event_date ?? r.first_seen_at,
    whyThisCompany: r.why_this_company,
    whatTheyDo: r.companies.description,
    identifiedProblem: r.identified_problem,
    potentialGap: r.potential_gap,
    currentApproach: r.current_approach,
    whyNow: r.why_now,
    potentialUseCase: r.potential_use_case,
    outreachAngle: r.outreach_angle,
    recommendedAction: recommendedAction(r.priority, buyers.length > 0),
    buyers,
    evidence,
    triggers: triggers.map((t) => ({
      type: t.trigger_type,
      date: t.event_date,
      strength: t.strength ?? null,
    })),
  };
}
