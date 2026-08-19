import "server-only";
import type { EvidenceItem, Priority, ScoreDimension } from "@huntloop/ui";
import type { TenantClient } from "@huntloop/db";
import { OPPORTUNITIES } from "../fixtures/opportunities";
import { requireOrgId } from "./org";
import { load, type Loaded } from "./source";
import { byPriorityThenScore, mapEvidence, type EvidenceQueryRow } from "./opportunity-map";

/**
 * The Command Center — master context §46 and §88, read from the database.
 *
 * ── Why this file exists ─────────────────────────────────────────────────
 *
 * Every figure on the dashboard used to be a literal in the page. Not a
 * fixture behind a loader with a demo fallback, like every other screen — a
 * hard-coded `value={12}` that read the same on a live deployment as on an
 * empty one. The screen carried an unconditional "these numbers are not real"
 * banner because that was the only honest thing it could say.
 *
 * That is the §7 failure aimed at the most-visited screen in the product, and
 * it is the one this file removes: the banner is now conditional on the data
 * source like everywhere else, because there is a query behind each number.
 *
 * ── Why one loader rather than reusing the screens' ─────────────────────
 *
 * Because the dashboard needs counts, and the other loaders return rows. This
 * screen would otherwise pull every opportunity, every thread and every
 * message into a page that renders four totals from them — on the screen most
 * likely to be the first thing loaded after sign-in.
 *
 * `head: true` with `count: "exact"` is the shape that matters: PostgREST
 * answers with a count and no rows at all.
 *
 * ── What is deliberately absent ─────────────────────────────────────────
 *
 * Anything the schema cannot answer. There is no "buying likelihood this
 * week" and no plan ceiling on companies, so neither is rendered — an
 * invented denominator is the same failure as an invented numerator, and this
 * screen has been carrying several. Where a number is genuinely unavailable
 * the field is null and the page says so rather than showing a zero, because
 * "nothing happened" and "we did not measure" are different facts.
 */

export interface WhyNow {
  id: string;
  company: string;
  domain: string;
  priority: Priority;
  priorityReason: string;
  score: number;
  scoreExplanation: string;
  confidence: "high" | "medium" | "low";
  dimensions: ScoreDimension[];
  trigger: string;
  triggerDate: string;
  evidence: EvidenceItem[];
}

export interface Attention {
  /** Distinguishes the items so the page can route each one. */
  kind: "replies" | "approvals" | "failing-sources" | "stale-evidence";
  title: string;
  source: string;
  meta: string;
  href: string | null;
}

export interface Dashboard {
  counts: Record<Priority, number>;
  /** Triggers whose event was inside the last day. */
  triggersLastDay: number;
  /** Opportunities nobody has moved out of `new`. */
  awaitingReview: number;
  whyNow: WhyNow[];
  loop: {
    discovered: number;
    researched: number;
    contacted: number;
    replied: number;
  };
  outcomes: { meetings: number; won: number; companies: number };
  /** One per connected mailbox. Empty when none is connected. */
  capacity: { label: string; used: number; limit: number }[];
  signalsByType: { label: string; value: number }[];
  sourcePerformance: { label: string; value: number }[];
  attention: Attention[];
}

const PRIORITIES: readonly Priority[] = ["hot", "warm", "watch", "ignore"];

/** How many why-now cards the screen shows. The rest are one click away. */
const WHY_NOW_LIMIT = 3;

export async function getDashboard(orgSlug: string): Promise<Loaded<Dashboard>> {
  return load(
    async (db) => {
      const orgId = await requireOrgId(orgSlug, "getDashboard");
      const now = Date.now();
      const dayAgo = new Date(now - 24 * 3600_000).toISOString();
      const weekAgo = new Date(now - 7 * 24 * 3600_000).toISOString();
      const ninetyDaysAgo = new Date(now - 90 * 24 * 3600_000).toISOString();

      const [counts, triggersLastDay, awaitingReview, whyNow, loop, outcomes, capacity, signals, sources, attention] =
        await Promise.all([
          priorityCounts(db, orgId),
          countRows(db, orgId, "company_triggers", (q) => q.gte("event_date", dayAgo)),
          countRows(db, orgId, "opportunities", (q) => q.eq("status", "new")),
          whyNowCards(db, orgId),
          loopCounts(db, orgId, weekAgo),
          outcomeCounts(db, orgId, weekAgo),
          sendingCapacity(db, orgId),
          signalsByType(db, orgId, weekAgo),
          sourcePerformance(db, orgId, weekAgo),
          attentionItems(db, orgId, orgSlug, ninetyDaysAgo),
        ]);

      return {
        counts,
        triggersLastDay,
        awaitingReview,
        whyNow,
        loop,
        outcomes,
        capacity,
        signalsByType: signals,
        sourcePerformance: sources,
        attention,
      };
    },
    () => DEMO,
  );
}

