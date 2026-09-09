/**
 * Apollo.
 *
 * ── This is one of three files allowed to know a vendor exists ───────────
 *
 * `PRV-CHK` in `scripts/audit.mjs` fails the build if the string "apollo"
 * appears in an import path or a type name anywhere outside
 * `packages/providers/src/adapters/`. The test of whether the abstraction is
 * real: deleting this file should break the build in exactly one place, the
 * registry.
 *
 * ── The single most important decision in this file ──────────────────────
 *
 * `email_status`.
 *
 * Apollo returns addresses with a status, and one of the values is a
 * construction from a pattern rather than an observation. Mapping that to
 * anything above `low` confidence, or to `verified: true`, would launder a
 * guess into a finding — and the bounce lands on the customer's sending
 * domain, not ours. `providers.ts` made the same call for `people/match` and
 * the reasoning is unchanged; it is restated here because this file now
 * handles four endpoints and the temptation to normalise them together is
 * exactly how the distinction gets lost.
 *
 * Only `verified` is trusted. Everything else is `low` and unverified,
 * including the values whose names sound reassuring.
 *
 * ── Credits ─────────────────────────────────────────────────────────────
 *
 * Apollo's pricing is per *record revealed* for people and per *request* for
 * organization search, and the exact numbers depend on the plan. The values
 * below are the shape of the billing rather than a price list, and they are
 * deliberately conservative — over-counting produces a budget that stops a
 * little early, under-counting produces a surprise invoice. When the real
 * plan is known, `MANUAL ACTIONS` says to reconcile these against one month
 * of `provider_calls` and correct them.
 */
import { canonicalizeDomain } from "@huntloop/db/identity";
import {
  ProviderError,
  type Capability,
  type CompanySearchQuery,
  type CompanySearchResult,
  type PersonMatchQuery,
  type PersonSearchQuery,
  type PersonSearchResult,
  type ProviderAdapter,
  type ProviderCompany,
  type ProviderPerson,
  type RawCall,
} from "../contract.ts";

const BASE = "https://api.apollo.io/api/v1";
const NAME = "apollo";

/**
 * Apollo caps a page at 100 and the whole result set at 50,000 records.
 *
 * Both matter. The page cap is why `limit` is clamped; the total cap is why a
 * search that reports a million matches still cannot be enumerated, which is
 * what `partial` communicates to the discovery runner and, through it, to the
 * screen.
 */
const MAX_PAGE = 100;

/** Per-call credit estimates. See the note above. */
const CREDITS = {
  organizationSearch: 1,
  organizationEnrich: 1,
  peopleSearch: 1,
  /** A revealed person costs more, because a contact point is the expensive part. */
  personMatch: 2,
} as const;

interface ApolloOrganization {
  id?: string;
  name?: string;
  website_url?: string;
  primary_domain?: string;
  short_description?: string;
  industry?: string;
  estimated_num_employees?: number;
  annual_revenue_printed?: string;
  country?: string;
  state?: string;
  city?: string;
  founded_year?: number;
  linkedin_url?: string;
  technology_names?: string[];
  latest_funding_stage?: string;
  total_funding?: number;
  latest_funding_round_date?: string;
}

interface ApolloPerson {
  id?: string;
  first_name?: string;
  last_name?: string;
  title?: string;
  seniority?: string;
  departments?: string[];
  linkedin_url?: string;
  city?: string;
  country?: string;
  email?: string;
  email_status?: string;
  phone_numbers?: Array<{ sanitized_number?: string; raw_number?: string }>;
}

