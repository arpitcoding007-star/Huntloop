# B — DB & Security audit (read-only) — HuntLoop @ 509a24e

Auditor B. Areas: **db**, **security**. Method: static reading of `packages/db/migrations/*` (0001–0030), `pending-migrations.sql`, `packages/db/{src,scripts}`, every `"use server"` module, every `app/api/**` route, `proxy.ts`, `lib/csp.ts`, `next.config.ts`, `packages/jobs/src/{fetch,runner,queue,first-run,public-research,reach,look-alike}.ts`, `packages/providers/src/budget.ts`, git history grep. Nothing was run against a database, provider, or dev server. One local `node -e` was run to confirm WHATWG URL serialisation (no network).

No leaked live secret was found in tracked files or git history (details in SEC-013). No *read* path across tenants was found; the closest things to an open tenant boundary are SEC-001 (a member can starve every tenant's scheduler) and SEC-006 (a cross-tenant write RPC that is probably still executable by `anon`).

---

## 1. Table inventory, RLS status, feature dependency map

69 tables, all RLS-enabled (structurally verified: every `create table` has a matching `enable row level security`). Policy shape in brackets:
`R=org` read = `org_id in user_org_ids()`; `W=member` / `W=admin` = `for all` using+check `has_org_role`; `W=none` no write policy (SECURITY DEFINER / service role only).

| Table | Mig | Policies | Used by (web / engine) | Feature |
|---|---|---|---|---|
| organizations | 0001 | R=member-of, UPDATE=admin, no INSERT (create via `create_organization()` 0030) | everywhere | tenant root |
| memberships | 0001 | R=org, W=admin (**any role incl. owner**, see SEC-002) | team, layout, all RLS | auth |
| plans | 0001 | R=true | data/plans | pricing/quota |
| subscriptions | 0001 | R=org, W=none | **none** (comment only `lib/data/directory.ts:112`) | orphan (billing) |
| usage_counters | 0001 | R=org, W=none | data/usage, jobs/ai.ts, sweepers | quotas, provider budget |
| audit_logs | 0001 | R=admin, W=none (`write_audit_log()`) | written `lib/data/audit.ts`; `listAudit` has **no caller** | audit |
| products, icps, personas | 0002 | R=org, W=member | settings, onboarding, jobs | ICP/product |
| sources, source_documents, source_events | 0002 | R=org, W=member | sources, scan-source, score-opportunity | signals |
| evidence | 0002/0020 | R=org, W=member | analyze, data, research-company, scan-source… | evidence |
| companies, company_problems, company_triggers, people, contact_points, enrichment_records, opportunities, scoring_rules, opportunity_scores | 0003 | R=org, W=member | core loop (web + engine) | discovery→scoring |
| company_gaps | 0003 | R=org, W=member | **none** | orphan |
| mailboxes, campaigns, sequences, sequence_steps, enrollments, suppressions, threads, messages, message_events, memories, ai_runs, ai_decisions, outcomes, events | 0004 | R=org, W=member | outreach, inbox, learn, jobs | outreach/learning |
| **job_executions** | 0004 | R=org, **W=member** (see SEC-001) | tick/inngest, learn page, all jobs | engine queue |
| conversations, conversation_messages | 0004 | owner-only (user_id = auth.uid()) | opportunity agent | sales agent |
| rate_limits | 0005 | R=org, W=none | lib/rate-limit.ts | AI rate limits |
| profiles | 0007 | R=self+co-members, UPDATE=self | team, onboarding | identity |
| invitations | 0007 | W=admin (**any role incl. owner**) | team | invites |
| learning_runs, learning_findings | 0010 | R=org, W=member | learn, analyze-performance | learning loop |
| provider_calls, provider_cache, provider_breakers | 0011 | R=org, **W=member** | providers ledger/cache | provider spend |
| provider_accounts | 0011 | R=org, W=admin | providers/registry | provider config/budget |
| company_domains, external_ids, merge_candidates | 0012 | R=org, W=member | discover-companies, hubspot, resolve-entity (never enqueued) | identity |
| company_merges | 0012 | R=org, W=member | only `merge_companies()`; `merge_companies_for_org` has no caller | orphan |
| icp_versions | 0013 | R=org, W=none | data/icp | ICP history |
| discovery_queries, discovery_runs, discovery_results | 0014 | R=org, W=member | first-run, discover-companies | discovery |
| competitors, competitor_profiles, competitor_evidence, company_competitor_signals | 0015 | R=org, W=member | engine only (no web reader) | competitor intel |
| contact_fit_scores, human_overrides | 0016 | R=org, W=member | rank-contacts, opportunity detail | contact scoring |
| contact_frequency | 0017 | R=org, W=member | **live** via `can_contact`/`record_contact_send`/`record_contact_reply` (send-message.ts:105,343; sync-mailbox.ts:300) | send safety |
| evidence_citations | 0022 | R=org, W=member | written by `merge_duplicate_evidence` (scan-source.ts:221); **no reader** | write-only |
| score_recompute_requests | 0023 | R=org, UPDATE→cancelled only | scoring settings, schedule-recomputes | rescoring |
| public_research | 0025 | RLS on, **no policy** (service role + `claim_research()`) | anonymous /discover | funnel |
| join_requests | 0027 | W=admin | team, directory | org directory |
| hubspot_connections | 0028 | R=admin, W=admin | integrations, sync-hubspot | CRM |

Indexes: hot paths checked (opportunity list `opportunities_priority_idx`, job claim `job_executions_due_idx`, evidence `evidence_subject_idx`, messages by thread/opportunity) are covered. Gap: `contact_points(person_id)` (DB-002).

## 2. Server action / API route authZ matrix

"mutate" = `lib/data/org.ts:83` (resolves membership via RLS, refuses viewer, optional minRole). Where the action runs under the user session, RLS is the real control. Where it hands `orgId` to service-role code, `mutate` **is** the control.

| Entry point | Auth | AuthZ location | Service role? | Verdict |
|---|---|---|---|---|
| `/api/jobs/tick` GET/POST | `CRON_SECRET` bearer, 503 if unset, 404 on mismatch, constant-time compare (route.ts `safeEquals`) | route | yes (runner) | OK |
| `/api/inngest` POST | HMAC over body, 5-min window, `timingSafeEqual`; 404 if unconfigured | route | yes | OK (no replay nonce; replay only causes an extra tick) |
| `/api/mailboxes/[p]/start` GET | session | `currentViewer`+`canWrite` in route | no | OK |
| `/api/mailboxes/[p]/callback` GET | state cookie (`__Host-`, httpOnly, 10 min) + nonce timing-safe + re-check membership | route | no (RLS upsert) | OK |
| `/api/unsubscribe/[token]` POST/GET | uuid token → `record_unsubscribe` (SD, anon) | DB function | no | OK (122-bit random, not signed; acceptable) |
| `/api/csp-report` POST | none (by design), 8 KB cap | — | no | Low: unrate-limited Sentry forwarding (SEC-014) |
| `/api/health` GET | none | — | no | Low: config fingerprint (SEC-012) |
| `/auth/callback` | code exchange; `safeNextPath` blocks `//`, `\`, controls | route | no | OK, no open redirect |
| (auth) `sendMagicLink`, `signInWithGoogle` | public | — | no | OK; open signup (relevant to SEC-004) |
| invite `acceptInvitationAction` | session → `accept_invitation` (SD: email match, expiry, revoked) | DB | no | OK |
| unsubscribe `unsubscribeAction` | token | DB | no | OK |
| (marketing) `discoverAction` | **anonymous** | IP-hash allowance in `public-research.ts:127` | **yes** | Medium (SEC-010) |
| welcome `saveYou`/`createWorkspace`/`createNamedWorkspace` | session | `create_organization()` SD (20-org cap) | no | OK (slug squatting possible, Low) |
| welcome `saveGoals/saveIcp/saveSources/advanceStep/finishOnboarding` | session | `mutate` (member) in `lib/data/onboarding.ts` | no | OK |
| welcome/company `researchCompanyAction` | session | `resolveRecorder` (org_read ⇒ any role) | no | **viewer can spend** (SEC-008) |
| welcome/company `saveCompanyAction` | session | `mutate` | no | client-asserted provenance (SEC-017) |
| welcome/company `requestJoinAction` | session | `request_to_join()` SD (domain-gated) | no | OK |
| welcome/icp `draftIcpAction` | session | `resolveRecorder` | no | viewer can spend (SEC-008) |
| welcome/icp `estimateReachAction`, `previewLookAlikesAction` | session | `mutate` (member) | **yes** | **no rate limit, budget fails open** (SEC-004) |
| welcome/building `runStageAction` | session | `mutate` (member) | **yes** (first-run) | **repeatable, no rate limit** (SEC-004) |
| welcome/sources `recommendSourcesAction` | session | `requireOrgId` (any role) | no | viewer can spend (SEC-008) |
| analyze `analyzeUrlAction`, `whyNowAction` | session | `resolveRecorder` only | no | viewer can spend (SEC-008) |
| analyze `saveQualificationAction` | session | `mutate` | no | OK |
| companies / imports / inbox / learn / opportunities / opportunities/[id] / outreach / pipeline / settings(icp, product, scoring) / sources | session | `mutate` (member) before writes; `suggestSources`/`scanSourceNow` also `canSpend` | no (RLS) | OK; ids are always additionally `.eq("org_id", orgId)` in the files read; RLS bounds IDOR to the caller's own orgs |
| memory `ingestMemoryAction` | session (proxy) | `mutate` — **after** `fetchPage` (actions.ts:220 vs 276) | no | **SSRF** (SEC-003) |
| settings `saveOrgSettings/saveOrgProfile`, integrations `connect/disconnectHubspot`, privacy `erase/export*` | session | `mutate` minRole admin + DB wrappers (admin) | no | OK |
| privacy `deleteOrganizationAction` | session | `mutate` owner + `delete_organization` owner | no | OK, but owner tier defeated by SEC-002; deletion incomplete (SEC-009) |
| privacy `deleteOwnAccountAction` | session | `delete_own_account()` (no args, sole-owner guard) | no | OK |
| ops `retryJobAction`, `cancelJobAction` | session | `mutate` admin + `retry_job`/`cancel_job` admin | no | OK — but moot, members can write `job_executions` directly (SEC-001) |
| team `setMemberRoleAction` | session | `mutate` admin; schema allows `owner` | no | **admin→owner escalation** (SEC-002) |
| team `removeMember`, `invite*`, `revokeInvitation`, `approve/declineJoin` | session | `mutate` admin | no | OK apart from SEC-002 |
| team `assignOpportunityAction` | session | `mutate` + explicit same-org membership check on `ownerId` | no | OK (good) |

Note on reachability: server actions are invokable by POST with the action id; `proxy.ts` only guards by path and lets `/` and every PUBLIC_PREFIX through, so "the page is protected" is not a control for any action. Every action above re-checks in-action, except the pre-auth work noted in SEC-003.

## 3. Service-role usage

`check-admin-imports.ts` allow-list: `packages/db/src/admin.ts`, `scripts/seed.ts`, `scripts/doctor.ts`, `scripts/check-admin-imports.ts`, `packages/jobs/src/scope.ts`. The grep is literal-import based; `apps/web` reaches the bypass **transitively** through `@huntloop/jobs` exports:

| Call site (service role via `adminClient()`) | Reached from | Guard before it | Justified? |
|---|---|---|---|
| `jobs/src/runner.ts:125` (every handler, `OrgScope(job.org_id)`) | `/api/jobs/tick`, `/api/inngest` | CRON_SECRET / HMAC | Yes |
| `jobs/src/queue.ts:110-210` (enqueue/claim/requeue) | runner, handlers | same | Yes |
| `jobs/src/first-run.ts:116,280,374,459,516` | `runStageAction` (welcome/building/actions.ts:178) | `mutate` member | Yes in principle; no rate limit (SEC-004) |
| `jobs/src/reach.ts:129` | `estimateReachAction` (welcome/icp/actions.ts:160) | `mutate` member | Same |
| `jobs/src/look-alike.ts:128` | `previewLookAlikesAction` ×2 (welcome/icp, settings/icp:332), `lib/data/look-alike-preview.ts` | `mutate` member | Same |
| `jobs/src/public-research.ts:90,128,189` | anonymous `discoverAction` | IP-hash allowance | Needed (no session); allowance weak (SEC-010) |
| `packages/db/scripts/seed.ts:684` | manual CLI | prod-ref refusal `seed.ts:128-145` | Yes (guard added after `acme` reached prod) |
| `packages/db/scripts/doctor.ts` | manual CLI | — | Yes |

`docs/security/tenancy-and-permissions.md:51-56` calls `mutate()` a "courtesy" layer whose removal only changes the error text. That is false for the five service-role call sites above, where `mutate` is the only authorization (SEC-018).

## 4. Status of prior findings (audit/full-system 13, 14, 17, 22)

| Prior ID | Claim | Status | Evidence |
|---|---|---|---|
| S-1 | Next RCE / sharp advisory | **Fixed** | lock: `next` 16.3.5, `sharp` 0.35.4 (`package-lock.json`); `apps/web/package.json` still `^16.3.1` |
| S-2 | CSP report-only | **Still open** (prod env UNVERIFIED) | `lib/csp.ts cspIsEnforced()` needs `CSP_ENFORCE=true`; `.env.example:54` empty. `X-Frame-Options: DENY` in `next.config.ts:45` mitigates clickjacking |
| S-3 | audit_logs never read | **Still open** | `listAudit` (`lib/data/audit.ts:111`) has zero callers |
| S-4 | No alerting on job failure | Not re-checked (jobs area) | — |
| S-5 | STRIPE_* unused | **Still open** | `.env.example:60-62`, zero readers |
| S-6 | kitchen-sink in prod | **Fixed (mitigated)** | `proxy.ts` `HIDDEN_IN_PRODUCTION` → 404; still built |
| S-7 | RL fails closed | Unchanged; but see SEC-005 (anyone can wipe windows) | |
| 17 "service role confined to 5 files" | | **Misleading** | true for literal imports; app reaches it via `@huntloop/jobs` (section 3) |
| 17 "tenant isolation best-defended… a handler cannot express a cross-tenant write" | | **Still open, not previously found**: SEC-001, SEC-006 | |
| 17 "SSRF guard re-checks every redirect hop" | | True, but guard is bypassable (SEC-003) | |
| 17 "every Server Action validates…" / "model-calling paths… rate limit and quota" | | Partly: provider-calling actions have no rate limit (SEC-004); viewers can spend (SEC-008) | |
| 17 "Admin-gated HubSpot" | | Confirmed (`0028:103-108`) | |
| 17 Permissions table (admin manages members) | | Admin can also make themselves owner (SEC-002) | |
| D-1 | 3 orphan tables | **Partly obsolete**: `company_gaps` still orphan; `contact_frequency` is live; `evidence_citations` written but never read; `company_merges` still orphan | DB-004 |
| D-2 | retention cron not configured / purge no caller | **Partly fixed**: `enforce_retention` is a DAILY sweeper (`runner.ts:237`); erasure reachable via `erase_contact_for_org` (0029 + privacy/actions.ts:52); `purge_contact_data` job still never enqueued | |
| D-3 | COMBINED batch inconsistent | **Still open / worse**: `pending-migrations.sql` covers 0011–0029 only; **0030 missing** | DB-001 |
| D-4 | Migrations applied by hand | **Still open** | no migration step in CI |
| D-5 | No generated types | Still open (not re-verified in depth) | `type Query = any` in `providers/src/budget.ts:3` |
| 13 "105 indexes, no missing hot-path index" | | Mostly true; `contact_points(person_id)` missing | DB-002 |
| AP-5 | csp-report unrated | **Still open** | SEC-014 |
| 14 table "cron 404 on mismatch" | | Confirmed; 503 when unset | tick/route.ts |
| 22 C-3 GDPR erasure unreachable | | **Fixed** via admin action (privacy/actions.ts:41-80) | |
| 22 H-7 audit write-only | | **Still open** | as S-3 |
| 22 M-1 / M-2 / M-3 / L-2 | | M-1 open, M-2 partly obsolete, M-3 open, L-2 fixed | |

---

## 5. Findings

Findings are described at the level a fixer needs: location, root cause, impact, and fix. Exploit payloads are deliberately left out of this file.

### [High] SEC-001 — Any member can write to `job_executions` directly
- Confidence: LIKELY (policy and index read; confirm with a migration test that asserts `authenticated` has no INSERT/UPDATE/DELETE on the table)
- Where: `packages/db/migrations/0004_outreach_memory_learning.sql:340-356` (the table is in the generic member-writable `tenant_write` loop and is never tightened later); `0008_engine_columns.sql:295-297` (the idempotency unique index on `(job_name, idempotency_key)` is not scoped by org); `packages/jobs/src/runner.ts:264-275` (sweepers use global keys); no table-level REVOKE in any migration.
- Evidence: `lib/data/engine.ts:7-20` says the queue has a single writer (the service role), but RLS allows any member to write.
- Impact: (1) Availability for **all tenants**: a row created by a tenant can occupy a global sweeper's idempotency slot, so sweeps can be suppressed platform-wide. (2) Inside a tenant, a member can queue admin-gated work (e.g. `purge_contact_data` with a caller-chosen actor) and spend provider or AI credit outside every app-level rate limit. (3) The admin-only `retry_job`/`cancel_job` gate (`0019:225-275`) is moot.
- Root cause: an engine-only table was put in the generic member-writable policy loop.
- Fix: drop `tenant_write` on `job_executions` and keep read-only access. Include `org_id` in the idempotency index. Apply the same treatment to the other engine-only tables (SEC-007).
- Effort: S · Depends on: — · Mechanizable: yes (migration test over an explicit list of engine-only tables)
- Status vs last pass: New. It contradicts file 17's claim that "a handler cannot express a cross-tenant write".

### [High] SEC-002 — An admin can make themselves owner and demote or remove owners
- Confidence: CONFIRMED (code traced)
- Where: `apps/web/app/(app)/[org]/team/actions.ts:46-107` (`setMemberRoleAction` with `minRole:"admin"`); `apps/web/lib/validation.ts:331` (the role enum includes `owner`); RLS `0001_identity.sql:163-165` (`membership_write`: admin, any role value); `0007:155-157` (`invitation_admin`, any role; the app's `inviteSchema` excludes owner but RLS does not).
- Impact: any admin can take the owner tier. `delete_organization` is owner-only (`0029:174`).
- Root cause: granting or revoking owner is authorised as "is admin".
- Fix: require the caller to be an owner when the target's current or new role is `owner`, both in the action and in a `memberships`/`invitations` trigger.
- Effort: S · Mechanizable: yes · Status: New

### [High] SEC-003 — The SSRF guard is incomplete, and memory ingest fetches before authorising
- Confidence: CONFIRMED that the address classifier misses some IPv6 representations of private IPv4 addresses (checked locally with `node -e`, no network). LIKELY exploitable on the deployed runtime (UNVERIFIED; needs a staging test).
- Where: `packages/jobs/src/fetch.ts` `isPrivateAddress` (the IPv4-mapped check only recognises the dotted form, and the NAT64 and 6to4 ranges aren't covered); `assertFetchable` resolves DNS and then `fetch()` resolves again, which leaves a DNS-rebinding window. `apps/web/app/(app)/[org]/memory/actions.ts:220` calls `fetchPage` **before** `mutate` at `:276` and returns fetch error text verbatim. `packages/jobs/src/handlers/scan-source.ts:85` fetches member-configured URLs.
- Impact: server-side requests to internal addresses, with content persisted to tenant-visible rows (memories, evidence). The pre-auth ordering lets callers who aren't members trigger outbound fetches.
- Root cause: string-prefix IP classification plus a separate resolve-then-connect.
- Fix: classify with a CIDR library after normalising IPv4-mapped and translated IPv6 addresses. Pin the connection to the validated address (custom `lookup` in an undici Agent), re-validate every redirect hop, and move `fetchPage` inside `mutate`. Return generic error text.
- Effort: M · Mechanizable: yes (unit tests over address forms) · Status: New (file 17 praised the redirect re-check, which is correct)

### [High] SEC-004 — Provider-calling actions have no rate limit, and the provider budget fails open by default
- Confidence: LIKELY (code read; the real cost depends on the Apollo plan)
- Where: `welcome/icp/actions.ts:136-230` (`estimateReachAction`, `previewLookAlikesAction`), `settings/icp/actions.ts:332`, `welcome/building/actions.ts:131-181` (`runStageAction` can be repeated at any time). Budget: `0011_providers.sql:335-369` returns `allowed=true` when no `monthly_credit_limit` is set, and `packages/providers/src/budget.ts` returns allowed on error. No code sets `monthly_credit_limit` (`registry.ts:178` upserts status only). Signup is open (`(auth)/actions.ts` `shouldCreateUser`).
- Impact: any self-serve account can drive platform-key provider spend with no ceiling.
- Root cause: rate limiting was applied to model calls only, and provider budgets default to unlimited.
- Fix: `consumeRateLimit` on these actions, a default per-plan provider credit cap (e.g. seeded in `create_organization`), and a once-only guard on first-run stages.
- Effort: S-M · Status: New (overlaps with the providers auditor)

### [High] SEC-009 — Deleting a workspace doesn't stop processing or access
- Confidence: LIKELY
- Where: `0029_data_rights.sql:167-200` archives campaigns and enrollments and disables sources, but leaves `discovery_queries` enabled. `0014_discovery.sql:277-307` (`claim_due_discovery_queries`) doesn't check `organizations.deleted_at`, and neither do the schedule-* handlers. `0001:103-113` `user_org_ids()` ignores org deletion, so members keep direct API access to "deleted" data. Only the app (`packages/db/src/server.ts:49-65`) filters deleted orgs.
- Impact: provider spend and data processing continue after the owner deletes the workspace (a cost and privacy problem).
- Fix: disable discovery queries in `delete_organization`; require `organizations.deleted_at is null` in `user_org_ids()` and in the claim functions.
- Effort: S · Status: New

### [Medium] SEC-005 — `prune_rate_limits()` is SECURITY DEFINER with no REVOKE
- Confidence: CONFIRMED that there is no REVOKE (`0005_rate_limits.sql:147-160`; no later migration revokes it). Effect LIKELY: any caller can clear every tenant's rate-limit windows. Monthly quotas still apply.
- Fix: revoke from `public, anon, authenticated`; grant to `service_role`.
- Effort: S · Mechanizable: yes (a check that each SECURITY DEFINER function granted to anon/authenticated is on an explicit allow-list)

### [Medium] SEC-006 — `merge_duplicate_evidence()` is revoked from PUBLIC only and has no org check
- Confidence: LIKELY (Supabase's default privileges grant EXECUTE to `anon`/`authenticated` explicitly; other migrations here revoke those roles separately, e.g. `0008:369-385`). To confirm, run `has_function_privilege('anon', …)` in production.
- Where: `0022_evidence_dedupe.sql:137-226`. It is SECURITY DEFINER, has no membership check, and takes `p_org`. Its only legitimate caller is the service role (`scan-source.ts:221`).
- Impact: a cross-tenant write (merging duplicate evidence) for anyone who knows the ids. `usage_limit()` (`0007:275`) has the same grant gap and leaks plan limits (Low).
- Fix: revoke from `anon, authenticated`; grant to `service_role`. The general check is the same as SEC-005.
- Effort: S

### [Medium] SEC-007 — Member-writable engine and provenance tables
- Confidence: CONFIRMED (policy read)
- Where: the generic `tenant_write for all` loops (0002–0004, 0011, 0012, 0014–0016, 0022) give members raw INSERT/UPDATE/DELETE on `ai_runs`, `evidence`, `opportunity_scores`, `provider_calls`, `provider_cache`, `provider_breakers`, `evidence_citations`, `message_events`, and on `companies` (a hard delete cascades through people, contact_points, opportunities and enrollments). The app itself only soft-deletes.
- Impact: provenance and ledgers can be forged or erased, and an irreversible cascade delete bypasses soft-delete and the audit log.
- Fix: read-only access for engine-written tables; no DELETE policy on user-authored tables.
- Effort: M · Root cause shared with SEC-001

### [Medium] SEC-008 — The viewer role can trigger AI spend, and those runs aren't recorded
- Confidence: CONFIRMED (code)
- Where: `analyze/actions.ts:46-100` and `lib/ai/{qualify,why-now,research,icp-draft,sources}.ts` authorise only through `resolveRecorder` (org readable ⇒ any role), and `canSpend` isn't used. `lib/ai/recorder.ts:111-113` continues "unmetered" when the `ai_runs` insert is refused, which RLS does for viewers.
- Fix: check `canSpend` before a model call. If the `ai_runs` insert fails, refuse the call rather than running it.
- Effort: S

### [Medium] SEC-010 — The anonymous `/discover` allowance is weak
- Confidence: LIKELY (`PUBLIC_RESEARCH_ENABLED` in production is UNVERIFIED)
- Where: `packages/jobs/src/public-research.ts:127-173` counts only successfully stored rows, so failed model runs aren't counted; it uses check-then-act; the fallback salt is constant (`:225`). The IP comes from the first `x-forwarded-for` hop (`(marketing)/discover/actions.ts`).
- Fix: record each attempt before the model call, use the platform's trusted client IP, and require a salt.
- Effort: S

### [Medium] SEC-018 — Security docs call `mutate()` a courtesy layer, but it is the only control on service-role paths
- Where: `docs/security/tenancy-and-permissions.md:51-56` vs section 3. `check-admin-imports.ts` catches only literal imports.
- Fix: correct the doc, and make the check list the `@huntloop/jobs` exports that use the service role.
- Effort: S

### [Low] SEC-011 — CSP is report-only unless `CSP_ENFORCE=true` (S-2). `X-Frame-Options: DENY` is set.
### [Low] SEC-012 — Unauthenticated `/api/health` reveals which integrations are configured and probes the database on every call.
### [Low] SEC-013 — Dev build output was committed in `edcc877` and removed in `15a0047` (`apps/web/.next-verify/**`). I scanned it and the full history for key-shaped strings: no secrets, only library code. `.next-verify` is not gitignored.
### [Low] SEC-014 — `/api/csp-report` isn't rate-limited and forwards to Sentry (AP-5).
### [Low] SEC-015 — Re-joining restores the prior role (`0027:293-296`), and `accept_invitation` overwrites the role, so it can demote an owner (`0007:210-214`). The self-asserted `primary_domain` combined with `is_discoverable` defaulting to true (`0027:60`) lets look-alike workspaces surface to a company's staff.
### [Low] SEC-016 — Workspace slugs are first-come (20 per user). Brand slugs can be squatted.
### [Low] SEC-017 — Onboarding `saveCompanyAction` trusts a client-supplied `understanding` (including `kind:"fact"`) and an `isLive` flag. The provenance is client-asserted.

### [High] DB-001 — `0030_create_organization.sql` is missing from `pending-migrations.sql`
- Confidence: CONFIRMED for the bundle (I diffed each section: 0011–0029 are identical to the migration files, and 0030 is absent). Production impact UNVERIFIED.
- Where: `packages/db/pending-migrations.sql:1-2`. Workspace creation calls `create_organization` (`welcome/actions.ts:247`, commit 3d7bdce).
- Impact: a production database brought current from the bundle can't create workspaces, so onboarding is blocked.
- Fix: regenerate the bundle, and have CI fail when the bundle doesn't reach the latest migration.
- Effort: S · Mechanizable: yes

### [Medium] DB-002 — No index on `contact_points(person_id)`
- Where: `0003:118-136` (only `unique(org_id,kind,value)`). The people→contact_points embeds are used in `lib/data/opportunities.ts:184`, `rank-contacts.ts:251` and `advance-enrollments.ts:303`.
- Fix: `create index on contact_points (org_id, person_id) where deleted_at is null`. Effort: S

### [Medium] DB-003 — No composite `(org_id, id)` foreign keys
- Where: 181 single-column `references …(id)` and no composite FKs. Examples: `opportunities.company_id`, `request_score_recompute(p_icp)` (`0023:110-130`, the ICP isn't org-checked), `human_overrides.entity_id`.
- Impact: rows in one org can reference rows in another. FK checks bypass RLS, so they also act as an existence oracle.
- Fix: add `unique(org_id,id)` on parent tables and composite FKs on hot relations; org-check the ids passed to SECURITY DEFINER functions. Effort: M

### [Low] DB-004 — Orphaned or write-only tables
`company_gaps` has zero references, `company_merges` is written only by an uncalled wrapper, `evidence_citations` is written but never read, and `subscriptions` has no reader. `contact_frequency` is live, so the prior orphan claim is obsolete for it.
### [Low] DB-005 — Migration idempotency
0001–0010, 0013, 0016, 0020, 0028 and 0029 use bare `create table`/`create policy`, so they can't be re-run. `COMBINED-0024-0027.sql` is a stale duplicate.
### [Low] DB-006 — `resolveMembership` relies on RLS
It doesn't filter `memberships.deleted_at` itself (`packages/db/src/server.ts:49-65`). RLS covers it today.
### [Low] DB-007 — Fixture org `acme` in production
The seed now refuses the production ref (`seed.ts:128-145`). Whether sweepers process the fixture org in production is UNVERIFIED.

## Do not change
The auth-derived, id-free designs of `accept_invitation`, `create_organization`, `delete_own_account` and `claim_research`; the admin-only `hubspot_connections` RLS; the CRON_SECRET/Inngest verification; the mailbox OAuth state cookie; `safeNextPath`; the `record_unsubscribe` token model; `OrgScope`; encryption at rest for tokens.

## Could not verify
Production function grants (SEC-005/006), which migrations production has applied (DB-001), production env flags (`CSP_ENFORCE`, `PUBLIC_RESEARCH_ENABLED`), runtime reachability of internal addresses from Vercel (SEC-003), and the Apollo cost per call (SEC-004).

