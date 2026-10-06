/**
 * `schedule_followups` — the work the loop was never asked to do (MAP-001).
 *
 * Three handlers were real, registered and tested, and nothing enqueued them
 * after onboarding. This sweeper is their producer. Each branch is bounded per
 * tick and reads a marker that stops it asking twice:
 *
 *   1. CRM pushes a rep requested — `opportunities.crm_sync_requested_at`,
 *      written by "Push to HubSpot" and cleared here once the job exists.
 *   2. Contact discovery for HOT and WARM opportunities that have never been
 *      searched — `contacts_sought_at`, set here so an opportunity nobody could
 *      be found for costs one search, not one per tick.
 *   3. Provider enrichment for companies behind a live opportunity, when it
 *      has never run or is older than `staleBefore()` — `last_enriched_at`.
 *   4. Research, and so a score, for companies that have never been
 *      researched and have no opportunity — CSV imports and hand-added
 *      companies above all (FLOW-007) — `research_requested_at`, at most
 *      once a day each.
 *
 * Cross-tenant like every sweeper, and for the same reason: "who has asked"
 * is not a question inside one org. Every enqueued job carries its org, and
 * every one spends through the provider seam, which enforces the org's budget.
 */
import { enqueue } from "../queue.ts";
import { OrgScope } from "../scope.ts";
import { staleBefore } from "./enrich-company.ts";
import type { JobContext, JobOutcome } from "../registry.ts";

const MAX_CRM_PER_TICK = 25;
const MAX_CONTACTS_PER_TICK = 10;
const MAX_ENRICH_PER_TICK = 10;
const MAX_RESEARCH_PER_TICK = 5;
const MAX_COMPETITOR_PER_TICK = 5;
const RESEARCH_RETRY_MS = 24 * 3600_000;

export async function scheduleFollowups(ctx: JobContext): Promise<JobOutcome> {
  const db = OrgScope.global();
  const counts = { crm: 0, contacts: 0, enrich: 0, research: 0 };

  // 1. Requested CRM pushes.
  const { data: pushes, error: pushError } = await db
    .from("opportunities")
    .select("id, org_id")
    .not("crm_sync_requested_at", "is", null)
    .is("deleted_at", null)
    .order("crm_sync_requested_at", { ascending: true })
    .limit(MAX_CRM_PER_TICK);
  if (pushError) return { ok: false, error: `schedule_followups: ${pushError.message}` };

  for (const row of (pushes ?? []) as { id: string; org_id: string }[]) {
    await enqueue({
      orgId: row.org_id,
      name: "sync_hubspot",
      payload: { opportunityId: row.id },
      idempotencyKey: `crm:${row.id}`,
    });
    await db.from("opportunities").update({ crm_sync_requested_at: null }).eq("id", row.id);
    counts.crm++;
  }

  // 2. Contact discovery, once per promising opportunity.
  const { data: unsought, error: contactError } = await db
    .from("opportunities")
    .select("id, org_id")
    .is("contacts_sought_at", null)
    .is("deleted_at", null)
    .in("priority", ["hot", "warm"])
    .order("first_seen_at", { ascending: false })
    .limit(MAX_CONTACTS_PER_TICK);
  if (contactError) return { ok: false, error: `schedule_followups: ${contactError.message}` };

  for (const row of (unsought ?? []) as { id: string; org_id: string }[]) {
    await enqueue({
      orgId: row.org_id,
      name: "rank_contacts",
      payload: { opportunityId: row.id, discover: true },
      idempotencyKey: `contacts:${row.id}`,
    });
    await db
      .from("opportunities")
      .update({ contacts_sought_at: ctx.now.toISOString() })
      .eq("id", row.id);
    counts.contacts++;
  }

  // 3. Enrichment refresh for companies someone is pursuing.
  const { data: stale, error: enrichError } = await db
    .from("opportunities")
    .select("company_id, org_id, companies!inner(last_enriched_at, deleted_at)")
    .is("deleted_at", null)
    .in("priority", ["hot", "warm"])
    .is("companies.deleted_at", null)
    .or(`last_enriched_at.is.null,last_enriched_at.lt.${staleBefore(ctx.now)}`, {
      referencedTable: "companies",
    })
    .limit(MAX_ENRICH_PER_TICK);
  if (enrichError) return { ok: false, error: `schedule_followups: ${enrichError.message}` };

  const seen = new Set<string>();
  for (const row of (stale ?? []) as { company_id: string; org_id: string }[]) {
    if (seen.has(row.company_id)) continue;
    seen.add(row.company_id);
    await enqueue({
      orgId: row.org_id,
      name: "enrich_company",
      payload: { companyId: row.company_id },
      idempotencyKey: `enrich:${row.company_id}`,
    });
    counts.enrich++;
  }

  // 4. Companies nobody has qualified — imports and hand-added ones.
  const retryBefore = new Date(ctx.now.getTime() - RESEARCH_RETRY_MS).toISOString();
  const { data: unresearched, error: researchError } = await db
    .from("companies")
    .select("id, org_id, opportunities(id)")
    .is("last_researched_at", null)
    .is("deleted_at", null)
    .or(`research_requested_at.is.null,research_requested_at.lt.${retryBefore}`)
    .order("research_requested_at", { ascending: true, nullsFirst: true })
    .limit(MAX_RESEARCH_PER_TICK * 4);
  if (researchError) return { ok: false, error: `schedule_followups: ${researchError.message}` };

  const due = ((unresearched ?? []) as { id: string; org_id: string; opportunities: unknown[] | null }[])
    .filter((c) => !c.opportunities?.length)
    .slice(0, MAX_RESEARCH_PER_TICK);
  for (const company of due) {
    await enqueue({
      orgId: company.org_id,
      name: "research_company",
      payload: { companyId: company.id },
      idempotencyKey: `research:${company.id}`,
    });
    await db
      .from("companies")
      .update({ research_requested_at: ctx.now.toISOString() })
      .eq("id", company.id);
    counts.research++;
  }

  // 5. Competitor research a person asked for (0039). `research_competitor`
  //    had no producer before this; the request column is its seam.
  const { data: asked, error: competitorError } = await db
    .from("competitors")
    .select("id, org_id")
    .not("research_requested_at", "is", null)
    .is("deleted_at", null)
    .order("research_requested_at", { ascending: true })
    .limit(MAX_COMPETITOR_PER_TICK);
  if (competitorError) return { ok: false, error: `schedule_followups: ${competitorError.message}` };

  let competitors = 0;
  for (const row of (asked ?? []) as { id: string; org_id: string }[]) {
    await enqueue({
      orgId: row.org_id,
      name: "research_competitor",
      payload: { competitorId: row.id, force: true },
      idempotencyKey: `competitor:${row.id}`,
    });
    await db.from("competitors").update({ research_requested_at: null }).eq("id", row.id);
    competitors++;
  }

  return { ok: true, result: { ...counts, competitors } };
}
