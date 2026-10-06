import "server-only";
import type { AssistantRecord } from "@huntloop/ai";
import type { TenantClient } from "@huntloop/db";
import { applicableMemories } from "@huntloop/db/memory";
import { getDefaultNeedsYou } from "../data/needs-you";
import { getPerformance } from "../data/performance";
import { listCompetitors } from "../data/competitor-intel";
import { performanceFacts } from "../performance/facts";

/**
 * The records the workspace assistant answers from — COMMAND.md §16.3-G.
 *
 * Gathered before the call rather than fetched by the model mid-answer: the
 * set is bounded, every query runs through the asker's own tenant client (so
 * RLS decides what they can see, exactly as on every other screen), and each
 * record carries a typed reference the answer must cite.
 *
 * What is always included: the asker's Needs-you queue, the pipeline by stage,
 * the last 30 days' performance figures (the same ones the Performance page
 * computes), the hottest opportunities, competitors, active scoring rules,
 * source health and the notes that apply to them. What depends on the
 * question: opportunities whose company it names.
 */

const TOP_OPPORTUNITIES = 20;
const NAMED_OPPORTUNITIES = 10;
const NEEDS_ITEMS = 12;

/* eslint-disable @typescript-eslint/no-explicit-any -- untyped PostgREST rows (DB-03). */

/** Words in the question worth matching against company names. */
export function questionTerms(question: string): string[] {
  const stop = new Set([
    "the", "and", "for", "with", "what", "which", "who", "why", "how", "are", "our", "you", "this",
    "that", "from", "about", "deal", "deals", "account", "accounts", "company", "companies", "should",
    "today", "week", "have", "has", "did", "does", "losing", "lost", "won", "where", "when", "they",
    "them", "their", "any", "all", "most", "focus", "next", "step", "steps", "pipeline", "hot", "warm",
  ]);
  return [
    ...new Set(
      question
        .toLowerCase()
        .replace(/[^a-z0-9.\- ]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length >= 3 && !stop.has(w)),
    ),
  ].slice(0, 6);
}