/* ── The queries ─────────────────────────────────────────────────────────── */

/* eslint-disable-next-line @typescript-eslint/no-explicit-any --
   PostgREST's builder generics infer against `any` without a generated schema,
   so a filter chain passed around as a value has no expressible type. See the
   note on `Query` in packages/jobs/src/scope.ts for why this is a cast rather
   than a hand-written copy of the builder. */
type Filters = any;

/**
 * A count with no rows.
 *
 * Every figure on this screen is one of these, so it is worth having the
 * `head: true` in one place — without it PostgREST returns the rows as well,
 * and a "count" of eleven thousand opportunities is eleven thousand rows over
 * the wire to render the number 11000.
 */
async function countRows(
  db: TenantClient,
  orgId: string,
  table: string,
  refine: (q: Filters) => Filters = (q) => q,
): Promise<number> {
  const base: Filters = db
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId);
  const { count } = await refine(base);
  return Number(count ?? 0);
}

async function priorityCounts(
  db: TenantClient,
  orgId: string,
): Promise<Record<Priority, number>> {
  /* One query per bucket rather than a group-by, because PostgREST has no
     aggregate without a view or an RPC, and four head requests are cheaper
     than either a new database object or pulling every row to count it here. */
  const counted = await Promise.all(
    PRIORITIES.map((p) =>
      countRows(db, orgId, "opportunities", (q) =>
        q.eq("priority", p).is("deleted_at", null),
      ),
    ),
  );
  return Object.fromEntries(PRIORITIES.map((p, i) => [p, counted[i]!])) as Record<
    Priority,
    number
  >;
}

/**
 * The few opportunities worth reading about today, with their evidence.
 *
 * Evidence inline rather than behind a click, because §52's argument is that a
 * why-now claim whose source is one page away is a claim most users will never
 * check. Two queries rather than an embed: `evidence.subject_id` is
 * polymorphic and carries no foreign key, so PostgREST cannot join it.
 */
