# Huntloop — Delivery Plan

**Version** 1.0 · **Date** 2026-08-11

This is the *executable* plan: what gets built, in what order, and how we know
each phase is finished. It is deliberately separate from the two documents
either side of it:

| Document | Answers |
|---|---|
| [HuntLoop — Master Product… Context.md](HuntLoop%20—%20Master%20Product,%20Technical%20&%20Engineering%20Context.md) | **What** the product is |
| [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) | **How** it is architected, and why |
| **This file** | **When**, in what order, and **done means what** |

Every item is tagged:

- 🟢 **buildable now** — no external dependency
- 🔴 **blocked** — needs credentials, a hosted project, or a decision from the
  product owner

---

## Phase A — Make it real (foundation)

*Goal: the app knows who you are and reads from an actual database.*

### A1 · Turn on the database 🔴

Blocked on Supabase credentials.

- [ ] Apply `packages/db/migrations/0001…0004` to the hosted project, in order
- [ ] Re-run the isolation suite **against the hosted project**, not PGlite
- [ ] Confirm `authenticated` (not the service role) is the role the app uses
- [ ] Record the applied migration list somewhere durable

**Done when:** `npm test` passes against the real project, and org A provably
cannot read org B *there*.

> PGlite proves the SQL is correct. It does not prove this project is
> configured correctly. Those are different claims and only the second one
> protects a customer.

### A2 · Data-access layer 🟢

- [x] One loader per screen in `apps/web/lib/data/`
- [x] Loaders query Supabase when configured, fall back to fixtures when not
- [x] A visible banner states which source is in use — the app never quietly
      shows demo data as if it were real
- [x] Fixture shapes match row shapes, so the swap is a query change per page

**Done when:** every screen calls a loader and no page imports a fixture
directly.

### A3 · Auth 🟢 to write, 🔴 to verify

- [x] Login and signup pages
- [x] `auth/callback` route for the email link / OAuth return
- [x] `middleware.ts` — refreshes the session and guards `/[org]/*`
- [x] Org resolution: not-a-member is indistinguishable from does-not-exist
- [x] Sign-out
- [x] Organisation creation, replacing the hand-written SQL in SETUP.md
- [x] The half-configured state (keys present, schema absent) reads as demo
      mode rather than a 404 on every page
- [ ] Google OAuth provider enabled in the Supabase dashboard 🔴
- [ ] End-to-end check with two real users in two real orgs 🔴

**Done when:** a logged-out visitor is bounced from every `/[org]` route, and a
member of org A gets a 404 — not a 403 — for org B.

> 404 rather than 403 is deliberate. "That org exists but you may not see it"
> leaks the customer list to anyone who can guess a slug.

### A4 · Guardrails that run themselves 🟢

- [x] ESLint flat config, including the D2 rule banning the admin client from
      `apps/`
- [x] GitHub Actions: typecheck → lint → test → build on every push
- [x] The dependency-free admin-import script kept alongside the ESLint rule

**Done when:** a pull request that imports the service-role client into
`apps/web` fails CI.

---

## Phase B — The intelligence core

*Goal: prove Huntloop finds better opportunities than a lead database.*
*This is the product. Everything in Phase A is plumbing.*

### B1 · Onboarding and ICP 🟡 *(screens built; the brain needs an AI key)*

- [x] `/welcome` — organisation creation, writing real rows as the user
- [x] `/welcome/product` — enter your website, review what was understood
- [x] Findings carry FACT / INFERENCE, and a human edit promotes to FACT
- [x] `/welcome/icp` — segment, size, region, triggers, and exclusions as their
      own question (§9)
- [x] `/welcome/sources` — accept / remove / add, each with a stated reason
- [x] Progress rail; completed steps are navigable backwards (§77 P7)
- [x] `research_company` — reads the site, returns five fields as FACT /
      INFERENCE / UNKNOWN with a source on every fact 🟡 *(written and unit
      tested; never run against the real API — no key)*
- [x] `/welcome/product` calls it, and says so when no key is configured
- [ ] Persist product, ICP and source choices 🔴 *(needs the schema applied)*
- [ ] ICP versioning, so a re-score can say which version judged it

### B2 · Sources 🟡 *(recommendation works; scanning needs the job runner)*

- [x] Source management screen with accept / remove / add
- [x] Failure states surfaced rather than hidden (§58)
- [x] `recommend_sources` — suggest sources from the ICP 🟡 *(written and unit
      tested; never run against the real API — no key)*
- [x] Every recommendation names the ICP element it came from, constrained to
      the elements actually sent — so "TechCrunch, because it's large" cannot
      be returned
- [x] `/welcome/sources` calls it, and says so when no key is configured
- [ ] Persist the accepted source list 🔴 *(needs the schema applied)*
- [ ] `source.scan` job, per source, on a schedule
- [ ] Failing source marks itself unavailable and the hunt continues

> The recommender has no web access. A URL it returns is recalled, not checked,
> so the task asks for `null` over a guess — a wrong address does not fail
> visibly, it fails at scan time looking like an outage.

