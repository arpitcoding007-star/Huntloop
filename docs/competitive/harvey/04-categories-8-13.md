# 4 · Category analysis, part 2 (categories 8–13)

Evidence labels: [V] verified in code, [I] inferred, [U] unverified claim,
[R] recommendation.

---

## 8. Security and privacy

**Huntloop contains.**

- *Tenancy:* RLS on every table, with policies keyed on
  `public.user_org_ids()`; a test that fails if any table lacks RLS
  (`verify-migrations.ts:2776`); a test that org A cannot read or write org B
  as a non-superuser; a build check that nothing under `apps/` imports the
  service-role client [V].
- *Credentials:* application-layer encryption of Gmail/Outlook OAuth and
  refresh tokens and HubSpot tokens with `MAILBOX_ENCRYPTION_KEY`
  (`packages/db/src/crypto.ts`) [V].
- *Network:* `fetch.ts` allows only http(s), checks every resolved address,
  validates again at connect time to defeat DNS rebinding, re-checks every
  redirect (`redirect: "manual"`, at most five), bounds response size [V].
- *Prompt injection:* `UNTRUSTED_CONTENT_RULE` in system prompts and
  `wrapUntrusted()` with a per-call random fence id (`untrusted.ts:38`);
  structured output plus validating parsers; research tasks can fetch but not
  send, delete or spend [V].
- *Compliance at send:* refuses to send without an unsubscribe URL or a postal
  address (`send-message.ts` steps 3b and 3c), suppressions re-checked at send,
  `List-Unsubscribe` and RFC 8058 one-click headers [V].
- *Web:* CSP with a per-request nonce, report-only by default [U per README];
  rate limits in Postgres (`0005_rate_limits.sql`) [V]; tick endpoint refuses to
  run without `CRON_SECRET` [V].

**Harvey contains.**

- *Model isolation:* no tools, no MCP, no settings, no hooks, no transcript,
  empty working directory; refuses to run on a CLI without `--safe-mode`
  (`claude_runtime.py:159,235-268`). Codex: pinned version, configuration and
  endpoint verified before the login is handed over, refresh token withheld
  (`codex.py`) [V].
- *Prompt injection:* `fence()` normalises NFKC, strips zero-width characters
  and removes any `untrusted` tag in any spelling or HTML-entity form
  (`untrusted.py:31`); `autopilot_review()` holds any unapproved email that
  links to, or gives an address at, a domain that is not the operator's, or
  quotes a run of Harvey's own prompts or skills (`gate.py:313`) [V].
- *Network:* `public_http.py` pins the connection to a checked IP while
  keeping TLS SNI, rejects special-use ranges including IPv6-embedded IPv4,
  disables environment proxies [V].
- *Local surface:* dashboard bound to loopback, Host header must be loopback,
  Origin checked, bearer token compared with `hmac.compare_digest`
  (`dashboard_auth.py:294`), token never accepted from a cookie or query [V].
- *Credentials:* `.env` in plain text; LinkedIn password stored there; Gmail
  token on disk [V].
- *Opt-out:* regex patterns run first and override the model
  (`handler.py:57,145,427-435`); escalation patterns for legal or angry
  replies never get a model answer [V].

**Similar.** Both treat external text as data, both fence it, both run SSRF
checks with redirect and rebinding defences, both refuse to send without an
opt-out mechanism and a postal address.

**Different, and why it matters.**

1. **Huntloop's opt-out-by-reply and stop-on-reply depend on the model.**
   `sync-mailbox.ts:104-121` stores each inbound message and then calls
   `classify_reply`. If that throws `AiUnavailable` (no key, monthly run quota
   exhausted), classification is skipped for the rest of the batch; any other
   error leaves `classification` null. Either way `applyClassification` is not
   called, so the suppression is not written and the enrollment is not stopped
   (`:283`, `:345`). No job reclassifies stored messages later (searched
   `packages/jobs/src` and migrations for a reclassify path; none). A
   "please remove me" reply can therefore be followed by the next step of the
   sequence [V, path traced; not executed]. Harvey's equivalent is a regex
   that runs before any model call [V].
2. **Huntloop has no send-time content gate.** Banned phrases and length are
   enforced when `personalize_message` parses the model's draft
   (`personalize-message.ts:173,403`), not when `send_message` sends. There is
   no check for links or addresses at domains outside the org's own, so at
   autonomy 2+ an instruction planted in scraped evidence that survives into a
   draft goes out unreviewed [V for absence of a link check; I for the attack].
   Harvey's `autopilot_review` exists for exactly this case.
3. **Huntloop sends to unverified addresses.** `isSendableEmail` excludes only
   `undeliverable` and `risky` (`contact.ts:689-692`); `unknown` and null pass.
   Harvey's `pre_send_check` requires `verified` (or `risky` by opt-in) [V].

