import "server-only";
import type { AgentContext, QualificationEvidence } from "@huntloop/ai";
import type { TenantClient } from "@huntloop/db";
import { applicableMemories } from "@huntloop/db/memory";

/**
 * What the per-opportunity agent knows beyond the research — COMMAND.md
 * §16.3-G's Phase 3 step: the stage, the account's recent history, how the
 * prospect replied, competitors on file with the team's positioning, and the
 * memories that apply (organisation, this person, this account, this
 * opportunity — scope-filtered in `@huntloop/db/memory`).
 *
 * Competitor relationships that rest on evidence are also returned as
 * evidence, so the agent can cite them like any other claim.
 */

const ACTIVITY_LINES = 15;

/* eslint-disable @typescript-eslint/no-explicit-any -- untyped PostgREST rows (DB-03). */

export async function loadAgentContext(
  db: TenantClient,
  input: { orgId: string; opportunityId: string; companyId: string; userId: string; stage: string },
): Promise<{ context: AgentContext; evidence: { id: string; item: QualificationEvidence }[] }> {
  const [activity, thread, signals, memories] = await Promise.all([
    db
      .from("activities")
      .select("summary, occurred_at, direction, channel")
      .eq("org_id", input.orgId)
      .eq("opportunity_id", input.opportunityId)
      .is("deleted_at", null)
      .order("occurred_at", { ascending: false })
      .limit(ACTIVITY_LINES),
    db
      .from("threads")
      .select("classification")
      .eq("org_id", input.orgId)
      .eq("opportunity_id", input.opportunityId)
      .not("classification", "is", null)
      .is("deleted_at", null)
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle(),
    db
      .from("company_competitor_signals")
      .select(
        "relationship, evidence_id, competitors!inner(name, tier, status, our_advantage, their_advantage, deleted_at), " +
          "evidence(id, claim, kind, confidence, source_url, excerpt)",
      )
      .eq("org_id", input.orgId)
      .eq("company_id", input.companyId)
      .limit(20),
    applicableMemories(db, {
      orgId: input.orgId,
      userId: input.userId,
      accountId: input.companyId,
      opportunityId: input.opportunityId,
    }),
  ]);

  const one = (v: any) => (Array.isArray(v) ? v[0] : v) ?? null;
  const competitors: AgentContext["competitors"] = [];
  const evidence: { id: string; item: QualificationEvidence }[] = [];
  for (const row of (signals.data ?? []) as any[]) {
    const c = one(row.competitors);
    if (!c || c.deleted_at || c.status !== "active") continue;
    competitors.push({
      name: String(c.name),
      tier: c.tier ?? null,
      relationship: String(row.relationship),
      ourAdvantage: c.our_advantage ?? null,
      theirAdvantage: c.their_advantage ?? null,
    });
    const ev = one(row.evidence);
    if (ev?.id) {
      evidence.push({
        id: String(ev.id),
        item: {
          claim: String(ev.claim),
          kind: ev.kind,
          confidence: ev.confidence ?? null,
          sourceUrl: ev.source_url ?? null,
          excerpt: ev.excerpt ?? null,
        },
      });
    }
  }

  return {
    context: {
      stage: input.stage,
      recentActivity: ((activity.data ?? []) as any[]).map(
        (a) => `${String(a.occurred_at).slice(0, 10)} · ${a.channel} · ${a.summary}`,
      ),
      replyClassification: (thread.data as { classification?: string } | null)?.classification ?? null,
      competitors,
      memories: memories.map((m) => m.content).slice(0, 30),
    },
    evidence,
  };
}

/* eslint-enable @typescript-eslint/no-explicit-any */