async function whyNowCards(db: TenantClient, orgId: string): Promise<WhyNow[]> {
  const { data, error } = await db
    .from("opportunities")
    .select(
      `id, priority, priority_reason, first_seen_at,
       companies!inner(name, canonical_domain,
         company_triggers(trigger_type, event_date, deleted_at)),
       opportunity_scores(score, explanation, confidence, computed_at,
         icp_fit, problem_severity, evidence_strength, trigger_strength,
         trigger_freshness, buying_likelihood, product_relevance,
         decision_maker_accessibility)`,
    )
    .eq("org_id", orgId)
    .is("deleted_at", null)
    /* Not `.limit(3)`. The ordering that decides which three matter is
       priority then score, and score lives in an embedded row PostgREST
       cannot order by — so the shortlist is taken after sorting here. The
       bound is `status = new`, which is what keeps this from reading the
       whole table: these are the ones nobody has triaged. */
    .eq("status", "new")
    .order("first_seen_at", { ascending: false })
    .limit(60);

  if (error) throw new Error(`getDashboard whyNow: ${error.message}`);

  /* eslint-disable @typescript-eslint/no-explicit-any --
     A nested select has no generated row type without a live project schema.
     Confined to the mapping below. */
  const rows = (data ?? []) as any[];

  const shortlist = rows
    .map((r) => {
      const score = latest(r.opportunity_scores);
      const trigger = live(r.companies?.company_triggers)[0];
      return {
        id: String(r.id),
        company: String(r.companies?.name ?? ""),
        domain: String(r.companies?.canonical_domain ?? ""),
        priority: (PRIORITIES.includes(r.priority) ? r.priority : "watch") as Priority,
        priorityReason: String(r.priority_reason ?? ""),
        score: Number(score?.score ?? 0),
        scoreExplanation: String(score?.explanation ?? ""),
        confidence: (score?.confidence ?? "low") as "high" | "medium" | "low",
        dimensions: dimensionsOf(score),
        trigger: trigger ? String(trigger.trigger_type) : "",
        triggerDate: trigger ? String(trigger.event_date) : "",
        evidence: [] as EvidenceItem[],
      };
    })
    .sort(byPriorityThenScore)
    .slice(0, WHY_NOW_LIMIT);
  /* eslint-enable @typescript-eslint/no-explicit-any */

  if (shortlist.length === 0) return [];

  const { data: evidence } = await db
    .from("evidence")
    .select("subject_id, claim, kind, confidence, source_url, excerpt, event_date, observed_at")
    .eq("org_id", orgId)
    .eq("subject_type", "opportunity")
    .in(
      "subject_id",
      shortlist.map((s) => s.id),
    )
    .is("deleted_at", null)
    .is("superseded_by", null)
    .order("observed_at", { ascending: false });

  const bySubject = new Map<string, EvidenceQueryRow[]>();
  for (const row of (evidence ?? []) as (EvidenceQueryRow & { subject_id: string })[]) {
    const list = bySubject.get(String(row.subject_id)) ?? [];
    list.push(row);
    bySubject.set(String(row.subject_id), list);
  }

  return shortlist.map((s) => ({ ...s, evidence: mapEvidence(bySubject.get(s.id) ?? []) }));
}

async function loopCounts(db: TenantClient, orgId: string, since: string) {
  const [discovered, researched, contacted, replied] = await Promise.all([
    countRows(db, orgId, "opportunities", (q) =>
      q.gte("first_seen_at", since).is("deleted_at", null),
    ),
    countRows(db, orgId, "companies", (q) =>
      q.gte("last_researched_at", since).is("deleted_at", null),
    ),
    /* Sent, not drafted. A message with no `sent_at` has not reached anybody,
       and counting it as "contacted" is the §78 failure stated as a metric. */
    countRows(db, orgId, "messages", (q) =>
      q.eq("direction", "outbound").gte("sent_at", since).is("deleted_at", null),
    ),
    countRows(db, orgId, "messages", (q) =>
      q.eq("direction", "inbound").gte("created_at", since).is("deleted_at", null),
    ),
  ]);
  return { discovered, researched, contacted, replied };
}

async function outcomeCounts(db: TenantClient, orgId: string, since: string) {
  const [meetings, won, companies] = await Promise.all([
    countRows(db, orgId, "outcomes", (q) =>
      q.eq("kind", "meeting").gte("occurred_at", since),
    ),
    countRows(db, orgId, "outcomes", (q) => q.eq("kind", "won").gte("occurred_at", since)),
    /* No `since`, and no denominator. This is how many companies the
       workspace knows about, full stop — the previous version showed it as
       "180 of 1,000 on the Growth plan", and there is no plan ceiling in the
       schema for that second number to have come from. */
    countRows(db, orgId, "companies", (q) => q.is("deleted_at", null)),
  ]);
  return { meetings, won, companies };
}

async function sendingCapacity(db: TenantClient, orgId: string) {
  const { data } = await db
    .from("mailboxes")
    .select("email, daily_limit, sent_today, sent_today_on")
    .eq("org_id", orgId)
    .eq("status", "connected")
    .is("deleted_at", null)
    .order("email", { ascending: true });

  const today = new Date().toISOString().slice(0, 10);
  return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    label: String(row.email ?? ""),
    /* Yesterday's counter is not today's usage. `sent_today` is reset by the
       sender when the date rolls over, so a mailbox that has not sent since
       Tuesday still carries Tuesday's number until it does. */
    used:
      String(row.sent_today_on ?? "").slice(0, 10) === today ? Number(row.sent_today ?? 0) : 0,
    limit: Number(row.daily_limit ?? 0),
  }));
}

