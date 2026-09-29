/**
 * HubSpot.
 *
 * ── The one honest caveat, stated once and not repeated at every call site ─
 *
 * This is written against HubSpot's documented CRM v3 objects/search/properties
 * API and the v4 default-associations endpoint, as researched in September
 * 2026. It has never been run against a live HubSpot portal — no private-app
 * token is configured in this environment. Apollo's adapter carries the same
 * kind of caveat about its credit estimates ("the shape of the billing rather
 * than a price list"); this file's equivalent is the endpoint paths and
 * property names below. Reconcile against a real portal — a sandbox account
 * is free — before the first customer connects one.
 *
 * ── Why upsert is search-then-write, not one call ──────────────────────────
 *
 * HubSpot's v3 objects API has no "upsert by unique property" verb for
 * companies or contacts. The correct sequence, and the one used here, is:
 * search by the property that identifies the record in the outside world
 * (domain for a company, email for a contact), then PATCH if found or POST if
 * not. A deal has no such natural key — two companies can legitimately be in
 * one deal named the same thing — so a deal is only ever created once and
 * remembered afterward via `external_ids`, which is `sync_hubspot`'s job, not
 * this file's.
 */
import { CrmError, type CrmCompanyInput, type CrmContactInput, type CrmDealInput, type CrmDealStage, type CrmUpsertResult } from "./contract.ts";

const BASE = "https://api.hubapi.com";

/**
 * The custom deal properties this integration writes.
 *
 * Created on first use via the Properties API if the portal does not already
 * have them — HubSpot's v3 objects API rejects a write to a property it does
 * not know about, so writing straight to `huntloop_score` on a fresh portal
 * without this step would fail on every single deal, silently look like a
 * HubSpot outage, and never explain why.
 */
const DEAL_PROPERTIES = [
  { name: "huntloop_score", label: "Huntloop score", type: "number", fieldType: "number" },
  { name: "huntloop_why_now", label: "Huntloop — why now", type: "string", fieldType: "textarea" },
  { name: "huntloop_evidence_url", label: "Huntloop opportunity", type: "string", fieldType: "text" },
] as const;

const GROUP_NAME = "huntloop";

interface HubspotErrorBody {
  message?: string;
  category?: string;
}

async function request<T>(
  token: string,
  method: "GET" | "POST" | "PATCH" | "PUT",
  path: string,
  body?: Record<string, unknown>,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15_000),
    });
  } catch (e) {
    throw new CrmError(e instanceof Error ? e.message : String(e), { reason: "failed", retryable: true });
  }

  if (response.status === 429) {
    throw new CrmError("HubSpot rate limit reached.", { reason: "rate_limited", httpStatus: 429 });
  }
  if (response.status === 401 || response.status === 403) {
    throw new CrmError(`HubSpot rejected the token (${response.status}).`, {
      reason: "unauthorized",
      httpStatus: response.status,
      retryable: false,
    });
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as HubspotErrorBody | null;
    throw new CrmError(`HubSpot returned ${response.status}: ${body?.message ?? "no detail"}`, {
      reason: "failed",
      httpStatus: response.status,
      retryable: response.status >= 500,
    });
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

/**
 * The credential check.
 *
 * Same argument as `PRV-01` for Apollo: without a cheap, early check, a bad
 * or revoked private-app token makes every subsequent push fail silently
 * from a user's point of view — a deal that never appears, with no error
 * anywhere they would think to look. `/crm/v3/objects/companies?limit=1` is
 * the cheapest authenticated read the objects API has.
 */
export async function verifyHubspotToken(token: string): Promise<{ ok: boolean; detail: string }> {
  try {
    await request(token, "GET", "/crm/v3/objects/companies?limit=1");
    return { ok: true, detail: "HubSpot accepted the token." };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, detail: message };
  }
}

