---
description: Functional, backend and systems audit of HuntLoop (no UI/visual review). Traces every flow, proves behavior by running it, and ends with a maturity assessment and a dev-ready backlog under audit/pass-N/
argument-hint: "[full | area ...] [--since <git-ref>] [--no-runtime] [--no-load]"
---

# HuntLoop system audit (functional / backend / architecture)

Arguments: `$ARGUMENTS`

You are HuntLoop's CTO, principal architect, backend and database engineer, security engineer and QA lead at once. Reverse-engineer how HuntLoop **actually works**, then say what is broken, missing, unsafe or unproven.

Product north star: *Who should I pursue next, why are they a good fit, what evidence supports that, and what should I do about it?*
Core loop: **Discover → Qualify → Enrich → Prioritize → Reach Out → Track → Learn**

**Out of scope:** visual design, layout, colors, typography, spacing, animation, copy. UI only matters as a *caller*: an entry point, a form that posts, a button that does nothing. For the visual and a11y side use `/audit ux`.

This command complements `/audit` (the broad program). Same pass numbering, same `audit/` home, different lens: **behavior, correctness, invariants and proof.**

---

## 0. Rules (read twice)

1. **Read-only.** No edits to code, schema, config or data. Only write files under `audit/pass-N/`. No migrations, no `db:seed`, no sends, no CRM writes, no provider calls that cost money or mutate. Never touch production data; prod is GET-only on `/api/health`.
2. **Urgent finding** (leaked secret, open tenant boundary, send without consent): stop and tell the user now, then continue.
3. **Code existing ≠ working.** A flow is `Working` only after you traced entry → action/route → logic → DB → provider → back, **and** either ran it or found a test that runs it. Otherwise it is `Implemented, unverified`.
4. **Docs and earlier passes are claims, not evidence** (`README`, `COMMAND.md`, `docs/status/*`, `audit/*`, comments). Disagreement is itself a finding.
5. **Every finding cites evidence**: `path:line`, migration, route, or command output you ran. Label `CONFIRMED` (traced or reproduced) · `LIKELY` (code strongly implies it) · `UNVERIFIED` (say what would settle it).
6. **Never print secret values.** Names only. If a secret is in code, git history or logs, give the location, not the value.
7. **Never claim a test passed, a vuln is fixed, or capacity exists unless you ran it.** No capacity numbers without measurements. Say "not measured".
8. **Don't invent requirements.** Separate *Implemented* / *Planned (cite the doc)* / *Missing and recommended (your opinion)*.
9. **Root causes, not symptoms.** Ten symptoms with one cause = one finding + ten locations.
10. **Don't recommend rewrites or tech swaps** unless evidence forces it. Every pass ends with a **Do-not-change** list.
11. **Try to disprove every Critical/High** before reporting it (guard in a caller, RLS, `proxy.ts`, later migration, unreachable flag). Drop, downgrade or confirm with a repro.
12. **No silent skips.** Keep `audit/pass-N/CHECKLIST.md` listing every module/area with `todo | in-progress | done | skipped(why)`. Update it on disk as you go so context compaction cannot lose it.

---

## 1. Scope

Parse `$ARGUMENTS`:
- empty / `full`: every area below.
- area keys: only those (Phases 0, 4, 5 still run).
- `--since <ref>`: weight toward `git diff --stat <ref>...HEAD`, but still follow the changed code's callers and callees.
- `--no-runtime`: skip Phase 3. `--no-load`: skip the load/concurrency probes in Phase 3.

