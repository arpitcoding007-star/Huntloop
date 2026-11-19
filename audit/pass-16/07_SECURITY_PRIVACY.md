# Pass 16 — security and privacy

## Confirmed
| ID | Sev | Issue |
|---|---|---|
| OUT-201 | Critical | Operator stop/archive/close ignored for queued mail |
| DB-201 | High | Members can delete suppressions, forge approvals, hard-delete around 0049's triggers (PGlite; LIKELY on hosted) |
| PROD-001 | High | Unsubscribe and sign-in links point at an origin that fails TLS |
| API-201 | Medium | Magic-link login reveals whether an account exists |
| LIFE-201 | Medium | Erasure leaves PII in eight places, incl. plaintext suppression and provider cache |
| LIFE-202/204 | Medium | Stated retention not running; deleted workspaces never purged, still writable via `has_org_role` |
| SEC-201 | Medium | CSP report-only and its report channel is blind |
| SEC-203 | Medium | No key rotation; service key is the HKDF root of three secrets |
| JOB-204 | Medium | Recipient addresses printed to GitHub Actions logs |
| API-202/203, SEC-204/205, AUTHZ-203, LIFE-203 | Low | see 03_FINDINGS.md |

## Checked and sound (reviewer E unless noted)
SSRF guard in `packages/jobs/src/fetch.ts` / `packages/ai/src/url.ts` (private ranges, redirects re-checked, DNS rebinding); no XSS sinks (`dangerouslySetInnerHTML` audited); open-redirect guard (`safe-next.ts`, tested); cron and webhook secret comparisons are timing-safe and fail closed when unset; rate limiting (tested); lockfile integrity; no secret in tracked files (both `.env.local` and `.vercel` are git-ignored); a history scan of 114 commits for 17 vendor key patterns found nothing real (a deeper extraction was refused by the sandbox, see Not verified); invitation tokens unguessable, single-use, expiring, email-bound (reviewer B, I7); owner-role guards (I6); org reserved columns (I18).

## Needs verification
- DB-201 on the hosted project: `has_table_privilege('authenticated','public.suppressions','DELETE')`.
- Full git-history secret scan (`gitleaks detect` or equivalent, locally).
- Supabase Auth settings: email enumeration protection, session lifetime, signups toggle.

## Security

Method: I traced all 13 route handlers (`apps/web/app/**/route.ts`), all of `apps/web/proxy.ts`, the SSRF guard in `packages/jobs/src/fetch.ts`, the AI URL path (`packages/ai/src/url.ts` → `client.ts`), every secret comparison, and every `.or(` filter built from a template string. I also searched for every XSS sink.

### 1a. Confirmed controls (traced in code)

