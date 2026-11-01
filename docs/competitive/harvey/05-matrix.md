# 5 · Comparison matrix

"Edge" is a judgement on implementation quality for that row, not on whether
a feature exists. **H** = Huntloop, **Hv** = Harvey, **=** = comparable.
Paths are relative to each repository's root.

| Area | Huntloop implementation | Harvey implementation | Edge | Why |
|---|---|---|---|---|
| Tenancy | RLS on all 81 tables; `verify-migrations.ts:2776` asserts it; cross-org test as non-superuser | None; one operator | H | Different product, but Huntloop's is proven by test |
| Process model | Serverless + Postgres queue (`jobs/src/queue.ts`, `runner.ts`) | One asyncio process (`main.py:245`) | H | Survives crashes, multi-worker safe |
| Heartbeat | `.github/workflows/tick.yml` */5; `apps/web/vercel.json` has no cron | In-process sleep loop with quiet-hours polling | Hv | Huntloop's depends on two unset-by-default repo settings and is documented wrongly in `README.md` |
| Throughput | 5 serial jobs per tick (`runner.ts:57`) ≈ 60 jobs/h total [I] | Per operator, parallel agents per cycle | Hv today, H potential | Huntloop's ceiling is a config choice, not a design limit |
| Task selection | Schedule-driven sweepers | `decide_next_action` priority (`main.py:134`) | = | Both deterministic |
| Reply-before-send ordering | None between `sync_mailbox` and `send_message` | Phase 2 waits for every reply reader (`main.py`) | Hv | Prevents sending after an unseen reply |
| Model access | Messages API, structured output (`ai/src/client.ts`) | `claude -p` subprocess, JSON scraped from text (`brain.py:599`) | H | Schema-constrained output |
| Model tools | `web_fetch` on a per-input allow-list, 9 tasks | None, verified (`claude_runtime.py:159`) | Hv | Smaller attack surface |
| Model routing | Per task in `ROUTES` (`models.ts`) | One model | H | Cost and quality per task |
| Model generation | `claude-opus-5`, `claude-sonnet-5`, `claude-haiku-4-5` | Operator's default | — | Huntloop should move to 5.5 (cheaper) |
| AI accounting | `ai_runs` row before each call; cost, latency, prompt version, input hash (`task.ts:62`) | `usage_events` tokens per agent/task | H | Attribution of bad prompt versions |
| AI budget | Monthly run count, fails open (`jobs/src/ai.ts:108-127`) | Real subscription %, falls back to call counter (`brain.py:632`) | = | Different constraints; Huntloop should meter in cents |
| Prompt injection fence | Random-id fence, no normalisation (`ai/src/untrusted.ts:38`) | NFKC, zero-width strip, tag strip (`untrusted.py:31`) | Hv | More robust fence |
| Outbound injection defence | None for links/addresses | `autopilot_review` (`gate.py:313`) | Hv | Holds foreign links at autopilot |
| Pre-send content gate | At draft parse only (`personalize-message.ts:173,403`) | At send (`gate.py:49`) | Hv | Covers edits and every path |
| Sendable address rule | Deny-list (`db/src/contact.ts:689`) | Allow-list `verified` (`gate.py:49`) | Hv | Unknown status should not send cold |
| Opt-out by reply | Model only (`classify-reply.ts`, `sync-mailbox.ts:283`) | Regex first, model second (`handler.py:57,427`) | Hv | Works when the model does not |
| Stop on reply | Only after successful classification (`sync-mailbox.ts:345`) | Always, company-wide (`handler.py:318`) | Hv | See [category 8](04-categories-8-13.md#8-security-and-privacy) |
| Bounces | Suppression if model labels `bounce` (`sync-mailbox.ts:265`) | Detection + invalidation + kill switch (`handler.py:685`) | Hv | Rate-based kill switch protects the domain |
| Unsubscribe link + headers | Required at send; RFC 8058 (`send-message.ts`, `mailbox/provider.ts:147`) | Reply-based opt-out line; no link | H | One-click unsubscribe is what Gmail/Yahoo bulk rules expect |
| Postal address | Required at send (`send-message.ts` step 3c) | Required for cold email at gate | = | |
| Frequency caps | Per-contact cadence, 30-day cap, per-mailbox daily (`0017`, `0008`) | Daily cap, per-cycle cap, follow-up spacing | H | Cross-campaign caps |
| Warmup | `warmup_stage` stored, unused (`0004:32`) | Ramp enforced (`sender.py` `cold_daily_cap`) | Hv | |
| Domain readiness | Absent | `deliverability.py:93-248` | Hv | |
| Recipient send window | Absent | `send_window.py` | Hv | |
| Per-recipient legal check | Absent | Precleared, optional (`integrations/precleared.py`) | Hv | |
| Mailbox auth | OAuth, tokens encrypted (`db/src/crypto.ts`) | OAuth (Gmail/MS) or SMTP password in `.env` | H | |
| SSRF guard | Per-address + connect-time + redirect re-check (`jobs/src/fetch.ts`) | IP-pinned connection, SNI kept, proxies off (`public_http.py`) | = | Both thorough |
| Signal model | Evidence rows with `claim_kind` fact/inference/unknown | `observations` with numeric confidence, governed codes (`state.py:402-434`) | H | Epistemic labels enforced in schema |
| Free site profiling | Absent | `collectors/profile.py`, `ats.py` | Hv | Free, deterministic facts |
| Discovery sources | Apollo search, 10 source kinds via scan | OSM, DataForSEO ×3, Serper, presets | = | Huntloop B2B depth; Harvey SMB breadth |
| Search-engine scraping | None | DuckDuckGo/Bing/Google HTML (`scout.py:432-528`) | H | Harvey's is fragile and against terms |
| LinkedIn | None | Playwright with password (`integrations/linkedin.py`) | H | Avoids account and ToS risk |
| Entity resolution | Domains, merges, candidates (`resolve-entity.ts`) | Normalised domain or external id | H | |
| Scoring | 8 nullable dimensions, append-only, rules after model (`score-opportunity.ts`, `0003:237`) | 1–100 contact score + heuristic fallback (`scout.py:1159,1238`) | H | Explainable and re-scorable |
| Email finding | Apollo/Hunter match, ZeroBounce verify | Pattern learning with ownership ambiguity rules (`email_finder.py`) | Hv | Fewer wrong-mailbox sends |
| Conversation handling | Classify, stop, hand to human/assistant | Stage machine with auto-drafted replies (`handler.py:826,868`) | = | Different intent |
| CRM / team / learning | Built-in CRM, HubSpot, teams, memory, analytics | `analyst.py` stats file | H | |
| Data store | Postgres, manual migrations + `db:doctor` | SQLite, automatic migrations (`state.py:570-579`) | H (scale), Hv (ops) | |
| Tests | ~12.5k lines verify scripts, 31 Vitest files, 108 Playwright tests | 70 modules, 1,238 tests, 3 OSes in CI | Hv on outbound path, H on schema | |
| Config | Env + per-org DB settings | YAML + editable Markdown skills | = | Right choice for each product |
| Model cost | Per-token API | Operator's subscription | Hv for an individual | Not available to a SaaS |
