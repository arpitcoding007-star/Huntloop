# W6 — query plans and load (measured on PGlite)

**Setup.** An in-memory PGlite with all 51 migrations (`perf.ts` in the session scratchpad; disposable, nothing persisted). Seeded volumes:

| Org | Companies / opportunities | Threads | Messages | Events | Jobs |
|---|---|---|---|---|---|
| Big | 10,000 | 3,000 | 30,000 (10 per thread, ~900 B bodies) + 4,000 scheduled | 35,000 total | 78,000 total (45k finished, 5k queued, 28k from the company-insert trigger) |
| Two others | 2,000 each | 1,000 each | 10,000 each | | |

Then `analyze` and `EXPLAIN (ANALYZE)` of each loader, written in the shape PostgREST emits (embedded resources as correlated `json_agg` subqueries).

**Caveat (read before the numbers).** PGlite is Postgres compiled to WASM, single-threaded and single-connection. Absolute times are pessimistic against a hosted Postgres. **Plan shapes, the ratios between plans, row counts and payload sizes carry over; seconds do not.** RLS was not active (superuser), and RLS adds a filter per row.

## Results

| Query | Plan | Time (PGlite) | Rows / payload |
|---|---|---|---|
| Inbox `listThreads` (`lib/data/inbox.ts:76-89`) | Seq Scan threads → per thread: messages via `messages_thread_idx` (filtering, not seeking) → per message: **Seq Scan of `message_events`** | **46,676 ms** | 3,000 threads · **30.9 MB** |
| + index `message_events(message_id)` | events become an Index Scan | 7,221 ms | same |
| + index `threads(org_id, last_message_at desc)` | sort removed | 6,555 ms | same |
| + index `messages(thread_id)` | messages seek directly | **735 ms** (63× faster) | same 30.9 MB |
| Inbox, first page of 50, no `body_text` (before the message index) | — | 128 ms | 67 KB |
| Assignments `listAssignments` (`lib/data/team.ts:113-122`) | Bitmap on `opportunities_owner_idx` + hash join + quicksort | 133 ms | 10,000 rows · 0.7 MB |
| `schedule_sends` sweep | Index Scan `messages_sendable_idx`, Limit 25 | 0.3 ms | 25 |
| `claim_job_executions` | Index Scan `job_executions_due_idx`, Limit 5 | 0.08 ms | 5 |

## Findings

### [High] PERF-301: The inbox is quadratic, because the indexes lead with `org_id` and PostgREST embeds join on the foreign key alone
- Confidence: CONFIRMED on PGlite (plans and timings above). The plan shape will be the same on Supabase; the absolute time will be smaller.
- Where: `0004_outreach_memory_learning.sql:174` `message_events_lookup_idx (org_id, message_id, kind)`; `0008_engine_columns.sql:197` `messages_thread_idx (org_id, thread_id, created_at)`; loader `apps/web/lib/data/inbox.ts:76-89` embeds `messages(…, message_events(…))`.
- Evidence: `->  Seq Scan` on `message_events` inside SubPlan 1, once per message (30,000 loops). `messages_thread_idx` is used only as a filter. Adding single-column indexes on `message_events(message_id)` and `messages(thread_id)`, plus `threads(org_id, last_message_at desc)`, took the query from 46.7 s to 0.74 s.
- Impact: the inbox is the daily-loop screen. Its cost grows with *messages × events*, and it is also unbounded (pass-16 PERF-201: 30.9 MB for 3,000 threads, past the 1,000-row PostgREST default cap, so it is also silently truncated). This is the first screen to fail at modest volume.
- Root cause: the composite indexes were designed for `org_id`-first queries, and embedding does not put `org_id` in the join.
- Fix: one migration with `message_events(message_id)`, `messages(thread_id, created_at)` and `threads(org_id, last_message_at desc) where deleted_at is null`. Separately, bound the loader to a page and drop `body_text` from the list (PERF-201).
- Acceptance: on the seeded PGlite, the inbox query is under 1 s and uses no Seq Scan on `message_events`.
- Test to add: a `verify-migrations.ts` check that every FK on an allow-list of embedded relations has an index leading on its column (see PERF-302).
- Effort: S · Mechanizable: yes · Status: New (sharpens pass-16 PERF-201)

### [Medium] PERF-302: 143 single-column foreign keys have no index leading on them
- Confidence: CONFIRMED (catalog query over `pg_constraint` × `pg_index` in the probe; full list in the probe output).
- Where: across the schema. The ones on hot paths: `messages.thread_id`, `message_events.message_id`, `enrollments.opportunity_id`/`campaign_id`, `opportunities.company_id`, `people.company_id`, `contact_points.person_id`, `opportunity_scores.opportunity_id`, `threads.opportunity_id`, `outcomes.opportunity_id`, `sequence_steps.sequence_id`, `merge_candidates.company_a_id/b_id`, `company_merges.winner_id/loser_id`. Most of the other ~110 reference `auth.users` (`*_by`, `user_id`).
- Impact: two costs. Embedded reads on these relations scan. And every `ON DELETE CASCADE` / `SET NULL` from the parent scans the child table: deleting a user, merging companies or erasing a person touches every unindexed child.
- Root cause: no rule says an FK needs an index; the `org_id`-first convention hid it.
- Fix: an index per hot-path FK (list above). For `auth.users` references, only where a delete or a join actually happens. Then add a mechanizable check (`scripts/audit.mjs` or verify-migrations) listing FKs without a leading index, with an explicit allow-list for the ones deliberately left.
- Effort: M · Mechanizable: yes · Status: New

### [Low] JOB-301: Bulk company inserts enqueue two jobs per company
- Confidence: CONFIRMED (seed of 14,000 companies produced 28,000 `job_executions` through 0050's `companies_enqueue_followups`).
- Impact: a 10,000-row CSV import queues 20,000 `resolve_entity` + `profile_company` jobs. Both are free (`profile_company` fetches the homepage; neither calls a paid provider), but they occupy the queue ahead of other orgs' work with no per-tenant fairness (pass-16 JOB-202). Each one also fetches a third-party homepage.
- Fix: covered by JOB-202 (fairness). Optionally, batch or rate-limit follow-ups per org.
- Effort: — · Status: New observation, folds into JOB-202

## Checked, fine

- The `schedule_sends` sweep and the job claim use their partial indexes and stay sub-millisecond at 78k jobs and 4k scheduled messages.
- Assignments: 133 ms for 10k opportunities; the concern there is the unbounded result (PERF-201), not the plan.

## Concurrency: what this machine cannot show

PGlite runs one connection, so `for update skip locked`, `claim_contact_lane`'s `on conflict` and `reserve_provider_credit`'s advisory lock cannot be raced here. The code reading in pass 16 stands (atomic by construction). The proof needs a real Postgres with two sessions: `09_ACCESS_NEEDED.md` item A3.
