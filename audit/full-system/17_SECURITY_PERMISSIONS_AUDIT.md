# Security & permissions audit

## 🔴 Critical — unpatched RCE in the pinned Next.js range

`npm audit --audit-level=high` exits **1** as of 2026-09-15, so CI's "Audit — dependency advisories" step is red:

| Package | Range | Severity | Advisory |
|---|---|---|---|
| `next` | 16.0.0 – 16.3.2 | **critical** | GHSA-p293-qw3h-jr36 — unauthenticated RCE on Windows-hosted servers |
| `next` | 16.0.0 – 16.3.2 | critical | GHSA-2xp9-vwfh-vxw4 — unauthenticated RCE in the Image Optimization API (AVIF) |
| `sharp` | <0.35.4 | high | GHSA-rgj7-g3m4-5g8c — libheif |

`apps/web/package.json` pins `next: ^16.3.1`. A non-breaking `npm audit fix` is available. **Nothing should deploy until this is patched and `npm run verify` re-run.**

Note the failure mode this exposes: the gate works, but nobody was watching its output. A red CI step is only a control if someone acts on it.

---

## What is genuinely strong

**Tenant isolation — the best-defended part of the product.**
- RLS on every table carrying `org_id`, with both a `tenant_read` and a `tenant_write` policy (`0012` and others use a `do $$ ... foreach` loop so a new table cannot quietly skip it).
- Proven, not assumed: `verify-migrations.ts` runs cross-tenant assertions **as a non-superuser**, so policies genuinely apply. 236 checks.
- Structural checks: "every table with an `org_id` has RLS enabled" and "…has at least one policy" are themselves tests.
- `OrgScope` (`packages/jobs/src/scope.ts`) makes the job-side boundary mechanical: every `select`/`update`/`delete` is pre-filtered and every `insert` has `org_id` injected *after* the caller's object, so a handler cannot express a cross-tenant write.
- The service-role client is confined to 5 named files, enforced by `check-admin-imports.ts` in CI **and** a second audit check (`SEC-ADMIN`) — two independent mechanisms, deliberately.

**Credentials at rest.** Mailbox OAuth tokens and the HubSpot token are AES-256-GCM encrypted in the application (`packages/db/src/crypto.ts`), so Postgres never holds the key. Refuses rather than storing plaintext when unconfigured.

**Request-path safety.**
- Every Server Action validates input shape *and bounds* with zod — enforced by audit check `SEC-VAL`, which fails the build on an unvalidated action.
- Rate limiting is Postgres-backed, per-user **and** per-org (`0005`), so ten seats cannot split one quota.
- Model-calling paths refuse when the caller's org cannot be resolved (`SEC-SPEND`) and consume both a rate limit and a monthly quota (`SEC-RATELIMIT`, `SEC-QUOTA`).
- SSRF guard on source fetching: `assertFetchable` re-checks on **every redirect hop** (`packages/jobs/src/fetch.ts`) — the hop re-check is the part most implementations miss.
- Cron endpoint refuses to run without `CRON_SECRET`, and answers 404 rather than 401 to an unauthenticated caller so the endpoint is not confirmed to exist.
- Unsubscribe is a token route; redemption of an invite is POST-only because "a GET that joins you to an organisation is a GET a mail scanner can fire".

**Secrets hygiene.** No credential literals found in tracked source. `.env.example` documents every variable the code reads (enforced by `REPO-02`). `SUPABASE_SECRET_KEY` is explicitly documented as never taking a `NEXT_PUBLIC_` prefix.

---

## Findings

| # | Severity | Finding | Evidence |
|---|---|---|---|
| S-1 | **Critical** | Unpatched Next.js RCE; CI dependency gate red | above |
| S-2 | Medium | CSP is report-only in the production target | `SEC-CSP-MODE` is a `warn`; `CSP_ENFORCE` documented in SETUP |
| S-3 | Medium | `audit_logs` is written but never read — no one can review privileged actions | `lib/data/audit.ts` has no reader |
| S-4 | Medium | No alerting on repeated job failure; a poisoned job fails 3× and goes quiet | `markFailed` in `queue.ts` |
| S-5 | Low | `STRIPE_*` secrets documented but unused — reduces the signal value of the env list | `.env.example` vs zero readers |
| S-6 | Low | `/kitchen-sink` design gallery ships in the production build | build output |
| S-7 | Info | Rate limiting "fails closed" when unenforceable (refuses model calls) — correct, and worth keeping | `RL-01` |

## Permissions model

| Role | Can |
|---|---|
| owner | everything incl. billing intent and final say on membership |
| admin | manage members, org settings, integrations (incl. the CRM token) |
| member | work opportunities, run hunts, send outreach |
| viewer | read-only, cannot change own role |

Two write tiers exist in the schema and the app honours both: `mutate(..., { minRole: "admin" })` turns what would be a raw Postgres policy violation into a sentence. The HubSpot connection is admin-gated in **both** directions (read and write), because the row holds a live credential — a member who can invite a teammate should not thereby be able to read the token that reaches the customer's CRM.

**Gap:** no permission covers *data export* or *erasure*, because neither exists yet (see `26` Phase 2).
