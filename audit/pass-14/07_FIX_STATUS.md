# Pass 14 — fix status

**Fixed on** 2026-09-30 · **From** `4ce78d7` **to** the commits below · **Method** the audit/fix command: one root cause per commit, a test that fails without the fix, typecheck + lint + package tests per change, and a full regression run against the Phase A baseline at the end (see *Verification*).

## Migrations to apply before deploying

The code in these commits reads columns and functions that only exist once these are applied. **Apply them to production before, or together with, the deploy.** Production is currently at `0030` (verified with `db:doctor` on 2026-09-29).

| Migration | What it does |
|---|---|
| `0031_tenant_write_hardening.sql` | Engine tables read-only to sessions; org-scoped queue idempotency; owner-role guard; deleted workspaces invisible and stopped; `delete_organization` fixed; `contact_points(person_id)` index |
| `0032_evidence_keys_and_provenance.sql` | `evidence.live_source_key` + upsertable unique index; `companies.last_enriched_at`; `opportunities.priority_set_by`; one email-verification vocabulary (existing rows mapped) |
| `0033_send_claim_and_provider_ceiling.sql` | `messages.send_attempted_at`; provider budget falls back to the plan limit |
| `0034_followup_requests.sql` | `crm_sync_requested_at`, `contacts_sought_at`; `org_has_hubspot()` |
| `0035_one_message_per_step.sql` | unique outbound message per (enrollment, step) |
| `0036_research_requests.sql` | `companies.research_requested_at` |

All six are additive and re-runnable. `npm run db:doctor` reports each by its `migration_00NN_applied()` marker.

## Commits

| Commit | Findings |
|---|---|
| `9133ccd` | SEC-001, SEC-002, SEC-005, SEC-006, SEC-007, SEC-009, SEC-015, PROV-009, DB-002; **new**: `delete_organization` referenced a column that does not exist |
| `bee8433` | RT-001, RT-002, TRUST-007, SEC-017, UX-006 |
| `c42b9a3` | FLOW-001, FLOW-002, FLOW-003, FLOW-004, FLOW-013, TRUST-001, TRUST-004, TRUST-010, PROV-004 |
| `5151715` | OUT-001, PROV-002, SEC-004 (budget) |
| `73d7d1f` | JOB-001, RT-005, TEST-002, DEBT-002, UX-005 |
| `f16ebb8` | RT-007 (CI red since 3d7292a) |
| `f7db4ac` | AI-001, PROD-008, PERF-01 warning |
| `91a8be6` | SEC-003, PROV-014 |
| `c288bd1` | SEC-004 (rate limits), SEC-008 |
| `a790fd6` | FLOW-005, FLOW-006 |
| `7cca687` | MAP-001, JOB-003, PROV-001, FLOW-012, CRM-001, CRM-004, CRM-006, UX-002 |
| `ee2775e` | PERF-002, PERF-005 |
| `9eec81d` | TRUST-002, TRUST-003, TRUST-005, TRUST-006 |
| `b570878` | AI-002, AI-003 |
| `b48f294` | OUT-002 |
| `4f5f810` | FLOW-007, FLOW-008 (H-1, Q-3, U-6) |
| `2f01672` | FLOW-010, OUT-005 |

## Needs a person (cannot be done from the repository)

