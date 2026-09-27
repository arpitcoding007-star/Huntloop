# Gap matrix

Severity is impact × likelihood, not effort. Effort is stated separately so quick wins are visible.

---

## Critical — blocks production, or risks data loss / compliance exposure

| ID | Gap | Evidence | Effort |
|---|---|---|---|
| C-1 | **Nothing runs on a schedule.** Every sweeper depends on `/api/jobs/tick`, which is called by a cron that was never configured. | `api/jobs/tick/route.ts` header references `vercel.json`; file absent until 2026-09-15 | XS (done — needs deploying) |
| C-2 | **Deduplication never runs while discovery does.** `resolve_entity` is registered and unenqueued; `discover_companies` creates companies at provider volume. | `queue.ts` vs zero call sites; `0012` header calls the ordering "a hard constraint" | S |
| C-3 | **GDPR erasure is unreachable.** `purge_contact_data` exists, is tested, and nothing can trigger it. | zero call sites | S |
| C-4 | **Person enrichment is unreachable.** `enrich_person` never enqueued — so emails/phones are only acquired during first-run. | zero call sites | S |
| C-5 | **No live vendor call has ever been verified.** Apollo, Anthropic, HubSpot, Gmail/Outlook are all written against documented shapes only. | no key in any verified environment | M (needs credentials) |
| C-6 | **Three plan limits are unenforced** while being displayed and priced: `opportunities`, `emails`, `enrich`. | `usage.ts:25` defines five; one `checkQuota` call site + AI path | S |

## High — major workflow or architectural weakness

| ID | Gap | Evidence | Effort |
|---|---|---|---|
| H-1 | **No in-app way to start a hunt.** Only `first-run.ts` and the cron reach discovery. | no `enqueue` of `discover_companies` under `app/(app)` | S |
| H-2 | **CRM sync has no trigger.** `sync_hubspot` is complete and callable by nothing. | zero call sites | S |
| H-3 | **No merge review UI.** `merge_companies_for_org()` was built for a Server Action that does not exist. | zero call sites | M |
| H-4 | **No composite next-best-action.** Three ranked signals (`priority`, `opportunity_scores`, `contact_fit_scores`), nothing composes them. | — | M |
| H-5 | **Signals do not become actions.** Hiring evidence lands on the company; nothing says "therefore contact X about Y". | `fetch-company-signals.ts` writes evidence only | M |
| H-6 | **No provider fallback.** Registry binds one adapter per capability; a Hunter outage means no `person.match` at all, silently. | `registry.ts` `build()` | M |
| H-7 | **Audit log is write-only.** Nothing reads `audit_logs`. | `lib/data/audit.ts` has no reader | S |
| H-8 | **No payment path.** Plans priced, quotas partially enforced, Stripe declared and unimplemented. | 3 env vars, 0 readers | L |
| H-9 | **No user-correction capture.** Nothing records a score override or a rejected recommendation, so the learning loop can only learn from replies. | no override column/table | M |

## Medium — meaningfully affects quality

| ID | Gap | Evidence | Effort |
|---|---|---|---|
| M-1 | CSP still report-only in production target | `SEC-CSP-MODE` warn | XS |
| M-2 | Three orphan tables (`company_gaps`, `contact_frequency`, `evidence_citations`) | zero code references | XS |
| M-3 | `subscriptions` table + `STRIPE_*` vars are dead weight pending H-8 | zero readers | XS |
| M-4 | No load test anywhere; concurrency behaviour of `tick()` unproven under real volume | — | M |
| M-5 | Signal scheduler scans every Apollo-known company, not only those with live opportunities | `schedule-signal-fetches.ts` own comment | S |
| M-6 | README materially misdescribes the product (3 false claims) | see `00_EXECUTIVE_SUMMARY.md` §1 | XS |
| M-7 | No dead-letter surface — exhausted jobs sit `failed` with no operator queue | `markFailed` | S |
| M-8 | Stage labels/pipelines re-fetched per sync (1 extra HubSpot call each) | `getStageLabels` | XS |

## Low — polish and cleanup

| ID | Gap | Effort |
|---|---|---|
| L-1 | `opportunity-map.ts` flagged as unimported by pages (it is imported by `opportunities.ts` — false positive, no action) | — |
| L-2 | Kitchen-sink route ships in production build | XS |
| L-3 | `first-run.ts` and `schedule_discovery` duplicate some discovery orchestration reasoning | S |
| L-4 | No `analyze_performance` manual trigger from `/learn` | XS |

---

## Quick wins — small effort, high user value

1. **C-1 deploy the cron** — one file, already written. Turns six dormant subsystems on.
2. **H-1 "Hunt now" button** — enqueue `discover_companies` from the opportunities or sources screen. ~30 lines; converts the product from one-shot to continuous.
3. **H-2 "Push to HubSpot" action** on the opportunity detail page — the handler is done and tested.
4. **C-2 enqueue `resolve_entity`** at the end of `discover_companies` — one `enqueue()` call closes the dedup contradiction.
5. **C-4 enqueue `enrich_person`** after `rank_contacts` — same shape.
6. **M-2 drop three orphan tables** — one migration, removes misleading schema.
7. **C-6 enforce `emails`** in `send_message` and `enrich` in the provider call path — both have a natural single choke point.