**Huntloop is better** at tenant isolation, secret storage and blast-radius
design (research cannot act) [V].

**Harvey is better** at model sandboxing (no tools at all), fence robustness
(Unicode normalisation, tag stripping), and outbound content defence [V].

**Weak in either.** Huntloop's fence id uses `Math.random()` with 8 base-36
characters and does not normalise the wrapped text; acceptable, but Harvey's
strip-and-normalise approach is stronger [V]. Harvey stores credentials in
plain text and automates LinkedIn with a password [V]. Huntloop's provider and
AI budgets fail open when the quota cannot be read (`jobs/src/ai.ts:117`,
`providers/src/budget.ts` header), a deliberate and documented trade [V].

**[R]** In priority order: a deterministic opt-out and bounce pre-classifier in
`sync-mailbox` that runs before the model and applies suppressions on match; a
"thread has unclassified inbound" stop in `advance_enrollments` and
`send_message`; a reclassify sweeper; a send-time gate ported from
`gate.py` (recipient matches contact, verification allow-list, merge tags,
banned phrases, link domains allow-list, HTML); Unicode normalisation and tag
stripping in `wrapUntrusted`. Impact: closes the one class of failure that can
create legal liability for a customer.

---

## 9. Performance and scalability

**Huntloop.** Throughput is bounded by the scheduler, not by Postgres: 5 jobs
per tick, serial, a tick every 5 minutes via GitHub Actions, gives about 60
jobs an hour for every tenant combined [I from `runner.ts:57`, `route.ts:76`,
`tick.yml`]. Function limit 60 s (`route.ts:45`), so one Opus call at high
effort can consume most of a tick. Horizontal scale exists in principle (two
runners claim disjoint rows with `skip locked`) [V] but nothing launches more
than one runner per tick [V]. Provider cache and breaker are in the database,
shared across instances [V]. 113 indexes; score history read through
`opportunity_scores_current_idx` [V].

**Harvey.** One process per operator; agents in parallel within a cycle;
`MAX_SENDS_PER_CYCLE` and the daily cap bound sending; SQLite WAL is adequate
for one writer process [V]. Profiling is 3–6 HTTP requests per site with no
model, 25 sites per cycle [V]. Codex calls are serialised per Brain [U per
README]. Scaling past one operator means running another copy [V].

**Similar.** Both bound per-cycle work and both avoid unbounded fan-out.

**Huntloop is better** at architectural headroom: multi-worker safety and
shared state are already correct [V].

**Harvey is better** at the cost per unit of work, because most work does not
touch a model [V].

**[R]** Raise throughput before onboarding real tenants: fan out per org (one
claim per org per tick, in parallel invocations), raise the per-tick limit for
jobs that do not call a model, and add a queue-age metric to
`/api/health`. Impact: the engine stops being the bottleneck at roughly ten
active tenants [I].

---

## 10. Testing and code quality

**Huntloop.** About 12,500 lines of verification scripts run with
`node --experimental-strip-types`: `verify-migrations.ts` (3,829 lines, a real
Postgres through PGlite, constraint and RLS assertions as a non-superuser),
`verify-jobs.ts` (3,508 lines, roughly 200 checks), `verify-tasks.ts` (2,363
lines, scripted model client), `verify-providers.ts`, `verify-rules.ts`,
`verify-pure.ts`, `verify-security-leads.ts`, `verify-crm.ts`; 31 Vitest files
in `apps/web` and `packages/ui`; 108 Playwright `test(` call sites in `e2e/`
[V counts]. CI: typecheck, lint, tests, site audit, `npm audit`, build, bundle
budget (`.github/workflows/ci.yml`) [V]. Code style: long design-rationale
headers on every handler, which make intent clear and also make the files
long; closed unions that make a missing handler or route a compile error [V].

**Harvey.** 70 pytest modules, 1,238 test functions, 22,387 lines of tests,
including prompt-injection, SMTP header-injection, security defaults, CLI
isolation against the real binary, Codex soak tests, Windows support; CI on
Ubuntu, macOS and Windows × Python 3.11 and 3.12, plus a real Codex CLI run
against localhost mocks (`.github/workflows/tests.yml`) [V].

**Similar.** Both test against scripted models rather than live APIs, both
test the security boundary specifically, both have a culture of documenting
why.

**Different.** Harvey's suite is denser per line of product code (22k test
lines for 27.5k source lines) and covers adversarial inputs to the send path
(`test_prompt_injection.py`, `test_smtp_header_injection.py`,
`test_hand_sent_guard.py`) [V]. Huntloop's strongest tests are on the schema
and tenancy; its reply path pins that unclassified messages are stored
(`verify-jobs.ts:1577`) but does not test that a sequence stops when the model
is unavailable [V].

