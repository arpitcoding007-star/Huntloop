# Data quality audit

## The canonical failure, and it is live

`0012_entity_identity.sql` opens with an argument that reads, in hindsight, as a prediction:

> A discovery provider … returns the domain it has on file, which may be the marketing site while the news names the product site, the acquired brand while the news names the acquirer, or `acme.io` while the article links `www.acme.com`. Under a single-column key each of those is a new company … **Duplicates created at provider volume are also the one class of data defect that gets harder to fix with time**, because every downstream row — evidence, scores, opportunities, sent messages — attaches to whichever duplicate happened to exist that day. This migration therefore ships **BEFORE any provider search does**, and the plan makes that a hard ordering constraint.

The migration shipped. The **runtime** did not: `resolve_entity` — the job that writes `company_domains`, resolves provider ids and proposes merges — is **never enqueued**. `discover_companies` runs. So the ordering constraint the migration called hard is currently inverted in the running system: provider-volume company creation with no resolution behind it.

Nothing is broken yet because discovery has barely run (see `05_DISCOVERY_AUDIT.md`). The moment the cron is enabled, duplicate accumulation begins.

## Identity rules — built, correct, unused

| Rule | Where | Status |
|---|---|---|
| Domain canonicalisation (lowercase, strip scheme/`www.`/trailing dot, punycode, drop port/path) | `packages/db/src/identity.ts`, CHECK-enforced in `company_domains` | ✅ used at write time |
| Social URLs are never a company identity (`linkedin.com` → null domain) | adapter + identity | ✅ unit-tested |
| Exact resolution: domain first, then provider id | `resolve_company()` SQL | 🔴 function exists, caller unreachable |
| Fuzzy matching **proposes, never resolves** | `identity.ts` `compareCompanies` | 🔴 output goes to `merge_candidates`, which nothing writes |
| Merge is recorded and undoable | `merge_companies()` + `company_merges` | 🔴 never invoked |
| Rejected pairs are never re-proposed | `merge_candidates.status` | 🔴 unused |

The design is better than most production CRMs. It simply never executes.

## Contact-level quality

| Control | Status |
|---|---|
| Only provider-asserted `verified` emails count as verified | ✅ enforced in the adapter, unit-tested across 9 statuses |
| Derived addresses (Hunter score) are high-confidence but **never** `verified` | ✅ |
| Ambiguous verification statuses round **down** | ✅ ZeroBounce mapping |
| Phones stored `medium`, never verified | ✅ |
| No address is ever guessed (`first.last@`) | ✅ explicit non-goal, enforced by "no provider → refuse" |
| Contact deduplication | 🔴 depends on `enrich_person`/`resolve_entity`, both unreachable |
| Stale-contact decay | 🟡 `contact_frequency` table exists and is unused; `enforce_retention` is cron-gated |

## Company data freshness

`enrich_company` re-enriches after `STALE_AFTER_DAYS = 30`, matching the 30-day cache TTL so a sooner ask would be a guaranteed cache hit. Sound. But the sweep that would trigger re-enrichment across an org is cron-gated, so in practice company data is enriched once, at discovery, and never refreshed.

Contradictions **are** modelled: `flag_contradictions()` marks two sources disagreeing about a field, and `0022` merges duplicate claims about the same event across outlets while keeping all citations ("corroboration is the whole point of merging").

## Findings

| # | Severity | Finding |
|---|---|---|
| DQ-1 | **Critical** | Entity resolution never runs while company creation does |
| DQ-2 | **Critical** | No merge review UI, so even proposed duplicates could not be resolved by a human |
| DQ-3 | High | Contact identity resolution unreachable (`enrich_person`) |
| DQ-4 | Medium | No company-data refresh in practice (cron) |
| DQ-5 | Medium | No data-quality surface: nothing tells an operator "you have 40 probable duplicates" |
| DQ-6 | Low | `contact_frequency` unused — either wire it to cadence enforcement or drop it |

## Canonical matching rules (recommended, mostly already implemented)

1. **Company identity = canonical domain**, resolved through `company_domains` (primary/alternate/redirect/former/acquired), never the raw provider value.
2. **Exact match only for automatic resolution**: domain, then provider id. Everything softer proposes.
3. **Automatic merge only at `high` confidence** from an exact provider-id or exact-domain match; everything else waits for a person.
4. **Contact identity = (company, email)** where a verified email exists; otherwise `(company, normalised name, title)` as a *proposal* only.
5. **Never merge on name similarity alone** — `0012` already refuses this, correctly.

The rules are right. They need a caller and a review screen.