| Control | Result | Evidence |
|---|---|---|
| Cron route auth | Fails closed: 503 when `CRON_SECRET` is unset. Constant-time compare. 404 on mismatch | `apps/web/app/api/jobs/tick/route.ts:55-75,122-127` |
| Local demo `GET /api/jobs/tick` → 404 | **Expected, not a bug.** `apps/web/.env.local` defines a `CRON_SECRET` (name only checked). `scripts/dev-demo.mjs:27-33` clears only the Supabase and Anthropic vars, so the request reaches the secret check and an unauthenticated GET gets 404. Not the proxy: `/api/jobs/tick` is in `PUBLIC_PREFIXES` (`proxy.ts:118`) | — |
| Inngest route auth | Fails closed (404 without keys). 5-minute timestamp window. `timingSafeEqual` | `apps/web/app/api/inngest/route.ts` `verifySignature`. Protocol compatibility: SEC-202 |
| Digest-unsubscribe token | HMAC-SHA256 with an HKDF key, `timingSafeEqual`, UUIDs validated | `packages/jobs/src/email/digest-token.ts:38-48`, test `packages/jobs/scripts/verify-jobs.ts:3583` |
| Prospect unsubscribe | Token is UUID-validated. `record_unsubscribe` RPC. 404 on an unknown token, 503 with no DB | `apps/web/app/api/unsubscribe/[token]/route.ts`. Replay is idempotent, tested at `verify-migrations.ts:909-942` |
| Open redirect | `safeNextPath` rejects anything not starting with `/`, `//`, `\` and control characters. The proxy writes a path only. The callback and signout routes use it | `apps/web/lib/safe-next.ts`, `proxy.ts:338-343`, `app/auth/callback/route.ts`, `app/auth/signout/route.ts`. Test `apps/web/lib/safe-next.test.ts` |
| SSRF (crawler) | http/https only. DNS is resolved and **every** address checked. IPv6 is expanded first (v4-mapped, NAT64 64:ff9b::/96, 6to4). Redirects are manual and re-checked on each hop (max 5). A **connect-time lookup** in `guardedAgent` closes DNS rebinding. 4 MB cap, 15 s timeout | `packages/jobs/src/fetch.ts` (`isPrivateAddress`, `assertFetchable`, `guardedAgent`, `fetchPage`). Test `verify-jobs.ts:254`. Small gaps (Low, unexploitable without a hostile resolver): Teredo `2001::/32` and NAT64 local-use `64:ff9b:1::/48` are not decoded |
| SSRF (AI) | `normalizeUrl` has no private-range check. The URL only goes to Anthropic's server-side `web_fetch` with `allowed_domains`, so HuntLoop infrastructure never fetches it | `packages/ai/src/url.ts`, `packages/ai/src/client.ts:101-113` |
| XSS | Zero `dangerouslySetInnerHTML`, `innerHTML`, markdown renderers or `srcDoc` in `apps/` or `packages/`. React 19.2.8 escapes text and blocks `javascript:` hrefs (e.g. `BriefSections.tsx:130` renders model-sourced URLs). Inbound reply HTML is stripped to text (`mailbox/gmail.ts:339-345`). Product-email templates escape every value (`email/templates.ts:16`, test `verify-jobs.ts:3605`). The outreach HTML footer escapes the address and URL (`send-message.ts:856-877`). The digest-unsubscribe page puts only a verified, URI-encoded token in markup | grep over `apps packages` |
| Email header injection | The unsubscribe URL is regex-checked. Addresses must be a single address. Header text is stripped of control characters | `packages/jobs/src/mailbox/provider.ts:140-190`, test `verify-jobs.ts:1088` |
| CSRF | Server Actions carry Next's Origin check. The only cookie-auth route handlers that mutate are `POST /auth/signout` (logout only) and `POST /api/memory/extract`, which returns text and writes nothing. `@supabase/ssr` cookies default to `SameSite=Lax`. OAuth `start` is a GET that only sets a state cookie | route files above |
| CSV injection | `toCsv` neutralises formula prefixes | `apps/web/lib/csv-write.ts:9`, test `csv-write.test.ts` |
| PostgREST filter strings | All 10 template `.or()` filters interpolate server-generated values (ISO timestamps, DB uuids). The one user-derived filter strips `%_,()` and runs on the tenant client under RLS plus `.eq("org_id")` | `apps/web/lib/ai/workspace-context.ts:138`, `packages/jobs/src/handlers/schedule-*.ts` |
| Raw SQL | App code builds no dynamic SQL. The one `format('%s')` builds a column list from catalog names, not user input | `packages/db/migrations/0049_soft_delete_propagation.sql:169` |
| Rate limiting | Every model task and every credit-spending action goes through `consume_rate_limit`, per user then per org. It fails closed in production with no DB or a missing function | `apps/web/lib/rate-limit.ts:180-280` (23 call sites), test `rate-limit.test.ts`. Anonymous `/discover`: 5 per IP per hour plus 200 per day globally (`packages/jobs/src/public-research.ts`) |
| Dev surfaces in prod | `/kitchen-sink` and `/dev/onboarded` return 404 when `VERCEL_ENV=production` (`proxy.ts:221-223`). `/dev/onboarded` also returns 404 unless `NODE_ENV=development` (`app/dev/onboarded/route.ts:30`). `DEV_BYPASS` is a literal `false` in builds (`IcpStep.tsx:37-39`). **On preview deployments `/kitchen-sink` is reachable**, but it is fixtures only and imports no data layer (`app/kitchen-sink/page.tsx` imports) | — |
| Demo in prod | Production with no Supabase or a partial schema serves 503, not fixtures (`proxy.ts:228-247`). Its precision is limited by PROD-201 | — |
| Static headers | HSTS (no preload), nosniff, XFO DENY, frame-ancestors, Referrer-Policy, Permissions-Policy, `poweredByHeader:false` | `apps/web/next.config.ts`. The lead confirmed them live on www |

### 1b. Confirmed weaknesses (details in §11)

- **SEC-201.** CSP is report-only, and its report channel cannot see Chromium reports. The policy emits both `report-uri` and `report-to` (`lib/csp.ts:173-176`). Chromium prefers `report-to` and posts Reporting-API JSON: an array of `{type:"csp-violation", body:{effectiveDirective,…}}`. The handler reads only `csp-report` or kebab-case keys (`app/api/csp-report/route.ts`, `report["effective-directive"]`). Those reports fall through `if (!directive) return done()`. Sentry is also off in production (`sentry:false` from health). The "enforce after a quiet week" gate (`lib/csp.ts:24-31`, `SETUP.md:456`) therefore measures silence by construction.
- **SEC-202.** The Inngest verifier and registration endpoint are hand-rolled with no SDK. It signs the timestamp, then the body. The GET returns a home-made function manifest. It fails closed, so the risk is a dead alternative driver rather than an open door.
- **SEC-203.** There is no rotation procedure, and the Supabase service key is the root of three other secrets. HKDF derives from it: the analyze-verdict seal (`apps/web/lib/ai/seal.ts`), the digest-unsubscribe HMAC (`digest-token.ts:4-8`), and the public-research IP salt (`public-research.ts:250-262`). Rotating the service key silently invalidates every digest-unsubscribe link already sent and every stored IP hash. `MAILBOX_ENCRYPTION_KEY` has no key version, so rotating it forces every mailbox and CRM to reconnect (`docs/developer/environment-variables.md:86`).
- **SEC-204.** Workflows are pinned by tag (`actions/checkout@v4`, `setup-node@v4`, `upload-artifact@v4`) and have no `permissions:` block. `migrate.yml` holds the production `DATABASE_URL`.
- **SEC-205.** `check-admin-imports.ts` (`FORBIDDEN` = `createAdminClient` / `db/admin`) does not see the service role reached through `@huntloop/jobs` exports. `apps/web` imports `estimateReach`, `expandWithLookAlikes`, `stage*`, `disableDigest`, `reserveAnonymousResearch`/`recordPublicResearch`/`lookupPublicResearch`, `tick`, `sweep`. Each of them uses `adminClient()` (`packages/jobs/src/{reach,look-alike,first-run,public-research,scope}.ts`). I spot-checked `runStageAction`: membership and rate limit run before `stage*` (`welcome/building/actions.ts:134-184`). Full caller authz is reviewer B's scope.

### 1c. Needs verification

| Item | Why it is open | What settles it |
|---|---|---|
| Session cookie flags in prod (`Secure`, `SameSite`, lifetime) | Library default (`@supabase/ssr` 0.5.2); the repo does not set them | DevTools → Application → Cookies on a signed-in www session |
| Auth abuse controls (signup and magic-link rate limits, CAPTCHA) | Dashboard setting | Supabase → Authentication → Rate Limits / Attack Protection |
| `x-forwarded-for` trust for the per-IP limit | Correct only on Vercel, which overwrites the header | Confirm hosting stays on Vercel |
| Leaked-password / MFA policy | Not in repo | Supabase → Authentication → Providers / MFA |
| Every web → service-role caller re-checks membership | SEC-205 | Reviewer B trace |

---

## Supply chain and secrets

| Check | Result | Evidence |
|---|---|---|
| `npm audit --omit=dev` | 5 moderate, 0 high/critical. All are build-time: `@sentry/nextjs` → `@sentry/bundler-plugins`/`webpack-plugin` → `glob`/`minimatch`. The fix is a semver-major bump to 11.12.0 | `audit/pass-16/_raw/npm-audit.json` (prod 175 / total 626 deps) |
| CI advisory gate | `npm audit --audit-level=high`. Blocks on main, non-blocking on PRs | `.github/workflows/ci.yml` "Audit — dependency advisories" |
| Lockfile | v3, 626 packages, **all have `integrity`**, and every `resolved` is on `registry.npmjs.org` (612). CI uses `npm ci` | `package-lock.json` (scanned with node) |
| Install scripts | `@sentry/cli` (downloads a binary at install) and `fsevents` (optional, macOS) | lockfile `hasInstallScript` |
| `.npmrc` | none | — |
| GitHub Actions pinning | **By tag, not SHA** (SEC-204) | `ci.yml`, `migrate.yml` |
| Workflow `permissions:` | **Absent in all three workflows**, so the token gets the repo default. A default of `write-all` would give the `migrate` job a writable token next to the prod DB secret | `ci.yml`, `migrate.yml`, `tick.yml`. The repo default needs GitHub settings access (§15) |
| `.env.local` tracked? | No. `.env.local` and `apps/web/.env.local` exist on disk and both are ignored (`.gitignore:28 .env*`, `apps/web/.gitignore:2`). `git ls-files` shows only `.env.example` plus docs/env.ts | `git check-ignore -v` |
| `.vercel/` tracked? | No. Ignored (`.gitignore:27`) | — |
| Key files tracked | No `*.pem`, `*.key`, `id_rsa`, `*.p12` | `git ls-files` |
| `NEXT_PUBLIC_*` contents | `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`/`ANON_KEY` (RLS-bound by design), `SITE_URL`, `FEEDBACK_URL`, `HELP_URL`, `AUTH_GOOGLE` (flag), `SENTRY_DSN` (public by design), `POSTHOG_KEY`/`HOST` (used **server-side only**, `lib/analytics.ts:111`; the public prefix is unnecessary but harmless), `STRIPE_PUBLISHABLE_KEY` (unused), `HUNTLOOP_DEV_BYPASS` (flag), `VERCEL_ENV`. None is a secret | grep |
| Git-history secret scan (114 commits, `git log --all -G`) | **Nothing found.** I searched for these patterns: Anthropic `sk-ant-`, Supabase `sb_secret_`/`sb_publishable_`, HS256 JWTs, AWS `AKIA`, GitHub `gh[pousr]_`, Stripe `sk_live_`/`sk_test_`/`whsec_`, Google `GOCSPX-`, Slack `xox`, PostHog `phc_`, Inngest `signkey-`, PEM private keys, `postgres://user:pass@`. The Resend-shaped pattern `re_…_…` matched 8 commits, but anchored with `\b` it matches nothing at HEAD. The hits are substrings of identifiers (e.g. `…re_xxx_yyy`), so they are false positives. A follow-up history-wide listing of the matched strings was refused by the sandbox (see §15) | — |
| Service-role blast radius | Server-only through `packages/db/src/env.ts` `supabaseSecretKey()`. It is used by `packages/db/src/admin.ts`, `packages/jobs/src/scope.ts` and through `jobs` by 5 web-reachable modules (SEC-205). It is also HKDF root material for 3 other secrets (SEC-203). Leaking it means full RLS bypass for every tenant **and** lets an attacker forge analyze seals and digest-unsubscribe tokens | — |
| Rotation procedure | **None written** for any key. Only the encryption-key consequence is documented (`environment-variables.md:86`) | SEC-203 |

