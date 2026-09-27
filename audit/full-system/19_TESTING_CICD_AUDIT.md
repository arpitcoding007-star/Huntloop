# Testing & CI/CD audit

## Coverage today

| Suite | Count | What it proves |
|---|---|---|
| Migrations / RLS (PGlite) | 236 | schema applies from empty; constraints enforce product rules; **org A cannot read or write org B, as a non-superuser** |
| Pure domain (`packages/db`) | 121 | ICP parsing, identity/domain canonicalisation, contact ranking, discovery translation, credential crypto |
| Rules | 59 | scoring rule evaluation |
| Jobs | 199 | scope isolation, SSRF guard, extraction, runner claim/dispatch/deadline, send safety, reply matching, CRM push |
| Providers | 81 | cache keying, refusal vs empty, retry classification, Apollo/Hunter/ZeroBounce mapping |
| CRM | 20 | HubSpot search-then-write, 409 tolerance, association shape, graceful label degradation |
| UI (vitest) | 22 | sidebar unbuilt state, hover panel, data table focus semantics |
| Web (vitest) | 108 | validation, CSV, rate limit, opportunity mapping, spend guard |
| E2E (Playwright) | 68 | navigation, demo banner, no dead links, a11y, filters, agent panel, campaign picker |
| Static audit | 40 | repo, nav, demo honesty, security headers, CSP, spend/rate-limit/quota guards, provider seam |

**Total: ~950 automated assertions**, all run by CI on every push.

This is a serious test suite, and its character is unusual: most assertions target *properties that would keep looking correct if they broke* — a refusal mistaken for an empty result, a guessed email promoted to verified, a cached failure served as "no results". That is the right instinct.

## 🔴 The gap the suite could not see

None of the ~950 assertions can detect **an unreachable job**. The registry is a total map, so every `JobName` provably has a handler — and nothing proves any handler has a caller. Four orphan jobs (`enrich_person`, `resolve_entity`, `purge_contact_data`, `sync_hubspot`) sat fully tested and completely unreachable.

Likewise nothing asserts that the cron endpoint is actually scheduled — `sweep()` is tested in isolation, so the tests pass whether or not anything calls it.

**Recommended additions (high value, low effort):**

1. **Reachability test:** every `JobName` is in `SWEEPERS` or appears as an `enqueue({ name })` argument in the source tree. Would have caught all four orphans on day one.
2. **Cron presence check** in `scripts/audit.mjs`: if `/api/jobs/tick` exists, a `vercel.json` cron (or an Inngest function) must reference it.
3. **Quota coverage check:** every metric in `UsageMetric` has at least one enforcement call site. Would have caught `opportunities`/`emails`/`enrich`.
4. **Table reachability check:** every `create table` in migrations is referenced by application code or explicitly allow-listed as intentionally-unused. Would have caught the three orphan tables.

All four are the same idea as the checks already in `audit.mjs` — they close the class of "exists but nothing reaches it", which is this repository's characteristic failure mode.

## CI (`.github/workflows/ci.yml`)

Runs, in order: typecheck → lint → `npm test` → `audit:site` → `npm audit --audit-level=high` → build → bundle budget → Playwright (Chromium).

Strong. Two problems:

| # | Severity | Finding |
|---|---|---|
| T-1 | **Critical** | The `npm audit --audit-level=high` step **currently exits 1** (critical Next.js RCE). CI is red and the finding was not acted on — see `17_SECURITY_PERMISSIONS_AUDIT.md` |
| T-2 | **Critical** | **No migration deployment step.** Migrations are applied by hand, one file at a time, against the production Supabase project. `db:doctor` exists precisely because this goes wrong — and its own README says a project was found half-migrated |
| T-3 | High | No preview-environment deployment or smoke test against a running instance |
| T-4 | Medium | No rollback procedure documented |
| T-5 | Medium | Playwright runs against demo data only; no seeded-database E2E |
| T-6 | Low | No coverage reporting (deliberate — this suite is property-driven, not coverage-driven; noted rather than criticised) |

## Recommendation

1. Patch the advisory and make a red CI step a blocking event with an owner.
2. **Automate migrations.** Hand-applied migrations against production is the largest operational risk in the project, and it is the one thing `db:doctor` can only detect *after* it has gone wrong.
3. Add the four reachability checks — they are cheap and they defend the exact failure mode this audit found.
