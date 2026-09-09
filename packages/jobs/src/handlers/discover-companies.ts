/**
 * `discover_companies` — search for companies that match a profile.
 *
 * ── The step this product did not have ───────────────────────────────────
 *
 * Until now the only way a company entered the system was `scan_source`:
 * fetch a feed, extract signals, resolve. Good at what it does, and it can
 * only find companies somebody wrote about this week. An ICP describing four
 * thousand addressable companies produced zero of them until one appeared in
 * an RSS item.
 *
 * ── The rule the whole handler is built around ───────────────────────────
 *
 * **A failed search must never look like an empty market.**
 *
 * It is the most dangerous confusion available here. A customer who reads
 * "0 companies match your ICP" edits a profile that was fine, or concludes
 * the product does not work — and neither is recoverable by us, because
 * nothing looks broken. Every exit below writes a `status` and a
 * `stop_reason`, and `succeeded` is reachable only when the provider actually
 * answered and there was nothing left to read.
 *
 * ── Why it does not create opportunities ─────────────────────────────────
 *
 * Same argument `scan_source` makes: §78 forbids a strong signal lifting a
 * poor-fit company, and this handler has no evidence — it has a provider's
 * attribute match. It produces companies and enqueues `score_opportunity`,
 * which has the ICP and the evidence in front of it. Letting the searcher
 * decide would put the qualification verdict in the place with the least
 * context to make it.
 *
 * ── Idempotency ─────────────────────────────────────────────────────────
 *
 * At-least-once, like every handler here. Three mechanisms, because this one
 * spends money:
 *
 *   · `discovery_runs_one_open_per_query` — one live run per query
 *   · `discovery_results` unique on (run, provider, provider_id) — the same
 *     organization on page 1 and page 3 counts once
 *   · `finish_discovery_run` derives its counts from the results rather than
 *     accumulating, so running it twice changes nothing
 *
 * A re-run after a crash resumes from `page_cursor` and pays only for pages
 * it has not read.
 */
import {
  ProviderRefused,
  searchCompanies,
  type ProviderCompany,
} from "@huntloop/providers";
import { canonicalizeDomain } from "@huntloop/db/identity";
import { isExcluded, parseIcp, type Icp } from "@huntloop/db/icp";
import type { DiscoveryFilters } from "@huntloop/db/discovery";
import { enqueue } from "../queue.ts";
import { OrgScope } from "../scope.ts";
import type { JobContext, JobOutcome } from "../registry.ts";

/**
 * How many pages one run reads before stopping.
 *
 * A cap on spend per invocation, not on the size of the market. A run that
 * hits it stops `partial` with a cursor, and the next scheduled run resumes —
 * so a 4,000-company market is enumerated over several days rather than in
 * one afternoon that empties a month's credits. Same shape as
 * `MAX_EXTRACTIONS_PER_SCAN` in `scan_source`, for the same reason.
 */
const DEFAULT_MAX_PAGES = 5;
const PAGE_SIZE = 25;

/**
 * How many companies one run will hand to research and scoring.
 *
 * Separate from the page cap, and lower. Finding a company is cheap; a model
 * call about it is not, and a run that discovered 500 companies and enqueued
 * 500 research jobs would put a four-figure model bill in a queue nobody
 * approved. The rest are still created as rows — they are real companies, and
 * a person can promote them — they simply do not trigger paid work on their
 * own.
 */
const MAX_AUTO_RESEARCH = 25;

export interface DiscoverPayload {
  queryId: string;
  runId?: string;
}

