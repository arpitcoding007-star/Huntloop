# Jobs & automation audit

The engine is the best-engineered subsystem in the repository and the least connected. Both halves of that sentence are load-bearing.

## Architecture

- **Queue:** `job_executions` in Postgres, not a hosted queue. Justified in `queue.ts`: every job either fetches a page or calls a model, so the unit of work is seconds — a queue round trip is noise, and a Postgres table is transactional with the rows the job is about.
- **Claim:** `claim_job_executions` under `for update skip locked`; `requeue_stalled_jobs` returns abandoned work.
- **Delivery:** at-least-once, explicitly. Every handler is written to tolerate a second run.
- **Idempotency:** `idempotency_key` unique among queued/running rows, so "scan source X" enqueued by both the scheduler and a button is one job.
- **Retry:** exponential backoff from the attempt count (`attempts²`, capped at 60 min), with a `permanent` flag that skips remaining attempts for failures that are answers ("this URL has no scheme").
- **Deadline:** the runner declines to start a job it cannot finish before `maxDuration`, rather than being killed holding a lock.
- **Registry:** `HANDLERS` is a **total map over `JobName`**, so adding a name without a handler is a compile error. Excellent.

## The finding: four handlers with no caller

Cross-referencing every `JobName` against every call site in `apps/` and `packages/`:

| Job | Enqueued by | Status |
|---|---|---|
| `enrich_person` | — | 🔴 orphan |
| `resolve_entity` | — | 🔴 orphan |
| `purge_contact_data` | — | 🔴 orphan |
| `sync_hubspot` | — | 🔴 orphan |

All four are registered, three are covered by tests, and none can ever run. This is the canonical **False Complete**: the compile-time guarantee proves a handler *exists* for every name, and nothing anywhere proves a *caller* exists for every handler.

**Recommended test** (closes the class of bug, not just these four): assert in `verify-jobs.ts` that every `JobName` is either in `SWEEPERS` or appears as an `enqueue({ name })` argument somewhere in the source tree. That test would have caught all four on the day they were written.

## The second finding: the sweep had no clock

`sweep()` enqueues nine sweepers per tick and is called only by `/api/jobs/tick`, whose header points at a `vercel.json` that did not exist until 2026-09-15. So:

| Sweeper | Drives | Consequence while dormant |
|---|---|---|
| `schedule_scans` | `scan_source` | sources never re-scanned |
| `schedule_discovery` | `discover_companies` | saved searches never re-run |
| `schedule_signal_fetches` | `fetch_company_signals` | signals never refreshed |
| `schedule_sends` | `send_message` | approved messages never sent |
| `schedule_syncs` | `sync_mailbox` | replies never ingested |
| `advance_enrollments` | sequence steps | sequences never advance |
| `schedule_learning` | `analyze_performance` | nothing ever learned |
| `schedule_recomputes` | `recompute_scores` | scores never refreshed after an ICP edit |
| `enforce_retention` | retention pruning | retention policy never applied |

`sweep()`'s own header warns about exactly this: *"A driver that ticks without sweeping runs an engine that processes whatever it is handed and never notices that a source is overdue… an engine that looks healthy in every log line and does nothing."* The warning was about a driver that forgets to sweep. The realised failure was one step earlier — no driver at all.

## Quality notes (good)

- `discover_companies` is a model handler: resumable via `page_cursor`, bounded by `DEFAULT_MAX_PAGES`, idempotent through three independent mechanisms, and **never lets a failed search look like an empty market** — every exit writes a `status` and a `stop_reason`.
- `send_message` orders its checks deliberately: already-sent → suppressed → approved → allowance claimed **before** the send, because "a crash between claiming and sending over-counts by one; the reverse order over-sends".
- `schedule_discovery` advances `next_run_at` *as part of the claim*, so a crashed worker cannot leave a paid query permanently due.

## Gaps

| # | Severity | Finding |
|---|---|---|
| J-1 | Critical | Four orphan handlers (above) |
| J-2 | Critical | No cron configured until 2026-09-15 |
| J-3 | High | No dead-letter surface: a job exhausting `max_attempts` sits `failed` with no operator queue and no alert |
| J-4 | Medium | No test asserts every job is reachable |
| J-5 | Medium | `first-run.ts` duplicates orchestration reasoning that also lives in the sweepers — acceptable today (it deliberately drives handlers in-request for the progress bar), but a second place discovery order is encoded |
| J-6 | Low | Concurrency untested under load; `tick({ limit })` defaults to 5 |