---

## AuthZ

### Role matrix vs enforcement (final DB state)

| Action | Doc (tenancy-and-permissions.md) | DB enforcement | App enforcement | Verdict |
|---|---|---|---|---|
| Read tenant data | all roles | `user_org_ids()` | layout `notFound()` | match |
| Work with opportunities | member+ | `has_org_role(…,'member')` | `mutate()` minRole | match |
| Change members | admin+ | `membership_write` admin + owner guard | `minRole:"admin"` + `canOwn` | match, except last-owner (AUTHZ-201) |
| Integrations (HubSpot) | admin+ | `hubspot_connections` admin | — | match |
| Integrations (mailboxes) | admin+ ("change the org, members, integrations") | **`mailboxes.tenant_write` member** | member | **doc/DB mismatch**: a member can connect/disconnect/edit mailboxes (P3, in DB-201 notes) |
| Provider accounts | admin+ | `provider_accounts` write admin; **read member-of** | — | ok (no secret columns) |
| Suppression list edits | not stated; compliance doc says suppression is the record of objection | `ALL:member` incl. DELETE | no UI | DB-201 |
| Erase / export contact, export org, retry/cancel job | admin | DEFINER wrappers check admin | `minRole:"admin"` | match |
| Delete workspace | owner | `delete_organization` owner | — | match |
| Audit log | doc: "read within org" | admin-only SELECT | — | doc drift |