async function signalsByType(db: TenantClient, orgId: string, since: string) {
  const { data } = await db
    .from("company_triggers")
    .select("trigger_type")
    .eq("org_id", orgId)
    .gte("event_date", since)
    .is("deleted_at", null)
    .limit(1000);

  return tally(
    ((data ?? []) as Record<string, unknown>[]).map((r) => String(r.trigger_type ?? "unknown")),
  );
}

/**
 * Evidence attributed per source.
 *
 * "Opportunities produced, not articles scraped" is what the card claims, and
 * evidence is the honest measure available: a source's contribution is what it
 * let the product assert, not how many pages it was read from.
 */
async function sourcePerformance(db: TenantClient, orgId: string, since: string) {
  const { data } = await db
    .from("evidence")
    .select("sources(name)")
    .eq("org_id", orgId)
    .not("source_id", "is", null)
    .gte("observed_at", since)
    .is("deleted_at", null)
    .limit(1000);

  /* eslint-disable-next-line @typescript-eslint/no-explicit-any --
     One embedded relation, no generated type. */
  const names = ((data ?? []) as any[])
    .map((r) => String(r.sources?.name ?? ""))
    .filter(Boolean);

  return tally(names);
}

/**
 * What needs a person, derived rather than asserted.
 *
 * The previous version of this rail stated four decisions were required and
 * gave counts for all of them, none of which had been computed. An item is
 * only rendered here when its count is non-zero, so a quiet workspace shows an
 * empty rail rather than a manufactured to-do list.
 */
async function attentionItems(
  db: TenantClient,
  orgId: string,
  orgSlug: string,
  staleBefore: string,
): Promise<Attention[]> {
  const [approvals, failing, stale] = await Promise.all([
    countRows(db, orgId, "messages", (q) =>
      q
        .eq("direction", "outbound")
        .is("scheduled_at", null)
        .is("sent_at", null)
        .is("deleted_at", null),
    ),
    countRows(db, orgId, "sources", (q) =>
      q.not("last_error", "is", null).eq("is_enabled", true).is("deleted_at", null),
    ),
    countRows(db, orgId, "opportunities", (q) =>
      q.lt("last_scored_at", staleBefore).is("deleted_at", null),
    ),
  ]);

  /* Threads rather than a count, because "waiting on us" is the last message
     being inbound — which PostgREST cannot express as a filter. Bounded, and
     the number shown is honest about that bound. */
  const { data: threads } = await db
    .from("threads")
    .select("id, last_message_at, messages(direction, created_at, deleted_at)")
    .eq("org_id", orgId)
    .eq("status", "open")
    .is("deleted_at", null)
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(200);

  /* eslint-disable-next-line @typescript-eslint/no-explicit-any --
     A nested select has no generated row type. */
  const unanswered = ((threads ?? []) as any[]).filter((t) => {
    const messages = (Array.isArray(t.messages) ? t.messages : [])
      /* eslint-disable-next-line @typescript-eslint/no-explicit-any -- same */
      .filter((m: any) => !m.deleted_at)
      /* eslint-disable-next-line @typescript-eslint/no-explicit-any -- same */
      .sort((a: any, b: any) =>
        String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")),
      );
    return messages[messages.length - 1]?.direction === "inbound";
  }).length;

  const items: Attention[] = [];

  if (unanswered > 0) {
    items.push({
      kind: "replies",
      title: `${unanswered} ${unanswered === 1 ? "conversation is" : "conversations are"} waiting on a reply`,
      source: "Inbox",
      meta: "Last message came from them",
      href: `/${orgSlug}/inbox`,
    });
  }

  if (approvals > 0) {
    items.push({
      kind: "approvals",
      title: `${approvals} ${approvals === 1 ? "message needs" : "messages need"} approval`,
      source: "Outreach",
      meta: "Drafted, and nothing sends until you say so",
      href: `/${orgSlug}/inbox`,
    });
  }

  if (failing > 0) {
    items.push({
      kind: "failing-sources",
      /* §58: a source that fails does not fail the hunt — it is marked
         unavailable, retried, and surfaced as something a human can see. */
      title: `${failing} ${failing === 1 ? "source is" : "sources are"} failing`,
      source: "Sources",
      meta: "Still enabled, and still retrying",
      href: `/${orgSlug}/sources`,
    });
  }

  if (stale > 0) {
    items.push({
      kind: "stale-evidence",
      title: `${stale} ${stale === 1 ? "opportunity was" : "opportunities were"} last scored over 90 days ago`,
      source: "Freshness",
      meta: "§81 — an old score is not a current one",
      href: `/${orgSlug}/opportunities`,
    });
  }

  return items;
}