| Key | Area | Start here (verify the paths exist) |
|---|---|---|
| `flows` | User journeys and state machines | `apps/web/app/**`, `COMMAND.md`, server actions |
| `api` | Routes, server actions, contracts | `apps/web/app/api/**`, `**/actions.ts`, `apps/web/proxy.ts` |
| `db` | Schema, RLS, migrations, integrity | `packages/db/migrations/`, `packages/db/src/`, `pending-migrations.sql` |
| `authz` | AuthN, sessions, roles, tenancy, IDOR | `apps/web/app/(auth)`, `app/auth`, `app/invite`, `docs/security/tenancy-and-permissions.md` |
| `engine` | Discover→Qualify→Enrich→Prioritize logic | `packages/jobs/src/handlers/*`, `first-run`, `look-alike`, scoring |
| `providers` | Apollo, Hunter, ZeroBounce, others | `packages/providers/src/**` (`budget`, `ledger`, `cache`, `call`) |
| `ai` | Every model call | `packages/ai/src/**`, `packages/jobs/src/ai.ts` |
| `outreach` | Mailboxes, send, sequences, compliance | `packages/jobs/src/mailbox/`, `send-message.ts`, `advance-enrollments.ts`, `api/{mailboxes,unsubscribe}` |
| `crm` | HubSpot sync, OAuth, webhooks | `packages/crm/src/`, `sync-hubspot.ts` |
| `jobs` | Queue, tick, cron, workers, retries | `packages/jobs/src/{queue,runner,registry,scope}.ts`, `api/{jobs,inngest}`, `.github/workflows/tick.yml` |
| `money` | Billing, plans, entitlements, **provider/AI spend** | grep first; see §2 `money` |
| `lifecycle` | Account/org/data lifecycle: delete, export, retention, restore | `enforce-retention`, `purge-contact-data`, migration `0049`, `docs/security/privacy.md` |
| `security` | Vulns, secrets, headers, abuse | whole repo + `npm audit` |
| `prod` | Deploy, env, observability, DR | `vercel.json`, `.vercel/`, `.github/workflows/`, `docs/operations/*`, `.env.example` |
| `perf` | Query cost, latency, scale | loaders, handlers, `docs/operations/performance.md` |
| `tests` | Coverage vs risk | `**/*.test.ts`, `e2e/`, `apps/web/test/`, CI |
| `debt` | Dead code, mocks, bypasses | `kitchen-sink`, `scripts/dev-*`, TODO/FIXME, seed/demo reachable in prod |
| `trust` | Provenance: no unsourced claim shown as fact | every place a factual statement leaves the backend |

---

## 2. Phase 0: Orient and baseline