export async function discoverCompanies(ctx: JobContext): Promise<JobOutcome> {
  const { scope, payload } = ctx;
  const queryId = String(payload.queryId ?? "");
  if (!queryId) {
    return { ok: false, permanent: true, error: "discover_companies: no queryId in payload." };
  }

  /* ── The query ───────────────────────────────────────────────────────── */

  const { data: query, error: queryError } = await scope
    .select(
      "discovery_queries",
      "id, name, icp_id, icp_version_id, filters, credit_budget, max_pages, is_enabled",
    )
    .eq("id", queryId)
    .is("deleted_at", null)
    .maybeSingle();

  if (queryError) return { ok: false, error: `discover_companies: ${queryError.message}` };
  if (!query) {
    /* Deleted between enqueue and claim. Not a failure — the work is moot. */
    return { ok: true, result: { skipped: "the search no longer exists" } };
  }

  const filters = query.filters as DiscoveryFilters;
  const maxPages = Number(query.max_pages ?? DEFAULT_MAX_PAGES);
  const creditBudget = Number(query.credit_budget ?? 100);

  /* ── The ICP, for exclusions ─────────────────────────────────────────
     Loaded even though the filters were built from it, because exclusions
     mostly cannot be pushed down to a provider and have to be applied here.
     A query with no ICP is legitimate — an ad-hoc search — and then there is
     nothing to exclude by. */
  let icp: Icp | null = null;
  if (query.icp_id) {
    const { data: icpRow } = await scope
      .select("icps", "criteria, negative_criteria")
      .eq("id", query.icp_id)
      .is("deleted_at", null)
      .maybeSingle();
    if (icpRow) {
      try {
        icp = parseIcp(icpRow.criteria, icpRow.negative_criteria);
      } catch (e) {
        /* A profile that cannot be parsed is a permanent failure, and it is
           better to say so than to search against an empty one — which is
           `ICP-01` reproduced at the cost of a provider call. */
        return {
          ok: false,
          permanent: true,
          error: `discover_companies: the ICP could not be read — ${e instanceof Error ? e.message : String(e)}`,
        };
      }
    }
  }

  /* ── The run ─────────────────────────────────────────────────────────
     Resumed when the payload names one — a retry after a crash — and created
     otherwise. Resuming rather than starting fresh is what makes a retry cost
     only the pages it has not read. */
  const run = await openRun(scope, queryId, String(payload.runId ?? "") || null);
  if (!run) {
    /* The unique index refused: a run is already live for this query. Not a
       failure; the work is already happening. */
    return { ok: true, result: { skipped: "a run of this search is already in progress" } };
  }

  await scope
    .update("discovery_runs", { status: "running", started_at: new Date().toISOString() })
    .eq("id", run.id);

  /* ── Read pages ──────────────────────────────────────────────────────── */

  let cursor: string | null = run.page_cursor;
  let pages = run.pages_fetched;
  let credits = 0;
  let total: number | null = run.total_available;
  let stopReason: string | null = null;
  let status = "succeeded";
  let error: string | null = null;
  const created: string[] = [];

  try {
    while (pages < maxPages) {
      if (credits >= creditBudget) {
        stopReason = "credit_budget";
        status = "partial";
        break;
      }

      const result = await searchCompanies(
        { db: OrgScope.global(), orgId: scope.orgId, entity: { type: "discovery_run", id: run.id } },
        {
          keywords: filters.keywords ?? [],
          industries: filters.industries ?? [],
          locations: filters.locations ?? [],
          employeeMin: filters.employeeMin ?? null,
          employeeMax: filters.employeeMax ?? null,
          revenueBands: filters.revenueBands ?? [],
          technologies: filters.technologies ?? [],
          excludeDomains: filters.excludeDomains ?? [],
          cursor,
          limit: PAGE_SIZE,
        },
      );

      credits += result.meta.credits;
      pages++;
      total = result.data.total ?? total;

      for (const [index, company] of result.data.items.entries()) {
        const outcome = await absorb(scope, {
          runId: run.id,
          queryId,
          provider: result.meta.provider,
          company,
          rank: (pages - 1) * PAGE_SIZE + index,
          icp,
          icpId: query.icp_id ? String(query.icp_id) : null,
        });
        if (outcome === "new" && created.length < MAX_AUTO_RESEARCH) {
          created.push(company.providerId);
        }
      }

      cursor = result.data.cursor;

      if (!result.data.partial || !cursor) {
        /* The provider has nothing more. The one path to `succeeded`. */
        stopReason = "exhausted";
        status = "succeeded";
        break;
      }

      /* Persist the cursor after every page, so a crash on page four does not
         re-read pages one to three. This is the write that makes the handler
         cheap to retry rather than merely safe to. */
      await scope
        .update("discovery_runs", { page_cursor: cursor, pages_fetched: pages })
        .eq("id", run.id);

      if (pages >= maxPages) {
        stopReason = "page_cap";
        status = "partial";
      }
    }

    if (!stopReason) {
      stopReason = "page_cap";
      status = "partial";
    }
  } catch (e) {
    if (e instanceof ProviderRefused) {
      /* Refused costs nothing and is not a failure of the search. The reason
         reaches the screen verbatim, so a customer sees "your credit
         allowance is used up" rather than "0 results". */
      status = "refused";
      stopReason =
        e.meta.refusal === "budget_exhausted"
          ? "org_budget"
          : e.meta.refusal === "breaker_open"
            ? "breaker_open"
            : e.meta.refusal === "no_provider"
              ? "no_provider"
              : "provider_error";
      error = e.meta.error;
    } else {
      /* A real failure. Results gathered before it are kept — they are real —
         and the run is `failed` with the provider's message, which is what
         stops it being read as an empty market. */
      status = "failed";
      stopReason = "provider_error";
      error = e instanceof Error ? e.message : String(e);
    }
  }

  await scope.rpc("finish_discovery_run", {
    p_run: run.id,
    p_status: status,
    p_stop_reason: stopReason,
    p_error: error,
    p_cursor: cursor,
    p_total: total,
  });

  /* ── Hand off ────────────────────────────────────────────────────────
     Research, not scoring. `research_company` gathers the evidence and
     enqueues `score_opportunity` itself, so the pipeline stays one chain
     rather than two things racing to write the same opportunity. */
  const { data: newCompanies } = await scope
    .select("discovery_results", "company_id")
    .eq("run_id", run.id)
    .eq("outcome", "new")
    .not("company_id", "is", null)
    .limit(MAX_AUTO_RESEARCH);

  let enqueued = 0;
  for (const row of (newCompanies ?? []) as Array<{ company_id: string }>) {
    const { created: didCreate } = await enqueue({
      orgId: scope.orgId,
      name: "research_company",
      payload: { companyId: row.company_id, icpId: query.icp_id ?? null },
      /* Keyed on the company rather than the run: the same company found by
         two searches should be researched once. */
      idempotencyKey: `research:${scope.orgId}:${row.company_id}`,
    });
    if (didCreate) enqueued++;
  }

  return {
    ok: status !== "failed",
    ...(status === "failed"
      ? { error: error ?? "the provider failed" }
      : {
          result: {
            status,
            stopReason,
            pages,
            credits,
            total,
            researchEnqueued: enqueued,
            ...(error ? { refusal: error } : {}),
          },
        }),
  } as JobOutcome;
}