### Sessions, invites, OAuth

| Check | Finding | Evidence |
|---|---|---|
| Session cookies | `@supabase/ssr` defaults: `path=/`, `SameSite=Lax`, `httpOnly=false`, `maxAge` 400 days, no explicit `Secure` (node_modules/@supabase/ssr/dist/main/utils/constants.js:4-11); no custom `cookieOptions` passed. httpOnly=false is the library design (browser client reads it) but means any XSS can lift the session (P3, AUTHZ-203) | `packages/db/src/server.ts:23-31` |
| Logout | POST only; `supabase.auth.signOut()` default scope = global → refresh tokens revoked; access JWT valid to expiry (Supabase default 1 h) but RLS re-checks membership per request | `app/auth/signout/route.ts` |
| Privilege change / removal | effective on next request (RLS reads `memberships` live); no session rotation needed | `user_org_ids`, `has_org_role` |
| Enumeration on login | one generic error for every OTP failure; success copy identical | `app/(auth)/actions.ts:96-115` |
| Password reset | none (magic link + Google only) | n/a |
| OAuth state/PKCE | `@supabase/ssr` forces `flowType: "pkce"` (createServerClient.js:29); `exchangeCodeForSession(code)`; `next` validated by `safeNextPath` (rejects `//`, `\`, control chars, non-`/`) | `app/auth/callback/route.ts`, `lib/safe-next.ts` |
| Invite token | `gen_random_uuid()` (122 bits), unique, 14-day expiry, single-use, email-bound, confirmed email required; readable by admins (credential-equivalent, bound to an address) | 0007:133-135, `accept_invitation` final (0047) |
| Invite accept error messages | distinguish "no longer valid" vs "different email": not an oracle at 122-bit entropy | `invite/[token]/actions.ts` |
| Last-owner protection | app-only and racy; DB permits; `delete_own_account` counts soft-deleted owners | AUTHZ-201 (repro in §8) |
| Removed member | loses access immediately (RLS); open sessions get empty results; jobs are org-scoped not user-scoped; no share-link feature found (`grep share` in app routes: none) | — |
| Suspended/deleted user | `delete_own_account` hard-deletes `auth.users`; cascades memberships/profiles/personal tables | LIFE-203 for what survives |

## Lifecycle and privacy

### Delete behaviour

| Entity | Delete path | Kind | Cascade reach | Orphans / residue |
|---|---|---|---|---|
| Organization | `delete_organization` (owner) | soft (`deleted_at`) + stop campaigns/enrollments/sources/queries | none (rows kept) | **all tenant data kept indefinitely; no hard purge, no restore** (LIFE-204) |
| User account | `delete_own_account` | hard (`auth.users`) | cascade: memberships, profiles, conversations→conversation_messages, attention_snoozes, join_requests, memory_evidence, notification_preferences, preference_signals/state, rate_limits, user_questions; set null: actor/approver/owner columns | `memories` with `scope='user'` keyed by `scope_id` (not an FK) survive with the deleted user's private notes (LIFE-203) |
| Member removal | soft (`memberships.deleted_at`) | soft | none | intended (keeps attribution) |
| Company | soft; 0049 trigger soft-deletes opportunities (**not live**) | soft | opps (0049) | merged: evidence re-pointed (0049) |
| Opportunity | soft; 0049 trigger stops enrollments, unschedules mail (**not live**); **hard DELETE allowed to members** | soft/hard | hard: enrollments cascade; messages set null and stay scheduled | DB-201 |
| Mailbox | soft + token nulling (`outreach/actions.ts:281-292`) | soft | — | — |
| Contact (erasure) | `erase_contact[_for_org]` | mixed | see below | LIFE-201 |

### PII inventory (by table/column) and erasure reach

| Table.column | PII | `erase_contact` handles? |
|---|---|---|
| `contact_points.value` | email/phone | deleted (email kind only; **phone/linkedin of the same person kept**) |
| `people.first_name,last_name,linkedin_url,departed_note` | name | nulled + soft-deleted; `title`, `seniority`, `department` kept |
| `messages.subject/body_*/to_email/from_email` | content, address | redacted / hashed |
| `enrichment_records.value/raw` | provider PII | deleted for matched people |
| `activities.body/summary` (manual) | free text | redacted; **trigger/backfill activities untouched** |
| `demand_signals` | quotes from replies/notes | deleted via `demand_forget_erased` trigger |
| `suppressions.value` (kind email, from `record_unsubscribe`) | **plaintext address** | **kept** (only a hash row is added) |
| `contact_frequency.email` | **plaintext address** | **kept** |
| `threads.participants`, `threads.subject` | addresses, subject | **kept** |
| `message_events.payload` | webhook/reply payloads | **kept** |
| `provider_cache.body/raw` | person-lookup responses | **kept** (pruned only by pg_cron `prune_provider_cache`, schedule UNVERIFIED) |
| `conversation_messages.content`, `memories`, `ai_decisions.output`, `outcomes.reason` | free text that can name the person | **kept** |
| `job_executions.payload/result` | `purge_contact_data` would store the email in plaintext (`purge-contact-data.ts:67-69`) | job has no producer (dead) |
| `audit_logs.meta` | sha256 of address | by design |
| HubSpot (external) | contact copies | **not propagated** (no CRM delete call) |
| AI provider logs (Anthropic), Sentry | prompts/errors | out of DB reach; not addressed |
| `ai_runs` | no prompt/output text stored (hash only) | n/a — good |

### Retention actually scheduled

| Mechanism | Trigger | Live? |
|---|---|---|
| `enforce_retention` → `prune_stale_contacts` per org with `contact_retention_days` | tick sweep, DAILY idempotency key (`runner.ts:238,306`) | depends on a tick driver (prod: none, per lead); `limit(50)` with no order/cursor (`enforce-retention.ts:58-63`) → orgs beyond 50 never pruned (P3, in LIFE-202) |
| `prune_job_executions` (30 d) | called by `enforce_retention` | **0049, not live** (call fails and is reported) |
| `prune_rate_limits` | pg_cron 03:17 (0006) | cron schedule not visible to doctor: UNVERIFIED |
| `prune_provider_cache` | pg_cron (0011:442-472) | UNVERIFIED (same) |
| `purge_expired_research` (public_research, 30 d expiry) | **nothing calls it, no cron** | **never runs** (LIFE-202) |
| `public_research_attempts` (ip_hash) | **no purge at all** | grows forever |

### Export completeness

`export_organization` (admin): org, members (role/date only), icps, products, companies, opportunities, activities, memories; **evidence, messages, people, ai_runs only as counts** (the function says so in its `note`). No export of contact_points, sequences/campaigns, scoring rules, suppressions, outcomes. `export_contact` (0037) covers the person, contact points, messages and activities. Partial by design and labelled; recorded as Partial in §9.

### Migration DR

50 forward-only files; no down migrations; 25 files use bare `create table` (not re-runnable; `migrate.ts` ledger `schema_migrations` + `--single-transaction` per file prevents double-apply; `MIGRATIONS_BASELINE` for hand-migrated DBs). Rollback = write a new forward migration. Configured DB lacks 0048–0050: every 0048–0050 fix is "Fixed in repo, not live". Applying 0049 as-is breaks mailbox connect (DB-203) — fix before applying.

## Trust and provenance (§8 engine/trust; every factual statement leaving the backend)

Enforcement layers found: (a) DB — `evidence_fact_needs_source` and `evidence_unknown_has_no_confidence` (`0002_icp_sources_evidence.sql:134-142`), `claim_kind` enum, `contact_points.verification_status` vocabulary (`0032`, TRUST-004), `addressable_source in ('provider','manual')` (`0013_icp_v2.sql:93-94`); (b) AI parse — `assertValidClaim` (`packages/ai/src/claims.ts`), per-task grounding; (c) UI — `aiGenerated` badges and inference counts (e.g. `[org]/dashboard/page.tsx:168-201`, `inbox/InboxView.tsx:350-361`, `opportunities/[id]/page.tsx:237`).

| Statement surfaced | Where it leaves the backend | Class | Label / grounding enforced where | Gap |
|---|---|---|---|---|
| Company facts (what they sell, buyers, problem, trigger) | evidence rows → company/opportunity pages; agent context | Fact = Provider-sourced or site-observed; else AI-inferred | DB fact-needs-URL; `research_company` downgrades off-domain "facts" to inference (`packages/ai/src/tasks/research-company.ts:232-239`, AI-002b) | URL is checked at domain level, not page level (a fabricated path on the company's own domain passes) — residual, P3, noted not filed |
| Competitor profile findings | `competitor_profiles`/`competitor_evidence` → competitor screen; drafts read competitors (`send-message.ts:662-672`) | Fact / AI-inferred | `assertValidClaim` only (`research-competitor.ts:277`); pricing inference → unknown | **no off-domain check**: a "fact" may cite any URL (TRUST-202) |
| Qualification verdict, priority, score, dimensions | Analyze screen; `opportunities`, `opportunity_scores` | AI-inferred (model) + Calculated (rules: `score` vs `model_score`, `rule_trace`) | `qualify_opportunity` rejects a fact citing an unread off-domain URL (`qualify-opportunity.ts:583-600`); seal binds what is saved (`lib/ai/seal.ts`); unmeasured dimensions are `unknown`, never 0 | none found |
| Why now | Analyze screen (not persisted) | AI-inferred over client-supplied claims | `explain_why_now` maps each cited claim to a supplied one (`explain-why-now.ts:305-310`) | by design the claims come from the browser; not persisted, so no reach beyond the caller |
| Agent / assistant answers | opportunity agent, workspace assistant | AI-inferred prose + cited claims/refs | `citedClaims` enum from evidence (`sales-agent.ts:253-265`); assistant citations filtered to known refs (`workspace-assistant.ts:238-258`) | prose itself unconstrained (inherent) |
| Outbound email body | the prospect's inbox (third party) | AI-inferred | `personalize_message` constrains citation ids to supplied evidence, refuses citing `unknown`; gate checks links/addresses/HTML only (`packages/jobs/src/gate.ts:31-66`) | the body's claims are not checked against the cited evidence; at autonomy ≥2 nobody reads it (TRUST-203) |
| Hiring / job-posting signals | evidence → scorer, drafts | Provider-sourced (`reliability:'provider_attested'`) | fact only with a posting URL, else inference (`fetch-company-signals.ts:118-128`); board ownership/host checks (TRUST-102) | contract comment says `postedAt → observed_at` (`packages/providers/src/contract.ts:271`) while code maps provider date → `event_date` (code is right; doc stale) |
| Homepage technology detectors | evidence | Site-observed fact or inference | embed-only patterns, vendor scripts as inference (`packages/jobs/src/handlers/profile-company.ts:26-40`) | none found |
| Source-event signals (news etc.) | `source_events` | Fact/inference about the document | excerpt must appear in the document; model domain must appear in text (`extract-signals.ts:280-305`) | none found |
| Contact email + status | people pages, send path | Provider-sourced (finder) → Verified (verifier `deliverable`) / User-provided (import: `verification_status:'unverified'`, `provider:'import'`, `imports/actions.ts` contact rows) | one vocabulary enforced (`0032`); FLOW-108 no downgrade | none found |
| Addressable-market estimate (ICP) | stored on `icps` | labelled **Provider-sourced** | DB allows only provider/manual | value comes from the browser (`welcome/actions.ts:409-411` → `lib/data/onboarding.ts:688-694`) and is stored as `'provider'` (TRUST-201); never read back today |
| Performance figures | Performance screen, CSV export | Calculated | deterministic `lib/performance/compute.ts`; CSV formula-escaped | none found |
| Performance narrative | Performance screen | AI-inferred over Calculated facts | every number must appear in a cited fact (`explain-performance.ts:16-22`) | none found |
| Public `/discover` reading | anonymous visitor; cached per domain and claimed at sign-up | AI-inferred (or example when no key) | cache key = canonical domain only; example flagged `isLive:false` and shown with a banner (`discover/*.tsx:144`), never cached | the cached reading is shown to later visitors with `researchedAt`; staleness bounded by the purge cron (`0047` purge-expired-research) |
| Learning findings / proposed rules | Learn screen | AI-inferred | approved rule created inactive (`learn/actions.ts:156-176`) | sample-size guards owned by reviewer C |
| HubSpot deal properties | customer's CRM (third party) | `huntloop_score` (AI+Calculated), `huntloop_why_now` (AI-inferred), `huntloop_evidence_url` | property labels "Huntloop — why now" (`packages/crm/src/hubspot.ts:41`) | no AI marker; back-link falls back to `https://app.huntloop.example` (`sync-hubspot.ts:125`) (TRUST-204) |
| Digest / notification emails | team members' inboxes | Calculated counts + links | links from `NEXT_PUBLIC_SITE_URL`; skipped when unset (`send-digests.ts:83-91`) | origin problem shared with FLOW-201 |
| Unscored opportunity | lists, map | Unknown | `null`, sorts last (`lib/data/opportunity-map.ts:53,99,353`, TRUST-008) | none |