/**
 * The portal (hub) id this token belongs to, or null if it cannot be read.
 *
 * CRM-004. Nothing ever stored `hub_id`, so the deal URL the stage read-back
 * cites was always null — and a fact with no source fails
 * `evidence_fact_needs_source`, so every read-back was silently dropped.
 * Never throws: a portal id is useful, not required to connect.
 */
export async function getHubId(token: string): Promise<string | null> {
  try {
    const details = await request<{ portalId?: number | string }>(
      token,
      "GET",
      "/account-info/v3/details",
    );
    return details?.portalId !== undefined && details?.portalId !== null ? String(details.portalId) : null;
  } catch {
    return null;
  }
}

/**
 * Creates the three `huntloop_*` deal properties if the portal does not
 * already have them. Idempotent: a 409 (property already exists) is treated
 * as success, not an error — the common case on every call after the first.
 */
export async function ensureDealProperties(token: string): Promise<void> {
  try {
    await request(token, "POST", "/crm/v3/properties/deals/groups", {
      name: GROUP_NAME,
      label: "Huntloop",
    });
  } catch (e) {
    if (!(e instanceof CrmError) || e.httpStatus !== 409) throw e;
  }

  for (const prop of DEAL_PROPERTIES) {
    try {
      await request(token, "POST", "/crm/v3/properties/deals", {
        name: prop.name,
        label: prop.label,
        type: prop.type,
        fieldType: prop.fieldType,
        groupName: GROUP_NAME,
      });
    } catch (e) {
      if (!(e instanceof CrmError) || e.httpStatus !== 409) throw e;
    }
  }
}

interface SearchResponse {
  results?: Array<{ id: string }>;
}

async function searchOne(
  token: string,
  objectType: "companies" | "contacts",
  property: string,
  value: string,
): Promise<string | null> {
  const body = {
    filterGroups: [{ filters: [{ propertyName: property, operator: "EQ", value }] }],
    limit: 1,
    properties: ["hs_object_id"],
  };
  const result = await request<SearchResponse>(token, "POST", `/crm/v3/objects/${objectType}/search`, body);
  return result.results?.[0]?.id ?? null;
}

export async function upsertCompany(token: string, input: CrmCompanyInput): Promise<CrmUpsertResult> {
  const properties: Record<string, string> = { name: input.name };
  if (input.domain) properties.domain = input.domain;
  if (input.industry) properties.industry = input.industry;
  if (input.employeeCount !== null) properties.numberofemployees = String(input.employeeCount);

  const existingId = input.domain ? await searchOne(token, "companies", "domain", input.domain) : null;

  if (existingId) {
    await request(token, "PATCH", `/crm/v3/objects/companies/${existingId}`, { properties });
    return { id: existingId, created: false };
  }

  const created = await request<{ id: string }>(token, "POST", "/crm/v3/objects/companies", { properties });
  return { id: created.id, created: true };
}

export async function upsertContact(token: string, input: CrmContactInput): Promise<CrmUpsertResult> {
  const properties: Record<string, string> = {};
  if (input.email) properties.email = input.email;
  if (input.firstName) properties.firstname = input.firstName;
  if (input.lastName) properties.lastname = input.lastName;
  if (input.title) properties.jobtitle = input.title;

  const existingId = input.email ? await searchOne(token, "contacts", "email", input.email) : null;

  if (existingId) {
    await request(token, "PATCH", `/crm/v3/objects/contacts/${existingId}`, { properties });
    return { id: existingId, created: false };
  }

  const created = await request<{ id: string }>(token, "POST", "/crm/v3/objects/contacts", { properties });
  return { id: created.id, created: true };
}

/**
 * Always creates. There is no honest search key for a deal — see the file
 * header — so the caller (`sync_hubspot`) is responsible for checking
 * `external_ids` before calling this a second time for the same opportunity.
 */
