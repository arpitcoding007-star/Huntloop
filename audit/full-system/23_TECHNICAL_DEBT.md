# Technical debt & dead code

**Unusually low.** Zero `TODO`/`FIXME`/`HACK`/`XXX` markers across `apps/` and `packages/`. No duplicated services. No abandoned parallel implementations. No feature flags left behind.

The debt that exists is of one specific kind: **things that were built and never connected**, plus **documentation that describes a product that no longer matches the code**.

## Dead code and dead objects

| Item | Type | Evidence | Action |
|---|---|---|---|
| `company_gaps` | table | `0003`; zero code references | **Remove** (migration `0029`) |
| `contact_frequency` | table | `0017`; zero references | **Remove** |
| `evidence_citations` | table | `0022`; zero references | **Remove** |
| `subscriptions` | table | `0001`; "there is no billing" (`directory.ts:112`) | Keep **only if** billing is imminent; otherwise remove |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | env | declared, read by nothing | Remove or implement |
| `enrich_person`, `resolve_entity`, `purge_contact_data`, `sync_hubspot` | jobs | registered, never enqueued | **Connect** (not remove — all four are needed) |
| `merge_companies_for_org()` | SQL function | built for a Server Action that does not exist | **Connect** |
| `company_merges`, `merge_candidates` | tables | writers unreachable | Connect with the above |
| `audit_logs` | table | written, never read | Build a reader |
| `/kitchen-sink` | route | design gallery in the production build | Exclude from production |

Nothing here is *legacy* in the usual sense — none of it is superseded. It is all **premature completeness**: capability built ahead of its trigger.

## Documentation debt (the largest category)

| Document | Claim | Reality |
|---|---|---|
| `README.md` | "eleven of the seventeen nav destinations are not built" | 19 destinations, **all built**, none marked unbuilt |
| `README.md` | "nothing sends an email" | `send_message` + Gmail/Outlook adapters exist, tested |
| `README.md` | "nobody can be invited" | `inviteMemberAction` complete with seat quotas |
| `README.md` | "the Command Center and sources screens still render illustrative figures" | both read live loaders with honest fallbacks |
| `adapters/apollo.ts` | "`PRV-CHK` … fails the build" | It did not exist until 2026-09-15 (now real) |
| `api/jobs/tick/route.ts` | "Vercel Cron calls this on a schedule (see `vercel.json`)" | No `vercel.json` existed until 2026-09-15 |
| `audit/FINDINGS.md` | "Twelve of seventeen nav destinations returned 404" | historical; fixed since |

This repository's documentation is unusually thoughtful *and* unusually stale, and the two facts are related: prose that explains reasoning at this density is expensive to keep current. The audit history shows the same failure recurring (`REPO-01` was raised for exactly this).

**Recommendation:** make the README's status section *generated* rather than written. A script that emits "N destinations, M reading live data, K jobs registered, J reachable" from the source would be shorter than the paragraph it replaces and could not go stale. The repository already has the machinery (`scripts/audit.mjs`).

## Structural debt

| # | Item | Severity |
|---|---|---|
| TD-1 | Discovery ordering encoded twice (`first-run.ts` and the sweeper chain) | Medium |
| TD-2 | No generated Supabase types → three documented `type Query = any` escapes | Low (deliberate, well-reasoned) |
| TD-3 | Migration batching convention inconsistent (`COMBINED-0024-0027.sql` exists; `0028` has no equivalent) | Low |
| TD-4 | `packages/crm` deliberately single-vendor — correct now, will need a registry later | Low (tracked) |
| TD-5 | Contact-fit dimensions in `jsonb` while opportunity dimensions are columns | Low |

## What not to "clean up"

- The dense explanatory comments. They are the reason this audit could reconstruct intent so precisely.
- `type Query = any` in `scope.ts`/`cache.ts` — documented, bounded, and the alternative (a hand-written structural copy of the PostgREST builder) would drift silently.
- The apparent duplication between `check_quota` and `check_quota_internal` — different callers, different privilege, deliberate.
