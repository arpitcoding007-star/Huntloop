# 3 · Category analysis, part 1 (categories 1–7)

Each category uses the same headings. Evidence labels: [V] verified in code,
[I] inferred, [U] unverified claim, [R] recommendation.

---

## 1. Core functionality

**Huntloop contains.** An opportunity engine (sources, discovery, research,
qualification, scoring, evidence), contacts and enrichment, sequences with an
autonomy ladder, Gmail/Outlook send and sync, a built-in CRM and pipeline,
HubSpot sync, teams and assignments, memory and preference learning,
performance analysis, competitor and demand intelligence, retention and
erasure. 16 AI tasks (`packages/ai/src/tasks/`), 34 job types, one handler
each (`packages/jobs/src/queue.ts` `JobName`, `packages/jobs/src/handlers/`) [V].

**Harvey contains.** One pipeline: train on a product, confirm signals,
discover businesses, profile their sites, find owners and addresses, write a
3-email sequence, send through the operator's mailbox, read replies, answer
them through stages up to `closed_won/closed_lost`, export CSV [V].

**Similar.** Both find companies, find a person, verify an address, draft
personalised email, require approval by default, send through the user's own
Gmail/Microsoft mailbox, classify replies and stop sequences.

**Different, and why it matters.** Harvey's use case is narrow and deep: local
businesses and startups, cold email to a meeting. Huntloop's is broad: any B2B
seller who needs to know *why now*, followed by a CRM. Harvey runs a whole
conversation autonomously; Huntloop drafts and classifies but leaves the
conversation to the salesperson and its assistant [V].

**Huntloop is better** at explaining a prospect (evidence rows, triggers with
dates, eight dimensions) and at everything after the reply (CRM, team,
HubSpot, learning) [V].

**Harvey is better** at getting a first email safely into an inbox at near-zero
cost, and at running unattended for one person [V].

**Missing.** Huntloop: billing, a working heartbeat without manual repository
settings, deliverability tooling. Harvey: tenancy, CRM, any learning beyond
editable prompts.

**[R]** Do not chase Harvey's autonomous multi-stage conversation agent. Do
adopt its execution-safety layer (category 5 and 8). Impact: protects sender
reputation, which is the one asset a customer cannot get back.

---

## 2. AI and agent systems

**Huntloop contains.** `runTask()` (`packages/ai/src/task.ts:62`) runs every
task the same way: route lookup in `ROUTES` (`models.ts`), an `ai_runs` row
written *before* the call, structured output via `output_config.format`, a
task-specific `parse()` that enforces fact/inference/unknown
(`claims.ts:70` `assertValidClaim`), cost and latency recorded on success or
failure. No SDK retries (`client.ts:73` `maxRetries: 0`); the job queue
retries. Prompt caching on the system prompt (`client.ts:124`). Nine tasks may
use the server-side `web_fetch` tool, limited to `fetchDomains` derived from
the input (`client.ts:87`) [V].

Routing: Opus (`claude-opus-5`) for research, qualification, why-now,
personalisation, sales agent, rules, ICP, competitors; Sonnet
(`claude-sonnet-5`) for performance explanations and two daily tasks; Haiku
(`claude-haiku-4-5`) for `extract_signals` and `classify_reply` [V].

**Harvey contains.** `Brain.think()` (`brain.py:246`) shells out to
`claude -p --output-format json --tools "" --strict-mcp-config --safe-mode
--setting-sources "" --disable-slash-commands --no-session-persistence`
(`claude_runtime.py:159`), in an empty temporary directory. JSON is extracted
from free text (`brain.py:599` `_extract_json`). Skills are Markdown files
concatenated into the prompt per agent (`brain.py:708`). Codex is an
alternative provider with version pinning and pre-flight isolation checks
(`codex.py`) [V].

**How decisions are made.** Neither uses an LLM planner. Harvey's
`decide_next_action` is a five-branch priority over counts. Huntloop's
sweepers are schedule-driven. Both reserve the model for judgement [V].

**Similar.** Model output is never trusted as instructions; untrusted text is
fenced; deterministic code chooses what runs.

**Different.**

| | Harvey | Huntloop |
|---|---|---|
| Output contract | Free text, JSON scraped out of it [V] | Schema-constrained JSON, then a validating parser [V] |
| Tools | None, verified before each call [V] | `web_fetch` on an allow-list for nine tasks [V] |
| Model choice | One model for everything, the operator's [V] | Per-task routing with a stated reason [V] |
| Knowledge | Editable Markdown skills, 1,631 lines [V] | Prompts in code, versioned (`prompt.version`, stored on `ai_runs`) [V] |
| Accounting | Tokens per agent/task in `usage_events` [V] | Tokens, cost, latency, prompt version, input hash, entity per run [V] |

