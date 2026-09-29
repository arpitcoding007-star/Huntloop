/**
 * `sync_hubspot` — push one opportunity out, and notice what came back.
 *
 * ── Why "push the opportunity" rather than "sync everything" ─────────────
 *
 * A HubSpot company or contact with no opportunity behind it is exactly the
 * kind of undifferentiated list this product exists not to produce (§6: ten
 * excellent opportunities over a thousand weak leads). Syncing is triggered
 * per opportunity — a rep pushing the ones worth a CRM record — not as a bulk
 * export of every company Huntloop has ever seen. `schedule_syncs` (existing)
 * can fan this out on a cadence once that is wanted; nothing here assumes it
 * runs any way but one opportunity at a time.
 *
 * ── Why a deal is only ever created once ──────────────────────────────────
 *
 * `external_ids` is checked before `createDeal` is ever called. A deal has no
 * natural search key (see `@huntloop/crm`'s file header), so the only thing
 * standing between "sync twice" and "two deals for one opportunity" is
 * remembering the id from the first push — which is precisely what
 * `external_ids` is for, reused rather than reinvented.
 *
 * ── What a HubSpot stage change becomes here ──────────────────────────────
 *
 * An evidence row, not a write to `opportunities.status`. HubSpot's stage is
 * a real, citable fact about what a rep did in their CRM — and §52 applies to
 * it exactly as it applies to a provider's claim about headcount: it is
 * recorded with its source, not silently promoted into overwriting a status
 * this product's own scoring engine is responsible for. See the roadmap for
 * the two-way sync this deliberately is not, yet.
 */
import {
  CrmError,
  associate,
  createDeal,
  ensureDealProperties,
  getDealStage,
  updateDealHuntloopFields,
  upsertCompany,
  upsertContact,
} from "@huntloop/crm";
import { decryptSecret } from "@huntloop/db";
import { OrgScope } from "../scope.ts";
import type { JobContext, JobOutcome } from "../registry.ts";

export interface SyncHubspotPayload {
  opportunityId: string;
}

const PROVIDER = "hubspot";

