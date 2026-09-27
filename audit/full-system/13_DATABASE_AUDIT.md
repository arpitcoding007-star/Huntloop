# Database audit

**28 migrations · 69 tables · 105 indexes · 236 schema-level assertions.**

## Verified

- **Migrations apply cleanly from empty.** `npm run test:migrations` runs all 28 in order against PGlite in-process and asserts behaviour, not just syntax. This is re-verified on every CI run.
- **RLS coverage is structural, not per-table discipline.** Two checks in the suite assert "every table with an `org_id` has RLS enabled" and "…has at least one policy", so a new table cannot be added without them.
- **Cross-tenant isolation is proven as a non-superuser**, so policies genuinely apply rather than being bypassed by the test's own privileges.
- **Views are `security_invoker`** — checked structurally, which prevents the classic "a view leaks across tenants because it runs as its owner" bug.
- **Epistemics are enforced by CHECK constraints**, not convention: `evidence_fact_needs_source` refuses a `fact` with no `source_url`; score dimensions are nullable so UNKNOWN cannot collapse to 0.
- **`db:doctor`** detects a partially applied schema by probing for specific functions, because "a half-applied schema does not announce itself".

## Orphan objects — created, never touched by application code

| Object | Migration | Verdict |
|---|---|---|
| `company_gaps` | `0003` | 🗑 zero reads, zero writes |
| `contact_frequency` | `0017` | 🗑 zero reads, zero writes |
| `evidence_citations` | `0022` | 🗑 zero reads, zero writes |
| `company_merges` | `0012` | 🗑 written only by `merge_companies()`, which is called by nothing |
| `merge_candidates` | `0012` | 🔴 written only by `resolve_entity`, which is never enqueued |
| `subscriptions` | `0001` | 🗑 "Because there is no billing" — `lib/data/directory.ts:112` |

Method: every `create table` name grepped against all `.ts`/`.tsx` outside migrations and the migration test suite, then each hit manually confirmed (this caught four false positives — `join_requests`, `public_research`, `rate_limits` and `subscriptions` are referenced via RPC, prefixed names or prose, and only `subscriptions` proved genuinely unused).

**Recommendation:** drop the first three in a `0029`. Keep `company_merges`/`merge_candidates` — they become live the moment `resolve_entity` is enqueued (`26` Phase 0.2).

## Schema design notes (good)

- **`external_ids` is generic over entity type** rather than an `apollo_id` column per table. `0012` argues this explicitly, and it paid off immediately: the HubSpot integration reused it for deal/company/contact mapping with only a CHECK-constraint widening.
- **`company_domains` separates the display key from the resolution key**, so `acme.io` and `www.acme.com` resolve to one company without rewriting `companies`.
- **Merge is a recorded operation with an undo path** — soft delete plus `merged_into_id`, so old links resolve to the survivor.
- **Append-only score tables** with `model_score` separated from the rule-adjusted `score`, plus `rule_trace`. This is what makes the learning loop answerable later.
- **Soft deletes are broad** — `deleted_at` appears across the tenant tables, with retention SQL in `0017`.

## Findings

| # | Severity | Finding | Evidence |
|---|---|---|---|
| D-1 | Medium | Three orphan tables (above) | grep + manual confirmation |
| D-2 | Medium | Retention SQL exists (`0017`) but `enforce_retention` only runs on a cron that was never configured; `purge_contact_data` has no caller at all | `15_JOBS_AUTOMATION_AUDIT.md` |
| D-3 | Low | `COMBINED-0024-0027.sql` exists as a paste-batch for manual application; `0028` has no equivalent, so the batching convention is now inconsistent | migrations dir |
| D-4 | Low | Migrations are applied **by hand** in production — no migration step in CI/CD | `19_TESTING_CICD_AUDIT.md`, `28_MANUAL_ACTIONS_REQUIRED.md` |
| D-5 | Info | No generated Supabase types; row types are hand-written and thin, forcing `type Query = any` in three places with documented reasoning | `scope.ts`, `cache.ts` |

## Indexes

105 across 69 tables, including partial indexes where they matter (`company_domains_one_primary` unique where `kind = 'primary'`; `merge_candidates_pending_idx` where `status = 'pending'`; the new `companies_signal_stale_idx` where `deleted_at is null`). No obviously missing index was found on the hot read paths inspected (opportunity list, opportunity detail, job claim). **Not verified under load** — see `18_PERFORMANCE_RELIABILITY_AUDIT.md`.