**Huntloop is better** at output correctness (schema plus parser) and at
attribution: a bad prompt version is traceable to the runs it produced [V].

**Harvey is better** at isolation (no tools at all) and at letting a
non-developer change behaviour without a deploy [V].

**Fragile or inefficient.**

- Huntloop's model IDs are one generation old. Current list prices: Opus 5.5
  $4/$20 per MTok against Opus 5's $5/$25; Haiku 5.5 $0.10/$0.50 against Haiku
  4.5's $1/$5 [V, Anthropic model table cached 2026-10-06]. Migration has
  breaking changes (Opus 5.5 cannot disable thinking and defaults effort to
  `medium`; Huntloop already sets effort explicitly per route) [V].
- `models.ts:143` prices Sonnet 5 at $3/$15; the current list price is $2/$10,
  so Sonnet costs on the spend dashboard are overstated by 50% [V].
- No use of the Batch API (50% price) for tasks with no latency requirement:
  `analyze_performance`, `cluster_demand`, `infer_preferences`,
  `extract_signals` from scheduled scans [I].
- Harvey's JSON extraction from free text is the weaker contract; its writer
  needs a three-attempt cap for unusable drafts (`writer.py:33`) [V].

**[R]** Migrate routes to the 5.5 family behind an eval; correct the Sonnet
price; move scheduled, non-interactive tasks to batches; consider moving
house-style guidance (banned phrases, email frameworks) into versioned,
org-editable prompt fragments, which is the useful half of Harvey's skills
idea. Impact: roughly 20% lower Opus spend and about 90% lower Haiku spend at
list price, before batching [I].

---

## 3. Data and processing pipelines

**Huntloop contains.** `scan_source`: one bounded, SSRF-checked fetch
(`fetch.ts`), markup/feed extraction (`extract.ts`), dedupe on content and
canonical URL, Haiku signal extraction into normalised `source_events`, entity
resolution into companies, triggers and evidence. Each step degrades to the
previous one: with no API key, documents are still stored and the result says
extraction was skipped (`scan-source.ts` header) [V]. `discover_companies`:
Apollo search, one open run per query, unique results per (run, provider,
provider_id), every exit writes `status` and `stop_reason` [V]. Enrichment
through `@huntloop/providers` with a per-org budget, a database-backed circuit
breaker, a cache and a ledger (`provider_calls`, `provider_cache`,
`provider_breakers`) [V].

**Harvey contains.** DISCOVER (paid, estimated first), PROFILE (free, regex
over 3–6 pages), ENRICH (people from the site), VERIFY (pattern plus one
verification). Every fact is a row in `observations` with confidence,
evidence URL, collector and run id; a trigger rejects unknown signal codes
(`state.py:402-434`). Entity key: normalised domain, else provider external id
(`uq_companies_external`) [V].

**Similar.** Both refuse to let a failed collection look like an empty result
(Harvey: "a failure is an observation"; Huntloop: `stop_reason`). Both keep
provenance with each fact and treat signals over time as history.

**Different.** Huntloop's signals are mostly model-extracted from documents
and labelled fact or inference. Harvey's are regex-extracted from HTML with a
numeric confidence, and an agency credit below 0.75 confidence is not recorded
at all [V]. Huntloop pays Apollo or a model for what Harvey reads for free
from the company's own homepage.

**Huntloop is better** at entity resolution (domains table, merges, merge
candidates), at cross-tenant cost control for providers (database breaker
shared by all serverless instances, `budget.ts` header) and at evidence
semantics [V].

**Harvey is better** at cheap, deterministic, high-precision firmographic and
technographic facts (incumbent agency, ad pixels, booking, schema, stale blog,
ATS feeds), each with a URL [V].

**Missing in Huntloop.** A non-model profiler. Website facts that are
checkable with a regex cost an Opus or Haiku call today, or are not collected.
ATS boards are read through Apollo's hiring signal rather than from the
company's own Greenhouse/Lever/Ashby/Workable feed [V].

**[R]** Add a `profile_company` job: bounded fetch of homepage, robots,
sitemap, careers page through the existing `fetch.ts`; regex detectors for
ad pixels, tech stack, booking, schema, ATS board links; write `evidence` rows
with `claim_kind = 'fact'` and the page URL. Impact: more facts per company at
near-zero marginal cost, more "fact" and fewer "inference" claims behind each
score, and fewer paid provider calls [I].

---

## 4. Algorithms and business logic

