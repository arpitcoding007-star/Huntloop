# 2 · Architecture and data-flow comparison

## Process model

| | Harvey | Huntloop |
|---|---|---|
| Runtime | One long-running Python 3.11+ asyncio process per operator (`harvey run`) plus an optional FastAPI dashboard on 127.0.0.1 [V] | Next.js 16 app on Vercel (serverless functions), Supabase Postgres, Auth and Storage [V] |
| Who it serves | One operator, one product, one sending identity [V] | Many organisations, many users each, isolated by RLS [V] |
| Clock | `asyncio` sleep loop inside the process, default 15 min (`main.py:245`) [V] | External HTTP call to `/api/jobs/tick`, from GitHub Actions every 5 min (`.github/workflows/tick.yml`) or Inngest if configured [V] |
| State | SQLite file `data/harvey.db`, WAL mode, schema version in `PRAGMA user_version` (`state.py:570-579`) [V] | Postgres, 47 numbered SQL migrations applied by hand, checked by `npm run db:doctor` [V] |
| Model access | `claude -p` or `codex app-server` subprocess using the operator's subscription login, with every tool disabled [V] | Anthropic Messages API with an API key, structured output, optional server-side `web_fetch` restricted to named domains [V] |
| Unit of work | A heartbeat cycle that runs one to four agents in parallel, bounded by a cycle timeout (`main.py:176`) [V] | A row in `job_executions`, claimed with `for update skip locked`, run serially inside one function invocation (`runner.ts`) [V] |

## Harvey: one cycle, traced

```
heartbeat()                                          main.py:245
 ├─ sync_sending_mode()        config file → DB (approval/autopilot)
 ├─ quiet hours?               sleep in short polled chunks, or send-only mode
 ├─ brain.preflight()          CLI present, isolation flags supported, login ok
 ├─ brain.is_within_budget()   real quota % vs max_daily_claude_percent,
 │                             else own call counter              brain.py:632
 ├─ decide_next_action()       counts → one action, no model call  main.py:134
 ├─ phase 1, in parallel (asyncio.gather, CYCLE_TIMEOUT)
 │    handler.run()   read mailbox → keyword opt-out/escalation → model intent
 │                    → stage → draft reply into outbox → bounces → kill switch
 │    scout.run()     search/scrape → people → email pattern → verify → score
 │    writer.run()    3-email sequence → validate → campaign draft
 │    run_profile_stage()  ≤25 sites, regex only, no model
 │    analyst.run()   stats file
 └─ phase 2, only if every reply reader returned True and the brain is usable
      sender.run()    stage drafts → _drain_due(): claim → gate → window
                      → warmup cap → Precleared → send → record   sender.py:698
```

The ordering is the design: replies are read and stop-on-reply has run before
anything is sent in the same cycle. If any reply reader failed, nothing is sent
that cycle (`main.py` phase 2, `send_hold_reason`) [V].

Agents talk only through the SQLite database. There is no message bus, and the
"multi-agent" structure is five Python classes with different prompts and
skill bundles (`brain.py:708` `load_skills_for_agent`) [V].

## Huntloop: the engine, traced

```
GitHub Actions (*/5)  ──GET /api/jobs/tick, Bearer CRON_SECRET──▶ route.ts
 ├─ sweep()            enqueue the sweepers (idempotency keys de-duplicate)
 │    schedule_scans, schedule_discovery, schedule_sends, schedule_syncs,
 │    schedule_learning, schedule_recomputes, schedule_signal_fetches, …
 └─ tick({limit: 5, deadline: now + 55s})                          runner.ts:57
      requeueStalled()  → claim(5) → for each job, serially:
         HANDLERS[name](ctx)  → succeed | markFailed (backoff attempts², ≤60 min,
                                 3 attempts by default)       queue.ts:132,204
```

The intelligence path, as separate jobs:

```
scan_source ─┐                         (fetch → extract → dedupe → Haiku
discover_companies ─┤                   extract_signals → resolve)
                    ├─▶ resolve_entity ─▶ research_company (Opus)
                    └─▶ score_opportunity (Opus qualify_opportunity, then the
                         org's scoring_rules) ─▶ opportunity_scores (append-only)
                                              ─▶ evidence (fact/inference/unknown)
enrich_company / enrich_person / rank_contacts  (Apollo, Hunter, ZeroBounce)
```

The outreach path:

```
advance_enrollments (≤5 per tick, Opus personalize_message per step)
   ├─ autonomy 0–1: messages row, scheduled_at NULL → waits for a person
   └─ autonomy ≥2 : messages row + enqueue send_message
send_message: sent? → suppressed? → approved? → unsubscribe URL? → postal
              address? → plan allowance → mailbox daily claim → send → record
sync_mailbox: fetch → store → Haiku classify_reply → applyClassification
              (bounce/unsubscribe → suppressions; reply → stop enrollments,
               opportunity → replied; demand statements → demand_signals)
```

## How decisions are made

| Decision | Harvey | Huntloop |
|---|---|---|
| What to do next | Deterministic priority over pipeline counts (`main.py:134`) [V] | Each sweeper decides from schedule columns (`next_scan_at`, `next_action_at`); no global priority between job types [V] |
| Is this company a fit | User-confirmed signals plus a 1–100 model score with a heuristic fallback (`scout.py:1159,1238`) [V] | Opus `qualify_opportunity` on eight dimensions, then customer rules; tiers HOT/WARM/WATCH/IGNORE [V] |
| Is this address sendable | Allow-list: only `verified`, plus `risky` if `send_to_risky` (`gate.py:49`) [V] | Deny-list: anything except `undeliverable` and `risky` (`contact.ts:689`) [V] |
| Does this email go now | Approval or autopilot; gate, autopilot review, window, warmup cap, Precleared, daily cap, at send time [V] | Autonomy level per campaign; at send time only suppression, approval, compliance footer and quotas [V] |
| Is this reply an opt-out | Regex first, then the model, and the regex wins (`handler.py:57,427-435`) [V] | Model only (`classify_reply`) [V] |

## Why the shapes differ, and what that implies

Harvey optimises for one person on one laptop who already pays for a model
subscription. Everything that can be done without a model is done without one,
because the subscription quota is the scarce resource. That is why its
deterministic layers (gate, opt-out regex, profiler, decision engine) are so
thorough.

Huntloop optimises for many tenants on serverless infrastructure where the
scarce resources are function time (60 s) and the tenant boundary. That is why
its engine is a claimable Postgres queue with idempotency keys, and why it
spends model calls freely on judgement (Opus for qualification and drafting).

[I] The consequence for Huntloop: its safety-critical outreach decisions
(opt-out, stop on reply, bounce) inherited the "ask the model" pattern from the
intelligence half, where it fits, into the execution half, where it does not.
A model call that fails is a normal event in a serverless queue; a reply that
does not stop a sequence is a compliance event. Harvey's pattern of
deterministic rules first, model second, is the right one for that half.
