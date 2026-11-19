---
description: >-
  A technical audit of Huntloop against Harvey (ethanplusai/harvey), an
  open-source autonomous sales agent, written from both codebases rather than
  from either product's documentation.
---

# Huntloop vs. Harvey — technical audit

**Date:** 2026-10-26 · **Huntloop at:** `8021d3f` (plus the uncommitted working
tree at the time of writing) · **Harvey at:** `b703856` (`pyproject.toml`
version `0.3.0`; its README still says 0.2.1)

Harvey is a single-operator, local-first Python agent that finds small
businesses, writes cold email, sends it through the operator's own mailbox and
works replies toward a meeting. Its model calls run on the operator's Claude
Pro/Max or ChatGPT subscription through isolated CLI subprocesses.

Huntloop is a multi-tenant SaaS (Next.js 16 + Supabase/Postgres) whose unit is a
*qualified opportunity with evidence*. It discovers companies from sources and
provider search, scores them on eight explainable dimensions, and runs a
CRM, outreach, mailbox sync and learning loop on top of that.

They overlap on the outreach half and differ almost completely on the
intelligence half, on tenancy, and on how they pay for models.

## Documents in this folder

| # | Document | What it answers |
|---|---|---|
| 1 | [Feature and capability inventory](01-feature-inventory.md) | What each product can do, as built, with each item marked as working, partial or planned |
| 2 | [Architecture and data-flow comparison](02-architecture.md) | How each system runs end to end: process model, data flow, decision-making |
| 3 | [Category analysis, part 1: categories 1–7](03-categories-1-7.md) | Functionality, AI/agents, pipelines, algorithms, automation, database, integrations |
| 4 | [Category analysis, part 2: categories 8–13](04-categories-8-13.md) | Security, performance, testing, configuration, cost, limitations |
| 5 | [Comparison matrix](05-matrix.md) | One table, every row backed by a file reference |
| 6 | [Gap analysis and roadmap](06-gaps-and-roadmap.md) | Prioritised improvements for Huntloop, with expected impact |

## How the evidence is labelled

Every claim in these documents is one of four kinds:

- **[V] Verified.** Read in the code, a schema, a test or CI config at the
  commit above. A file path is given.
- **[I] Inferred.** Follows from verified code but was not executed, such as
  throughput arithmetic from a batch size and a schedule.
- **[U] Unverified.** Taken from documentation, a comment or a README and not
  confirmed in code. Kept only where it matters, and always labelled.
- **[R] Recommendation.** What Huntloop should do. Never evidence of anything.

Neither product was run for this audit. No Huntloop or Harvey test suite was
executed; test *existence and scope* were read, not test *results*.

## Evidence inspected

**Harvey** (cloned to a scratch directory, never executed). Read in full or in
the relevant part: `harvey/main.py` (heartbeat, `decide_next_action`),
`brain.py` (provider selection, budget gate, skill loading),
`claude_runtime.py` (isolated CLI argv), `untrusted.py` (fencing), `gate.py`
(`pre_send_check`, `autopilot_review`), `state.py` (schema, migrations,
`claim_outbox_item`), `agents/sender.py` (`_drain_due`), `agents/handler.py`
(opt-out patterns, intents, bounces), `agents/scout.py` (search, scraping,
scoring), `agents/writer.py` (retries, feedback), `collectors/discover.py`
(provider classes), `integrations/email_finder.py` (verifiers, SMTP probe),
`integrations/quota.py`, `integrations/linkedin.py`, `public_http.py`,
`dashboard_auth.py`, `deliverability.py`, `trainer.py`, `analyst.py`,
`prompts/*.md`, `skills/*.md`, `harvey.yaml`, `CLAUDE.md`, `README.md`,
`.github/workflows/tests.yml`, and the test file list and counts.