**Huntloop contains.** Qualification by Opus into eight nullable 0–100
dimensions with `NOT NULL` explanation and confidence (`0003:237-250`), no
weights column by design; customer `scoring_rules` evaluated after the model
(`@huntloop/db/rules`), `model_score` and `score` stored separately with a
`rule_trace`; append-only history indexed by `computed_at desc`; computed
reason enum; HOT/WARM/WATCH/IGNORE tiers [V]. Contact ranking
(`rank-contacts.ts`), needs-you ranking (`apps/web/lib/needs-you/rank.ts`) [V].
Frequency caps: per-contact cadence and a rolling 30-day cap
(`0017_outreach_safety.sql`) [V].

**Harvey contains.** Deterministic priority (`main.py:134`); contact score
1–100 by model, `_heuristic_score` fallback; agency-credit confidence ladder
(0.9 / 0.75 / 0.35-not-recorded); owner ranking by surname in the business
name; email pattern inference with ambiguity rules (`email_finder.py`);
warmup cap arithmetic; recipient time-zone resolution; follow-up spacing;
cohort set intersection in SQL [V].

**Similar.** Both keep the model out of the control flow and keep scores
explainable.

**Different.** Huntloop scores *opportunities* (company × ICP) with an
explanation per dimension; Harvey scores *contacts* with one number and a
note. Huntloop's design keeps the model's verdict separable from policy so the
learning loop can ask whether the model was right [V].

**Huntloop is better.** Its scoring is auditable, rescorable, and produces
labelled training data (score before outcome) for free [V].

**Harvey is better.** Its email-address logic is more careful: it will not
verify an address that another named person at the company could own, and it
never treats a guess as a win [V].

**Fragile.** Huntloop has no combination rule across dimensions, which is
honest, but means ranking across opportunities leans on the model's tier
[V, by design]. Harvey's heuristic fallback silently replaces the model when a
call errors, so scores from two methods mix in one list [V].

**[R]** Keep Huntloop's scoring design. Borrow Harvey's address-ownership
ambiguity rule into `rank-contacts`/`enrich-person` when a guessed pattern is
used. Impact: fewer sends to the wrong person's mailbox.

---

## 5. Automation and execution

**Huntloop contains.** A Postgres queue (`job_executions`) with
`claim_job_executions ... for update skip locked`, a unique idempotency key
among queued and running rows, `requeue_stalled_jobs` after 10 minutes,
exponential backoff (attempts², capped at 60 min), 3 attempts by default,
permanent failures for unfixable payloads (`queue.ts`, `0008`) [V]. A tick
claims up to 5 jobs and runs them serially, stopping 20 s before a 60 s
deadline and handing unstarted jobs back (`runner.ts`) [V]. `send_message`
claims allowance before sending, records `sent_at` with the provider id
(`messages_sent_has_provider_id` constraint) and is safe to retry [V].

**Harvey contains.** An in-process loop. Phase 1 agents run in parallel with
per-task exception capture and a cycle timeout; phase 2 sends only if every
reply reader succeeded. Outbox claim `approved → sending` in one `UPDATE ...
WHERE status = 'approved'` (`state.py:1144`); items stuck in `sending` become
`failed`, never retried, with a note to check the Sent folder
(`fail_stale_sending_outbox`) [V]. Error backoff doubling to a cap; quiet
hours polled in short chunks after a sleep/wake stall was seen in production
(comment in `main.py`) [V].

**Similar.** Both are at-least-once with idempotent sends; both separate
drafting from sending so an approval state exists; both refuse to retry a send
whose outcome is unknown.

**Different.** Harvey orders the whole cycle so replies are processed before
sends. Huntloop has no such ordering between `sync_mailbox` and
`send_message` jobs: they are independent rows, and a reply that arrives
between the last sync and the next send is not seen [I]. Huntloop's
`send_message` re-checks suppressions, but a reply only becomes a stop after a
successful classification (category 8).

**Huntloop is better** at durability, multi-worker safety and recovery: a
crashed function loses nothing, and two workers never take the same job [V].

**Harvey is better** at causal ordering of reply-before-send, and at holding
sends when replies could not be read [V].

**Fragile in Huntloop.**

- **The heartbeat.** `apps/web/vercel.json` contains only a `$schema` key; the
  cron was removed in `59f7942`. The only driver is
  `.github/workflows/tick.yml`, which needs a `CRON_SECRET` secret and a
  `HUNTLOOP_URL` variable on the repository, and which GitHub pauses after 60
  days without repository activity. The root `README.md` still says
  `vercel.json` schedules the tick every minute [V].
- **Throughput.** 5 jobs per tick × one tick per 5 minutes = 60 jobs per hour
  across all tenants, about 1,440 per day [I]. `advance_enrollments` drafts at
  most 5 enrollments per run (`advance-enrollments.ts:50`). A single tenant
  with 300 active enrollments and a daily scan schedule would saturate it.

