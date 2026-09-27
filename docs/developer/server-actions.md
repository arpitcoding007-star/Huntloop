---
description: All 71 server actions, grouped by surface, with the role each one requires.
---

# Server actions

> **Layer:** Developer · **Audience:** engineering

Every write in the product. All follow the same contract — see
[Backend and server actions](../architecture/backend.md).

```ts
// The shape every one of them returns
type ActionResult<T = undefined> =
  | { ok: true; data: T; message?: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };
```

{% hint style="warning" %}
These are **public POST endpoints**. Next exposes an id for each to the
browser. Every one validates its input against a Zod schema in
`apps/web/lib/validation.ts` — `SEC-VAL` fails the build otherwise.
{% endhint %}

## Role requirements

| Tier | Roles | How |
|---|---|---|
| Read | any member | loaders, not actions |
| Write | owner, admin, member | `mutate()` default |
| Admin | owner, admin | `mutate(..., { minRole: "admin" })` |
| Spend | `canSpend(viewer)` | model- or credit-spending actions |

`viewer` can do none of the below.

***

## Auth — `app/(auth)/actions.ts`

| Action | Notes |
|---|---|
| `sendMagicLink` | Rate-limited by Supabase's own sign-in limits |
| `signInWithGoogle` | Present and working; currently hidden in the UI |

## Onboarding — `app/(onboarding)/welcome/`

| Action | File | Notes |
|---|---|---|
| `saveYou` | `actions.ts` | Name + role |
| `createWorkspace` | `actions.ts` | Creates the org and the owner membership |
| `saveGoals` | `actions.ts` | Max two goals + outreach channel |
| `saveIcp` | `actions.ts` | |
| `saveSources` | `actions.ts` | |
| `advanceStep` | `actions.ts` | `advance_onboarding()` |
| `finishOnboarding` | `actions.ts` | |
| `researchCompanyAction` | `company/actions.ts` | **Spends** — Opus + web fetch |
| `saveCompanyAction` | `company/actions.ts` | |
| `requestJoinAction` | `company/actions.ts` | `request_to_join()` |
| `draftIcpAction` | `icp/actions.ts` | **Spends** |
| `estimateReachAction` | `icp/actions.ts` | **Spends** provider credits |
| `previewLookAlikesAction` | `icp/actions.ts` | **Spends** |
| `recommendSourcesAction` | `sources/actions.ts` | **Spends** |
| `runStageAction` | `building/actions.ts` | One first-run stage per request |

## Marketing

| Action | File | Notes |
|---|---|---|
| `discoverAction` | `(marketing)/discover/actions.ts` | **Anonymous.** Gated by `PUBLIC_RESEARCH_ENABLED`, a hard daily cap and a per-source hourly window |

## Company profile and ICP

| Action | File | Role |
|---|---|---|
| `saveProductAction` / `deleteProductAction` | `settings/product/actions.ts` | write |
| `saveIcpAction` · `activateIcpAction` · `deleteIcpAction` | `settings/icp/actions.ts` | write |
| `savePersonaAction` / `deletePersonaAction` | `settings/icp/actions.ts` | write |
| `previewLookAlikesAction` | `settings/icp/actions.ts` | spend |
| `saveOrgSettingsAction` | `settings/actions.ts` | **admin** |
| `saveOrgProfileAction` | `settings/actions.ts` | **admin** — tone of voice |

## Sources

| Action | Notes |
|---|---|
| `saveSourceAction` | A *pending recommendation* is `is_enabled = false` — one column, not a new concept |
| `setSourceEnabledAction` | Accept or pause |
| `deleteSourceAction` / `restoreSourceAction` | Soft delete, with a real undo |
| `suggestSourcesAction` | **Spends** |
| `scanSourceNowAction` | Enqueues `scan_source` through `lib/data/engine.ts` |
| `setScanIntervalAction` | |

## Hunt