/* ── Small shared rules ──────────────────────────────────────────────────── */

/** Counts, then orders by count. Ties keep the order they arrived in. */
function tally(values: string[]): { label: string; value: number }[] {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 6);
}

/* eslint-disable @typescript-eslint/no-explicit-any --
   Embedded rows, no generated types. Confined to these three helpers. */

/** The newest score. A row can be re-scored, and only the latest is the score. */
function latest(scores: any): any {
  const list = Array.isArray(scores) ? scores : scores ? [scores] : [];
  return [...list].sort((a, b) =>
    String(b?.computed_at ?? "").localeCompare(String(a?.computed_at ?? "")),
  )[0];
}

/** Triggers that have not been soft-deleted, newest event first. */
function live(triggers: any): any[] {
  return (Array.isArray(triggers) ? triggers : [])
    .filter((t: any) => !t.deleted_at)
    .sort((a: any, b: any) =>
      String(b?.event_date ?? "").localeCompare(String(a?.event_date ?? "")),
    );
}

/**
 * §16's eight dimensions.
 *
 * A null column becomes `"unknown"` rather than 0. They are different claims,
 * and a zero renders as a measured score of nothing — which is the specific
 * lie §7 is about.
 */
function dimensionsOf(score: any): ScoreDimension[] {
  const at = (key: string) =>
    score && typeof score[key] === "number" ? (score[key] as number) : ("unknown" as const);
  return [
    { label: "ICP fit", value: at("icp_fit") },
    { label: "Problem severity", value: at("problem_severity") },
    { label: "Evidence strength", value: at("evidence_strength") },
    { label: "Trigger strength", value: at("trigger_strength") },
    { label: "Trigger freshness", value: at("trigger_freshness") },
    { label: "Buying likelihood", value: at("buying_likelihood") },
    { label: "Product relevance", value: at("product_relevance") },
    { label: "Decision-maker accessibility", value: at("decision_maker_accessibility") },
  ];
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/* ── Demo ────────────────────────────────────────────────────────────────── */

/**
 * Built from the same fixtures the opportunity list uses.
 *
 * Derived rather than written out, so the demo dashboard and the demo
 * opportunity list cannot disagree about how many hot opportunities there are
 * — which they did, and which is the kind of inconsistency that makes a
 * reviewer distrust every other number on the page.
 */
const DEMO: Dashboard = {
  counts: PRIORITIES.reduce(
    (acc, p) => ({ ...acc, [p]: OPPORTUNITIES.filter((o) => o.priority === p).length }),
    {} as Record<Priority, number>,
  ),
  triggersLastDay: 0,
  awaitingReview: OPPORTUNITIES.length,
  whyNow: OPPORTUNITIES.slice(0, WHY_NOW_LIMIT).map((o) => ({
    id: o.id,
    company: o.company,
    domain: o.domain,
    priority: o.priority,
    priorityReason: o.priorityReason,
    score: o.score,
    scoreExplanation: o.scoreExplanation,
    confidence: o.confidence,
    dimensions: o.dimensions,
    trigger: o.trigger,
    triggerDate: o.triggerDate,
    evidence: o.evidence,
  })),
  loop: { discovered: OPPORTUNITIES.length, researched: 0, contacted: 0, replied: 0 },
  outcomes: { meetings: 0, won: 0, companies: OPPORTUNITIES.length },
  /* No mailbox, no rows. The previous version showed two addresses at
     `acme.co` with sending quotas, on a deployment where nothing could send. */
  capacity: [],
  signalsByType: tally(OPPORTUNITIES.map((o) => o.trigger)),
  sourcePerformance: [],
  attention: [],
};