### B3 · Signal → company 🔴

- [ ] `signal.extract` — pull normalized events out of fetched pages (§33)
- [ ] `company.resolve` — entity resolution (§59); `Alphio`, `Alphio AI` and
      `alphio.ai` become one row
- [ ] Deduplication by content hash, canonical URL, domain (§60)

### B4 · Research and judgement 🟡 *(the verdict works; the pipeline into it doesn't)*

- [x] `qualify_opportunity` — **willing to return IGNORE** (§17) 🟡 *(written
      and unit tested; never run against the real API — no key)*
- [x] `ai.score` — the eight dimensions, unmeasured ones left `unknown`, never
      coerced to zero
- [x] §15 enforced rather than described: HOT requires ICP fit, problem
      severity **and** trigger strength to have been established, so §78's
      "a strong trigger must not lift a poor-fit company" is a failed run
      rather than a code-review note
- [x] A fact must cite a page on the domain the run actually fetched — a
      citation to a site that was never read fails the run
- [x] `/[org]/analyze` calls it, and discloses that the verdict rests on the
      company's own site alone (§78)
- [ ] Persist the verdict — "Save as an opportunity" is disabled, and says
      why 🔴 *(needs the schema applied)*
- [ ] `ai.research` — deep company understanding (§12)
- [ ] Problem / gap / trigger detection, stored separately (§78 needs them
      independently addressable)
- [x] `explain_why_now` — or an honest "no reason to contact today" 🟡
      *(written and unit tested; never run against the real API — no key)*
- [x] It cannot fetch, and its reasoning is constrained by schema to the
      claims it was handed, minus the unknowns — so urgency resting on
      something nobody gathered is unrepresentable
- [ ] Buyer identification

> The score is the model's, not a formula's. §51 records the weighting of the
> eight dimensions as NOT DEFINED and warns against inventing weights and
> passing them off as Huntloop's logic, so nothing here derives the composite
> from the dimensions — it checks that the two are coherent and renders both.

### B5 · The job runner 🔴

None of this exists today. Research takes minutes; it cannot happen while
someone waits on a page — `/welcome/product` awaits it inline, which is
acceptable for one call during setup and will not survive a scan cycle.

- [ ] `packages/jobs` — handlers as plain functions, runner-agnostic
- [ ] `apps/workers` — the entry point that registers them
- [ ] Retries, per-org fairness, idempotency keys
- [x] Every AI job writes its `ai_runs` row **before** the model call, so a
      crash still shows up in the bill — `runTask` in `packages/ai` owns this,
      so a handler cannot skip it

### B6 · Screens 🟢 *(buildable against fixtures now)*

- [x] Command Center
- [x] Opportunity list with priority filters
- [x] §47 opportunity detail page
- [x] Analyze a URL (§17) — wired to `qualify_opportunity`, no longer scripted
- [ ] Companies list and company page
- [ ] Imports — upload → map columns → dedupe → resolve → research (§61)

**Phase B done when:** a new signup goes from website → ICP → sources → real
opportunities they judge better than their current lead database, with every
HOT verdict traceable to cited evidence, and at least one company the system
was willing to mark IGNORE.

---

## Phase C — The AI workspace

- [ ] Per-opportunity agent conversation, wired to a model (§19)
- [ ] The §62 safety rules enforced, not just described in the UI
- [ ] Organization and user memory, with permission-aware retrieval (§37, §54)
- [ ] Contact enrichment behind a provider interface
- [ ] CRM pipeline (§26)
- [ ] AI cost dashboard and per-org budgets

**Done when:** a salesperson asks "why do you think this?" about any claim and
gets an evidence-cited answer — and the agent visibly declines to assert what
the evidence doesn't support.

---

## Phase D — Execution

- [ ] Gmail / Outlook mailbox connection
- [ ] Message generation grounded in `evidence_ids`
- [ ] Human approval queue
- [ ] Send scheduler with all four invariants
- [ ] Inbox sync, reply classification
- [ ] Autonomy levels 0–3

> The database already refuses to record an outbound message as sent without a
> provider message id. There is no such thing as a fake ✓ in this schema.

---

## Phase E — Team

- [ ] Roles beyond owner/admin/member/viewer
- [ ] Assignment and reassignment
- [ ] Manager dashboards, team analytics
- [ ] AI coaching

---

## Phase F — Learning

- [ ] Outcome capture
- [ ] Statistical (not ML) correlation with confidence intervals
- [ ] Intelligence Center
- [ ] Score model versioning and drift detection

**Guard:** show no "we learned X" claim until an org has ≥200 outcomes. Below
that, show the sample size instead of a conclusion. Shipping noise as insight
loses trust permanently, and it does not come back.

---

## Ordering rationale

Phase A before B because nothing can be stored. B before C and D because §76
lists *"build everything simultaneously without validating the intelligence
core"* under DO NOT — and a campaign tool that sends templates does not test
the claim this product is making.

F is last because a new tenant produces roughly zero outcomes for 60–90 days.
Learning is the retention mechanism, not the wedge.