| Action | File | Notes |
|---|---|---|
| `analyzeUrlAction` | `analyze/actions.ts` | **Spends** — rate limit → budget → `qualify_opportunity` |
| `whyNowAction` | `analyze/actions.ts` | **Spends** |
| `saveQualificationAction` | `analyze/actions.ts` | Turns an analysis into a real opportunity |
| `saveCompanyAction` / `deleteCompanyAction` | `companies/actions.ts` | |
| `importCsvAction` | `imports/actions.ts` | |
| `enrollOpportunitiesAction` | `opportunities/actions.ts` | Enrols; **never sends**, at any autonomy level |
| `askAgentAction` | `opportunities/[id]/actions.ts` | **Spends** — `sales_agent` |
| `overridePriorityAction` | `opportunities/[id]/actions.ts` | `record_override()` |

## Engage

| Action | File |
|---|---|
| `saveCampaignAction` · `deleteCampaignAction` | `outreach/actions.ts` |
| `createSequenceAction` · `saveStepAction` · `deleteStepAction` | `outreach/actions.ts` |
| `setThreadStatusAction` · `assignThreadAction` | `inbox/actions.ts` |
| `replyToThreadAction` | `inbox/actions.ts` |
| `approveMessageAction` | `inbox/actions.ts` — the autonomy 0–1 gate |
| `setOpportunityStatusAction` | `pipeline/actions.ts` |
| `unsubscribeAction` | `unsubscribe/[token]/actions.ts` — **no session required** |

{% hint style="info" %}
`saveCampaignAction` accepts `autonomyLevel`, but the *create* path does not.
An action that accepted an autonomy level at creation would let one call
produce a campaign that sends without a human ever choosing that.
{% endhint %}

## Team

| Action | Role |
|---|---|
| `inviteMemberAction` | **admin** — enforces the `seats` quota |
| `revokeInvitationAction` | **admin** |
| `setMemberRoleAction` | **admin** |
| `removeMemberAction` | **admin** |
| `approveJoinAction` / `declineJoinAction` | **admin** |
| `assignOpportunityAction` | write |
| `acceptInvitationAction` | `invite/[token]/actions.ts` — the invitee, not a member yet |

## Learn

| Action | Notes |
|---|---|
| `requestAnalysisAction` | Enqueues `analyze_performance` via `lib/data/engine.ts` |
| `approveFindingAction` / `rejectFindingAction` | One finding at a time, by design |
| `saveMemoryAction` · `deleteMemoryAction` · `ingestMemoryAction` | `/memory` |
| `draftRulesAction` | **Spends** — `draft_scoring_rules` |
| `saveRuleAction` · `setRuleActiveAction` · `deleteRuleAction` | |
| `previewRuleAction` | Dry-runs a rule before anyone activates it |
| `recomputeScoresAction` | `request_score_recompute()` |

## Integrations and ops

| Action | Role |
|---|---|
| `connectHubspotAction` / `disconnectHubspotAction` | **admin**; refused without `MAILBOX_ENCRYPTION_KEY` |
| `retryJobAction` / `cancelJobAction` | `ops/actions.ts` → `retry_job()` / `cancel_job()` |

***

## Adding an action

1. Add a Zod schema to `lib/validation.ts`. **Derive enum members**, never
   retype them.
2. `parseForm(schema, input)` first; return `fail(...)` with `fieldErrors`.
3. Wrap the work in `mutate(org, "callerName", run, options)`.
4. `recordAudit()` inside, `revalidatePath()` after.
5. If it spends money, go through `lib/ai/*` (which carries the three gates) or
   `lib/data/engine.ts` (which owns the queue seam). **Never import the queue or
   the admin client directly from an action.**
6. `npm run audit:site` — `SEC-VAL`, `SEC-SPEND`, `SEC-QUOTA`, `SEC-RATELIMIT`
   and `NAV-03` all gate on this.

## Related

* [Backend and server actions](../architecture/backend.md)
* [Code conventions](conventions.md)
