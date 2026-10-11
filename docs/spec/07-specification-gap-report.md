---
description: Final Specification Gap Report — what is documented, missing, contradictory, broken, awaiting decision, safe to do now, and the next steps. Holds the MIS / CON / DEF / DEC / REC registers.
---

# 7 · Specification Gap Report

> **As of 2026-10-08** · code at `feat/personal-learning` @ `4c8576a`.
> Index: [README](README.md) · [PRD](01-product-requirements.md) · [TRD](02-technical-requirements.md) ·
> [App Flow](03-app-flow.md) · [Design Brief](04-design-brief.md) · [Schema](05-backend-database-schema.md) ·
> [Plan](06-implementation-plan.md).
>
> **The one-paragraph truth.** Huntloop is a large, carefully built, well-tested product (45 migrations,
> 79 tables, 34 job handlers, 16 AI tasks, 33 workspace screens, 1,480 passing assertions). But
> **it has never been observed working end to end in production**: production runs an older commit
> than the documentation describes, has none of the keys the product needs, and nothing drives its
> background engine. The code is ahead of the deployment, and the deployment is ahead of the
> verification. Fixing that is mostly configuration, a merge, and a few decisions — not new features.
>
> **Update 2026-10-09** (second task: patch, audit against the design reference, complete what needs no decision).
> Resolved in the working tree, not yet committed or deployed: **DEF-16** (0 advisories; `next` 16.4.0,
> `undici` 8.11.2, `sharp` 0.35.5, `vitest` 4.1.11; typecheck/lint/all suites/site audit/build/Playwright green),
> **DEF-14** (IP-hash salt derived from the deployment secret), **REC-10** (job reachability and
> schema-reference drift now fail CI), **REC-13** (SECURITY DEFINER review → migration `0046`),
> **REC-15**, the secret scan (clean), and the **design-reference alignment** recorded in
> [Design Brief §15](04-design-brief.md#15--design-reference-boards-october-2026). Everything that needs a
> decision is unchanged and still listed in §5.

---

## 1 · What is already fully documented

| Area | Where | Confidence |
|---|---|---|
| Every screen, button, branch, message and route behaviour (≈ 1,200 lines of interaction tables) | [COMMAND.md](../../COMMAND.md) §0–§15 (normative detail), linked from [App Flow](03-app-flow.md) | High — 6 drifts found in a spot-check, none mechanical (CON-04…06) |
| Product purpose, users, features and their true status | [PRD](01-product-requirements.md) F-01…F-40 | High |
| Architecture, engine, AI tasks, security, env vars, CI | [TRD](02-technical-requirements.md) | High (code-derived); production facts are as of `/api/health` today |
| Complete data model (79 tables, columns, constraints, policies, functions) | [generated/schema-reference.md](generated/schema-reference.md) + [Schema](05-backend-database-schema.md) | High — machine-generated |
| Visual system (colour, type, spacing, components, themes, responsive) | [Design Brief](04-design-brief.md) from `tokens.css` | High |
| Principles and invariants (fact/inference/unknown, explainable scores, human-accepts-all-durable-AI-output) | PRD §5, `docs/product/vision-and-principles.md` | High |
| Product roadmap & shipped history | COMMAND.md §16 (P0–P6, K0–K6, L1–L12 all "Shipped") | High as intent; see CON-01 for *where* it shipped |
| Architecture decisions & audits | `docs/decisions/`, `audit/*` | Historical |

## 2 · What is missing (MIS)

| ID | Missing | Needed because | Where noted |
|---|---|---|---|
| MIS-01 | **Billing / checkout / invoices** (Stripe vars exist, read by no code; `subscriptions` unused) | Plans are metered and enforced but unpurchasable | PRD F-38 · Schema §7.2 |
| MIS-02 | **Record-level search** (⌘K finds pages only) | Large workspaces | PRD F-39 |
| MIS-03 | **Backups/PITR configuration and a rehearsed restore** (`docs/OPERATIONS.md` DB-02 still "not yet verified") | Migrations are forward-only | TRD §17/§22 |
| MIS-04 | **Mail authentication records** (no MX/SPF/DKIM/DMARC seen at last recorded check, 2026-09-28) | Product email deliverability; trust | TRD §10 |
| MIS-05 | **MFA / SSO / SCIM / session management UI** | Enterprise readiness (Master Context §86 "recommended") | PRD F-40 |
| MIS-06 | **Observability:** structured logs/drain, uptime + last-tick alerting, RUM; Sentry/PostHog unconfigured in prod | Cannot detect a dead engine | TRD §22 |
| MIS-07 | **Staging environment, CD migration gate, post-deploy smoke, signed-in E2E** (E2E runs demo-mode only) | Deployments are unverified | TRD §23 |
| MIS-08 | **Duplicate-company merge review UI** (SQL + handler exist) | Dedup is inert | PRD F-35 |
| MIS-09 | **Migration ledger** (applied by hand; only probe RPCs) | Cannot prove what is applied | Schema S-13 |
| MIS-10 | **Retention for operational tables** (`job_executions`, `ai_runs`, `provider_calls`, `audit_logs`, …) | Unbounded growth | Schema S-08 |
| MIS-11 | **Web3 signal packs** (Master Context §85 confirms the audience) | Stated market | PRD §19 |
| MIS-12 | In-app notification centre (optional) | Toast unused; attention = counts only | PRD §11 |
| MIS-13 | Accessibility conformance assessment / declared target | Claims unverifiable | TRD §20 |
| MIS-14 | Profile edit (email, avatar) | `profiles.avatar_url` orphaned | PRD §13.2 |
| MIS-15 | **Design reference boards 05 (Product screens) and 06 (Flows & architecture)** — listed in the reference's index, not supplied; only boards 00–04 were provided | Per-screen visual review against the reference is not possible; screens were checked against boards 01–04 and this pack instead | Design Brief §15 |

## 3 · What is contradictory (CON)

"Wins" = which side matches the code today.

| ID | Statement A | Statement B | Wins | Action |
|---|---|---|---|---|
| **CON-01** | `COMMAND.md` header, §16.0, §16.8 and `CHANGELOG.md`: release 0.1.0 is **"on `main`"** | `main` = `origin/main` = `14cf749`; 0.1.0 (`4c8576a`) is on local `feat/personal-learning`, **11 commits ahead, never pushed**; tag `v0.1.0` local only; PR #2 (`feat/p3-p6-roadmap`) open and unmerged | Git | DEC-01; correct wording after merge |
| **CON-02** | `docs/OPERATIONS.md` banner & `docs/status/*`: `apps/web/vercel.json` "commits a one-minute cron" | `vercel.json` is `{"$schema": …}` only; `tick.yml` states Vercel Cron was removed in `59f7942`; heartbeat is GitHub Actions `*/5` needing secrets | Code | Fix docs (done: banner) ; DEF-01 |
| **CON-03** | `docs/README.md`, `docs/status/*`, `docs/architecture/{database,data-model}.md`, `README.md` Status: 28 migrations, 69 tables, 63 functions, 12 AI tasks, 26 handlers, 71 actions, 19 nav, 1,024 tests, "ten screens", "four AI tasks" | **45 / 79 / 98 / 16 / 34 / 137 / 33 workspace pages / 1,480 assertions** | Code | Bannered; regenerate (P-10) |
| **CON-04** | `COMMAND.md` §11.1: "**No email is sent** — the admin must deliver the link"; §16.7: "Huntloop sends no product email today" | `inviteMemberAction` emails via Resend when configured; `0040` built Resend notifications/digests | Code | Edit COMMAND.md (applied) |
| **CON-05** | `COMMAND.md` §0.1: protected sections omit `assistant, competitors, demand, needs-you, performance` | `WORKSPACE_SECTIONS` lists 21 incl. those | Code | Edit COMMAND.md (applied) |
| **CON-06** | `COMMAND.md` §3: Google button "not rendered (temporarily hidden)" | `AuthForm.tsx` renders it when `NEXT_PUBLIC_AUTH_GOOGLE === "true"` (same file's §14.2 agrees) | Code | Edit COMMAND.md (applied) |
| **CON-07** | `docs/architecture/design-system.md`: green brand, violet = AI, "no shadows", warm-paper light; `tokens.css` header: "true-black `#08090A`"; `design/HANDOFF.md`: bands `#08090A`, single `#2F6BFF` | Implementation: blue brand `#1F58F0`/`#3F63BD`, AI = blue tint, `shadow-card` in light, canvas `#F7F8FA`, bands `#111111` | `tokens.css` values | Fix header comment (REC-15); banner design-system.md |
| **CON-08** | `docs/status/implementation-status.md` & `plans-and-quotas.md`: only 2 of 5 quotas enforced | `check_quota_internal` guards `opportunities` (creation), `ai_runs`, `emails` (before send), `enrich` (inside the unreachable handler), `seats`; all five are enforced where reachable | Code | Bannered |
| **CON-09** | `docs/status/*`: "GDPR erasure cannot be triggered" | Settings → Privacy `eraseContactAction` → `erase_contact_for_org` works; only the *job* `purge_contact_data` is unreachable | Code | Bannered |
| **CON-10** | `docs/status/*`: `company_gaps` "nobody reads" | `lib/data/company-intel.ts` reads `company_gaps` and `company_problems` | Code | Bannered |
| **CON-11** | `CHANGELOG.md`/`COMMAND.md`: migrations 0040–0045 "applied to production 2026-10-08" | Cannot be verified from the repo; production `/api/health` still reports commit `14cf749` and probes `hubspot_connections` | **Unverifiable** | P-0: run `db:doctor` against prod |
| **CON-12** | `docs/product/what-it-is.md`: "Not a CRM" | Master Context §85 (CONFIRMED): "HuntLoop should have CRM capabilities"; code has pipeline, activity ledger, owners, notes | Unclear | DEC-13 |
| **CON-13** | Onboarding offers goal **Reach out** and prompts "Connect a mailbox" | **Free plan includes 0 emails** (`plans` seed), and new workspaces start on Free | Code (both) | DEC-03: set Free emails > 0, or explain at the point of choice |
| **CON-14** | Two competing product naming/packaging sets: code plans Free/Growth/Scale vs Master Context §56 Core/Professional/Team/Enterprise | — | Code (current) | DEC-03 |
| **CON-15** | `OPERATIONS.md`/`SETUP.md` describe a Vercel topology of "two projects" | Last recorded: three projects (project notes 2026-09-28) | Unverified | DEC-06 |

## 4 · What is broken or incomplete (DEF)

Format: **current → expected · evidence · likely cause · fix**.

| ID | Status | Finding |
|---|---|---|
| **DEF-01** | **BROKEN (production)** | **The engine is not driven.** Current: `/api/health` → `cronSecret:false, inngest:false`; `/api/jobs/tick` answers 503. Expected: a tick at least every 5 min. Evidence: health JSON; `apps/web/vercel.json`; `.github/workflows/tick.yml` needs repo secret `CRON_SECRET` + variable `HUNTLOOP_URL` — **verified today: 0 secrets, 0 variables, and every scheduled `Engine tick` run is failing with "CRON_SECRET (secret) or HUNTLOOP_URL (variable) is not set"** (a red run every 5 minutes). Cause: configuration absent. Effect: nothing scans, discovers, scores, drafts, sends, syncs or learns; every "on the next engine run" message is untrue. Fix: DEC-02 → P-2 |
| **DEF-02** | **BROKEN (production) / UNVERIFIED** | **Production environment lacks every dependency** (Anthropic, Apollo, Hunter, ZeroBounce, Gmail, Outlook, Sentry, PostHog all `false`; `credentialEncryption:false`; Resend not reported). All AI shows "worked example"; mailboxes cannot connect. **And no live vendor call has ever been observed** in any verified environment. Fix: P-2 + P-3 |
| **DEF-03** | **BROKEN (production vs docs)** | **Production serves `main` @ `14cf749` — missing** `/assistant`, `/competitors`, `/demand`, `/outreach/log`, `/performance/report`, `/settings/you`, `/companies/{id}`, `/welcome/start`, the Resend email, the learning layer. Fix: P-1 (migrations first) |
| **DEF-04** | PARTIALLY EXISTS | **Deduplication is inert.** `resolve_entity` has no producer; `merge_companies_for_org` has no caller; no UI; `merge_candidates`/`company_merges` never written/read. `0012` states dedup must precede provider volume — currently inverted. Fix: DEC-07 → P-7 |
| **DEF-05** | PARTIALLY EXISTS | **`enrich_person` unreachable** → Hunter (`person.match`) and ZeroBounce (`email.verify`) are only called there, so `ENRICHMENT_API_KEY`/`EMAIL_VERIFICATION_API_KEY` have no effect; contacts arrive via `rank_contacts` (Apollo). Fix: DEC-08 → P-7 |
| **DEF-06** | PARTIALLY EXISTS | `purge_contact_data` job unreachable (UI erasure works). Low. DEC-08 |
| **DEF-07** | PARTIALLY EXISTS | **Schema objects without a reader or writer:** `company_merges`, `evidence_citations`, `subscriptions`, `events`; see Schema S-01. DEC-07/DEC-03 |
| **DEF-08** | PARTIALLY EXISTS | **Legal facts pending** (7: `entityName, registeredAddress, jurisdiction, privacyContactEmail, contactEmail, art27Required, prospectLawfulBasis`) → pages draft/noindex/unlinked; audit `LEGAL-01` warns. DEC-04 → P-6 |
| **DEF-09** | PARTIALLY EXISTS | **CSP is Report-Only** and the report sink (Sentry) is unconfigured, so no evidence exists to justify enforcing it. P-5 |
| **DEF-10** | **LIKELY BROKEN** *(derived, not reproduced)* | **A removed company cannot be re-added:** `deleteCompanyAction` soft-deletes; `UNIQUE(org_id, canonical_domain)` is not partial; re-adding returns "already on your list… edit the existing one", which the list hides. Fix: P-4/P-8 (DEC-16) |
| **DEF-11** | PARTIALLY EXISTS | **Schema gate checks one sentinel table:** `main` probes `hubspot_connections` (0028) though it needs 0039; the branch probes `user_questions` (0044) though it needs 0045. A partial migration can pass. Fix: P-4 |
| **DEF-12** | PARTIALLY EXISTS | **Soft-deleted rows stay readable** under every RLS policy (0/140 reference `deleted_at`); a loader that forgets the filter leaks "removed" data. P-4 (DEC-16) |
| **DEF-13** | PARTIALLY EXISTS | **Quota fail-open:** nullable `plan_id`, unvalidated `plans.limits`; an absent key means unlimited. P-4 |
| **DEF-14** | **RESOLVED 2026-10-09** (uncommitted) | Was: the anonymous-research IP hash fell back to a public default salt when `PUBLIC_RESEARCH_SALT` was unset. Now: an unset salt is derived with HKDF from `SUPABASE_SECRET_KEY` (own `info`); the constant remains only with no secret at all (demo build, nothing stored). Tested in `verify-jobs.ts` ("hashIp"). Rate-limit counters keyed on the old hash reset once on deploy. |
| **DEF-16** | **RESOLVED 2026-10-09** (uncommitted) | Was: 9 advisories (3 critical, 4 high), `next` 16.3.5 in the critical `next/og` RCE range, `main` CI red. Now: `npm audit` → **0 vulnerabilities**; `next` 16.4.0 (manifest floor `^16.4.0`), `undici` 8.11.2 (`^8.11.2`), `sharp` 0.35.5, `vitest` 4.1.11 in `apps/web` and `packages/ui` (removes `tinypool`; config renamed `vitest.config.mts`). `npm run verify` and Playwright pass locally. CI turns green on `main` once this lands there (DEC-01 sequencing). |
| **DEF-15** | PLANNED / deferred | K5 items deferred by design: learning research focus from analysed companies; recurring-task digests (need usage tracking, which §16.6 rejects without opt-in) |

**Also incomplete but not defects:** the Playwright suite was not re-run here; Toast component unused; tablet layout unspecific.

## 5 · What requires your decision (DEC)

| ID | Decision | Options | Recommended | Blocks |
|---|---|---|---|---|
| **DEC-01** | **Release strategy:** how does the unmerged work reach `main`/production? | (a) verify prod migrations → push branch → merge PR #2 + branch → deploy; (b) merge PR #2 only; (c) keep unmerged | (a), after P-0 verification | P-1 and everything after |
| **DEC-02** | **Engine driver** | (a) GitHub Actions `*/5` (free, can lag/pause); (b) Vercel plan with minute cron; (c) Inngest | (a) for pilot, (b) or (c) for GA; add last-tick alert either way | P-2 |
| **DEC-03** | **Billing & packaging:** build Stripe now/later/never; plan names (Free/Growth/Scale vs Core/Professional/Team/Enterprise); **should Free include emails?** (CON-13); which features gate by plan (assistant, team view — COMMAND §16.7-5) | — | Decide before pilot users hit Free's 0-email wall; build checkout only after DEC-04 | P-9, CON-13/14 |
| **DEC-04** | **Legal identity & data-protection facts** (entity, address, jurisdiction, privacy + general contact, Art. 27 decision, lawful basis; processors/regions) | owner/legal supply | — | P-6; any non-test sending |
| **DEC-05** | **Product-email sender domain & DNS** (SPF/DKIM/DMARC; Supabase SMTP via Resend) | — | Verify domain in Resend; route auth email through it | P-6 |
| **DEC-06** | **Vercel/GitHub hygiene:** retire the failing duplicate project and the stale CLI-deployed copy; GitHub branch protection | — | Retire both; protect `main` | P-1/P-5 |
| **DEC-07** | **Fate of deduplication:** wire + review UI, or retire | wire (before provider volume grows) / retire | Wire (the schema says it must precede volume) | P-7 |
| **DEC-08** | **Fate of `enrich_person` (Hunter/ZeroBounce) and `purge_contact_data`** | wire / retire | Wire `enrich_person` from `rank_contacts` if email deliverability matters; retire `purge_contact_data` (UI path suffices) | P-7 |
| **DEC-09** | **Enable anonymous `/discover`?** (cost exposure behind an unauthenticated endpoint) | on with cap / off | Off until P-3 proves cost per read | — |
| **DEC-10** | **CSP enforcement date** | after ≥ 7 quiet days of reports | follow rule | P-5 |
| **DEC-11** | **LinkedIn capture:** manual logging only vs a browser extension (COMMAND §16.7-2) | manual / extension | Manual (platform terms) | — |
| **DEC-12** | **Quality targets:** WCAG level; browser matrix; i18n; behaviour on expired session (redirect vs message) | — | AA; evergreen Chrome/Safari/Firefox; English only for now; redirect on expiry | P-8/P-10 |
| **DEC-13** | **CRM stance:** "not a CRM" (docs) vs "should have CRM capabilities" (Master Context) | — | State the boundary (pipeline + ledger yes, contact database no) in `what-it-is.md` | PRD wording |
| **DEC-14** | **Brand/domain pairing:** product "Huntloop" served at `seefluence.com`; canonical apex vs `www` (apex 307→www, `SITE_URL` apex) | — | Pick one canonical origin | SEO/OG/cookies |
| **DEC-15** | **Access model:** ownership is workflow-only today — every member can see/edit every opportunity and write rules/sources/campaigns | keep / add owner-scoped visibility | Keep for team sizes in plan limits; revisit with Team tier | Schema §5 |
| **DEC-16** | **Soft-delete semantics:** hidden from RLS reads? re-add restores or conflicts? | RLS `deleted_at IS NULL` + partial unique / restore-on-re-add | RLS filter + restore-on-re-add | P-4 |

## 6 · What can be implemented immediately (no decision needed)

| Item | Type | Notes |
|---|---|---|
| Docs corrections CON-02…CON-10 (banners, COMMAND.md drift 4–6) | Documentation | **Applied in this task** (see §8 "Changes made") |
| Fix `tokens.css` header comment (CON-07, REC-15) | Comment-only code edit | **Done 2026-10-09** |
| Add a reachability check (every `JobName` has a producer) and a schema-reference drift check to CI (REC-10) | Test/CI | **Done 2026-10-09:** `verify-jobs.ts` "reachability" (allow-list = DEF-04/05/06; fails on a new orphan *or* on a listed job gaining a producer) and `packages/db` `check:schema-reference` (part of `npm test`) |
| **Upgrade vulnerable dependencies** (DEF-16) | Maintenance | **Done 2026-10-09** (see DEF-16) |
| Verify production migration state with `npm run db:doctor` (P-0) | Verification | Needs `DATABASE_URL` (owner) |
| Backup/PITR confirmation in the Supabase dashboard | Verification | Owner |
| Run the Playwright suite locally and record the result | Verification | **Done 2026-10-09** — see TRD §16 |
| Secret scan of git history | Security | **Done 2026-10-09:** every commit on every branch scanned for Anthropic, Supabase, Resend, AWS, GitHub, Slack, Google, PostHog, Sentry, JWT, private-key and Postgres-URL patterns — **0 matches**; only `.env.example` is tracked |
| SECURITY DEFINER review (REC-13) | Security review | **Done 2026-10-09:** migrations applied to PGlite under Supabase's real default privileges (EXECUTE granted to `anon`/`authenticated` by name). 71 definer functions; 37 session-callable — all check the caller, are trigger functions, or are token-gated (`record_unsubscribe`), **except `usage_limit(org, metric)`**, which returned any workspace's plan limits to anyone. Fixed by migration `0046` (+ doctor probe + test). |
| Inventory of values actually written to the 7 un-CHECKed status columns | Analysis | Prerequisite for S-02 |

## 7 · What should NOT be implemented until you decide

| Do not start | Because |
|---|---|
| **Merging / pushing / deploying** the unmerged work | DEC-01; prod migration state unverified (code probes `user_questions`; a deploy before migrations 503s app routes). *Exception:* the DEF-16 dependency patch may land on its own first, on `main`, to turn CI green |
| **Billing / Stripe** | DEC-03, DEC-04 (legal identity, tax) |
| **Enabling anonymous `/discover`** | DEC-09 (unbounded-cost surface) |
| **Enforcing CSP** | DEC-10 / no report stream |
| **Wiring or deleting dedup, `enrich_person`, `purge_contact_data`, unused tables** | DEC-07/08; destructive and architecture-shaping |
| **Soft-delete/RLS/unique-key migrations** | DEC-16 — can hide rows the UI relies on |
| **Changing Free plan limits, plan names, or gating** | DEC-03 (commercial) |
| **Record search, notification centre, tablet redesign** | Not required by any confirmed goal; DEC-12 |
| **MFA/SSO/SCIM** | Not specified beyond "recommended" |
| **Any outbound send to real prospects** | DEC-04/05 (legal text, mail auth), P-3 |

## 8 · Highest-priority next steps

1. **Answer DEC-01, DEC-02, DEC-06** (a 20-minute conversation) and **run `db:doctor` against production** (CON-11).
2. **Patch the vulnerable dependencies** (DEF-16: `next` critical RCE advisory affects a feature the site uses on public routes) and get CI green — before or with the merge. — **done 2026-10-09 in the working tree** (DEF-16).
3. **Push and merge** the stack (after migrations 0040–0045 are confirmed in prod) so `main` = the documented release (P-1).
4. **Set `CRON_SECRET`** and the chosen driver (also silences the failing `Engine tick` workflow); confirm `/api/health` and a recorded tick (P-2).
5. **Add the Anthropic key; run the live-verification checklist** on a throw-away workspace with low caps (P-3) — the first real evidence the AI layer works.
6. **Supply the legal facts and mail DNS** (DEC-04/05) before any real sending (P-6).
7. **Integrity migration batch** (S-02/S-03/S-06/S-07/S-10) after DEC-16 and a backup point (P-4).
8. **Decide dormant capability** (DEC-07/08) with real data in hand (P-7).
9. **Observability + restore rehearsal** (P-11), then launch checklist (P-12).

### Changes made to the repository by this task (all documentation except one read-only script)

| File | Change |
|---|---|
| `docs/spec/**` | New: this pack (README, 01–07, `generated/schema-reference.md`) |
| `packages/db/scripts/schema-reference.ts` | New read-only generator (applies migrations to in-memory PGlite; writes one markdown file) |
| `docs/README.md`, `docs/SUMMARY.md` | Link to the pack; status block flagged as superseded |
| `docs/status/implementation-status.md`, `docs/status/doc-vs-code.md`, `docs/OPERATIONS.md`, `docs/architecture/{database,data-model,design-system}.md` | Correction banners pointing here |
| `COMMAND.md` | Five verified factual corrections (protected-section list, Google button, sign-in resend/change-address, invitation email, Resend decision) = CON-04/05/06; header and §16 status wording **untouched** pending DEC-01 |
| Product code, migrations, config, environment | **Unchanged** |

### Changes made on 2026-10-09 (second task — uncommitted)

| Area | Change |
|---|---|
| Dependencies | `npm audit fix` + `vitest` 4.1.11; `next` floor `^16.4.0`, `undici` floor `^8.11.2` → 0 advisories (DEF-16) |
| Design system (`packages/ui`) | Aligned to reference boards 01–04: pill badges in sentence case, claim chips, priority pills, score pill/ring incl. the *unknown* states, stat card, 5 px quota bar, hairline evidence list, empty state, `Note` `quiet` tone, `destructive` button for the armed ConfirmButton, field label weight, sortable table headers in capitals — Design Brief §15 |
| Brand placements | App icon and favicon on the board's dark tile; OG card mark-only on the current dark palette; product email header = mark + wordmark (new `/email-mark.png`); share report, invitation and legal pages carry the lockup; auth/onboarding/`/discover` lockup centred |
| Responsive / content defects | Command Center "Needs you" rail no longer forces the page wider than the viewport below 1440 px (it hid **Log touch** and **Draft**); "Hot HOT" duplication; sentence-case priority words |
| Security | DEF-14 derived salt; `0046` revokes session access to `usage_limit`; secret scan clean |
| CI | Job reachability check; schema-reference drift check |
| Docs | COMMAND.md: lockup/link-label rows; 14 stale inline "FLOW MISMATCH" callouts removed (all were already recorded as fixed in §14.1) |
| Not changed | Logo geometry (`BRAND_MARK_PATH`), anything gated in §7, product behaviour beyond the defects listed |

---

## 9 · Recommendations register

**RECOMMENDED — none of these is a requirement.** Format: what · why · benefit · dependencies · risk · immediate? · needs decision?

| ID | Recommendation | Why / benefit | Depends on | Risk | Now? | Decision? |
|---|---|---|---|---|---|---|
| REC-01 | Push `feat/personal-learning`, merge PR #2 and the branch, push the tag | Production and docs agree; unblocks everything | Prod migrations verified | Deploying before migrations → 503 on app routes (gate protects) | After P-0 | **DEC-01** |
| REC-02 | Pick one engine driver and add a *last-tick-age* alert | Engine is the product's heartbeat; GitHub cron can pause silently | Secrets | Cost (option b) | Yes once chosen | **DEC-02** |
| REC-03 | Provision prod env in dependency order (cron → AI → encryption key → Apollo → OAuth → Resend → Sentry/PostHog) | Each step is independently verifiable | Vendor accounts | Spend — set caps first | Yes | No |
| REC-04 | Migration ledger + CD gate that compares applied vs repo migrations | Removes S-10/S-13 class of failure | MIS-09 | Tooling choice | Design now | Minor |
| REC-05 | Generate counts in the docs book from code; retire hand-maintained status pages | Stops CON-03 recurring | P-10 | — | Yes | No |
| REC-06 | Record search in ⌘K | Usability at scale | RLS-safe index | Index maintenance; leakage if wrong | No | **Yes** (scope) |
| REC-07 | Enforce CSP after ≥ 7 quiet days of reports | Defence in depth | Sentry on | Silent page breakage | No | DEC-10 |
| REC-08 | Use the Toast for success feedback, or delete the component | Removes dead code / inconsistency | — | Pattern change across screens | Low priority | Minor |
| REC-09 | Retire the failing duplicate Vercel project and the stale CLI-deployed copy | Removes red builds and confusion | Owner access | Deleting the wrong project | After checking | **DEC-06** |
| REC-10 | CI: regenerate `schema-reference.md` and fail on diff; fail if a `JobName` has no producer | Prevents drift | — | Reachability check fails until P-7 | Yes (allow-list) | **Done 2026-10-09** |
| REC-11 | Branch protection + required CI on `main`; scan git history for secrets | Public repo hygiene | Owner access | — | Yes | No |
| REC-12 | Notification centre — only if email digests prove insufficient | Avoid building speculative UI | Usage data | Scope creep | No | Yes |
| REC-13 | Review the 71 SECURITY DEFINER functions for caller authorisation | They bypass RLS by design | Read-only review | — | Yes | **Done 2026-10-09** → `0046` |
| REC-14 | Rehearse a restore and record RTO | `OPERATIONS.md` still says "not yet verified" | Backup plan | Time | Yes | No |
| REC-15 | Fix the `tokens.css` header comment and banner `docs/architecture/design-system.md` | Removes CON-07 | — | None | Yes | **Done 2026-10-09** |
| REC-16 | One integrity migration bundle: CHECKs on 7 status columns, `plan_id NOT NULL`, `limits` shape CHECK, `deleted_at` handling, gate probes | Closes S-02/S-03/S-06/S-07/S-10 | Backup; DEC-16; value inventory | Existing rows violate a CHECK; RLS change hides rows | After decisions | **DEC-16** |
| REC-17 | Require `PUBLIC_RESEARCH_SALT` when anonymous research is on | Removes DEF-14 | — | Misconfig blocks feature | Yes | **Superseded 2026-10-09** — salt derived from the deployment secret instead, so no misconfiguration can block the feature |