export async function syncHubspot(ctx: JobContext): Promise<JobOutcome> {
  const { scope, payload } = ctx;
  const opportunityId = String(payload.opportunityId ?? "");
  if (!opportunityId) {
    return { ok: false, permanent: true, error: "sync_hubspot: no opportunityId in payload." };
  }

  const { data: connection, error: connErr } = await scope
    .select("hubspot_connections", "access_token, hub_id, is_enabled")
    .maybeSingle();
  if (connErr) return { ok: false, error: `sync_hubspot: ${connErr.message}` };
  if (!connection || !(connection as { is_enabled: boolean }).is_enabled) {
    /* Not configured is a state, not a failure — the same rule the provider
       registry applies to a missing Apollo key. A sync a customer never
       connected must never look like a sync that failed. */
    return { ok: true, result: { skipped: "no HubSpot connection for this org" } };
  }
  let token: string;
  try {
    token = decryptSecret(String((connection as { access_token: string }).access_token));
  } catch (e) {
    /* Every way this throws is permanent, which is why none of them are told
       apart here: a missing key, a rotated key, and a row written before the
       column was encrypted are all fixed by a person — by setting a variable
       or by reconnecting — and none is fixed by running this job again in
       four minutes. The reason is written to the connection so the settings
       screen can show it, rather than living only in a job row nobody reads. */
    const message = e instanceof Error ? e.message : String(e);
    await scope.update("hubspot_connections", { last_sync_error: message.slice(0, 1000) });
    return { ok: false, permanent: true, error: `sync_hubspot: ${message}` };
  }
  const hubId = (connection as { hub_id: string | null }).hub_id;

  const { data: org } = await scope.organization("slug").maybeSingle();
  const slug = org ? String((org as { slug: string }).slug) : scope.orgId;

  const { data: opp, error: oppErr } = await scope
    .select("opportunities", "id, company_id, primary_person_id, why_now, status")
    .eq("id", opportunityId)
    .is("deleted_at", null)
    .maybeSingle();
  if (oppErr) return { ok: false, error: `sync_hubspot: ${oppErr.message}` };
  if (!opp) return { ok: true, result: { skipped: "the opportunity no longer exists" } };
  const opportunity = opp as {
    id: string; company_id: string; primary_person_id: string | null; why_now: string | null; status: string;
  };

  const { data: company } = await scope
    .select("companies", "id, name, canonical_domain, industry, employee_count")
    .eq("id", opportunity.company_id)
    .maybeSingle();
  if (!company) return { ok: true, result: { skipped: "the opportunity's company no longer exists" } };
  const co = company as { id: string; name: string; canonical_domain: string | null; industry: string | null; employee_count: number | null };

  const { data: scoreRow } = await scope
    .select("opportunity_scores", "score")
    .eq("opportunity_id", opportunityId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const score = scoreRow ? (scoreRow as { score: number | null }).score : null;

  const person = await loadPrimaryPerson(scope, opportunity.primary_person_id);
  const email = person ? await loadEmail(scope, person.id) : null;

  const site = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") || "https://app.huntloop.example";
  const evidenceUrl = `${site}/${slug}/opportunities/${opportunityId}`;

  try {
    await ensureDealProperties(token);

    const companyResult = await upsertCompany(token, {
      name: co.name, domain: co.canonical_domain, industry: co.industry, employeeCount: co.employee_count,
    });
    await linkExternal(scope, "company", co.id, companyResult.id);

    let contactHubspotId: string | null = null;
    if (person) {
      const contactResult = await upsertContact(token, {
        email, firstName: person.first_name, lastName: person.last_name, title: person.title,
      });
      contactHubspotId = contactResult.id;
      await linkExternal(scope, "person", person.id, contactHubspotId);
      await associate(token, "contacts", contactHubspotId, "companies", companyResult.id);
    }

    const dealInput = {
      name: `${co.name} — Huntloop opportunity`,
      score,
      whyNow: opportunity.why_now ?? "Not yet researched.",
      evidenceUrl,
    };

    const { data: existingDeal } = await scope
      .select("external_ids", "provider_id")
      .eq("entity_type", "opportunity")
      .eq("entity_id", opportunityId)
      .eq("provider", PROVIDER)
      .limit(1);

    let dealId: string;
    let created: boolean;
    if (Array.isArray(existingDeal) && existingDeal.length) {
      dealId = String((existingDeal[0] as { provider_id: string }).provider_id);
      await updateDealHuntloopFields(token, dealId, dealInput);
      created = false;
    } else {
      const dealResult = await createDeal(token, dealInput);
      dealId = dealResult.id;
      created = true;
      await linkExternal(scope, "opportunity", opportunityId, dealId);
      await associate(token, "deals", dealId, "companies", companyResult.id);
      if (contactHubspotId) await associate(token, "deals", dealId, "contacts", contactHubspotId);
    }

    /* Read back the stage HubSpot has it in, and record it as evidence — see
       the file header for why this is a record, not a status overwrite. */
    const stage = await getDealStage(token, dealId);
    if (stage) {
      await scope.upsert(
        "evidence",
        {
          subject_type: "opportunity",
          subject_id: opportunityId,
          /* The label when the portal gave us one, the raw id when it did
             not. Never both, and never the id dressed up as a name: "stage
             a1b2c3-4" is a sentence that looks like information and is not. */
          claim: `HubSpot reports this deal is in stage "${stage.stageLabel ?? stage.stageId}"${stage.isClosed ? (stage.isWon ? " (closed won)" : " (closed lost)") : ""}.`,
          kind: "fact",
          confidence: "high",
          reliability: "provider_attested",
          source_url: hubId ? `https://app.hubspot.com/contacts/${hubId}/deal/${dealId}` : null,
          observed_at: new Date().toISOString(),
          field: "hubspot_stage",
        },
        { onConflict: "org_id,subject_type,subject_id,field,live_source_key", ignoreDuplicates: false },
      );
    }

    await scope.update("hubspot_connections", { last_synced_at: new Date().toISOString(), last_sync_error: null });

    return {
      ok: true,
      result: { hubspotDealId: dealId, dealCreated: created, hubspotCompanyId: companyResult.id, stage: stage?.stageId ?? null },
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await scope.update("hubspot_connections", { last_sync_error: message.slice(0, 1000) });

    if (e instanceof CrmError && !e.retryable) {
      /* A rejected token will not fix itself on a retry, same reasoning
         `enrich_company` applies to a wrong Apollo key. */
      return { ok: false, permanent: true, error: `sync_hubspot: ${message}` };
    }
    return { ok: false, error: `sync_hubspot: ${message}` };
  }
}

interface PrimaryPerson {
  id: string;
  first_name: string | null;
  last_name: string | null;
  title: string | null;
}

/**
 * Pulled out as its own `const`-returning function rather than a mutable
 * `let` reassigned inline. Both are correct; this one is what a `let`
 * narrowed across an `await` and a later `try` block would not reliably give
 * the compiler — a `const` a caller receives from a function call stays
 * narrowed at every use, which is the actual property being relied on below.
 */
async function loadPrimaryPerson(scope: OrgScope, personId: string | null): Promise<PrimaryPerson | null> {
  if (!personId) return null;
  const { data } = await scope
    .select("people", "id, first_name, last_name, title")
    .eq("id", personId)
    .maybeSingle();
  return (data as PrimaryPerson | null) ?? null;
}

async function loadEmail(scope: OrgScope, personId: string): Promise<string | null> {
  const { data: points } = await scope
    .select("contact_points", "value")
    .eq("person_id", personId)
    .eq("kind", "email")
    .limit(1);
  return Array.isArray(points) && points.length ? String((points[0] as { value: string }).value) : null;
}

async function linkExternal(scope: OrgScope, entityType: string, entityId: string, providerId: string): Promise<void> {
  await scope.upsert(
    "external_ids",
    { entity_type: entityType, entity_id: entityId, provider: PROVIDER, provider_id: providerId, last_seen_at: new Date().toISOString() },
    { onConflict: "org_id,provider,provider_id" },
  );
}
