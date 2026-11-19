# 1 · Feature and capability inventory

Status key: **Working** means the code path exists end to end and is
exercised by tests. **Partial** means it exists but has a known gap or is not
wired to its trigger. **Stored only** means a column or table exists with no
behaviour behind it. **Absent** means not found after searching the code.
Labels [V]/[I]/[U] are defined in the [README](README.md#how-the-evidence-is-labelled).

## Harvey

| Capability | Status | Where | Notes |
|---|---|---|---|
| Heartbeat loop (wake, budget, decide, act, log, sleep) | Working [V] | `harvey/main.py:245` `heartbeat()` | Default 15 min. Quiet hours, error backoff, a bounded cycle timeout. |
| Deterministic task selection | Working [V] | `main.py:134` `decide_next_action()` | Fixed priority: replies, send, write, prospect, idle. No model call. |
| Product training from a URL | Working [V] | `harvey/trainer.py` | Cloudflare Browser Rendering crawl, else local fetch via `public_http`. Writes `harvey.local.yaml` and two skill files. |
| Signal catalogue gated by the user | Working [V] | `harvey/signals.py`, `state.py:386` `signal_codes.status` | 29 signals, all `proposed` until a person confirms them. |
| Cohort builder (must have / must not / ranges) | Working [V] | `state.cohort`, dashboard Signals tab | SQL over `observations`. |
| Discovery: OpenStreetMap, DataForSEO Listings/SERP/Maps, Serper | Working [V] | `collectors/discover.py:479-809` | Each provider has `estimate()`. Spend cap between batches. |
| Discovery presets: YC, accelerator, funding, hiring | Working [V] | `discover.py`, `startups.py` | Search through Serper or DataForSEO SERP. |
| Search-engine HTML scraping (DuckDuckGo, Bing, Google) | Working, fragile [V] | `agents/scout.py:432,467,493` | Scrapes result pages directly. Breaks on markup changes and violates those engines' terms. |
| Free website profiling (agency, ad pixels, schema, blog, tech) | Working [V] | `collectors/profile.py` (1,341 lines) | Homepage, robots, sitemap, team and careers pages, regex. No model call. |
| Public ATS feeds (Greenhouse, Lever, Ashby, Workable) | Working [V] | `collectors/ats.py` | Only boards the company's own site links to. |
| People from the company's own site | Working [V] | `collectors/people.py` (870 lines) | Cards, sentences, schema.org; owner ranking by surname in business name. |
| Email pattern learning plus single-candidate verification | Working [V] | `integrations/email_finder.py` | Reoon, ZeroBounce, Hunter; status `verified/risky/guess/invalid`. |
| Raw SMTP RCPT probe | Present, discouraged [V] | `email_finder.py:581` `verify_email_smtp` | Port 25 from a laptop; the README itself calls this not viable. |
| Model scoring of contacts plus heuristic fallback | Working [V] | `scout.py:1159` `_score_contacts`, `:1238` `_heuristic_score` | 1–100 score and a personalisation note. |
| 3-email sequence writing with retry cap | Working [V] | `agents/writer.py`, `WRITE_ATTEMPTS_KEY` | Prospects parked after 3 unusable drafts; `harvey retry-writes`. |
| Per-campaign writing feedback | Working [V] | `writer.py:253` `_feedback_block` | Free-text notes appended to the writer prompt. |
| Outbox with approval, autopilot and held states | Working [V] | `state.py:344` `outbox`, `sending_mode.py` | Unique `(campaign, prospect, step)` index prevents double staging. |
| Deterministic pre-send gate | Working [V] | `gate.py:49` `pre_send_check` | Recipient match, deliverable status, length, merge tags, banned phrases, link count, HTML, postal footer. |
| Autopilot review (foreign links, leaked instructions) | Working [V] | `gate.py:313` `autopilot_review` | Normalises obfuscated links (`evil dot com`, IPs, zero-width chars). |
| Recipient-timezone send window | Working [V] | `send_window.py` (532 lines) | Zone from location, Precleared country or config. |
| Warmup ramp for cold email | Working [V] | `sender.py` `cold_daily_cap`, `harvey.yaml` `warmup` | Replies are never capped by it. |
| Sending-domain readiness check | Working [V] | `deliverability.py:93-248` | MX, SPF, DMARC, DKIM, domain age (RDAP), domain and IP blocklists, send history. |
| Per-recipient legal check (Precleared) | Working, optional [V] | `integrations/precleared.py` | Holds cold email unless `ok_to_email`. |
| Reply handling: keyword opt-out first, then model intent | Working [V] | `agents/handler.py:57` `OPT_OUT_PATTERNS`, `:779` `_classify_intent` | Escalation patterns (legal, angry) also run before the model. |
| Stop on reply across the whole company | Working [V] | `handler.py:318` `_stop_colleagues` | |
| Bounce detection and global kill switch | Working [V] | `handler.py:685` `_handle_bounce`, `KILL_SWITCH_KEY` | Trips past `max_bounce_rate` after at least 10 sends. |
| Mail providers: Gmail API, Microsoft Graph, SMTP+IMAP, Instantly | Working [V] | `integrations/{gmail,microsoft,smtp_mail,instantly}.py` | Instantly is legacy and cannot hold single emails. |
| LinkedIn browser automation | Working, off by default [V] | `integrations/linkedin.py` | Playwright with the operator's password; violates LinkedIn's terms. |
| Subscription quota gate | Working [V] | `brain.py:632` `is_within_budget`, `integrations/quota.py` | Reads an undocumented OAuth usage endpoint; falls back to a call counter. |
| Codex (ChatGPT) provider with verified isolation | Working, macOS/Linux [V] | `harvey/codex.py` (1,561 lines) | Pinned to Codex CLI 0.159.3. |
| Local dashboard with token auth | Working [V] | `dashboard.py` (46 routes), `dashboard_auth.py` | Loopback only, Host and Origin checks, constant-time token compare. |
| CSV export honouring opt-outs | Working [V] | `harvey/export.py` | |
| Analytics | Minimal [V] | `agents/analyst.py` | Writes `data/analytics.json`; no learning feeds back into scoring. |
| Multi-user, teams, CRM sync | Absent [V] | — | Single operator by design. |
| Calendar booking | Absent [V] | `integrations/calendar.py` exists; roadmap lists auto-booking as next [U] | Only a booking link in the offer. |

## Huntloop

| Capability | Status | Where | Notes |
|---|---|---|---|
| Multi-tenant orgs, roles, invites, seat quotas | Working [V] | migrations `0001`, `0007`; RLS on every table | `verify-migrations.ts:2776` fails if any table lacks RLS. |
| Onboarding: company research, ICP draft, source recommendations | Working [V] | `packages/jobs/src/first-run.ts`, AI tasks `research_company`, `draft_icp`, `recommend_sources` | |
| Source scanning (news, blog, jobs, funding, GitHub, regulatory, community, podcast, custom) | Working [V] | `handlers/scan-source.ts`, `0002` `source_kind` enum | Fetch, extract, dedupe, model signal extraction, entity resolution. |
| Company discovery through a provider | Working [V] | `handlers/discover-companies.ts` | Apollo `searchCompanies`. Writes run status and stop reason so a failed search never reads as an empty market. |
| Direct URL analysis | Working [V] | `/[org]/analyze` | Runs qualification and why-now against a pasted URL. |
| List import | Working [U] | `/[org]/imports` | Not traced in this audit. |
| Competitor research and competitor-customer prospecting | Working [V] | `handlers/research-competitor.ts`, `prospect-competitor-customers.ts`, `resolve-competitor-mentions.ts` | |
| Hiring signals from a provider | Working [V] | `handlers/fetch-company-signals.ts` | Apollo `searchSignals`, 48-hour cadence. |
| Free website profiling (non-model regex signals) | Absent [V] | — | Signals come from the model or from Apollo. |
| Entity resolution and merges | Working [V] | `handlers/resolve-entity.ts`, tables `company_domains`, `company_merges`, `merge_candidates` | |
| Opportunity qualification on eight nullable dimensions | Working [V] | `handlers/score-opportunity.ts`, `0003:237-250` | Append-only `opportunity_scores`. |
| Customer scoring rules applied after the model | Working [V] | `@huntloop/db/rules`, `score-opportunity.ts` | `model_score` and `score` kept apart; `rule_trace` stored. |
| Rescoring on rule or ICP change | Working [V] | `recompute_scores`, `schedule_recomputes` | |
| Contact discovery, enrichment, ranking | Working [V] | `enrich-person.ts`, `rank-contacts.ts`; Apollo, Hunter, ZeroBounce | |
| Sequences and enrollments with an autonomy ladder (0–5) | Working [V] | `advance-enrollments.ts`, `0004:48` `autonomy_level` | Levels 0–1 draft for approval; 2+ queue to send. |
| Message personalisation with citations | Working [V] | `ai/tasks/personalize-message.ts` | Banned phrases and length checked when the draft is parsed. |
| Send-time gate | Partial [V] | `handlers/send-message.ts` | Checks idempotency, suppression, approval, unsubscribe URL, postal address, quotas. Does **not** re-check content, links or recipient verification. |
| Gmail and Outlook send and sync (OAuth) | Working [V] | `jobs/src/mailbox/{gmail,outlook}.ts`, `/api/mailboxes/[provider]` | `List-Unsubscribe` and RFC 8058 one-click headers. |
| Reply classification | Working, model-only [V] | `ai/tasks/classify-reply.ts` (Haiku 4.5) | No keyword pre-check for opt-outs. |
| Stop on reply | Partial [V] | `sync-mailbox.ts:345` | Only when classification succeeded. |
| Bounce suppression | Partial [V] | `sync-mailbox.ts:265` | Only when the model labels the message `bounce`. No bounce-rate kill switch. |
| Contact frequency caps (per contact, 30-day) and per-mailbox daily limit | Working [V] | `0017_outreach_safety.sql`, `0008` `claim_mailbox_send` | |
| Warmup | Stored only [V] | `mailboxes.warmup_stage` (`0004:32`) | Shown in the UI; no job reads it. |
| Sending-domain readiness (SPF/DKIM/DMARC) | Absent [V] | — | |
| Recipient-timezone send window | Absent [V] | — | |
| Built-in CRM, pipeline, outreach log | Working [V] | routes under `/[org]/pipeline`, `/outreach/log` | |
| HubSpot sync | Working [V] | `packages/crm/src/hubspot.ts`, `handlers/sync-hubspot.ts` | |
| Org and personal memory, preference learning | Working [V] | `0044_personal_learning.sql`, `learn-preferences.ts`, `infer_preferences` task | |
| Performance analysis and explanations | Working [V] | `analyze-performance.ts`, tasks `analyze_performance`, `explain_performance` | |
| Demand clustering from replies | Working [V] | `cluster-demand.ts`, `demand_signals` | |
| Per-lead sales agent and workspace assistant | Working [V] | tasks `sales_agent`, `workspace_assistant`; `0045_assistant_conversations.sql` | |
| Retention and erasure | Working [V] | `enforce-retention.ts`, `purge-contact-data.ts` | |
| AI spend accounting | Working [V] | `ai_runs` row written before every call (`task.ts:62`) | |
| Engine heartbeat | Partial [V] | `.github/workflows/tick.yml` every 5 min | `apps/web/vercel.json` has no cron, despite the README. Needs two repository settings. |
| Billing | Absent [V] | — | Stripe variables are read by no code [U per README, consistent with search]. |
| Web3 signals | Absent [V] | — | In the master context only. |
