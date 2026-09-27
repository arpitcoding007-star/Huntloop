# Executive summary — full-system audit

**Date** 2026-09-15 · **Branch** `feat/sidebar-modules` · **Method** repository-wide inspection, cross-referenced mechanically. Nothing below is taken from existing documentation; every claim names the file, table or job it came from.

---

## 1. What HuntLoop actually is today

A **single-tenant-per-org B2B opportunity engine** built as an npm-workspaces monorepo: Next.js 16 app, Supabase Postgres with RLS, a Postgres-backed job queue, three data-provider adapters, one CRM connector, and twelve AI tasks.

It is considerably more built than its own README says. The README (last substantively updated 2026-08-19) claims eleven of seventeen nav destinations are unbuilt, that nothing sends an email, and that nobody can be invited. **All three are false.** There are nineteen nav destinations and every one resolves to a real route reading a real loader (`apps/web/app/(app)/[org]/OrgShell.tsx`, verified by audit check `NAV-01`); `send_message` and the Gmail/Outlook mailbox adapters exist and are tested; `inviteMemberAction` exists with seat-quota enforcement (`apps/web/app/(app)/[org]/team/actions.ts:278`).

The engineering quality of what exists is high and unusual: tenant isolation enforced in Postgres and proven by 236 migration-level checks including a non-superuser cross-tenant test; a provider seam that no caller can bypass; a cost-control layer (cache → budget → breaker → ledger) that most companies build after their first surprise invoice rather than before their first customer; and a house rule — fact vs inference vs unknown — enforced at three layers rather than asserted in a style guide. There are **zero** `TODO`/`FIXME` markers in the entire codebase.

## 2. The single most important finding

**The engine has almost certainly never run on a schedule in any deployment.**

`apps/web/app/api/jobs/tick/route.ts` is the only thing that enqueues the sweepers, and its own header says "Vercel Cron calls this on a schedule (see `vercel.json`)". No `vercel.json` existed in this repository until it was added on 2026-09-15. Every scheduled behaviour in the product — discovery re-runs, source scans, reply sync, sequence advancement, retention enforcement, signal fetches — depends on that endpoint being called by a clock that was never configured.

The consequence compounds with a second finding: **there is no in-app control that starts discovery.** The only two callers of `discover_companies` are `packages/jobs/src/first-run.ts` (which drives handlers directly, inside the onboarding request) and the `schedule_discovery` sweeper. So in practice, in any deployment to date, **discovery has only ever run once per workspace, during onboarding** — and nothing has ever re-run it.

That is not a bug in a handler. It is the difference between a product that hunts and a product that hunted once.

## 3. Four jobs exist, are registered, are tested, and are never enqueued

Cross-referencing every name in `packages/jobs/src/queue.ts` against every call site in the repository:

