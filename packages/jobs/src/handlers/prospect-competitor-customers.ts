/**
 * "Go after their customers" — a competitor's named customers, turned into
 * companies to research. COMMAND.md §16.3-D step 5.
 *
 * Opt-in per competitor (`competitors.prospect_customers`, 0039), and only
 * for customers the competitor's own site names as a *fact* — a logo wall or
 * a case study. An inferred customer is a guess, and researching a guess
 * spends the customer's credits on a company nobody said anything about.
 *
 * Nothing here contacts anybody. A company found this way goes through the
 * same chain as any other: `research_company` gathers evidence and enqueues
 * scoring, and a person decides what happens next. It is attributed to the
 * competitor (`discovered_via = competitor:<id>`) so Performance can say
 * whether "their customers" convert.
 *
 * ── Bounded three ways ───────────────────────────────────────────────────
 *
 *   · at most `MAX_CUSTOMERS` names per run
 *   · one provider lookup per name, through the same metered, budgeted call
 *     path discovery uses, so the org's credit ceiling applies
 *   · once per research: `customers_sought_at` records the run, and the
 *     sweeper only asks again after the profile has been re-researched
 */
import { ProviderRefused, searchCompanies, type ProviderCompany } from "@huntloop/providers";
import { canonicalizeDomain } from "@huntloop/db/identity";
import { enqueue } from "../queue.ts";
import { OrgScope } from "../scope.ts";
import type { JobContext, JobOutcome } from "../registry.ts";

export interface ProspectCompetitorCustomersPayload {
  competitorId: string;
}

const MAX_CUSTOMERS = 10;

/** Lower-case, punctuation and legal suffixes removed — for "is this the same name". */
export function normalizeCompanyName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[.,'’&()]/g, " ")
    .replace(/\b(inc|incorporated|llc|ltd|limited|gmbh|corp|corporation|co|plc|sa|ag|bv)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The provider result that is unambiguously the named company, or null. */
export function pickMatch(name: string, items: ProviderCompany[]): ProviderCompany | null {
  const wanted = normalizeCompanyName(name);
  if (!wanted) return null;
  const exact = items.filter((c) => c.domain && normalizeCompanyName(c.name) === wanted);
  // Two different companies with the same name is not a match; it is a guess.
  return exact.length === 1 ? exact[0]! : null;
}

export async function prospectCompetitorCustomers(ctx: JobContext): Promise<JobOutcome> {
  const { scope, payload, now } = ctx;
  const competitorId = String(payload.competitorId ?? "");
  if (!competitorId) {
    return { ok: false, permanent: true, error: "prospect_competitor_customers: no competitorId." };
  }

  const { data: competitor, error } = await scope
    .select("competitors", "id, name, status, prospect_customers")
    .eq("id", competitorId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) return { ok: false, error: `prospect_competitor_customers: ${error.message}` };
  if (!competitor || competitor.status !== "active" || !competitor.prospect_customers) {
    return { ok: true, result: { skipped: "prospecting is off for this competitor" } };
  }

  const { data: profile } = await scope
    .select("competitor_profiles", "customer_examples")
    .eq("competitor_id", competitorId)
    .maybeSingle();

  const examples = Array.isArray(profile?.customer_examples)
    ? (profile.customer_examples as Array<{ value?: unknown; kind?: unknown }>)
    : [];
  const names = [
    ...new Set(
      examples
        .filter((e) => e.kind === "fact" && typeof e.value === "string")
        .map((e) => String(e.value).trim())
        .filter((v) => v.length >= 2 && v.length <= 120),
    ),
  ].slice(0, MAX_CUSTOMERS);

  let found = 0;
  let created = 0;
  let refused: string | null = null;

  for (const name of names) {
    let items: ProviderCompany[] = [];
    try {
      const result = await searchCompanies(
        { db: OrgScope.global(), orgId: scope.orgId, entity: { type: "competitor", id: competitorId } },
        {
          name,
          keywords: [],
          industries: [],
          locations: [],
          employeeMin: null,
          employeeMax: null,
          revenueBands: [],
          technologies: [],
          excludeDomains: [],
          cursor: null,
          limit: 5,
        },
      );
      items = result.data.items;
    } catch (e) {
      if (e instanceof ProviderRefused) {
        // No provider, no budget, or a broken key: stop, and say which.
        refused = e.meta.error ?? e.meta.refusal ?? "refused";
        break;
      }
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }

    const match = pickMatch(name, items);
    const domain = match?.domain ? canonicalizeDomain(match.domain) : null;
    if (!match || !domain) continue;
    found++;

    const { data: existing } = await scope
      .select("companies", "id")
      .eq("canonical_domain", domain)
      .is("deleted_at", null)
      .maybeSingle();
    if (existing) continue;

    const { data: row, error: insertError } = await scope
      .upsert(
        "companies",
        {
          canonical_domain: domain,
          name: match.name,
          website: match.website,
          industry: match.industry,
          employee_count: match.employeeCount,
          revenue_band: match.revenueBand,
          country: match.country,
          region: match.region,
          description: match.description,
          tech_stack: match.technologies,
          funding: match.funding ?? {},
          discovered_via: `competitor:${competitorId}`,
        },
        { onConflict: "org_id,canonical_domain", ignoreDuplicates: true },
      )
      .select("id")
      .maybeSingle();
    if (insertError || !row) continue;
    const companyId = String((row as { id: string }).id);

    await scope.upsert(
      "company_domains",
      { company_id: companyId, domain, kind: "primary", asserted_by: "competitor_customer", confidence: "high" },
      { onConflict: "org_id,domain", ignoreDuplicates: true },
    );

    /* The relationship that brought it here, with no evidence id of its own:
       the competitor's site named them, which the competitor profile cites.
       `uses` with no evidence is deliberately not a rule fact (see
       score-opportunity), so this cannot move a score by itself. */
    await scope.upsert(
      "company_competitor_signals",
      {
        company_id: companyId,
        competitor_id: competitorId,
        relationship: "uses",
        claim_kind: "fact",
        confidence: "medium",
        observed_at: now.toISOString(),
        detected_by: "competitor_customers",
      },
      { onConflict: "org_id,company_id,competitor_id,relationship", ignoreDuplicates: true },
    );

    await enqueue({
      orgId: scope.orgId,
      name: "research_company",
      payload: { companyId },
      idempotencyKey: `research:${scope.orgId}:${companyId}`,
    });
    created++;
  }

  await scope.update("competitors", { customers_sought_at: now.toISOString() }).eq("id", competitorId);

  return {
    ok: true,
    result: { named: names.length, matched: found, created, ...(refused ? { refused } : {}) },
  };
}
