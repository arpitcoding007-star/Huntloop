## Perf (static only; every item is **not measured**)

| Item | Where | Why it matters |
|---|---|---|
| Inbox loads every thread with every message body and event, unbounded | `apps/web/lib/data/inbox.ts:76-89` | Payload grows with all mail ever exchanged. PostgREST `max-rows` (Supabase default 1000) truncates silently, a correctness problem as well. No `threads (org_id, last_message_at)` index exists (only `threads_provider_idx`) |
| Assignments loads every opportunity, unbounded | `apps/web/lib/data/team.ts:113-122` | Same truncation and size issue; `opportunities_priority_idx` covers the order |
| Dashboard "why now" evidence is unbounded per shortlist | `apps/web/lib/data/dashboard.ts:257-268` | The shortlist is small, but evidence per opportunity is unbounded |
| 53 of 291 `select`s in `lib/data` and `jobs/handlers` have no limit, key or `maybeSingle` | listing produced by a static scan (scratch script); notable ones: `opportunities.ts:159,388` (evidence), `hunt-source.ts:118,152`, `conversation.ts:70`, `analyze-performance.ts:551,561,676`, `send-message.ts:660,672,712` | Most of the rest are small config tables (plans, icps, products, mailboxes) |
| Model calls in the request path | Analyze, research, ICP draft and first-run stages run inside Server Actions (`lib/ai/*.ts`), capped by the 55 s AI timeout (`ai/src/env.ts`) | Latency and serverless limits. Rate-limited |
| Route skeletons | 3 `loading.tsx` for 54 pages; `[org]/loading.tsx` covers the org tree | PERF-001 partially addressed |
| Bundle | 201.7 / 275 kB shared (lead) | Within budget |