interface OpenRun {
  id: string;
  page_cursor: string | null;
  pages_fetched: number;
  total_available: number | null;
}

/**
 * The run row, resumed or created.
 *
 * A 23505 from the insert is the `one_open_per_query` index doing its job:
 * another worker is already running this search. That is a success from this
 * caller's point of view — the work it wanted is happening — and returning
 * null rather than throwing is how the handler reports "already in progress"
 * instead of failing and retrying into the same conflict.
 */
async function openRun(scope: OrgScope, queryId: string, runId: string | null): Promise<OpenRun | null> {
  if (runId) {
    const { data } = await scope
      .select("discovery_runs", "id, page_cursor, pages_fetched, total_available")
      .eq("id", runId)
      .maybeSingle();
    if (data) return data as OpenRun;
  }

  const { data, error } = await scope
    .insert("discovery_runs", {
      channel: "provider",
      query_id: queryId,
      status: "queued",
      trigger: "scheduled",
    })
    .select("id, page_cursor, pages_fetched, total_available")
    .maybeSingle();

  if (error) {
    if (error.code === "23505") return null;
    throw new Error(`discover_companies: could not open a run — ${error.message}`);
  }

  return (data as OpenRun) ?? null;
}

type Absorbed = "new" | "matched" | "excluded" | "suppressed" | "invalid";

/**
 * One provider row → a `discovery_results` row, and maybe a company.
 *
 * ── Why the rejects are recorded too ─────────────────────────────────────
 *
 * They are the valuable ones. Without them, "why is this company not in my
 * list" has no answer, and an exclusion rule quietly filtering half the
 * market is invisible. `DSC-06`.
 *
 * ── The order of the checks ─────────────────────────────────────────────
 *
 * Cheapest and most certain first. `invalid` needs no queries. `excluded` is
 * a pure function. Only after both does anything touch the database, which
 * means a search returning three hundred rows against a tight exclusion list
 * does almost no work.
 */