**[R]** (a) Gate every send on "no unprocessed inbound message on this
thread or from this contact", checked inside `send_message`, independent of
classification. (b) Move the tick to Vercel Pro cron or Inngest, and add an
alert when the oldest queued job is older than N minutes. (c) Let one tick run
several invocations (fan out by org, or call the endpoint with a larger
`limit` and parallel claim). (d) Fix the README. Impact: (a) removes a
compliance failure mode; (b) and (c) are the difference between a demo and a
product with more than a handful of tenants.

---

## 6. Database and state management

**Huntloop contains.** 81 tables over 47 migrations; RLS enabled on every
table, mostly in `foreach ... execute format('alter table ... enable row level
security')` loops, and `verify-migrations.ts:2776` fails if any table lacks it;
cross-org read and write tested as a non-superuser role [V]. Append-only score
history, evidence with a `claim_kind` check, provider ledgers, job queue,
outcome and learning tables, retention and erasure functions, 113
`create index` statements [V]. Migrations applied manually, with
`npm run db:doctor` to detect half-applied schemas [V].

**Harvey contains.** SQLite with WAL, 15 tables, versioned migrations in a
list keyed to `PRAGMA user_version` ("never edit or reorder"), indexes on the
hot paths, unique indexes that act as guards (`uq_outbox_campaign_step`,
`uq_prospects_email`, `uq_usage_events_request`), and the
`observations`/`signal_codes` pair with a vocabulary trigger [V].

**Similar.** Both encode invariants in the schema rather than in code, both
treat observations or evidence as rows with provenance, and both use unique
indexes as idempotency guards.

**Different.** Harvey's migrations run automatically at start; Huntloop's are
applied by hand, which is why `db:doctor` exists [V]. Harvey has no backup or
retention story beyond "it's a file" [V]; Huntloop has retention jobs and
documents backups in `docs/OPERATIONS.md` [U, not inspected in depth].

**Huntloop is better** at isolation, integrity constraints, history and
scale [V].

**Harvey is better** at zero-touch schema upgrades for its users [V].

**[R]** Automate migration application in the deploy pipeline (Supabase CLI
`db push` against a migration history table) and keep `db:doctor` as the
check. Impact: removes the most likely cause of a production-only failure.

---

## 7. APIs and integrations

**Huntloop contains.** Provider contract with five capabilities and an
explicit refusal taxonomy (`providers/src/contract.ts`); adapters for Apollo
(company search, enrich, people search, match, hiring signals), Hunter
(person match), ZeroBounce (verify) [V]. Gmail and Outlook adapters with OAuth
(`/api/mailboxes/[provider]`), `List-Unsubscribe` and one-click headers
(`mailbox/provider.ts:103-147`) [V]. HubSpot sync (`packages/crm`) [V]. Resend
for digests and notifications [V]. Inngest as an optional tick source [V].
HTTP endpoints: health, csp-report, jobs/tick, inngest, mailboxes, memory,
notifications, unsubscribe [V].

**Harvey contains.** Gmail API, Microsoft Graph, SMTP+IMAP, Instantly;
DataForSEO (three products), Serper, OpenStreetMap Overpass (three mirrors),
Hunter, Reoon, ZeroBounce, Precleared, Cloudflare Browser Rendering, Claude
OAuth usage endpoint (undocumented), LinkedIn via Playwright, optional
`python-jobspy`; search-engine HTML scraping [V]. A 46-route FastAPI JSON API
for the local dashboard [V].

**Similar.** Adapter-per-provider, provider choice in configuration,
verification providers interchangeable.

**Different.** Huntloop's adapters sit behind budgets, a breaker and a
ledger; Harvey's are direct `httpx` calls with per-collector spend caps [V].
Harvey reaches small local businesses through maps and listings data that
Apollo covers poorly [U per Harvey README; plausible].

**Huntloop is better** at integration hygiene: OAuth instead of passwords,
encrypted tokens, cost ledger, breaker, capability refusal reasons [V].

**Harvey is better** at source diversity and cost: free OSM, cheap
DataForSEO, free company-site reading, public ATS JSON [V].

**Fragile in Harvey.** Scraping Google, Bing and DuckDuckGo result pages; the
undocumented Claude usage endpoint; LinkedIn automation with a stored password
[V].

**[R]** Add DataForSEO (Listings, Maps) or an equivalent as a second
`company.search` adapter for local and SMB segments, and an ATS-feed reader.
Avoid search-engine scraping and LinkedIn automation entirely. Impact: opens
the SMB market without a per-seat data contract.
