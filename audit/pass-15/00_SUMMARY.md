# Pass 15 — summary

**Commit audited:** `main` @ `8021d3f` + uncommitted working tree (2026-11-01). Production serves `8021d3f`; nothing from this session is deployed.

## A. What HuntLoop is today
A multi-tenant Next.js 16 app on Supabase with a Postgres-backed job queue. In code, the loop is complete: discovery (Apollo), company research and qualification (Claude), contact ranking and enrichment, sequences sent through the customer's own Gmail/Outlook, reply sync and classification, HubSpot push, and a learning loop. In production none of it runs: there is no job driver, no keys, and the canonical origin fails TLS. Every vendor path is proven only against scripted fakes.

## B. Architecture
Browser → Vercel (Next.js, `proxy.ts` guard + CSP) → Server Components/Actions over RLS-scoped Supabase → Postgres (48 migrations, RLS on every table) ← job engine (`packages/jobs`, claimed with `for update skip locked`, driven by GitHub Actions `tick.yml` every 5 min) → providers (`packages/providers`), Anthropic (`packages/ai`, 16 tasks on the 5.5 family), mailboxes, HubSpot. See 01_SYSTEM_MAP.md.

## C. Feature rollup
See 02_FEATURES.md. Working in code and tests: discovery, scoring, sequences and the send safety chain, reply handling, approvals, analytics. Partial: hiring signals, site facts, merge review, company removal, enrichment, CRM. Dead: `purge_contact_data` (by design; erasure runs through `erase_contact_for_org`). Missing: billing, legal facts, signed-in E2E.

## D–G. Counts
- **Critical 0** — no cross-tenant path, leaked secret or auth bypass found. The new merge actions are org-checked twice (action + `merge_companies_for_org`).
- **High 11** — production origin (PROD-001); removed/merged companies keep emailing (SEC-101); merge loses evidence (FLOW-102); evidence overclaims from the two free signal sources added this session (TRUST-101, TRUST-102/103); `enrich_person` outside the budget (PROV-003, regressed); failed reply classification (AI-009); warm-up cap churn (DB-101); approval can't release a gated message (OUT-011); research facts accept any URL (AI-002b); model links in unreviewed email (AI-007, mostly mitigated).
- **Medium 25**, **Low 14** — see 03_FINDINGS.md.

## H. Missing systems
Billing; signed-in/real-DB E2E; live vendor verification; erasure intake UI beyond the direct action; provider budget reservation.

## I. Broken connections
- Company/opportunity soft delete → enrollments (SEC-101).
- `merge_companies` → `evidence` (FLOW-102).
- New hiring/site evidence → scorer and draft (FLOW-103).
- Classification failure → enrollment stop (AI-009).
- `NEXT_PUBLIC_SITE_URL` → a TLS-valid origin (PROD-001).

## J–K. Maps
01_SYSTEM_MAP.md.

## L–O. Headlines
- **Security:** no Critical. Mailbox token ciphertext readable by all members (SEC-102); members can rewrite send-safety columns (SEC-103).
- **Performance:** 3 `loading.tsx` for 54 pages; `job_executions` grows forever.
- **UX:** irreversible merge in one click.
- **Product integrity:** the two free evidence sources added this session overclaim; fixed in this pass.

## P. Order
06_PLAN.md.

## Q. Do not change
RLS-as-tenant-boundary and `OrgScope`; `send_message`'s at-most-once claim and fail-closed `can_contact`; the SSRF-guarded `fetchPage`; the claim/evidence model (fact needs a source, unknown stays NULL); `check-admin-imports`; the scripted-fake test harnesses; `scripts/audit.mjs` as the place findings close.

## R. Target architecture
The current one. Close the soft-delete propagation in the database (triggers, not per-reader filters), route every paid call through `callProvider`, and make production a single verified origin.

## SYSTEM HEALTH
- **Architecture:** sound and consistent; boundaries enforced by tests.
- **Product functionality:** complete in code, unproven against vendors, not running in production.
- **Data integrity:** strong constraints; soft-delete propagation and merge were the gaps.
- **Security:** no Critical. Two least-privilege gaps on `mailboxes`.
- **Performance:** fine at current scale; missing route skeletons and pruning.
- **UX:** coherent design system; destructive merge lacked a confirm.
- **Integrations:** shapes unverified live (Apollo, HubSpot).
- **Production readiness:** not ready — origin TLS, no driver, no keys, 0048 unapplied.
- **Maintainability:** high; very well commented and tested.

## TOP 10 TO FIX FIRST
| # | Problem | Evidence | Impact | Depends on | Action |
|---|---|---|---|---|---|
| 1 | Removed/merged companies keep emailing | SEC-101 | Email without consent | — | DB trigger + guards |
| 2 | Merge drops evidence | FLOW-102 | Survivor under-evidenced | — | Move evidence in merge |
| 3 | Production origin fails TLS | PROD-001 | Links unusable | Vercel access | Certificate or site URL |
| 4 | Site facts overclaim | TRUST-101 | Guesses as facts | — | Tighten detectors |
| 5 | Job-board postings overclaim and never expire | TRUST-102/103 | Stale/foreign hiring signals | — | Ownership check, expiry |
| 6 | `enrich_person` outside budget | PROV-003 | Unmetered spend | — | Unwire until routed via providers |
| 7 | Classification failure keeps sequence | AI-009 | Follow-up after a reply | — | Stop on failure |
| 8 | Approval can't release gated message | OUT-011 | Sends stuck | — | Gate only unapproved |
| 9 | Warm-up cap churn | DB-101 | Queue churn | 0048 | Defer to midnight |
| 10 | Research facts accept any URL | AI-002b | Invented sources as facts | — | Domain check |
