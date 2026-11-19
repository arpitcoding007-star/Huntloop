# 6 · Gap analysis and roadmap for Huntloop

Every item is a recommendation [R]. Each names the evidence that motivates it
(see the category documents for detail), the change, and the expected impact.
Effort is a rough size: S (a day or two), M (about a week), L (several weeks).

## P0 — fix before any customer sends real email

These are failures that cost a customer their domain or create legal
exposure. All are small.

| # | Gap (evidence) | Change | Effort | Impact |
|---|---|---|---|---|
| P0-1 | Opt-out and stop-on-reply only happen if `classify_reply` succeeds (`sync-mailbox.ts:104-121,283,345`) | Deterministic pre-classifier before the model: opt-out phrases ("unsubscribe", "remove me", "stop", "no thanks", "take me off"), bounce senders (`mailer-daemon`, `postmaster`, DSN content type). On match, suppress and stop with no model call. Model still runs for everything else | S | A request to stop is honoured even with no API key or an exhausted quota |
| P0-2 | Any inbound reply that is never classified leaves the sequence running | In `advance_enrollments` and `send_message`, refuse to proceed if the thread or contact has an inbound message newer than the last outbound that has no classification. Add a `reclassify_replies` sweeper | S | Removes the "replied, then got the follow-up anyway" failure |
| P0-3 | Cold email to `unknown` verification status (`contact.ts:689`) | Allow-list for the first cold email: `deliverable` or `provider_verified`; `risky` only by a per-campaign opt-in. Replies to someone who wrote to us stay exempt | S | Lower bounce rate, protects mailbox reputation |
| P0-4 | No content or link check at send time; at autonomy ≥2 nobody reviews | Port Harvey's `pre_send_check` and `autopilot_review` into a `packages/jobs/src/gate.ts` called from `send_message`: recipient matches contact point, merge tags, banned phrases, length, HTML, link and address domains against an org allow-list (sending domain, org website, recipient's domain, booking URL). Failures at autonomy ≥2 go back to approval with the reason | M | Closes the prompt-injection-to-outbox path and catches human edits |
| P0-5 | Bounce-rate kill switch absent | Per mailbox: pause sending when bounces exceed a threshold over the last N sends (Harvey uses 5% after at least 10) and surface it in needs-you | S | Stops a bad list from burning a domain in an afternoon |
| P0-6 | Heartbeat depends on unset repo settings; README says Vercel cron runs it (`apps/web/vercel.json`, `tick.yml`) | Choose one production driver (Vercel Pro cron or Inngest), alert when the oldest queued job is older than 15 min, correct `README.md` | S | The engine actually runs, and a stopped engine is noticed |

## P1 — before more than a handful of tenants

| # | Gap | Change | Effort | Impact |
|---|---|---|---|---|
| P1-1 | ~60 jobs/hour total throughput (`runner.ts:57`, `tick.yml`) | Fan out per org in parallel invocations; separate limits for model and non-model jobs; queue-depth and age in `/api/health` | M | Engine stops being the bottleneck |
| P1-2 | No reply-before-send ordering | Run `sync_mailbox` for a mailbox before draining its due sends in the same tick, or hold sends for a mailbox whose last sync is older than its send interval | M | Same guarantee Harvey's phase 2 gives |
| P1-3 | Warmup stored but unused (`0004:32`) | Enforce a ramp from a per-mailbox start date in `claim_mailbox_send` | S | New domains do not land in spam on day one |
| P1-4 | No domain readiness check | A `check_mailbox_domain` job: MX, SPF, DMARC, DKIM (common selectors), domain age by RDAP, DNS blocklists. Block cold sending on FAIL | M | Prevents the most common cause of zero replies |
| P1-5 | No recipient-timezone window | Store a zone per contact (company location, then country) and hold cold sends outside business hours in that zone | M | Better open and reply rates [I] |
| P1-6 | Manual migrations | Apply migrations in the deploy pipeline; keep `db:doctor` as the check | S | Removes production schema drift |

## P2 — margin and data quality

