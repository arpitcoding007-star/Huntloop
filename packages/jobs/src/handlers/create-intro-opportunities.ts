/**
 * `create_intro_opportunities` — an accepted Exchange introduction becomes a
 * "Stated need" opportunity in the supplier's workspace (build plan DN-58).
 *
 * Every tick, for accepted introductions with no opportunity yet:
 *   · the buyer's company in the supplier's workspace — found by domain, or
 *     created from the buyer workspace's name and primary domain;
 *   · the opportunity, `origin = 'exchange'`, hot and qualified, its reason the
 *     buyer's own summary (they accepted, so the supplier may now read it);
 *   · one evidence row, a fact: "the buyer stated this need on <date>", whose
 *     source is the introduction itself.
 *
 * If the supplier already had this company as an engine opportunity, that
 * opportunity is reused and its origin becomes `exchange` (0059 lets it
 * become, never stop being, Exchange). That is deliberate: once a buyer is in
 * an introduction, the firewall must stop any cold sequence still running at
 * them, and `advance_enrollments` refuses `exchange` rows.
 *
 * A buyer with no domain gets a reserved `.invalid` placeholder (RFC 2606),
 * which says "no domain known" rather than inventing one.
 *
 * The company itself becomes `exchange` too (0066), new or reused, so it is
 * never enriched, researched or signal-fetched.
 *
 * No people are created. The buyer's contact details, if they chose to share
 * them, stay inside the introduction.
 */
import { OrgScope } from "../scope.ts";
import type { JobContext, JobOutcome } from "../registry.ts";

export const MAX_PER_TICK = 50;

type Intro = {
  id: string;
  need_id: string;
  buyer_org_id: string;
  provider_org_id: string;
  decided_at: string | null;
};

export function placeholderDomain(introId: string): string {
  return `buyer-${introId.replace(/-/g, "").slice(0, 12)}.exchange.invalid`;
}

export async function createIntroOpportunities(ctx: JobContext): Promise<JobOutcome> {
  const db = OrgScope.global();
  const { data, error } = await db
    .from("exchange_intros")
    .select("id, need_id, buyer_org_id, provider_org_id, decided_at")
    .eq("state", "accepted")
    .is("opportunity_id", null)
    .order("decided_at", { ascending: true })
    .limit(MAX_PER_TICK);
  if (error) return { ok: false, error: `create_intro_opportunities: ${error.message}` };

  let created = 0;
  let reused = 0;
  const failures: string[] = [];
  for (const intro of (data ?? []) as Intro[]) {
    try {
      const outcome = await one(intro, ctx.now);
      if (outcome === "created") created++;
      else reused++;
    } catch (e) {
      failures.push(`${intro.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { ok: true, result: { created, reused, ...(failures.length ? { failures } : {}) } };
}

async function one(intro: Intro, now: Date): Promise<"created" | "reused"> {
  const db = OrgScope.global();
  const [{ data: need }, { data: buyer }, { data: provider }] = await Promise.all([
    db.from("exchange_needs").select("summary, created_at, exchange_categories(name)").eq("id", intro.need_id).maybeSingle(),
    db.from("organizations").select("name, primary_domain").eq("id", intro.buyer_org_id).maybeSingle(),
    db.from("organizations").select("slug").eq("id", intro.provider_org_id).maybeSingle(),
  ]);
  if (!need) throw new Error("the need no longer exists");
  const n = need as { summary: string; created_at: string };
  const b = (buyer ?? {}) as { name?: string; primary_domain?: string | null };
  const slug = String((provider as { slug?: string } | null)?.slug ?? "");

  const scope = new OrgScope(intro.provider_org_id, db);
  const domain = (b.primary_domain ?? "").trim().toLowerCase() || placeholderDomain(intro.id);
  const name = (b.name ?? "").trim() || "Exchange buyer";

  // The company.
  const { data: existingCompany } = await scope.select("companies", "id").eq("canonical_domain", domain).maybeSingle();
  let companyId = (existingCompany as { id?: string } | null)?.id ?? null;
  if (!companyId) {
    const { data: inserted, error } = await scope
      .insert("companies", { canonical_domain: domain, name, origin: "exchange", discovered_via: "exchange" })
      .select("id")
      .single();
    if (error) throw new Error(`company: ${error.message}`);
    companyId = String((inserted as { id: string }).id);
  }

  // The opportunity: reuse one the supplier already has for this company.
  const { data: existingOpp } = await scope
    .select("opportunities", "id")
    .eq("company_id", companyId)
    .is("icp_id", null)
    .maybeSingle();
  let opportunityId = (existingOpp as { id?: string } | null)?.id ?? null;
  const stated = new Date(n.created_at).toISOString().slice(0, 10);
  const reason = `Stated need on the Exchange: “${n.summary.slice(0, 300)}”. The buyer accepted an introduction.`;
  let outcome: "created" | "reused" = "reused";
  if (opportunityId) {
    const { error } = await scope.update("opportunities", { origin: "exchange" }).eq("id", opportunityId);
    if (error) throw new Error(`opportunity: ${error.message}`);
  } else {
    const { data: inserted, error } = await scope
      .insert("opportunities", {
        company_id: companyId,
        origin: "exchange",
        priority: "hot",
        priority_reason: reason,
        status: "qualified",
        discovered_via: "exchange",
      })
      .select("id")
      .single();
    if (error) throw new Error(`opportunity: ${error.message}`);
    opportunityId = String((inserted as { id: string }).id);
    outcome = "created";
  }

  // The evidence: a fact, whose source is the introduction.
  const { error: evidenceError } = await scope.insert("evidence", {
    subject_type: "opportunity",
    subject_id: opportunityId,
    claim: `The buyer stated this need on the Exchange on ${stated} and accepted an introduction.`,
    kind: "fact",
    confidence: "high",
    source_url: `/${slug}/exchange/intros/${intro.id}`,
    observed_at: intro.decided_at ?? now.toISOString(),
  });
  if (evidenceError) throw new Error(`evidence: ${evidenceError.message}`);

  const { error: linkError } = await db.from("exchange_intros").update({ opportunity_id: opportunityId }).eq("id", intro.id);
  if (linkError) throw new Error(`link: ${linkError.message}`);
  return outcome;
}
