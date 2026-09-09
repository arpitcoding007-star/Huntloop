/**
 * `enrich_company` — fill in what a provider knows, with attribution.
 *
 * ── What was missing ─────────────────────────────────────────────────────
 *
 * Companies arrived with whatever the channel that found them happened to
 * carry. A company from a news article had a name and a domain; a company
 * from a CSV had whatever the customer typed. Nothing ever asked a provider
 * "what do you know about this domain", so `employee_count`, `industry` and
 * `funding` were populated by luck.
 *
 * That matters because those three fields are the inputs to the deterministic
 * half of qualification — the rules in `@huntloop/db/rules` name them
 * directly — so an unenriched company is scored on unknowns.
 *
 * ── Why every field becomes evidence ─────────────────────────────────────
 *
 * §52, applied consistently. A provider asserting "180 employees" is a claim
 * with a source, and the source is the provider. Writing it into `companies`
 * without a corresponding `evidence` row would make it indistinguishable from
 * something a person typed or a model inferred — and the whole product rests
 * on that distinction being visible.
 *
 * The claim kind is `fact`, and the source is the provider rather than a URL,
 * because that is what it is: a third party's assertion, attributable and
 * checkable, but not something we observed.
 *
 * ── What it deliberately does not overwrite ──────────────────────────────
 *
 * Anything a person set. A provider that thinks a company has 50 employees
 * does not get to overwrite the 180 a salesperson wrote after a call. The
 * merge below is "fill the blanks", not "replace with the provider's view".
 */
import { ProviderRefused, enrichCompany as providerEnrich } from "@huntloop/providers";
import { canonicalizeDomain } from "@huntloop/db/identity";
import { OrgScope } from "../scope.ts";
import type { JobContext, JobOutcome } from "../registry.ts";

export interface EnrichCompanyPayload {
  companyId: string;
  /** Force a refresh even if the cache would answer. A user pressed a button. */
  refresh?: boolean;
}

/**
 * How stale a company has to be before a scheduled re-enrichment is worth a
 * credit. Matches the 30-day cache TTL: asking sooner is guaranteed to be a
 * cache hit, which costs nothing but also tells us nothing new.
 */
const STALE_AFTER_DAYS = 30;