export async function createDeal(token: string, input: CrmDealInput): Promise<CrmUpsertResult> {
  const properties: Record<string, string> = {
    dealname: input.name,
    huntloop_why_now: input.whyNow,
    huntloop_evidence_url: input.evidenceUrl,
  };
  if (input.score !== null) properties.huntloop_score = String(input.score);

  const created = await request<{ id: string }>(token, "POST", "/crm/v3/objects/deals", { properties });
  return { id: created.id, created: true };
}

export async function updateDealHuntloopFields(token: string, dealId: string, input: CrmDealInput): Promise<void> {
  const properties: Record<string, string> = {
    huntloop_why_now: input.whyNow,
    huntloop_evidence_url: input.evidenceUrl,
  };
  if (input.score !== null) properties.huntloop_score = String(input.score);
  await request(token, "PATCH", `/crm/v3/objects/deals/${dealId}`, { properties });
}

/**
 * The v4 "default association" endpoint — HubSpot's own documented shortcut
 * for the common case, chosen specifically because it does not require
 * knowing a numeric association-type id, which the older v3 endpoint does
 * and which is the kind of magic number this codebase avoids elsewhere.
 */
export async function associate(
  token: string,
  fromType: "deals" | "contacts",
  fromId: string,
  toType: "companies" | "contacts",
  toId: string,
): Promise<void> {
  await request(token, "PUT", `/crm/v4/objects/${fromType}/${fromId}/associations/default/${toType}/${toId}`);
}

interface DealReadResponse {
  properties?: { dealstage?: string; hs_is_closed?: string; hs_is_closed_won?: string };
}

interface PipelinesResponse {
  results?: Array<{ label?: string; stages?: Array<{ id?: string; label?: string }> }>;
}

/**
 * Every deal stage this portal has, id → human label.
 *
 * ── Why this is a second call and not a cache ────────────────────────────
 *
 * A stage id is a real fact and a useless one: `"a1b2c3-4"` in an evidence
 * row tells a salesperson nothing, and "HubSpot reports this deal is in
 * stage a1b2c3-4" is the kind of technically-true sentence this product is
 * built not to write. The label lives on the pipeline object, so resolving
 * it costs one more request per sync — against the five a sync already makes,
 * that is noise.
 *
 * Deliberately not memoised. A module-level cache would have to be keyed by
 * token to stay correct across orgs, which means holding customer
 * credentials in a process-lifetime map to save one request on a job that
 * already spends several. Wrong trade.
 *
 * Failure here is not failure of the sync. A portal with custom pipeline
 * permissions can refuse this read while allowing the deal write, and losing
 * a label is not worth losing the push — so the caller gets a null label and
 * the stage id it already had.
 */
export async function getStageLabels(token: string): Promise<Map<string, string>> {
  const labels = new Map<string, string>();
  try {
    const result = await request<PipelinesResponse>(token, "GET", "/crm/v3/pipelines/deals");
    for (const pipeline of result.results ?? []) {
      for (const stage of pipeline.stages ?? []) {
        if (stage.id && stage.label) labels.set(stage.id, stage.label);
      }
    }
  } catch {
    /* Swallowed on purpose — see above. The empty map is the honest answer:
       "we could not resolve labels", which reads downstream as a null label
       rather than as a wrong one. */
  }
  return labels;
}

export async function getDealStage(token: string, dealId: string): Promise<CrmDealStage | null> {
  try {
    const result = await request<DealReadResponse>(
      token,
      "GET",
      `/crm/v3/objects/deals/${dealId}?properties=dealstage,hs_is_closed,hs_is_closed_won`,
    );
    const stageId = result.properties?.dealstage;
    if (!stageId) return null;

    const labels = await getStageLabels(token);

    return {
      stageId,
      stageLabel: labels.get(stageId) ?? null,
      isClosed: result.properties?.hs_is_closed === "true",
      isWon: result.properties?.hs_is_closed_won === "true",
    };
  } catch (e) {
    if (e instanceof CrmError && e.httpStatus === 404) return null;
    throw e;
  }
}