| Finding | What is needed |
|---|---|
| RT-004 | Set production env on Vercel team `huntloop` → project `huntloop-web`: `ANTHROPIC_API_KEY`, `APOLLO_API_KEY` (and enrichment/verification keys), `CRON_SECRET`, `MAILBOX_ENCRYPTION_KEY`, Sentry DSN. Re-check `/api/health` for `ok:true`. |
| RT-005 / JOB-001 | GitHub → Settings → Secrets and variables → Actions: secret `CRON_SECRET` (same value as Vercel), variable `HUNTLOOP_URL`. The tick workflow now **fails** until these exist, by design. |
| RT-006 / PROD-002 | Delete the personal Vercel project `cmbatmans-projects/huntloop-web` (stale code on the production database) and the always-failing team project `huntloop`. |
| RT-007 (rest) | Enable branch protection on `main` requiring CI. |
| — | Apply migrations 0031–0036 to production (above). |
| OUT-009 / LEGAL-01 | Supply the seven legal facts in `apps/web/lib/legal.ts` (entity, address, jurisdiction, contacts, Art. 27, lawful basis). |
| XINT-001 | One recorded live call per vendor (Apollo, HubSpot, Anthropic, Gmail/Outlook) against a test account — no live call has ever been verified. |
| RT-009 | Pick apex or www and align `NEXT_PUBLIC_SITE_URL`, the Vercel primary domain and OAuth redirect URIs. |
| M-1 / SEC-011 | Turn `CSP_ENFORCE=true` once the report stream is quiet. |

## Deferred, with reasons

| Finding | Why not in this pass |
|---|---|
| FLOW-009 / H-4 next-best-action | A product feature (a composer over score, trigger, contact fit and outreach state), not a defect; needs a design decision on ranking. The inputs it needs are now correct and connected. |
| TEST-001 DB-backed test lane | Needs a disposable Supabase project (or local Supabase in CI) and its credentials. The PGlite migration harness now covers every new invariant here. |
| JOB-002 throughput / JOB-004 Inngest | Needs a hosting decision (minute-level cron or Inngest). The heartbeat now fails loudly instead of lying. |
| PROV-003 `enrich_person` | Deliberately left unwired: it bypasses the provider budget. Contacts arrive through `rank_contacts`, which uses the seam. Port or delete. |
| MAP-003 competitors | No writer for `competitors`; wiring needs the profile's competitor list to become rows. |
| H-8 billing / M-3 Stripe vars | Payment path is a product/commercial build, not a fix. |
| DB-003 composite FKs | A schema-wide change needing a data audit of production first. |
| TRUST-008 unscored = 0 | Touches the shared `ScorePill` and every sort; small but cross-cutting — next pass. |
| CRM-002 / CRM-003 / CRM-005, OUT-003 / OUT-004 / OUT-006 / OUT-007, JOB-006 / JOB-007, PROV-005–PROV-012 (except those above), AI-004–AI-008, PERF-001 / 003 / 004 / 006 / 007, UX-001 / 003 / 004 / 010, A11Y-001 / 002, SEC-010 / 012 / 014 / 018, remaining Low items | Medium/Low. Listed in `areas/` with location, cause and fix; none blocks the core loop once the items above are in place. |

## Verification

Final regression run on the last commit, against the Phase A baseline (all green at `4ce78d7`, CI red on 2 E2E specs):

| Check | Baseline | After |
|---|---|---|
| typecheck (all workspaces) | pass | pass |
| lint | pass | pass |
| db: migration harness (PGlite, as a non-superuser) | 247 checks | **279**, all pass |
| db: rules / pure / service-role boundary | pass | pass |
| jobs harness | 225 checks | **254**, all pass |
| ai / crm / providers | pass | pass |
| web unit (vitest) | 146 | **149**, all pass |
| `audit:site` | 0 failing · 2 warn | **0 failing · 1 warn** (LEGAL-01, needs a person). It caught one regression during the run — the new `huntNowAction` did not validate its input — fixed before this commit. |
| build | pass | pass |
| bundle budget | 245.7 of 275 kB | 245.7 of 275 kB |
| Playwright (desktop + mobile, production build) | 264 pass · **4 fail** | **268 pass · 0 fail** · 4 skipped |
| Demo walk-through | — | Hunt now refuses cleanly without a database; the worked example on Analyze has no Save and says why; the opportunity page shows inference badges and email status; no console or server errors |

Not verifiable here: behaviour against the production database and live vendors (migrations 0031–0036 are not applied there yet; no vendor keys exist).
