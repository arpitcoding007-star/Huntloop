/**
 * `fetch_company_signals` — ask a provider what a company is hiring for, and
 * write each posting in as evidence.
 *
 * ── Why this is not a field on `enrich_company` ──────────────────────────
 *
 * `enrich_company` fills static attributes — industry, headcount, funding —
 * that change on the order of months and are cached for 30 days. A hiring
 * signal is the opposite: several rows per company, each with its own date
 * and its own citation, refreshed every 48 hours because staleness here is
 * dangerous rather than merely wasteful (`packages/providers/src/cache.ts`).
 * Folding the two together would mean either enrich_company runs every two
 * days — repricing every static field to match the volatile one — or signals
 * inherit a 30-day cache and go stale silently. Separate jobs, separate
 * cadences, same evidence table.
 *
 * ── Why every posting becomes its own evidence row ────────────────────────
 *
 * §7 again: "Company is hiring" is a weaker, vaguer claim than "Company
 * posted a Senior AE role in Austin on September 1st", and the vaguer version
 * is also unfalsifiable — nobody can check it. One row per posting, each with
 * the provider's own URL as `source_url` where one exists, keeps every claim
 * checkable individually rather than collapsing five postings into one
 * sentence nobody can verify.
 */
import { ProviderRefused, searchCompanySignals } from "@huntloop/providers";
import { OrgScope } from "../scope.ts";
import type { JobContext, JobOutcome } from "../registry.ts";

export interface FetchCompanySignalsPayload {
  companyId: string;
}

export async function fetchCompanySignals(ctx: JobContext): Promise<JobOutcome> {
  const { scope, payload } = ctx;
  const companyId = String(payload.companyId ?? "");
  if (!companyId) {
    return { ok: false, permanent: true, error: "fetch_company_signals: no companyId in payload." };
  }

  const { data: company, error } = await scope
    .select("companies", "id, canonical_domain, name")
    .eq("id", companyId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) return { ok: false, error: `fetch_company_signals: ${error.message}` };
  if (!company) return { ok: true, result: { skipped: "the company no longer exists" } };

  /* The job-postings resource is scoped to a provider id, not a domain (see
     the adapter). No id, no call — and no credit spent finding that out. */
  const { data: external } = await scope
    .select("external_ids", "provider, provider_id")
    .eq("entity_type", "company")
    .eq("entity_id", companyId)
    .eq("provider", "apollo")
    .limit(1);

  const providerId =
    Array.isArray(external) && external.length
      ? String((external[0] as { provider_id: string }).provider_id)
      : null;

  if (!providerId) {
    return { ok: true, result: { skipped: "no provider id on file for this company yet" } };
  }

  let result;
  try {
    result = await searchCompanySignals(
      { db: OrgScope.global(), orgId: scope.orgId, entity: { type: "company", id: companyId } },
      {
        companyDomain: String(company.canonical_domain ?? "") || null,
        companyName: String(company.name ?? "") || null,
        companyProviderId: providerId,
        kinds: ["hiring"],
        cursor: null,
        limit: 25,
      },
    );
  } catch (e) {
    if (e instanceof ProviderRefused) {
      return { ok: true, result: { skipped: e.meta.refusal, detail: e.meta.error } };
    }
    return { ok: false, error: `fetch_company_signals: ${e instanceof Error ? e.message : String(e)}` };
  }

  await scope.update("companies", { last_signal_checked_at: new Date().toISOString() }).eq("id", companyId);

  const postings = result.data.items;
  if (!postings.length) {
    return { ok: true, result: { found: 0, provider: result.meta.provider, credits: result.meta.credits } };
  }

  const observedAt = new Date().toISOString();
  const rows = postings.map((signal) => {
    const where = signal.location ? ` (${signal.location})` : "";
    const dept = signal.department ? `${signal.department} — ` : "";
    return {
      subject_type: "company",
      subject_id: companyId,
      claim: `Posted a job — ${dept}${signal.title}${where} — according to ${result.meta.provider}.`,
      /* A posting with a real URL is a fact with somewhere to check it; one
         without degrades to inference rather than being written as a fact
         with no citation — the same rule `enrich_company` applies to a
         provider claim it cannot construct a record URL for. */
      kind: signal.url ? "fact" : "inference",
      confidence: "medium",
      reliability: "provider_attested",
      source_url: signal.url,
      observed_at: signal.observedAt ?? observedAt,
      /* Distinguishes one posting from the next under the same dedup target.
         Falls back to the bare field when neither a provider id nor a URL is
         available to key on — a real but rare limitation, worth naming
         rather than hiding: two such postings for the same company collapse
         into one evidence row. */
      field: signal.providerId ? `hiring_signal:${signal.providerId}` : "hiring_signal",
    };
  });

  await scope.upsert("evidence", rows, {
    onConflict: "org_id,subject_type,subject_id,field,source_id,source_url",
    ignoreDuplicates: false,
  });

  await scope.rpc("flag_contradictions", {
    p_org: scope.orgId,
    p_subject_type: "company",
    p_subject: companyId,
  });

  return {
    ok: true,
    result: {
      found: postings.length,
      provider: result.meta.provider,
      credits: result.meta.credits,
      cached: result.meta.outcome === "cache_hit",
    },
  };
}