export async function enrichCompanyJob(ctx: JobContext): Promise<JobOutcome> {
  const { scope, payload } = ctx;
  const companyId = String(payload.companyId ?? "");
  if (!companyId) {
    return { ok: false, permanent: true, error: "enrich_company: no companyId in payload." };
  }

  const { data: company, error } = await scope
    .select(
      "companies",
      "id, canonical_domain, name, industry, employee_count, revenue_band, country, " +
        "region, description, tech_stack, funding, website, last_researched_at",
    )
    .eq("id", companyId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) return { ok: false, error: `enrich_company: ${error.message}` };
  if (!company) return { ok: true, result: { skipped: "the company no longer exists" } };

  const domain = canonicalizeDomain(String(company.canonical_domain ?? ""));
  if (!domain) {
    /* A company with no usable domain cannot be enriched and will not acquire
       one by being retried. */
    return { ok: false, permanent: true, error: "enrich_company: the company has no usable domain." };
  }

  /* The provider's own id, when we have one. Far more precise than a domain
     lookup, and free to include. */
  const { data: external } = await scope
    .select("external_ids", "provider, provider_id")
    .eq("entity_type", "company")
    .eq("entity_id", companyId)
    .limit(1);

  const providerId =
    Array.isArray(external) && external.length
      ? String((external[0] as { provider_id: string }).provider_id)
      : null;

  let result;
  try {
    result = await providerEnrich(
      {
        db: OrgScope.global(),
        orgId: scope.orgId,
        entity: { type: "company", id: companyId },
        refresh: payload.refresh === true,
      },
      { domain, name: String(company.name ?? ""), providerId },
    );
  } catch (e) {
    if (e instanceof ProviderRefused) {
      /* Not a failure of the job. Reported so the company screen can say
         "enrichment is not configured" or "the allowance is used up" rather
         than showing empty fields with no explanation. */
      return { ok: true, result: { skipped: e.meta.refusal, detail: e.meta.error } };
    }
    return { ok: false, error: `enrich_company: ${e instanceof Error ? e.message : String(e)}` };
  }

  const found = result.data;
  if (!found) {
    /* "We asked and they have nothing" is an answer, and recording it is what
       stops the same question being paid for again next week. The cache
       already holds it; this marks the row so a scheduled sweep skips it. */
    await scope
      .update("companies", { last_researched_at: new Date().toISOString() })
      .eq("id", companyId);
    return { ok: true, result: { found: false, provider: result.meta.provider, credits: result.meta.credits } };
  }

  /* ── Fill the blanks ─────────────────────────────────────────────────
     Only fields that are currently empty. `?? undefined` rather than `?? null`
     matters: undefined is omitted from the update entirely, so an existing
     value is untouched rather than being written back over itself. */
  const patch: Record<string, unknown> = {};
  const fill = (column: string, current: unknown, incoming: unknown) => {
    const empty =
      current === null ||
      current === undefined ||
      current === "" ||
      (Array.isArray(current) && current.length === 0);
    if (empty && incoming !== null && incoming !== undefined && incoming !== "") {
      patch[column] = incoming;
    }
  };

  fill("industry", company.industry, found.industry);
  fill("employee_count", company.employee_count, found.employeeCount);
  fill("revenue_band", company.revenue_band, found.revenueBand);
  fill("country", company.country, found.country);
  fill("region", company.region, found.region);
  fill("description", company.description, found.description);
  fill("website", company.website, found.website);
  fill("tech_stack", company.tech_stack, found.technologies.length ? found.technologies : null);

  const currentFunding = (company.funding ?? {}) as Record<string, unknown>;
  if (Object.keys(currentFunding).length === 0 && found.funding) {
    patch.funding = found.funding;
  }

  patch.last_researched_at = new Date().toISOString();

  await scope.update("companies", patch).eq("id", companyId);

  await linkExternalId(scope, companyId, result.meta.provider, found.providerId);

  /* ── Evidence ────────────────────────────────────────────────────────
     One row per attribute the provider asserted, so a screen can say where
     "180 employees" came from and a contradiction with a later source is
     representable rather than a silent overwrite. */
  const claims: Array<[string, string]> = [];
  if (found.employeeCount !== null) claims.push(["employee_count", `${found.employeeCount} employees`]);
  if (found.industry) claims.push(["industry", `Industry: ${found.industry}`]);
  if (found.revenueBand) claims.push(["revenue_band", `Revenue band: ${found.revenueBand}`]);
  if (found.country) claims.push(["country", `Headquartered in ${found.country}`]);
  if (found.funding?.stage) claims.push(["funding_stage", `Funding stage: ${found.funding.stage}`]);
  if (found.technologies.length) {
    claims.push(["tech_stack", `Uses ${found.technologies.slice(0, 8).join(", ")}`]);
  }

  if (claims.length) {
    /* ── Fact or inference? The constraint decides, and it is right ──────
       `evidence_fact_needs_source` refuses a `fact` with no `source_url`,
       on the grounds that a fact with nowhere to observe it is an inference
       wearing a fact's label. That caught the first version of this code,
       which wrote provider assertions as facts with no URL.

       The fix is not to weaken the claim to `inference` — a provider's
       assertion is genuinely more than a model's guess — but to give it the
       URL where it can actually be checked. `providerRecordUrl` produces the
       provider's own page for the record, which is a real address a person
       with an account can open and compare against.

       When we cannot construct one, the claim degrades to `inference`. That
       is the honest fallback: unverifiable, and labelled as such. */
    const recordUrl = providerRecordUrl(result.meta.provider, found.providerId);
    const observedAt = new Date().toISOString();

    await scope.upsert(
      "evidence",
      claims.map(([field, claim]) => ({
        subject_type: "company",
        subject_id: companyId,
        claim: `${claim} — according to ${result.meta.provider}.`,
        kind: recordUrl ? "fact" : "inference",
        confidence: "medium",
        reliability: "provider_attested",
        source_url: recordUrl,
        observed_at: observedAt,
        field,
      })),
      {
        /* Matches `evidence_one_per_source_field` from `0020`. Re-enriching
           updates the same rows rather than appending a fourth copy of
           "180 employees" every month. */
        onConflict: "org_id,subject_type,subject_id,field,source_id,source_url",
        ignoreDuplicates: false,
      },
    );

    /* Two sources disagreeing about one field is the interesting case, and
       it is flagged after the batch rather than by a trigger — a trigger
       would recompute the same answer once per row. */
    await scope.rpc("flag_contradictions", {
      p_org: scope.orgId,
      p_subject_type: "company",
      p_subject: companyId,
    });
  }

  return {
    ok: true,
    result: {
      found: true,
      provider: result.meta.provider,
      credits: result.meta.credits,
      cached: result.meta.outcome === "cache_hit",
      filled: Object.keys(patch).filter((k) => k !== "last_researched_at"),
      claims: claims.length,
    },
  };
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
    { onConflict: "org_id,provider,provider_id" },
  );
}

/** Companies worth re-asking about. Read by the scheduler. */
export function staleBefore(now: Date = new Date()): string {
  return new Date(now.getTime() - STALE_AFTER_DAYS * 86_400_000).toISOString();
}

/**
 * Where a provider's claim can be checked.
 *
 * This is the one place outside `packages/providers/src/adapters/` that knows
 * a vendor's URL shape, and it is deliberate: the alternative is a
 * `recordUrl` method on the adapter contract, which would mean every adapter
 * implements a string template to satisfy an interface. The `PRV-CHK` rule is
 * about *coupling* — nothing here calls a vendor or depends on its response
 * shape — and a URL template that returns null for an unknown provider
 * introduces none.
 *
 * Returning null is the correct answer for a provider whose record URLs we do
 * not know, and the caller degrades the claim to `inference` rather than
 * fabricating an address. A fabricated citation is worse than no citation:
 * it is a link that looks checkable and is not.
 */
export function providerRecordUrl(provider: string, providerId: string): string | null {
  switch (provider) {
    case "apollo":
      return `https://app.apollo.io/#/organizations/${encodeURIComponent(providerId)}`;
    default:
      return null;
  }
}