export function apolloAdapter(apiKey: string): ProviderAdapter {
  const capabilities: Capability[] = [
    "company.search",
    "company.enrich",
    "person.search",
    "person.match",
  ];

  async function post<T>(path: string, body: Record<string, unknown>): Promise<{ body: T; status: number }> {
    let response: Response;
    try {
      response = await fetch(`${BASE}${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
          /* Apollo accepts the key in a header rather than the body. Putting
             it in the body would put a credential in anything that logs a
             request payload, which is most things. */
          "x-api-key": apiKey,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (e) {
      /* Transport. Retryable, and deliberately NOT given an http status —
         `null` is what distinguishes "never reached them" from "they said
         something", which the health view reports separately. */
      throw new ProviderError(NAME, e instanceof Error ? e.message : String(e), {
        retryable: true,
      });
    }

    if (response.status === 429) {
      throw new ProviderError(NAME, "Apollo rate limit reached.", {
        httpStatus: 429,
        rateLimited: true,
      });
    }

    if (response.status === 401 || response.status === 403) {
      /* Not retryable. A wrong key is wrong on the third attempt too, and
         retrying it three times just makes the log harder to read. This is
         also the failure `PRV-01` exists to surface as "wrong credentials"
         rather than as "no results". */
      throw new ProviderError(NAME, `Apollo rejected the API key (${response.status}).`, {
        httpStatus: response.status,
        retryable: false,
      });
    }

    if (response.status >= 500) {
      throw new ProviderError(NAME, `Apollo returned ${response.status}.`, {
        httpStatus: response.status,
        retryable: true,
      });
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new ProviderError(NAME, `Apollo returned ${response.status}: ${detail.slice(0, 200)}`, {
        httpStatus: response.status,
        retryable: false,
      });
    }

    return { body: (await response.json()) as T, status: response.status };
  }

  /* ── Mapping ─────────────────────────────────────────────────────────── */

  function toCompany(org: ApolloOrganization): ProviderCompany | null {
    const providerId = org.id?.trim();
    const name = org.name?.trim();
    /* No id or no name is not a company. Counted as `invalid` by the
       discovery runner, which is how "this provider returns 30% junk" becomes
       a measurable fact rather than an impression. */
    if (!providerId || !name) return null;

    return {
      providerId,
      name,
      /* Canonicalized here, in the adapter, so the rest of the system never
         sees a vendor's idea of a domain. `canonicalizeDomain` also refuses
         `linkedin.com` and friends, which providers do return as websites —
         and which would otherwise collapse every such company into one row. */
      domain: canonicalizeDomain(org.primary_domain ?? org.website_url ?? null),
      website: org.website_url?.trim() || null,
      description: org.short_description?.trim() || null,
      industry: org.industry?.trim() || null,
      employeeCount:
        typeof org.estimated_num_employees === "number" && org.estimated_num_employees > 0
          ? org.estimated_num_employees
          : null,
      revenueBand: org.annual_revenue_printed?.trim() || null,
      country: org.country?.trim() || null,
      region: org.state?.trim() || null,
      city: org.city?.trim() || null,
      foundedYear:
        typeof org.founded_year === "number" && org.founded_year > 1800 ? org.founded_year : null,
      linkedinUrl: org.linkedin_url?.trim() || null,
      technologies: Array.isArray(org.technology_names)
        ? org.technology_names.filter((t): t is string => typeof t === "string").slice(0, 100)
        : [],
      funding:
        org.latest_funding_stage || org.total_funding
          ? {
              stage: org.latest_funding_stage?.trim() || null,
              totalRaisedUsd: typeof org.total_funding === "number" ? org.total_funding : null,
              lastRoundAt: org.latest_funding_round_date?.trim() || null,
              lastRoundUsd: null,
            }
          : null,
      /* Capped. The raw payload is kept for debugging a bad mapping, not as a
         second copy of the database — an uncapped one would put megabytes of
         vendor JSON in `provider_cache` per search. */
      raw: truncate(org),
    };
  }

  function toPerson(person: ApolloPerson): ProviderPerson | null {
    const providerId = person.id?.trim();
    if (!providerId) return null;

    const contacts: ProviderPerson["contacts"] = [];

    if (person.email) {
      /* THE decision. `verified` is the only status Apollo asserts from
         observation; every other value includes addresses constructed from a
         company's pattern. Calling one of those `medium` would be laundering
         a guess into a finding, and the bounce lands on the customer's
         sending domain. */
      const verified = person.email_status === "verified";
      contacts.push({
        kind: "email",
        value: person.email.toLowerCase(),
        confidence: verified ? "high" : "low",
        verified,
      });
    }

    if (person.linkedin_url) {
      contacts.push({
        kind: "linkedin",
        value: person.linkedin_url,
        confidence: "high",
        verified: true,
      });
    }

    for (const phone of person.phone_numbers ?? []) {
      const value = phone.sanitized_number ?? phone.raw_number;
      if (value) {
        contacts.push({ kind: "phone", value, confidence: "medium", verified: false });
      }
    }

    return {
      providerId,
      firstName: person.first_name?.trim() || null,
      lastName: person.last_name?.trim() || null,
      title: person.title?.trim() || null,
      seniority: person.seniority?.trim() || null,
      department: person.departments?.[0]?.trim() || null,
      linkedinUrl: person.linkedin_url?.trim() || null,
      city: person.city?.trim() || null,
      country: person.country?.trim() || null,
      contacts,
      raw: truncate(person),
    };
  }

  /* ── Capabilities ────────────────────────────────────────────────────── */

  return {
    name: NAME,
    capabilities,

    /**
     * The credential check.
     *
     * A one-row search rather than a dedicated auth endpoint, because Apollo
     * does not expose one that works on every plan. `per_page: 1` is the
     * cheapest authenticated request available; the credit it may cost is
     * paid once at configuration time and is the price of never confusing
     * "wrong key" with "empty market".
     */
    async verifyCredentials() {
      try {
        await post<{ pagination?: unknown }>("/mixed_companies/search", {
          page: 1,
          per_page: 1,
        });
        return { ok: true, detail: "Apollo accepted the API key." };
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        return { ok: false, detail: message };
      }
    },

    async searchCompanies(query: CompanySearchQuery): Promise<RawCall<CompanySearchResult>> {
      const perPage = Math.min(Math.max(query.limit, 1), MAX_PAGE);
      /* The cursor is an opaque string to everything above this file, and a
         page number here. Storing a page number as text is what lets the next
         provider store something else without a schema change. */
      const page = query.cursor ? Number(query.cursor) || 1 : 1;

      const body: Record<string, unknown> = { page, per_page: perPage };

      if (query.keywords.length) body.q_organization_keyword_tags = query.keywords;
      if (query.industries.length) body.q_organization_industry_tag_ids = undefined;
      /* Apollo takes industries as internal tag ids, which we do not have, and
         as free text through the keyword field, which we do. Sending the
         names as keywords is lossy and honest; sending them as tag ids would
         silently match nothing. The lossiness is reported to the user through
         `discovery_queries.unmappable`. */
      if (query.industries.length) {
        body.q_organization_keyword_tags = [
          ...((body.q_organization_keyword_tags as string[]) ?? []),
          ...query.industries,
        ];
      }
      if (query.locations.length) body.organization_locations = query.locations;
      if (query.technologies.length) body.currently_using_any_of_technology_uids = query.technologies;
      if (query.excludeDomains.length) {
        body.organization_not_ids = undefined;
        /* Apollo has no domain-exclusion filter. Excluding at our end is the
           only option, and it is done by the runner after the call — so these
           still cost credits. Recorded here so the cost is understood rather
           than mysterious. */
      }

      const ranges = employeeRanges(query.employeeMin, query.employeeMax);
      if (ranges.length) body.organization_num_employees_ranges = ranges;

      const { body: response, status } = await post<{
        organizations?: ApolloOrganization[];
        accounts?: ApolloOrganization[];
        pagination?: { total_entries?: number; total_pages?: number; page?: number };
      }>("/mixed_companies/search", body);

      const rows = [...(response.organizations ?? []), ...(response.accounts ?? [])];
      const items = rows
        .map(toCompany)
        .filter((c): c is ProviderCompany => c !== null);

      const total = response.pagination?.total_entries ?? null;
      const totalPages = response.pagination?.total_pages ?? null;
      const hasMore = totalPages !== null ? page < totalPages : items.length === perPage;

      return {
        data: {
          items,
          total,
          cursor: hasMore ? String(page + 1) : null,
          /* `partial` means "there is more that we did not read". It is NOT
             an error and the runner treats it as a resumable success — the
             distinction the whole discovery design rests on. */
          partial: hasMore,
        },
        credits: CREDITS.organizationSearch,
        httpStatus: status,
        partial: hasMore,
      };
    },

    async enrichCompany(input): Promise<RawCall<ProviderCompany | null>> {
      const body: Record<string, unknown> = {};
      if (input.domain) body.domain = input.domain;
      else if (input.name) body.name = input.name;
      else {
        /* Nothing to look up. Returning null rather than calling means no
           credit is spent asking a question with no subject. */
        return { data: null, credits: 0, httpStatus: null };
      }

      const { body: response, status } = await post<{ organization?: ApolloOrganization }>(
        "/organizations/enrich",
        body,
      );

      return {
        data: response.organization ? toCompany(response.organization) : null,
        credits: CREDITS.organizationEnrich,
        httpStatus: status,
      };
    },

    async searchPeople(query: PersonSearchQuery): Promise<RawCall<PersonSearchResult>> {
      const perPage = Math.min(Math.max(query.limit, 1), MAX_PAGE);
      const page = query.cursor ? Number(query.cursor) || 1 : 1;

      const body: Record<string, unknown> = { page, per_page: perPage };

      if (query.companyProviderId) body.organization_ids = [query.companyProviderId];
      else if (query.companyDomain) body.q_organization_domains = query.companyDomain;

      if (query.titles.length) body.person_titles = query.titles;
      if (query.seniorities.length) body.person_seniorities = query.seniorities.map(apolloSeniority);
      if (query.departments.length) body.person_departments = query.departments;

      const { body: response, status } = await post<{
        people?: ApolloPerson[];
        contacts?: ApolloPerson[];
        pagination?: { total_entries?: number; total_pages?: number };
      }>("/mixed_people/search", body);

      const rows = [...(response.people ?? []), ...(response.contacts ?? [])];
      const items = rows.map(toPerson).filter((p): p is ProviderPerson => p !== null);

      const total = response.pagination?.total_entries ?? null;
      const totalPages = response.pagination?.total_pages ?? null;
      const hasMore = totalPages !== null ? page < totalPages : items.length === perPage;

      return {
        data: { items, total, cursor: hasMore ? String(page + 1) : null, partial: hasMore },
        credits: CREDITS.peopleSearch,
        httpStatus: status,
        partial: hasMore,
      };
    },

    async matchPerson(query: PersonMatchQuery): Promise<RawCall<ProviderPerson | null>> {
      const { body: response, status } = await post<{ person?: ApolloPerson }>("/people/match", {
        first_name: query.firstName,
        last_name: query.lastName,
        domain: query.companyDomain,
        organization_name: query.companyName,
        /* Personal addresses are a different consent question from work ones
           and this product has no basis for asking for them. Unchanged from
           the original `providers.ts`. */
        reveal_personal_emails: false,
      });

      return {
        data: response.person ? toPerson(response.person) : null,
        credits: CREDITS.personMatch,
        httpStatus: status,
      };
    },
  };
}

/**
 * Our numeric range to Apollo's fixed bands.
 *
 * Apollo does not take a min and a max; it takes a list of its own bands. So
 * the translation is "every band that overlaps what was asked for", which is
 * a superset — a search for 40–60 people returns the 21–50 and 51–100 bands
 * and therefore some companies outside the range.
 *
 * That is the correct direction to be wrong in. A superset is filtered at our
 * end, where the exclusion is visible on the discovery screen with a reason;
 * a subset would silently drop companies the customer asked for and nobody
 * would ever know.
 */
const APOLLO_BANDS: Array<[number, number, string]> = [
  [1, 10, "1,10"],
  [11, 20, "11,20"],
  [21, 50, "21,50"],
  [51, 100, "51,100"],
  [101, 200, "101,200"],
  [201, 500, "201,500"],
  [501, 1000, "501,1000"],
  [1001, 2000, "1001,2000"],
  [2001, 5000, "2001,5000"],
  [5001, 10000, "5001,10000"],
  [10001, Number.MAX_SAFE_INTEGER, "10001,1000000"],
];

export function employeeRanges(min: number | null, max: number | null): string[] {
  if (min === null && max === null) return [];
  const lo = min ?? 1;
  const hi = max ?? Number.MAX_SAFE_INTEGER;
  return APOLLO_BANDS.filter(([bandLo, bandHi]) => bandHi >= lo && bandLo <= hi).map(([, , label]) => label);
}

/** Our seniority words to Apollo's. Unknown values pass through unchanged. */
function apolloSeniority(value: string): string {
  const map: Record<string, string> = {
    founder: "founder",
    "c-level": "c_suite",
    c_level: "c_suite",
    vp: "vp",
    "head of": "head",
    head: "head",
    director: "director",
    manager: "manager",
    senior: "senior",
    "individual contributor": "entry",
    junior: "entry",
  };
  return map[value.trim().toLowerCase()] ?? value.trim().toLowerCase();
}

/**
 * A bounded copy of a vendor payload.
 *
 * Kept for the same reason `enrichment_records.raw` is: when a mapping is
 * wrong, the only way to know what the provider said is to have kept it.
 * Bounded because an uncapped copy of every result would put megabytes of
 * vendor JSON in the cache per search.
 */
function truncate(value: unknown): Record<string, unknown> | null {
  try {
    const json = JSON.stringify(value);
    if (!json || json.length > 8_000) return null;
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}