1. Read the baseline: `audit/README.md`, the latest `audit/pass-*/` (`00_SUMMARY`, `03_FINDINGS`, `07_FIX_STATUS`), `docs/status/*`, `docs/operations/first-live-run.md`, `HuntLoop - Master Product, Technical & Engineering Context.md`, `COMMAND.md` (flow map: verify it, don't trust it).
2. Fix the audited commit: `git rev-parse HEAD`, branch, `git status --short`, `git log --oneline` since the last pass. Everything is judged at that commit.
3. Mechanical checks (read each script first; skip any that writes; failures are findings, keep going):
   ```
   npm run typecheck | npm run lint | npm test | npm run audit:site
   npm run build && npm run audit:bundle
   npm run db:doctor            # read-only; no creds => UNVERIFIED
   npm audit --omit=dev --json  # summarize; don't paste
   ```
   Also: count migrations vs `pending-migrations.sql` vs what the DB reports; `tsc` strictness flags; count of `any`, `as unknown as`, `@ts-ignore`, `eslint-disable`.
4. **Env inventory** (names only) from `.env.example`, `process.env.*`, `env.ts`, `vercel.json`, workflows: required vs optional, which feature dies without each, and whether code fails loud or silently degrades when it is absent.
5. **Capability probe for `money`:** grep for Stripe/Razorpay/Paddle/checkout/webhook/plan/entitlement/quota/seat. If there is **no billing code**, say so plainly, then audit the *substitutes*: per-org spend caps, provider budget (`budget.ts`/`ledger.ts`), plan-like limits, and note billing as `Missing`; do not invent a billing design. Check docs for whether billing is intended.

---

## 3. Phase 1: Static sweep (parallel, read-only subagents)

Group areas by shared code: `flows+api+trust` · `db+authz+lifecycle` · `engine+providers+ai+crm` · `jobs+outreach+money` · `security+prod+perf+tests+debt`. Give each agent: its areas and start paths, the baseline findings for them (so it says fixed / still open / regressed), **§0 verbatim**, its checklist from §8, and the Finding schema from §9. Agents return findings **only** in that schema plus a feature-status table. No subagents available: do areas serially and write each to disk before the next.

### 3a. Flow audit: required method

For every journey, fill this row (put them in `02_FLOWS.md`, one table per journey; critical ones also get a mermaid sequence or state diagram):

`Entry · Trigger · Caller (UI/cron/webhook/API) · Route or action · AuthN/Z check (where, file:line) · Validation · Logic · Tables read/written · External calls · Transaction boundary · Idempotent? · Expected · Actual · Failure modes · Edge cases · Status · Verified by (test/run/none)`

Journeys (include only what exists; mark absent ones `Missing`): sign-up, login/logout, email verify, password reset, OAuth, invite/accept, role change, org create/switch/delete, onboarding/ICP, discover/search/filter/save, company and person views, qualify/score, enrich (per provider), list/import/export, outreach draft → approve → send → reply → unsubscribe, sequence enroll/pause/stop, mailbox connect/disconnect/warm-up, CRM connect/sync/disconnect, notifications, learning/feedback loop, share links, public token pages, account/org deletion, data export, admin/ops actions, support recovery (locked out, wrong org, bad import).

Then find: dead ends, missing transitions, wrong redirects, UI that posts to nothing, handlers never enqueued, jobs enqueued with no handler, illegal state transitions the DB allows, duplicate operations on double-submit, flows that work only on the happy path.

### 3b. State machines (new; usually where the worst bugs hide)

Extract every status/enum column (lead, enrollment, message, mailbox, job, import, sync, invite, org, run) into a table: **states · allowed transitions (code) · transitions enforced by DB (check/trigger) · who can trigger each · terminal states · stuck-state recovery.** Flag states reachable only by manual SQL, states with no exit, and transitions enforced only in app code.

---

## 4. Phase 2: Things the standard checklists miss. Check these deliberately

**Invariants.** List the 15 to 25 invariants the product depends on (e.g. "a contact is never emailed twice per step", "no send after unsubscribe/suppression", "provider spend ≤ org cap", "an org never reads another org's rows", "soft-deleted rows never surface", "a job's side effect happens at most once"). For each: where it's enforced (DB constraint / RLS / app code / nowhere), and a test that would fail if it broke. Invariants enforced "nowhere" are top findings.

**Concurrency and repetition.** For each write path ask: two users at once? same user double-click? retried request? job claimed by two workers? tick overlapping a tick? `SELECT then INSERT` without a unique index? read-modify-write without a lock or `FOR UPDATE SKIP LOCKED`? counters updated non-atomically? Show the exact race and the constraint that would close it.

**Partial failure and compensation.** For every multi-step operation (send → mark sent, enrich → debit ledger, sync → write cursor, delete → propagate): what if step N fails or the process dies between N and N+1? Is the result duplicated, lost, or stuck? Is there a reconciler?

**Failure of dependencies.** For each external service: timeout, 429, 5xx, malformed body, partial page, revoked OAuth token, expired key, vendor outage, price change. Does the system degrade, retry with backoff and jitter, circuit-break, alert, or silently drop data?

**Time.** Time zones in send windows and quiet hours, DST, `now()` in app vs DB, clock skew with signed links/tokens, cron drift, "today" boundaries per org, token/link expiry, scheduled jobs missed during downtime (catch-up or lost?).

**Cost and abuse.** Per core-loop run: provider credits and AI tokens. Can a single user/org drive unbounded spend (loops, retries, fan-out, look-alike expansion, re-enrichment of unchanged data)? Is the budget check atomic with the spend? Is there a global kill switch? Rate limits on expensive endpoints per user and per org?

**Outreach and legal safety** (outbound email is the highest-harm surface): suppression list scope (org vs global), unsubscribe honored across mailboxes and sequences, List-Unsubscribe and one-click header, physical address/identity in footer, bounce and complaint handling that actually stops sending, daily caps and per-domain ramp, SPF/DKIM/DMARC guidance for the user's sending domain, reply-detection stopping sequences, consent basis recorded, region rules (CAN-SPAM, GDPR/PECR, CASL, India DPDP) as far as the repo claims them. Check `docs/security/outreach-compliance.md` claim by claim against code.

**Data lifecycle and privacy.** Soft vs hard delete, cascade reach, orphans after delete, PII inventory (tables/columns holding personal data), retention enforcement actually running, per-contact purge ("right to erasure") end to end including caches, embeddings, AI run logs, provider caches, backups, search index, CRM copies; data export completeness; what's in logs and Sentry; PII sent to AI providers; DPA/sub-processor list matches reality.

**Backup, restore, disaster recovery.** Is there a backup? Point-in-time recovery enabled? **Has a restore ever been rehearsed?** RPO/RTO stated vs real. How to roll back a bad migration, a bad deploy, a bad job batch (kill switch, replay, dedupe). Can migrations run twice? Are they forward-only? Is prod schema == repo (drift)?

**Observability.** For each critical flow: can you tell, from logs/metrics alone, that it failed, for which org, and why? Structured logs with request/job/org IDs, error tracking wired and tested, alerting on dead-letter growth / failed ticks / spend spikes / bounce rate, health check depth (does `/api/health` check DB, queue lag, last tick time or only return 200?), tick heartbeat (`docs/operations/heartbeat.md`).

**API contracts.** Consistent error shape and status codes, input validated with a schema at every boundary (zod or equivalent), output not leaking internal columns, pagination bounds (max page size), sort/filter allowlists (no raw column names from users), idempotency keys on POSTs that cost or send, versioning of public/token endpoints, CORS, body-size limits, webhook signature + timestamp + replay protection.

**Supply chain and secrets.** `npm audit`, lockfile integrity, install scripts, unpinned GitHub Actions (pin by SHA?), workflow permissions (`permissions:` least-privilege), secrets only in env, `NEXT_PUBLIC_*` contents, `.env.local` not tracked, key rotation procedure, service-role key blast radius, git history secret scan (names/locations only).

**Config and environment parity.** Local vs preview vs prod: different DB? different provider keys (sandbox vs live)? feature flags and dev-only bypasses reachable in prod? `first-live-run` runbook steps all actually possible with the code as it is? Several Vercel projects/domains/Supabase projects pointing at different code (split-brain); the domain migration (`docs/domain-migration-huntloop-pro.md`) fully reflected in OAuth redirect URIs, webhook URLs, cookie domains, CORS, link generation, CSP.

**Multi-tenancy under load.** One noisy org starving the queue (per-tenant fairness in `scope.ts`), cache keys including org ID, global singletons holding tenant data, background jobs running under service role without re-checking the org, realtime/channels scoped per org.

**AI correctness.** Output schema validation before persisting, retries on invalid JSON, prompt-injection from scraped/provider text, grounding (claim → source), determinism where scoring must be repeatable, model-version pinning, cost per call, fallbacks when the model is down, PII minimization, evals (any golden set?), ability to explain a score.

**Scoring/learning soundness.** Is the score a defined formula or an unexplained blend? Are weights versioned? Do outcomes feed back, with enough data to mean anything (sample-size guards)? Can feedback loops amplify bias or a single bad signal? Is a rescore reproducible for a past date?

**Documentation and operability.** Could a new engineer run, deploy, roll back and debug this from the docs? Is there a runbook per alert? On-call actions that today require manual SQL (list them: that is the "manual operations" register).

---

## 5. Phase 3: Runtime verification (skip with `--no-runtime`)

Use preview tools, not Bash, to run servers.

1. `preview_start {name: "huntloop-demo"}`; drive each critical journey as a user *only to observe behavior* (data, redirects, errors, network, console, server logs). Slow requests (>1s) noted. Demo mode proves nothing about the real backend: say so.
2. `npx playwright test`: report pass/fail honestly and what the suite does not cover.
3. **Failure injection (local/test DB only, never prod or real vendors):** force provider 500/429/timeout via the existing mocks/fixtures if they exist, kill a job mid-run, replay the same webhook twice, submit the same form twice, call a route with another org's IDs, call actions with no session and with a lower role. Record actual behavior. If no safe harness exists, mark `UNVERIFIED` and propose the test.
4. **Load/concurrency (skip with `--no-load`; local only):** measure, don't guess. At minimum time the heaviest loaders and claim path with realistic row counts; run `EXPLAIN` (read-only) on the top queries; fire N parallel claims on the queue if a test DB exists. Report numbers with the setup. For scale tiers (100 / 1k / 10k / 100k / 1M users) give **what breaks first and why, with a measured or `not measured` label**, never invented capacity.
5. **Production, read-only:** GET `/api/health` on each origin from config/`.vercel/`. Compare deployed commit, applied migrations vs repo, env presence (names), tick workflow target origin. Anything needing a dashboard (Supabase PITR, Vercel env, Sentry alerts, provider dashboards, DNS) is `UNVERIFIED` with the exact place to look.

---

## 6. Phase 4: Verify and synthesize

- **Disprove pass** on every Critical/High (rule 11). Merge duplicates.
- **Feature matrix** (`02_FEATURES.md`): feature · purpose · entry · backend · tables · providers · tests · ops-readiness · issues · missing · priority · **status** from: `Verified` (ran or tested) · `Implemented, unverified` · `Partial` · `Broken` · `Mock/Demo-only` · `Dead (built, not connected)` · `Planned, not built` · `Missing, recommended` · `Obsolete`.
- **Verification matrix** (`08_VERIFICATION.md`): feature · workflow · expected · actual · automated test (path or none) · verification status · known failure · recommended test. Untested ≠ verified.
- **Diff vs last pass:** each earlier finding `Fixed` (with proof) · `Still open` · `Regressed` · `Obsolete`; list new ones.
- **Invariant table**, **state-machine table**, **manual-operations register**, **external-integration inventory** (service · purpose · where · auth · creds (names) · data exchanged · webhooks · errors · retry · rate limit · timeout · status).
- **Mechanizable checks:** for each finding a script could catch, name the check for `scripts/audit.mjs` or a test. That is how this program closes findings.
- **Ordering** by consequence and dependency, not taste: data loss / security / unsafe sends → production-breaking → core loop → integrity/concurrency → reliability → spend → debt.

---

## 7. Phase 5: Write the report

Next pass number `N` from `audit/`. Write (name files so they sort):

```
audit/pass-N/
  README.md           index, commit, scope, method, NOT verified, CHECKLIST status
  CHECKLIST.md        every area/module and its state
  00_SUMMARY.md       executive answers (§10) + maturity table + top 10
  01_SYSTEM_MAP.md    architecture, data flow, integration map (mermaid)
  02_FLOWS.md         flow tables + state machines + diagrams
  03_FINDINGS.md      all findings by severity (schema §9)
  04_FEATURES.md      feature matrix
  05_VERIFICATION.md  verification matrix + tests run (with results) + missing tests (top 10)
  06_DB_AND_INVARIANTS.md  tables, constraints, RLS, drift, invariants, races
  07_SECURITY_PRIVACY.md   confirmed vs needs-verification; data lifecycle
  08_INTEGRATIONS_JOBS.md  integration inventory, queue/cron/webhook audit
  09_OPS_AND_SCALE.md      deploy, env, observability, backup/DR, measured perf, scale tiers
  10_MISSING_SYSTEMS.md    "Missing systems, functional gaps, blind spots" + manual-ops register
  11_DEBT.md          technical-debt register + do-not-change list
  12_ROADMAP.md       7 phases (§11) + developer-ready backlog (§12)
  13_ENV.md           env inventory (names only)
  14_DIFF.md          vs previous pass
```

Add **one row** for this pass to the table in `audit/README.md`; change nothing else there.

Finish with a **short chat message**: audited commit, top 3 to 5 findings (linked), counts by severity, what stayed `UNVERIFIED` and what you need from the user to settle it, and the path to `00_SUMMARY.md`. **Do not start fixing anything until the user reviews the report.**

---

## 8. Area checklists (prompts, not quotas; report only what you have evidence for)

**flows/api:** every route, server action, API handler with its auth requirement; unauthenticated-reachable list; actions callable with a forged org ID; response-shape consistency; redirect targets validated (open redirect); every `fetch`/`router.push` target exists.

**db:** every table with owner column, RLS on/off, policies per command, indexes vs actual query patterns, unique constraints backing "dedupe" claims, FK and `ON DELETE` behavior, nullable columns that code assumes non-null, enum drift, triggers/functions (`SECURITY DEFINER` + `search_path`), migration ordering/idempotency/reversibility, `migrations/` vs `pending-migrations.sql` vs prod, service-role usage (`check-admin-imports`), seed/demo reachability, N+1 in loaders, unbounded queries (no `limit`), connection mode (pooled vs direct) and serverless connection exhaustion.

**authz:** session cookie flags, expiry, rotation on privilege change, logout invalidates server-side, multi-device, invite token entropy/expiry/single-use/email-binding, role matrix vs enforcement, last-owner protection, removed member loses access immediately (incl. open sessions, jobs, share links), account enumeration on login/reset, reset token single-use, OAuth `state`/PKCE, suspended/deleted user behavior.

**engine/trust:** for each score/rank/filter/signal: inputs, rule or model, source, timestamp, deterministic vs AI, explainable, stale-data handling, can an unsupported claim reach a decision surface. Classify each factual statement: Verified · Provider-sourced · User-provided · AI-inferred · Calculated · Unknown.

**providers:** per adapter: auth, pagination, rate limit, retries, timeout, normalization/field mapping, entity resolution and dedupe, cache keys and TTL, budget and ledger atomicity, source attribution stored, behavior on missing/invalid fields, cost per run, **actual live status** (sandbox vs live, key present?).

**crm:** OAuth + token refresh, direction and entities synced, mapping, conflict resolution, duplicate creation, cursor/watermark integrity, failed-sync visibility, webhook verification, disconnect behavior, deletion propagation.

**jobs:** claim/lock semantics, visibility timeout, idempotency key per handler, backoff and max attempts, dead-letter and who sees it, per-tenant fairness, tick trigger chain (`tick.yml` → route → `CRON_SECRET`), Inngest live or dead, missed/overlapping ticks, handlers without enqueuers and the reverse, long jobs vs serverless timeout, poison-message behavior.

**outreach:** see §4 outreach block, plus token storage encryption, send idempotency (can a message go out twice after a crash between SMTP/API accept and DB update?), per-address send lanes (migration `0050`), warm-up, reply/bounce parsing, human approval gate really enforced server-side.

**security:** authN/Z on every action not just pages, IDOR, RLS bypass via service role, XSS (`dangerouslySetInnerHTML`, rendered AI/provider HTML, markdown), CSRF on cookie-auth mutating routes, SSRF (any user-controlled URL fetched server-side: check `packages/ai/src/url.ts`, `packages/jobs/src/fetch.ts`: private IP ranges, redirects, DNS rebinding), SQLi (raw SQL, `rpc`, string-built filters), command injection, file upload type/size/storage ACL, webhook signature/replay, rate limiting, CSP, security headers, `NEXT_PUBLIC_*` leaks, logs/Sentry PII, dependency CVEs. Classify Critical/High/Medium/Low/Info; split *confirmed* from *needs verification*.

**prod:** repo → Vercel → domain(s) → Supabase → providers consistent; env per environment; Node vs `engines`; runtime (Edge/Node); migrations applied in prod; CI gates (what a red build actually blocks, is `verify` run in CI?); deploy and rollback procedure; health check depth; backups/PITR; alerting; secrets rotation; cron reliability (GitHub Actions schedule is best-effort and can skip or delay).

**perf:** slowest routes with measured latency and cause, query plans for top queries, missing indexes, sequential awaits, blocking provider/AI calls in request path, caching, bundle size, memory/CPU-heavy handlers, per-tier "what breaks first".

**tests:** coverage by risk, not by line count. Do auth/RLS/tenant-isolation, send-idempotency, spend-cap, webhook-replay, migration and job-retry tests exist? What do the e2e tests *not* assert? Flaky tests? The 10 missing tests that would catch the most damaging failures, each with a one-line spec.

**debt:** dead files/routes/endpoints, duplicate logic (esp. business rules in the frontend that the backend should enforce), unsafe casts, missing types at boundaries, deprecated integrations, dev bypasses reachable in prod, TODO/FIXME/HACK, hardcoded values, placeholder responses, circular deps, unused deps.

---

## 9. Finding schema

```
### [SEV] AREA-NNN: short title
- Confidence: CONFIRMED | LIKELY | UNVERIFIED (what verifies it)
- Where: path:line · route · table/migration · job
- Evidence: what you saw or ran (≤5 lines quoted; never secrets)
- Trace/repro: call chain or steps
- Impact: user · tenant · data · cost · legal · prod
- Root cause: one sentence
- Fix: smallest change that closes the root cause; what else it touches
- Acceptance criteria: observable, testable
- Test to add: file + one-line spec
- Effort: S (<½d) | M (≤2d) | L (>2d) · Depends on: IDs · Mechanizable: yes (check) | no
- Status vs last pass: New | Still open (ID) | Regressed (ID)
```

**Severity by consequence.**
- **P0 / Critical:** cross-tenant read/write, auth bypass, secret exposure, data loss/corruption, prod down, core loop unusable, email sent or CRM written without consent or after unsubscribe, unbounded spend.
- **P1 / High:** a core-loop stage broken or faked; unsourced/inferred data shown as fact on a decision surface; missing idempotency/retry guarantee on anything that sends or writes externally; race that duplicates or loses data; backups unrestorable; missing index on a hot path.
- **P2 / Medium:** reliability gaps, missing secondary function, maintainability that will cause bugs, observability holes.
- **P3 / Low:** cleanup, consistency, future enhancement.

---

## 10. Executive section (in `00_SUMMARY.md`; each answer 2 to 5 sentences with links to evidence)

1. How does HuntLoop actually work internally? 2. Is the architecture right? 3. Which critical flows work, which are broken or incomplete? 4. Does the backend implement the intended business logic? 5. Is the database sound? 6. Are APIs correct and consistent? 7. AuthN/Z secure? 8. Are integrations really live? 9. Are background processes reliable? 10. Is error handling correct? 11. Data-integrity and concurrency risks? 12. Production-ready (yes/no/conditional, with the blockers)? 13. Biggest technical risks? 14. Essential missing functionality? 15. Fix immediately? 16. Build next? 17. Simplify or remove? 18. What breaks at 10x? 19. What would you do first as CTO?

**Maturity table** (one row each, a level and a one-sentence evidence-based reason, **no numeric score unless you can show the rubric**): functional completeness · backend quality · architecture · database integrity · API quality · security · privacy/compliance · reliability · integration completeness · observability · test coverage · infrastructure/DR readiness · scalability · cost control. Levels: `Not started · Prototype · Works in demo · Works in prod-like env · Production-hardened`.

Also the **TOP 10 TO FIX FIRST** table: problem · evidence · impact · depends on · action.

---

## 11. Roadmap (`12_ROADMAP.md`)

Phases: **1** Critical fixes (security, integrity, unsafe sends, spend) · **2** Core-flow completion and verification · **3** Backend/DB foundation (constraints, RLS, APIs, permissions) · **4** Integrations and async workflows · **5** Reliability, tests, monitoring, recovery, DR drill · **6** Scale and optimization (only what measurements justify) · **7** Product expansion (missing capabilities).

Per task: objective · current problem (finding IDs) · exact requirements · files/modules · dependencies · risks · tests required · acceptance criteria · effort · definition of done. Mark tasks that can run in parallel, and tasks that must land together (one migration + code change).

## 12. Backlog (`12_ROADMAP.md`, second part)

Ticket-ready rows: `ID · title · phase · priority · area · files · acceptance criteria · tests · effort · blocked by · mechanizable check`. One ticket should fit one PR.

---

## 13. Quality bar for your own output

- If a section has no findings, say what you checked and how, so "nothing found" is distinguishable from "not looked at".
- Prefer tables and mermaid over prose. Keep each file skimmable; the full report lives in files, not in chat.
- Reconcile counts: severity totals in `00_SUMMARY.md` must match `03_FINDINGS.md`.
- End `README.md` with **"Not verified in this pass"** and the exact access or action needed for each item.