**Huntloop.** `packages/jobs/src/{queue,runner,fetch,ai}.ts` and the handlers
`discover-companies`, `scan-source`, `score-opportunity`,
`advance-enrollments`, `send-message`, `sync-mailbox`; `packages/ai/src/{models,
client,task,untrusted,claims}.ts` and `tasks/personalize-message.ts`,
`tasks/classify-reply.ts`; `packages/providers/src/{contract,budget}.ts` and
the Apollo, Hunter and ZeroBounce adapters; `packages/db/src/{crypto,contact}.ts`;
migrations `0002`, `0003`, `0004`, `0005`, `0008`, `0017` and the RLS loops
across all 47; `packages/db/scripts/verify-migrations.ts`;
`apps/web/app/api/jobs/tick/route.ts`; `apps/web/vercel.json`;
`.github/workflows/{ci,tick}.yml`; `apps/web/app/(app)/[org]/inbox/actions.ts`
and `outreach/actions.ts`; `README.md`; `docs/` and `audit/` indexes.

## Access limitations

- Harvey's 27.5k lines of source and 22.4k lines of tests were read
  selectively, by module and by function, not line by line. Its dashboard
  (2,470 lines) and Codex runtime (1,561 lines) were sampled, not traced.
- Huntloop's `apps/web` server actions were sampled where they bear on
  sending, approval and AI spend. UI code was deliberately skipped, as asked.
- No production or staging deployment of either product was inspected.
  Huntloop's README says no AI task has called the real API yet [U]; nothing
  here contradicts that.
- Model prices come from `packages/ai/src/models.ts` and from Anthropic's
  current published model table (cached 2026-10-06), not from a bill.

## Unresolved questions

1. Are `CRON_SECRET` and `HUNTLOOP_URL` set on the GitHub repository, so that
   `.github/workflows/tick.yml` actually drives production? Without them the
   engine runs nothing (see [Category 5](03-categories-1-7.md#5-automation-and-execution)).
2. Is the uncommitted change to `apps/web/app/api/health/route.ts` related to
   engine health? It was not reviewed.
3. What autonomy level do real campaigns use? At level 2 and above drafts send
   with no human review, which changes how much the gaps in
   [Category 8](04-categories-8-13.md#8-security-and-privacy) matter.
4. Was the Sonnet price in `models.ts` ($3/$15) set deliberately above today's
   list price ($2/$10), or is it stale?

## The short verdict

**Huntloop is ahead on** the intelligence model (fact/inference/unknown enforced
in the schema, eight nullable score dimensions, append-only score history,
customer scoring rules applied after the model), tenancy and isolation (RLS on
every table, asserted by a test), durable job execution (Postgres queue with
`skip locked`, idempotency keys, stalled-job recovery), credential handling
(application-layer encryption of OAuth tokens), and breadth (CRM, HubSpot,
teams, learning, competitors, demand).

**Harvey is ahead on** sending safety and deliverability: a deterministic
pre-send gate at the moment of sending, an autopilot review that holds emails
linking to domains that are not yours, keyword opt-out detection that runs
before and regardless of the model, an allow-list for deliverable addresses,
a warmup ramp, a sending-domain readiness check, recipient-timezone send
windows and a bounce-rate kill switch. It is also ahead on cost: free website
profiling and no per-token model bill.

**The two most important findings for Huntloop** are both in the outreach
path, and both are cheap to fix:

1. **Stopping a sequence on reply, and honouring an emailed opt-out, depend on
   a successful model call.** If `classify_reply` fails for any reason, the
   reply is stored but the enrollment keeps sending, and nothing reclassifies
   it later (`packages/jobs/src/handlers/sync-mailbox.ts:104-121`).
2. **Huntloop sends to addresses whose verification status is unknown.**
   `isSendableEmail` is a deny-list that blocks only `undeliverable` and
   `risky` (`packages/db/src/contact.ts:689`). Harvey's gate is an allow-list.

The full prioritised list is in [Gap analysis and roadmap](06-gaps-and-roadmap.md).