async function absorb(
  scope: OrgScope,
  input: {
    runId: string;
    queryId: string;
    provider: string;
    company: ProviderCompany;
    rank: number;
    icp: Icp | null;
    icpId: string | null;
  },
): Promise<Absorbed> {
  const { company } = input;
  const domain = canonicalizeDomain(company.domain ?? company.website);

  const record = async (
    outcome: Absorbed,
    companyId: string | null,
    exclusionReason: string | null,
  ): Promise<Absorbed> => {
    await scope.upsert(
      "discovery_results",
      {
        run_id: input.runId,
        query_id: input.queryId,
        provider: input.provider,
        provider_id: company.providerId,
        raw_name: company.name,
        raw_domain: domain ?? company.domain,
        rank: input.rank,
        outcome,
        exclusion_reason: exclusionReason,
        company_id: companyId,
        matched_filters: [],
      },
      { onConflict: "run_id,provider,provider_id", ignoreDuplicates: true },
    );
    return outcome;
  };

  /* 1. Unusable. A company with no resolvable domain cannot be deduplicated,
        enriched or contacted, and creating it would put a row in the table
        that nothing can ever join to. Counted, because a provider returning
        30% of these is a fact about the provider. */
  if (!domain) return record("invalid", null, "The provider returned no usable domain.");

  /* 2. Excluded. A pure function over what the provider already told us — no
        queries, no model, no cost. */
  if (input.icp) {
    const verdict = isExcluded(
      {
        name: company.name,
        domain,
        industry: company.industry,
        country: company.country,
        region: company.region,
        employeeCount: company.employeeCount,
        businessModel: null,
        techStack: company.technologies,
        description: company.description,
      },
      input.icp.exclusions,
    );
    if (verdict.excluded) return record("excluded", null, verdict.reason);
  }

  /* 3. Already ours? `resolve_company` is one round trip and checks the
        domain and the provider id — so a company found last week under a
        different domain resolves rather than duplicating. */
  const { data: resolved } = await scope.rpc("resolve_company", {
    p_org: scope.orgId,
    p_domain: domain,
    p_provider: input.provider,
    p_provider_id: company.providerId,
  });

  const existingId = Array.isArray(resolved) && resolved.length
    ? String((resolved[0] as { company_id: string }).company_id)
    : null;

  if (existingId) {
    /* Seen before. Record the provider id if this is the first time it has
       arrived from this provider — that is what makes the next search resolve
       on the id rather than the domain. */
    await linkExternalId(scope, existingId, input.provider, company.providerId);
    return record("matched", existingId, null);
  }

  /* 4. New. */
  const companyId = await createCompany(scope, domain, company, input);
  if (!companyId) return record("invalid", null, "The company row could not be created.");
  return record("new", companyId, null);
}

async function createCompany(
  scope: OrgScope,
  domain: string,
  company: ProviderCompany,
  input: { provider: string; runId: string },
): Promise<string | null> {
  const { data, error } = await scope
    .upsert(
      "companies",
      {
        canonical_domain: domain,
        name: company.name,
        website: company.website,
        industry: company.industry,
        employee_count: company.employeeCount,
        revenue_band: company.revenueBand,
        country: company.country,
        region: company.region,
        description: company.description,
        tech_stack: company.technologies,
        funding: company.funding ?? {},
        discovered_via: `provider:${input.provider}`,
        discovery_run_id: input.runId,
      },
      { onConflict: "org_id,canonical_domain" },
    )
    .select("id")
    .maybeSingle();

  if (error || !data) return null;
  const companyId = String((data as { id: string }).id);

  /* The domain row, which is what makes the NEXT search resolve rather than
     duplicate. `0012`'s backfill covered rows that existed then; every row
     created from here on needs this, and forgetting it is the single most
     consequential omission available in this file. */
  await scope.upsert(
    "company_domains",
    {
      company_id: companyId,
      domain,
      kind: "primary",
      asserted_by: `provider:${input.provider}`,
      confidence: "high",
    },
    { onConflict: "org_id,domain", ignoreDuplicates: true },
  );

  await linkExternalId(scope, companyId, input.provider, company.providerId);
  return companyId;
}

async function linkExternalId(
  scope: OrgScope,
  companyId: string,
  provider: string,
  providerId: string,
): Promise<void> {
  await scope.upsert(
    "external_ids",
    {
      entity_type: "company",
      entity_id: companyId,
      provider,
      provider_id: providerId,
      last_seen_at: new Date().toISOString(),
    },
    { onConflict: "org_id,provider,provider_id", ignoreDuplicates: false },
  );
}
