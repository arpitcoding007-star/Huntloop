/**
 * `enrich_person` — find and verify a way to reach a decision maker.
 *
 * ── The shape of the integration, and why it is written this way ─────────
 *
 * There is no enrichment provider chosen for this product, and this file does
 * not choose one. What it does is fix the *contract*: given a person and a
 * company domain, a provider returns candidate contact points, each with a
 * confidence and a provider name; given an address, a verifier returns
 * deliverable / undeliverable / unknown.
 *
 * `providers.ts` maps whichever vendor is configured onto that contract. This
 * handler is the same regardless, and — the part that matters — the *rules*
 * live here rather than in the vendor adapter:
 *
 *   · §25: a guessed address and a verified one are not the same fact. Both
 *     are stored, with their provenance, and the UI can say which it has.
 *   · §58: preserve evidence and confidence instead of overwriting. Every
 *     provider answer is its own `enrichment_records` row; the resolution
 *     happens on read.
 *   · Cost is metered per call, in cents, on the row that caused it.
 *
 * With nothing configured the job reports that and stops. It does not guess an
 * address from a name and a domain — first.last@company.com is a plausible
 * string with no evidence behind it, and §7 does not have an exception for
 * "everybody does it".
 */
import { embedded } from "../scope.ts";
import { verifyEmail, findContacts, enrichmentProvider } from "../providers.ts";
import type { JobContext, JobOutcome } from "../registry.ts";

export interface EnrichPayload {
  personId: string;
}

export async function enrichPerson(ctx: JobContext): Promise<JobOutcome> {
  const { scope, payload } = ctx;
  const personId = String(payload.personId ?? "");
  if (!personId) {
    return { ok: false, permanent: true, error: "enrich_person: no personId in payload." };
  }

  const { data: person, error } = await scope.select("people", "id, first_name, last_name, title, company_id, companies!inner(canonical_domain, name)")
    .eq("id", personId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) return { ok: false, error: `enrich_person: ${error.message}` };
  if (!person) return { ok: true, result: { skipped: "the person no longer exists" } };

  const company = embedded(person.companies);
  const domain = String(company?.canonical_domain ?? "");
  if (!domain) {
    return { ok: false, permanent: true, error: "enrich_person: the company has no domain." };
  }

  const quota = await scope.rpc("check_quota_internal", {
    p_org: scope.orgId,
    p_metric: "enrich",
  });
  const quotaRow = (Array.isArray(quota.data) ? quota.data[0] : quota.data) as
    | { allowed?: boolean; used?: number; quota?: number | null }
    | undefined;
  if (quotaRow && quotaRow.allowed === false) {
    return {
      ok: true,
      result: {
        skipped:
          `this organisation has used ${quotaRow.used} of its ${quotaRow.quota} ` +
          `enrichments this month`,
      },
    };
  }

  const provider = enrichmentProvider();
  if (!provider) {
    return {
      ok: true,
      result: {
        skipped:
          "No enrichment provider is configured (ENRICHMENT_API_KEY). Contact " +
          "details can still be added by hand or imported from CSV.",
      },
    };
  }

  const candidates = await findContacts({
    firstName: person.first_name ?? null,
    lastName: person.last_name ?? null,
    title: person.title ?? null,
    companyDomain: domain,
    companyName: String(company?.name ?? domain),
  });

  if (candidates.length === 0) {
    /* Recorded as an answer, not as nothing. Without this row the next run
       asks the same provider the same question and pays for the same silence
       — and the screen cannot distinguish "we looked and found nothing" from
       "we never looked", which §7 says are different states. */
    await scope.insert("enrichment_records", {
      entity_type: "person",
      entity_id: personId,
      provider,
      field: "email",
      value: null,
      confidence: null,
      cost_cents: 0,
    });
    await scope.rpc("increment_usage_internal", {
      p_org: scope.orgId,
      p_metric: "enrich",
      p_amount: 1,
    });
    return { ok: true, result: { found: 0, provider } };
  }

  let stored = 0;
  let verified = 0;

  for (const candidate of candidates) {
    /* Every answer, from every provider, as its own row (§58). The read side
       resolves them; the write side never clobbers, because a later provider
       being wrong would silently erase an earlier one that was right. */
    await scope.insert("enrichment_records", {
      entity_type: "person",
      entity_id: personId,
      provider: candidate.provider,
      field: candidate.kind,
      value: candidate.value,
      confidence: candidate.confidence,
      cost_cents: candidate.costCents,
      raw: candidate.raw ?? null,
    });

    let status = "unverified";
    let verifiedAt: string | null = null;

    if (candidate.kind === "email") {
      const verdict = await verifyEmail(candidate.value);
      status = verdict.status;
      // Only a *positive* verification gets a timestamp. "We checked and it
      // bounced" and "we checked and could not tell" are both checks, and
      // neither is a verified address — the column says when it was proven.
      if (verdict.status === "deliverable") {
        verifiedAt = new Date().toISOString();
        verified++;
      }
    }

    /* Unique on (org_id, kind, value): the same address found twice by two
       providers is one contact point. Upserting rather than inserting keeps
       that true without the handler having to know which provider ran first. */
    const { error: upsertError } = await scope.upsert(
      "contact_points",
      {
        person_id: personId,
        kind: candidate.kind,
        value: candidate.value,
        verification_status: status,
        confidence: candidate.confidence,
        provider: candidate.provider,
        verified_at: verifiedAt,
      },
      { onConflict: "org_id,kind,value" },
    );
    if (!upsertError) stored++;
  }

  await scope.rpc("increment_usage_internal", {
    p_org: scope.orgId,
    p_metric: "enrich",
    p_amount: 1,
  });

  return { ok: true, result: { found: candidates.length, stored, verified, provider } };
}