| Job | Handler | Enqueued by | Consequence |
|---|---|---|---|
| `enrich_person` | `handlers/enrich-person.ts` | **nothing** | Contact enrichment is unreachable. Emails and phones are only ever acquired during first-run. |
| `resolve_entity` | `handlers/resolve-entity.ts` | **nothing** | Entity resolution and deduplication never run. |
| `purge_contact_data` | `handlers/purge-contact-data.ts` | **nothing** | GDPR erasure cannot be triggered. |
| `sync_hubspot` | `handlers/sync-hubspot.ts` | **nothing** | CRM sync has no trigger (added 2026-09-14; trigger was out of that change's scope). |

`resolve_entity` is the serious one, because it creates an **architectural contradiction**. Migration `0012_entity_identity.sql` argues in its own header that deduplication "ships BEFORE any provider search does, and the plan makes that a hard ordering constraint", on the grounds that "duplicates created at provider volume are the one class of data defect that gets harder to fix with time". `discover_companies` runs. `resolve_entity` does not. The constraint the migration named as hard is currently inverted in production behaviour.

Downstream of that: `merge_candidates` is written only by `resolve_entity`; `company_merges` is written only by the `merge_companies()` function; and `merge_companies_for_org()` — the `SECURITY DEFINER` wrapper `0012` built specifically so a Server Action could call it — **is called by nothing**. There is no merge review UI. The whole deduplication subsystem is complete, tested, and inert.

## 4. The commercial layer is display-only

- `plans.limits` defines five quotas: `opportunities`, `ai_runs`, `emails`, `enrich`, `seats` (`apps/web/lib/data/usage.ts:25`).
- **Two are enforced.** `seats` at `team/actions.ts:294`; `ai_runs` via `check_quota` in `lib/ai/budget.ts:48` and `check_quota_internal` in `packages/jobs/src/ai.ts:109`.
- **Three are not.** `opportunities`, `emails` and `enrich` are defined, surfaced on the usage screen and priced on the landing page, and nothing anywhere checks them.
- **There is no payment path at all.** `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` and `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` are declared in `.env.example` and read by zero lines of code. The `subscriptions` table has existed since `0001` and is referenced by no application code — `lib/data/directory.ts:112` says so out loud: *"Because there is no billing."*

A product that meters three things it does not enforce, and prices a plan it cannot sell, is not ready to take money.

## 5. Biggest product opportunities

1. **Make the loop continuous.** The engine is built; it needs a clock and a button. Cron plus a "hunt now" control turns a one-shot onboarding demo into the product the landing page describes.
2. **Turn signals into the front door.** `fetch_company_signals` now writes hiring evidence, but nothing surfaces "what changed since you last looked". The Command Center is the natural home and already has the layout for it.
3. **Close the learn loop.** `0010_learning_loop.sql`, `analyze_performance`, `schedule_learning` and the `learn` screen all exist. What is missing is outcome volume, which is gated on §2 and §3 above, not on more code.
4. **Ship the recommendation engine as one thing.** Ranking currently lives in three places — `priority`, `opportunity_scores`, and now `contact_fit_scores`. They do not conflict, but nothing composes them into a single "who next, why, what do I do".

## 6. Critical launch blockers

| # | Blocker | Evidence |
|---|---|---|
| 1 | Nothing runs on a schedule | no `vercel.json` before 2026-09-15; `CRON_SECRET` undocumented as required |
| 2 | Discovery cannot be started from the app | only caller is `first-run.ts` |
| 3 | Deduplication never runs while discovery does | `resolve_entity` unenqueued; `0012` header |
| 4 | GDPR erasure unreachable | `purge_contact_data` unenqueued |
| 5 | Three of five plan limits unenforced | `usage.ts:25` vs single `checkQuota` call site |
| 6 | No live vendor call has ever succeeded | no Apollo / Anthropic / HubSpot key in any verified environment |
| 7 | CSP still report-only | `SEC-CSP-MODE` audit check, severity `warn` |

## 7. What should be removed

`company_gaps` (`0003`), `contact_frequency` (`0017`), `evidence_citations` (`0022`) — created, never read, never written by any application code. Either wire them or drop them; a schema that carries three tables nobody reads teaches the next reader that tables are decorative.

## 8. Honest assessment

HuntLoop is **not** an early prototype with a thin veneer. It is a well-architected system with an unusual amount of correctness machinery, whose connective tissue is missing in a small number of specific, identifiable places — and those gaps are concentrated almost entirely in *triggering*, not in *doing*. Four handlers with no caller, one cron that was never configured, one button that was never built.

That is a genuinely good position to be in, and it is also why the product has never been observed working end to end. Fixing the triggering layer is a matter of days, not months. Proving it works against live vendors is the gate everything else waits behind.

---

**Read next:** `02_FEATURE_INVENTORY.md` for the per-capability table, `22_PRODUCT_GAPS.md` for the severity matrix, `26_IMPLEMENTATION_PLAN.md` for the phased plan.