| # | Gap | Change | Effort | Impact |
|---|---|---|---|---|
| P2-1 | Older, more expensive model IDs; Sonnet priced at $3/$15 vs $2/$10 list (`models.ts`) | Build a small eval per route, then migrate to `claude-opus-5-5` / `claude-sonnet-5-5` / `claude-haiku-5-5`; correct the price table | M | About 20% lower Opus and about 90% lower Haiku list cost [I]; correct spend dashboard |
| P2-2 | No Batch API use | Batch scheduled, non-interactive tasks (`analyze_performance`, `cluster_demand`, `infer_preferences`, scheduled `extract_signals`) | M | 50% off those tasks |
| P2-3 | Quota counts runs, not cost (`jobs/src/ai.ts:108`) | Meter in cents from `ai_runs.cost_cents` | S | Plans priced on what they cost |
| P2-4 | Facts a regex can find cost a model call or are missing | `profile_company` job (homepage, robots, sitemap, careers through `fetch.ts`; detectors for ad pixels, tech stack, booking, schema, ATS links); write `fact` evidence with URLs | M | More facts per company, near-zero marginal cost, stronger evidence behind scores |
| P2-5 | Hiring only through Apollo | Read Greenhouse, Lever, Ashby and Workable public feeds linked from the company's own site | S | Fresher, cheaper, cited hiring evidence |
| P2-6 | Every candidate goes to Opus qualification | A deterministic ICP mismatch filter, then optionally a Haiku pre-screen, before Opus | M | Fewer Opus calls on obvious non-fits |
| P2-7 | Wrong-person risk on guessed addresses | Adopt Harvey's ownership-ambiguity rule in `enrich-person`/`rank-contacts` | S | Fewer misdirected sends |

## P3 — differentiation

| # | Opportunity | Change | Impact |
|---|---|---|---|
| P3-1 | Signal change as a trigger | Re-observe profiler facts on a schedule and raise triggers on deltas (agency changed, ads started, role opened) | A "why now" that a static database cannot give |
| P3-2 | Outcome-labelled scoring | Use the append-only score history against outcomes to calibrate the tiers per org | Scores that improve with use, a lasting advantage |
| P3-3 | SMB segment | A DataForSEO Listings/Maps adapter as a second `company.search` provider | Opens local-business customers without a per-seat data contract |
| P3-4 | Org-editable voice | Versioned per-org prompt fragments (voice, banned phrases, frameworks), the safe half of Harvey's skills files | Customer control of tone without forking prompts |

## Deliberately avoid

- **Search-engine HTML scraping** (Harvey `scout.py:432-528`): brittle and
  against those engines' terms. Use a search API.
- **LinkedIn browser automation** (`integrations/linkedin.py`): account and
  terms risk to the customer.
- **Running customers' work on consumer model subscriptions.** Harvey's
  cost model does not transfer to a SaaS.
- **Raw SMTP RCPT probing** (`email_finder.py:581`): unreliable and harmful to
  sending IP reputation.
- **A model-driven conversation agent that replies autonomously** before the
  P0 items exist. Huntloop's choice to draft and hand to a person is the safer
  default.
- **Scraping JSON out of free text.** Keep structured output.

## Suggested sequence

1. P0-1, P0-2, P0-3, P0-5 together (one change to the reply and send path,
   with the adversarial tests from [category 10](04-categories-8-13.md#10-testing-and-code-quality)).
2. P0-4 and P0-6.
3. P1-1 and P1-2 (engine), then P1-3 to P1-6 (deliverability and ops).
4. P2-1 and P2-3 behind an eval, then P2-4 and P2-5 (profiler).
5. P3 items as product bets.

## Final assessment

- **Where Huntloop is technically ahead:** the evidence and scoring model, the
  tenant boundary and its tests, the durable job queue, credential
  encryption, integration hygiene, and breadth after the reply (CRM, HubSpot,
  team, learning).
- **Where Harvey is technically ahead:** the execution half of outreach:
  deterministic gating at send, injection-aware outbound review, keyword
  opt-out ahead of the model, allow-listed deliverability, warmup, domain
  readiness, send windows, bounce kill switch; and free deterministic
  profiling.
- **Which advantages last:** Huntloop's compound with data and are hard to
  retrofit into a local tool. Harvey's safety layer is easy to copy, so it is
  not a moat against Huntloop. Harvey's cost model only works for
  individuals.
- **What to learn from Harvey:** rules before the model on anything that must
  not fail; check at the moment of sending, not at the moment of drafting;
  never spend a model call on what a regex can find.
- **What to do differently:** keep structured output, tenancy, OAuth and
  evidence semantics; do not adopt scraping of search engines or LinkedIn.
- **The most important improvements:** P0-1 to P0-6, in that order. None of
  them is large, and together they make the outreach half as trustworthy as
  the intelligence half already is.
