# CRM & HubSpot audit

## Internal CRM

HuntLoop has a deliberately thin internal CRM: `opportunities` with `status`, `owner_id`, `priority`, plus `/pipeline` and `/team/assignments`. There is no `deals`, `tasks` or `notes` model.

**This is the right call and should be defended.** The product's own governing document lists "a generic CRM" as something HuntLoop must not become. The opportunity *is* the record; ownership and status are the only CRM primitives it needs.

The gap that follows: there is **no task or activity model**, so "what should I do next" has nowhere to live once it becomes an instruction rather than a score. See `14`/`22` — the recommendation engine will need one, and it should be minimal (a recommendation with a state), not a task manager.

## HubSpot connector

Shipped 2026-09-14, hardened 2026-09-15. Architecture:

| Layer | File | Notes |
|---|---|---|
| Vendor client | `packages/crm/src/hubspot.ts` | v3 objects/search/properties + v4 default associations |
| Contract | `packages/crm/src/contract.ts` | three objects + one read-back, deliberately narrow |
| Connection | `hubspot_connections` (`0028`) | one row per org, admin-only RLS both directions, token AES-256-GCM encrypted |
| Job | `handlers/sync-hubspot.ts` | push one opportunity, read stage back as evidence |
| UI | `/settings/integrations` | connect/disconnect, token never reaches rendered output |

Good decisions:
- **Search-then-write** for companies (by domain) and contacts (by email), because v3 has no upsert verb.
- **Deal created once**, remembered in `external_ids` — reusing the generic table rather than inventing `hubspot_deal_id`.
- **Custom properties auto-created** (`ensureDealProperties`), 409-tolerant, because v3 rejects writes to unknown properties and the failure would look like a HubSpot outage.
- **Stage read back as evidence, not as a status overwrite** — an external system's stage is a citable fact, not permission to overwrite the scoring engine's own state.
- **Undecryptable credential fails permanently**, not with retries, and writes the reason to the connection row so the settings screen can show it.

## 🔴 The connector cannot be invoked

`sync_hubspot` has **no caller**. There is no "Push to HubSpot" button, it is not in `SWEEPERS`, and nothing enqueues it on opportunity creation or status change. The entire integration is connectable and unusable.

## Source-of-truth rules — currently undefined, and they need to be

| Field | Proposed owner | Rationale |
|---|---|---|
| Company firmographics | **HuntLoop** | provenance and confidence are modelled here; HubSpot has no evidence chain |
| Contact identity / email | **HuntLoop** | verification status is modelled here |
| Opportunity score, why-now, evidence | **HuntLoop, exclusively** | these are the product |
| Deal stage / pipeline position | **HubSpot** once pushed | the rep works there; HuntLoop records it as evidence |
| Deal owner | **HubSpot** | assignment is a sales-management decision |
| Activity history (emails sent by HuntLoop) | **HuntLoop**, mirrored to HubSpot | HuntLoop has the proof (`provider_message_id`) |

Write this down before two-way sync exists, not after.

## Findings

| # | Severity | Finding |
|---|---|---|
| C-1 | **Critical** | `sync_hubspot` has no trigger — the integration cannot run |
| C-2 | High | No initial/bulk sync: only per-opportunity push is modelled |
| C-3 | High | No inbound sync and no webhooks — HubSpot changes are only seen when HuntLoop happens to push that deal again |
| C-4 | High | Never verified against a live portal; every endpoint shape is documentation-derived |
| C-5 | Medium | No field-mapping configuration — property names are hard-coded |
| C-6 | Medium | No sync history or per-record error surface; only `last_sync_error` on the connection |
| C-7 | Medium | Deleted-record handling undefined (deal deleted in HubSpot → `external_ids` row points at nothing) |
| C-8 | Low | `getStageLabels` re-fetches pipelines on every sync (deliberate: avoids caching tokens in a process map) |
| C-9 | Low | HubSpot rate limits are not modelled — no budget/breaker equivalent to the provider package |

## Recommendation

1. Add the trigger (button + on-status-change), then verify against a sandbox portal.
2. Write the source-of-truth table above into `docs/` before building inbound sync.
3. When a second CRM becomes real, promote `packages/crm` to a registry — not before.