**[R]** Add adversarial tests on the outbound path: an opt-out reply with the
model unavailable must stop the enrollment and suppress the address; a draft
containing a foreign link at autonomy 2 must not send; an `unknown`
verification status must not send. Impact: the tests encode the fixes in
category 8 so they cannot regress.

---

## 11. Configuration and extensibility

**Huntloop.** Environment variables (`docs/developer/environment-variables.md`),
per-org profile in the database (`@huntloop/db/org-profile`), per-campaign
autonomy, per-org scoring rules and ICPs, preferences and memory [V]. Adding a
task: a member in `TaskName` forces a route (type error otherwise); adding a
job: a member in `JobName` forces a handler [V]. Adding a provider: implement
the capability interface in `providers/src/contract.ts` [V].

**Harvey.** `.env` for credentials, `harvey.yaml` for behaviour, gitignored
`harvey.local.yaml` override, `skills/*.md` and `prompts/*.md` editable
without code, `skill_map` in `brain.py` to wire a new skill, a
`DiscoveryProvider` class per source, governed signal vocabulary [V].

**Different.** Harvey's behaviour is changed by editing text; Huntloop's by
data per tenant and by code for prompts [V]. Huntloop's choice is right for a
multi-tenant product, where a tenant editing a global prompt is not possible.

**[R]** Expose per-org, versioned prompt fragments for voice and banned
phrases (stored in the org profile, rendered into `personalize_message`), and
keep the system prompt in code. Impact: customer control of tone without
forking prompts.

---

## 12. Cost and operational efficiency

**Huntloop.** Pays the Anthropic API per token at the prices in `models.ts`
(Opus 5 $5/$25, Sonnet 5 $3/$15 as coded, Haiku 4.5 $1/$5) [V]. Most
customer-visible and per-company tasks run on Opus at medium or high effort
(`ROUTES`) [V]. Prompt caching on the system prompt [V]. Spend recorded per
run in `ai_runs`; a per-org monthly *run count* quota, not a currency budget
(`jobs/src/ai.ts:108-127`) [V]. Provider spend through budgets and a ledger
[V]. Infrastructure: Vercel, Supabase, Resend, Apollo/Hunter/ZeroBounce
contracts [V].

**Harvey.** Model calls on the operator's existing subscription, throttled to
`max_daily_claude_percent` of the real quota [V]. Profiling free, OSM free,
DataForSEO about $0.37 per 1,000 listings, verification free tiers [U prices
per README]. No infrastructure beyond the operator's machine and a mailbox [V].

**Different, and why it matters.** Harvey's cost advantage is real for one
person and cannot be copied by a SaaS: running customers' work on a consumer
subscription would breach the provider's terms and is not offered as a
product [I]. What *can* be copied is the habit of not spending a model call on
what a regex can do.

**Huntloop inefficiencies.** Every scored company costs at least one Opus
high-effort qualification; every enrollment step costs an Opus drafting
call; the run-count quota treats a Haiku classification and an Opus research
run as the same unit [V]. Older model IDs cost more than their successors [V].

**[R]** Migrate to the 5.5 family after an eval; batch the scheduled
non-interactive tasks; meter quotas in cost units (cents from `ai_runs`) rather
than runs; add the free profiler so cheap facts do not need a model; consider
a cheap pre-qualification gate (deterministic ICP mismatch, or a Haiku pass)
before Opus qualification. Impact: the largest lever on gross margin per
tenant [I].

---

## 13. Limitations and future potential

**Huntloop: structural limits.** The engine's throughput and its dependence on
manual repository settings; no billing; no deliverability tooling; model-only
handling of safety-critical replies; manual migrations; AI tasks never run
against the real API [U per README]; legal pages still drafts [U per README].

**Harvey: structural limits.** One operator per install, no CRM or team
features, SQLite, local machine as the server (sleep, Wi-Fi and reboots stop
it), dependence on undocumented endpoints and on scraping search engines,
LinkedIn automation risk, intelligence limited to what a homepage says.

**Sustainable advantages.**

- *Huntloop's* evidence model, explainable scoring with history, tenancy and
  the CRM-plus-learning loop compound with use and are hard to retrofit into a
  local tool [I].
- *Harvey's* zero-marginal-cost model use is sustainable only for
  individuals; its deterministic safety layer and free profiler are easy for
  Huntloop to adopt, so they are not a lasting moat against Huntloop [I].

**Opportunities for differentiation.** Signal *change* over time (Harvey
lists scheduled re-observation as a roadmap item [U]; Huntloop already keeps
history and could trigger on deltas such as "dropped their agency", "started
running ads", "opened a sales role"); outcome-labelled scoring (Huntloop
keeps the score before the reply); evidence-cited drafts that a reviewer can
check line by line.