export async function gatherWorkspaceRecords(
  db: TenantClient,
  input: { orgSlug: string; orgId: string; userId: string; question: string },
): Promise<{ records: AssistantRecord[]; hrefs: Map<string, string> }> {
  const { orgSlug, orgId, userId, question } = input;
  const records: AssistantRecord[] = [];
  const hrefs = new Map<string, string>();
  const terms = questionTerms(question);

  const [needs, perf, competitors, pipeline, top, named, rules, sources, memories] = await Promise.all([
    getDefaultNeedsYou(orgSlug),
    getPerformance(orgSlug, "30d").catch(() => null),
    listCompetitors(orgSlug),
    db
      .from("opportunities")
      .select("status, priority, estimated_value_cents")
      .eq("org_id", orgId)
      .is("deleted_at", null)
      .limit(5000),
    db
      .from("opportunities")
      .select("id")
      .eq("org_id", orgId)
      .is("deleted_at", null)
      .in("priority", ["hot", "warm"])
      .not("status", "in", "(won,lost,archived)")
      .order("priority", { ascending: true })
      .order("last_scored_at", { ascending: false, nullsFirst: false })
      .limit(TOP_OPPORTUNITIES),
    terms.length
      ? db
          .from("opportunities")
          .select("id, companies!inner(name)")
          .eq("org_id", orgId)
          .is("deleted_at", null)
          .or(terms.map((t) => `name.ilike.%${t.replace(/[%_,()]/g, "")}%`).join(","), {
            referencedTable: "companies",
          })
          .limit(NAMED_OPPORTUNITIES)
      : Promise.resolve({ data: [] as any[] }),
    db
      .from("scoring_rules")
      .select("id, name, effect, weight, floor_priority")
      .eq("org_id", orgId)
      .eq("is_active", true)
      .is("deleted_at", null)
      .limit(15),
    db
      .from("sources")
      .select("id, name, last_error, last_scanned_at")
      .eq("org_id", orgId)
      .eq("is_enabled", true)
      .is("deleted_at", null)
      .limit(50),
    applicableMemories(db, { orgId, userId }),
  ]);

  /* ── Needs you ─────────────────────────────────────────────────────────── */
  const needIds: string[] = [];
  for (const item of needs.data.items.slice(0, NEEDS_ITEMS)) {
    const ref = `needs:${item.key}`;
    records.push({ ref, type: "needs", title: `${item.label}: ${item.title}`, facts: [item.why] });
    hrefs.set(ref, item.href);
    if (item.opportunityId) needIds.push(item.opportunityId);
  }

  /* ── Pipeline ──────────────────────────────────────────────────────────── */
  const byStage = new Map<string, { count: number; value: number }>();
  const byPriority = new Map<string, number>();
  for (const o of (pipeline.data ?? []) as any[]) {
    const s = byStage.get(o.status) ?? { count: 0, value: 0 };
    s.count += 1;
    s.value += Number(o.estimated_value_cents ?? 0);
    byStage.set(o.status, s);
    byPriority.set(o.priority, (byPriority.get(o.priority) ?? 0) + 1);
  }
  records.push({
    ref: "pipeline:stages",
    type: "pipeline",
    title: "Pipeline by stage",
    facts: [
      ...[...byStage].map(
        ([stage, s]) => `${stage}: ${s.count}${s.value ? `, $${Math.round(s.value / 100).toLocaleString()} recorded value` : ""}`,
      ),
      `By priority: ${[...byPriority].map(([p, n]) => `${p} ${n}`).join(", ") || "none"}`,
    ],
  });
  hrefs.set("pipeline:stages", `/${orgSlug}/pipeline`);

  /* ── Performance, last 30 days ─────────────────────────────────────────── */
  if (perf?.data) {
    for (const fact of performanceFacts(perf.data.performance).slice(0, 14)) {
      const ref = `metric:${fact.id}`;
      records.push({ ref, type: "metric", title: "Last 30 days", facts: [fact.text] });
      hrefs.set(ref, `/${orgSlug}/performance?period=30d`);
    }
  }

  /* ── Opportunities: the hottest, the queue's, and the ones named ───────── */
  const ids = [
    ...new Set([
      ...((named.data ?? []) as any[]).map((o) => String(o.id)),
      ...needIds,
      ...((top.data ?? []) as any[]).map((o) => String(o.id)),
    ]),
  ].slice(0, TOP_OPPORTUNITIES + NAMED_OPPORTUNITIES);
  if (ids.length) {
    const [{ data: opps }, { data: touches }] = await Promise.all([
      db
        .from("opportunities")
        .select(
          "id, priority, status, owner_id, next_step, next_step_due_at, why_now, estimated_value_cents, " +
            "companies!inner(name, industry), opportunity_scores(score, computed_at)",
        )
        .eq("org_id", orgId)
        .in("id", ids),
      db
        .from("activities")
        .select("opportunity_id, kind, direction, occurred_at")
        .eq("org_id", orgId)
        .in("opportunity_id", ids)
        .in("kind", ["email_sent", "email_received", "message", "call", "meeting", "connection_request"])
        .is("deleted_at", null)
        .order("occurred_at", { ascending: false })
        .limit(500),
    ]);
    const lastTouch = new Map<string, any>();
    for (const t of (touches ?? []) as any[]) if (!lastTouch.has(String(t.opportunity_id))) lastTouch.set(String(t.opportunity_id), t);

    for (const o of (opps ?? []) as any[]) {
      const company = Array.isArray(o.companies) ? o.companies[0] : o.companies;
      const score = (Array.isArray(o.opportunity_scores) ? o.opportunity_scores : []).sort((a: any, b: any) =>
        String(b.computed_at).localeCompare(String(a.computed_at)),
      )[0];
      const touch = lastTouch.get(String(o.id));
      const ref = `opportunity:${o.id}`;
      records.push({
        ref,
        type: "opportunity",
        title: String(company?.name ?? "An opportunity"),
        facts: [
          `priority ${o.priority}, stage ${o.status}${score ? `, score ${score.score}` : ""}`,
          company?.industry ? `industry ${company.industry}` : "industry not on file",
          o.owner_id ? (o.owner_id === userId ? "owned by the asker" : "owned by a colleague") : "no owner",
          o.next_step
            ? `next step: ${o.next_step}${o.next_step_due_at ? ` (due ${String(o.next_step_due_at).slice(0, 10)})` : ""}`
            : "no next step set",
          touch
            ? `last touch ${String(touch.occurred_at).slice(0, 10)}, ${touch.direction} ${touch.kind.replace(/_/g, " ")}`
            : "never touched",
          ...(o.estimated_value_cents ? [`recorded value $${Math.round(Number(o.estimated_value_cents) / 100).toLocaleString()}`] : []),
          ...(o.why_now ? [`why now: ${String(o.why_now).slice(0, 220)}`] : []),
        ],
      });
      hrefs.set(ref, `/${orgSlug}/opportunities/${o.id}`);
    }
  }

  /* ── Competitors ───────────────────────────────────────────────────────── */
  for (const c of competitors.data.filter((c) => c.status === "active").slice(0, 10)) {
    const ref = `competitor:${c.id}`;
    records.push({
      ref,
      type: "competitor",
      title: c.name,
      facts: [
        `${c.tier ?? "tier not set"} competitor`,
        `prospects using them (with evidence): ${c.signals.uses}; evaluating: ${c.signals.evaluating}; left them: ${c.signals.former}`,
        `deals recorded as lost to them: ${c.losses}`,
        ...(c.ourAdvantage ? [`where we win (team's words): ${c.ourAdvantage}`] : []),
      ],
    });
    hrefs.set(ref, `/${orgSlug}/competitors/${c.id}`);
  }

  /* ── Rules, sources, notes ─────────────────────────────────────────────── */
  for (const r of (rules.data ?? []) as any[]) {
    const ref = `rule:${r.id}`;
    records.push({
      ref,
      type: "rule",
      title: String(r.name),
      facts: [
        r.effect === "adjust"
          ? `adjusts the score by ${r.weight}`
          : r.effect === "floor"
            ? `keeps matches at least ${r.floor_priority}`
            : `effect: ${r.effect}`,
      ],
    });
    hrefs.set(ref, `/${orgSlug}/settings/scoring`);
  }
  const sourceRows = (sources.data ?? []) as any[];
  const failing = sourceRows.filter((s) => s.last_error);
  records.push({
    ref: "source:health",
    type: "source",
    title: "Sources",
    facts: [
      `${sourceRows.length} enabled, ${failing.length} failing`,
      ...failing.slice(0, 5).map((s) => `failing: ${s.name}`),
    ],
  });
  hrefs.set("source:health", `/${orgSlug}/sources`);

  for (const m of memories.slice(0, 15)) {
    records.push({ ref: `memory:${m.id}`, type: "memory", title: "A note the team taught Huntloop", facts: [m.content] });
    hrefs.set(`memory:${m.id}`, `/${orgSlug}/memory`);
  }

  return { records, hrefs };
}

/* eslint-enable @typescript-eslint/no-explicit-any */
