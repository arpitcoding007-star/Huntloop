# Discovery & prospecting audit

## How a company can enter the system today

Three channels, modelled as one abstraction in `0014_discovery.sql` (`discovery_runs.channel` = `provider` | `source` | `import`):

| Channel | Handler | Triggered by | Status |
|---|---|---|---|
| Provider search | `discover_companies` | `first-run.ts` (onboarding) **or** `schedule_discovery` (cron) | 🔴 both paths effectively dormant |
| Source scan | `scan_source` | `schedule_scans` (cron) | 🔴 cron |
| CSV import | import flow | user | ✅ works |

## 🔴 The central finding: discovery runs once, then never again

There is **no in-app control that starts a hunt.** Searching `apps/web/app/(app)` for `enqueue(` returns only `inbox/actions.ts` and `learn/actions.ts`. Discovery is reachable only from:

1. `packages/jobs/src/first-run.ts:323` — `runHandler(orgId, "discover_companies", …)`, driven inside the onboarding request so results appear while the user watches;
2. the `schedule_discovery` sweeper, which claims due `discovery_queries` — and which has never been triggered, because no cron existed until 2026-09-15.

So in every deployment to date, a workspace discovers companies during onboarding and then stops. A user who edits their ICP, adds a segment, or simply comes back on Monday has no way to ask the product to look again.

This is the single largest gap between what the landing page promises ("Search your market for companies matching your profile, and watch the sources where they show up") and what the software does.

## Quality of what is built (high)

`discover_companies` is the strongest handler in the repository:

- **A failed search never looks like an empty market.** Every exit writes a `status` and a `stop_reason`; `succeeded` is reachable only when the provider actually answered and there was nothing left to read. `0014`'s header calls this "the rule the whole file is built around", and it is correct — a customer who reads "0 companies match your ICP" edits a profile that was fine.
- **Resumable and bounded.** `DEFAULT_MAX_PAGES = 5`, `PAGE_SIZE = 25`, cursor persisted, so a 4,000-company market is enumerated over several days rather than one afternoon that empties a month's credits.
- **Idempotent three ways**: one open run per query, unique `(run, provider, provider_id)`, and counts derived rather than accumulated.
- **It does not create opportunities.** It produces companies and enqueues `score_opportunity`, because the searcher "has a provider's attribute match, not evidence" — putting the verdict where the context is.

## ICP → provider translation

`packages/db/src/discovery.ts` maps the 15 ICP criteria keys onto provider filters and — importantly — **reports what it could not express** (`discovery_queries.unmappable`). The Apollo adapter continues this honesty: industries are sent as free-text keywords because Apollo wants internal tag ids "and sending the names as keywords is lossy and honest; sending them as tag ids would silently match nothing".

Employee ranges map to a **superset** of Apollo's bands, filtered locally, because "a superset is filtered at our end where the exclusion is visible with a reason; a subset would silently drop companies the customer asked for".

## Apollo's role

Currently serves four capabilities: `company.search`, `company.enrich`, `person.search`, `person.match` (and, since 2026-09-14, `company.signals`). Hunter takes `person.match` when configured, as the cheaper specialist; ZeroBounce serves `email.verify`.

This division is right and should be kept. Apollo should remain the primary discovery and contact provider; HuntLoop should not attempt to build a database. See `21_PROVIDER_INTEGRATIONS_AUDIT.md` for the fallback gap.

## Findings

| # | Severity | Finding |
|---|---|---|
| DI-1 | **Critical** | No in-app trigger for discovery — the product hunts once, at onboarding |
| DI-2 | **Critical** | Scheduled discovery has never run (no cron) |
| DI-3 | **Critical** | `resolve_entity` never runs, so provider-volume duplicates accumulate unchecked — the exact failure `0012` said must be prevented *before* provider search shipped |
| DI-4 | High | No saved-search management UI: `discovery_queries` can be previewed (`discovery-preview.ts`) but not created, edited or paused by a user |
| DI-5 | Medium | Signal scheduler scans every Apollo-known company rather than only those with live opportunities (deliberate v1; documented in-file) |
| DI-6 | Medium | Apollo's 50,000-record result ceiling is handled (`partial`), but nothing surfaces "your market is larger than we can enumerate" to the user |
| DI-7 | Low | `first-run.ts` encodes discovery ordering a second time |

## Recommendation

1. **Build a "Hunt now" control** (opportunities screen and/or sources screen) that enqueues `discover_companies` for the org's active query. ~30 lines. Highest value-per-line change available in the product.
2. **Enqueue `resolve_entity`** at the end of `discover_companies`.
3. **Build saved-search management** so a user can run more than one profile.
