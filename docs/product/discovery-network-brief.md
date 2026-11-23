---
description: >-
  A sharper version of the "universal discovery network" research command, plus an
  inventory of what HuntLoop already does, what is already planned (Exchange), and
  which parts of the new request are genuinely new add-ons.
---

# Universal discovery network: the command, and where we stand

> **Layer:** Product · **Status:** Research brief. Nothing on this page is built or decided.
> Written 2026-11-23 from branch `feat/pass-19-debt` (migrations through `0057`).

This page has three parts:

1. [**The improved command**](#1-the-improved-command): the research prompt, rewritten to be scoped, checkable and safe to hand to an agent.
2. [**What we have today**](#2-what-huntloop-already-does): what the code does now, with file references.
3. [**Planned vs. new add-ons**](#3-what-is-already-planned-and-what-is-new): what the Exchange spec already covers, and what this request adds on top.

---

## 1. The improved command

Copy everything inside the block below. Compared with the original, it:

- tells the agent which documents to read first, so it builds on the Exchange spec instead of starting again;
- fixes the output file and keeps the task read-only;
- requires evidence labels (built, partial, planned, missing) and `file:line` citations, so nobody can mistake a proposal for something built;
- asks for decisions with recommendations, and doesn't stop at listing options;
- lists the risks that are easy to skip: cold-contacting unregistered suppliers, profiling consumers, and keeping declared buyer data away from enrichment;
- names the sections the document must contain and when it counts as finished.

```text
ROLE
You are a principal product architect doing a READ-ONLY feasibility study of the
HuntLoop monorepo (W:\work-backup\Huntloop). You write exactly one new file:
  docs/product/discovery-network-exploration.md
Do not edit any other file, run migrations, change config, install packages,
call paid providers, or start jobs. Reading code, running read-only greps, and
running existing unit tests are allowed.

GOAL
Decide how HuntLoop can grow from a seller-side "why now" sales-intelligence tool
into a two-way AI discovery and connection network: anyone (business or individual)
says what they want, and HuntLoop turns that into a structured requirement, finds
and verifies counterparties (registered or not), routes the opportunity to them
with consent, and keeps matching as new participants arrive. Do this without
turning HuntLoop into a full e-commerce marketplace and without breaking the
current seller product.

READ FIRST, IN THIS ORDER (these set the ground rules, and the code outranks them on what exists)
  1. README.md and HUNTLOOP_MASTER_SYSTEM_GUIDE.md (Part 14 inventory, Part 15)
  2. docs/product/marketplace-spec.md          (the existing "Exchange" proposal)
  3. docs/decisions/exchange.md                (open decisions EX-1..EX-5)
  4. docs/product/exchange-demand-test.md      (the manual test that gates code)
  5. docs/decisions/README.md, docs/product/plans-and-quotas.md
  6. packages/ai/src/{client,models,task,prompt,untrusted}.ts and tasks/*
  7. apps/web/app/(onboarding)/welcome/*, apps/web/lib/data/onboarding*.ts
  8. packages/jobs/src/handlers/* (discovery, enrich, research, score, send, notify)
  9. packages/providers/src/* and packages/db/migrations/* (schema, RLS, firewall-
     relevant tables: companies, people, contact_points, evidence, products, icps)
Treat the Exchange spec as the baseline. Say where you agree, where you extend it,
and where you would change it and why. Don't redesign it from nothing.

NON-NEGOTIABLE PRINCIPLES (inherited from the repo, so check every proposal against them)
  - Fact ≠ inference ≠ unknown. A stated need is a fact; inferred intent is an inference.
  - Scores are explainable, named dimensions; an unmeasured dimension is UNKNOWN, not 0.
  - Why now: needs and signals expire.
  - Signing up never exposes anyone; identity is revealed per need, by the user, revocably.
  - Declared (consented) data never flows into enrichment or cold sequences.

QUESTIONS TO ANSWER (each one needs a recommendation, not only options)
  A. Intake. Design the conversational questionnaire: entry categories (Find products /
     services / suppliers or manufacturers / customers or leads / buyers / partners,
     Sell, "Describe what you need"), slot-filling per category, when to stop asking,
     skip/unsure handling, reuse of onboarding/profile data, and the structured
     "Requirement" object it produces (JSON schema with fact/inference/unknown per field).
     Show 4 example conversations: B2B bulk (200 x a specific NVIDIA GPU/module),
     consumer one-off (one laptop), service buyer (accountant/agency), and a seller
     ("find me customers") reversing the flow.
  B. LLM approach. Compare Claude, OpenAI and at least one other option (open-weight model or
     a rules/form hybrid) for: structured output reliability, tool use, prompt
     caching, cost per completed intake (estimate tokens), latency, refusals, data
     retention terms. The repo is Anthropic-only behind a ModelClient seam
     (packages/ai/src/client.ts), so state the cost of adding a second provider and
     whether it is worth it now. Recommend a model per step (classify, ask, extract,
     match-explain) consistent with packages/ai/src/models.ts routing.
  C. Supply discovery. How a requirement becomes candidate providers: registered
     orgs (products, icps, offerings), public web, and data providers (Apollo is
     B2B company data and knows nothing about stock, authorised distribution, or
     consumer sellers). How to verify a supplier (domain, authorised-distributor
     lists, evidence rows), how to handle product availability (honest UNKNOWN by
     default), and how to deduplicate (reuse resolve_entity / merge_candidates).
  D. Demand discovery (the reverse direction). How a seller finds buyers: stated
     needs (consented), aggregate demand (k-anonymity), and the existing signal
     engine for companies. State plainly what is NOT acceptable: inferring
     individual consumers' purchase intent from scraped data and contacting them.
  E. Routing and notification. Notifying registered suppliers about a matching need
     (visibility levels, caps, preferences in notification_preferences, digest vs
     instant). What happens with UNREGISTERED suppliers: is contacting them cold
     outreach (CAN-SPAM, GDPR/PECR, India DPDP)? Recommend a compliant pattern
     (for example, buyer-initiated "invite this supplier", or a claim-your-listing email
     with a lawful basis) and its limits.
  F. Matching and scoring. Retrieval (hard filters, then similarity; there is no
     pgvector today, so say whether to add it), match dimensions, intent scoring that
     separates browsing from buying (stated timeline, budget, verified identity,
     repeat activity), lead qualification, duplicate and spam prevention, and
     continuous re-matching on the existing /api/jobs/tick runner.
  G. Connection. Inquiry → response → thread → follow-up → outcome, reusing threads,
     messages, outcomes and learning_runs where the firewall allows. Users who are
     both buyer and seller: one identity, separate roles, no data bleed.
  H. Scope control. What stops this becoming an e-commerce marketplace (no
     checkout, no inventory sync, no escrow) and what that costs us.

REQUIRED SECTIONS IN THE OUTPUT
  0. Executive summary (one page): the recommendation, the three biggest risks,
     and the first thing to do on Monday.
  1. Inventory table: capability | status (✅ built / 🟡 partial / 📝 planned /
     ❌ missing) | evidence (file:line) | reusable for this? (yes/with change/no).
  2. Gap analysis against questions A to H.
  3. Proposed architecture: a mermaid diagram showing new tables and jobs next to
     existing ones, and the firewall boundary drawn explicitly.
  4. Requirement schema and the 4 example conversations (A).
  5. LLM comparison table and per-step recommendation with cost estimate (B).
  6. User journeys (B2B buyer, consumer, manufacturer, distributor, service
     provider, freelancer, lead-seeking business): before, during and after a match.
  7. Risks and limitations: legal, trust and safety, cold start or liquidity,
     data quality, cost, abuse. Each one gets a mitigation and an owner type.
  8. Phased plan that extends the Exchange P0/P1/P2: per phase, what ships, which
     existing code it reuses, which decisions (EX-1..5 or new ones) block it,
     and the exit metric. Phase 0 must be something testable without code.
  9. New open decisions, written in the docs/decisions/exchange.md format.
  10. Things we may have missed.

EVIDENCE RULES
  - Every "exists" claim cites file:line. If you can't cite it, it is not "exists".
  - Label every proposal as PROPOSED. Never describe planned work in the present tense.
  - When you assume something, say it is an assumption.
  - Prefer the simplest design that passes the principles; justify every new table.

DONE WHEN
  The single output file exists; every section above is present; the inventory
  has citations; each question A to H ends in a recommendation; and `git status`
  shows no other file changed.
```

---

## 2. What HuntLoop already does

Status key: ✅ built · 🟡 built, but not proven live or only partial · ❌ not built.
Per the README, the code outranks the docs on what exists.

### 2.1 The core loop (seller side)

> **SIGNAL → CONTEXT → INTENT → OPPORTUNITY**: find companies, explain *why now*, help reach them.

| Capability | Status | Where | Reuse for the new vision |
|---|---|---|---|
| Accounts, workspaces (orgs), roles, invites, join requests, verified domain claim (SEC-302) | ✅ | `packages/db/migrations/0001`, `0030`, `0052`; `apps/web/app/(auth)` | **Yes.** Provider identity, and the "who may claim a listing" rule. |
| 7-step resumable onboarding: who you are → first goal → company research → goals → ICP → sources → build | ✅ 🟡 | `apps/web/app/(onboarding)/welcome/*`, `lib/data/onboarding.ts` | **Partly.** The pattern of resumable steps that save as they go carries over. The questions are fixed and seller-only; no chat. |
| AI reads your website and drafts your product + ICP, citing sentences | ✅ | `packages/ai/src/tasks/research-company.ts`, `draft-icp.ts` | **Yes.** It's the same "words → structured profile with citations" step a supplier profile needs. |
| Products you sell (name, description, value props, proof points) | ✅ | `products` table (`0002`), `settings/product` | **With change.** No category, price, quantity, region or stock fields. It isn't a catalogue yet. |
| ICPs (who you sell to), versioned | ✅ | `icps`, `icp_versions` (`0013`), `settings/icp` | **Yes.** The Exchange spec already runs seller ICPs against open buyer needs. |
| Sources and scanning (news, job boards, funding feeds) → dated, sourced signals | ✅ 🟡 | `scan_source`, `extract-signals.ts`, `sources` | **Yes**, for spotting companies that probably need something. Company-level only. |
| Company discovery from a data provider | ✅ 🟡 | `discover_companies` → `packages/providers/src/adapters/apollo.ts` | **Limited.** Apollo only knows B2B companies. It can't tell you who stocks a part, who's an authorised distributor, or anything about individual sellers. |
| Enrichment: company facts, people, emails, email verification | ✅ 🟡 | `enrich_company`, `enrich_person`; Apollo, Hunter, ZeroBounce | **Seller side only.** The Exchange firewall says buyer data must never go through this. |
| Entity resolution and dedupe (domains, external ids, merge candidates) | ✅ | `resolve_entity`, `company_domains`, `merge_candidates` (`0012`) | **Yes.** Duplicate suppliers and listings. |
| Evidence model: every claim is fact / inference / unknown, with citations and freshness | ✅ | `evidence`, `evidence_citations` (`0020`, `0032`) | **Yes.** It's the base for "verified supplier" and "stated need". |
| Explainable 8-dimension opportunity score (ICP fit, problem severity, evidence strength, trigger strength or freshness, buying likelihood, product relevance, decision-maker access); unknown = null | ✅ | `score-opportunity.ts:293-336`, `opportunity_scores` | **Pattern, yes.** Match scoring should use the same named-dimension shape. |
| Scoring rules + rescore jobs | ✅ | `scoring_rules`, `recompute_scores` | **Yes.** |
| Why-now explanation | ✅ | `explain-why-now.ts` | **Yes.** It works for "why this match now". |
| Competitors: research, mentions, their customers | ✅ | `research_competitor`, `prospect_competitor_customers` | Side benefit. "Alternative suppliers". |
| Contact ranking | ✅ | `rank_contacts`, `contact_fit_scores` | Seller side only. |

### 2.2 Engage (outreach and conversations)

| Capability | Status | Where | Reuse |
|---|---|---|---|
| Campaigns, sequences, enrollments, approval before send | ✅ 🟡 | `campaigns`, `sequences`, `advance_enrollments` | **No** for buyers (the firewall). OK for a seller's own prospects. |
| Sending from your own Gmail/Outlook, reply sync, reply classification | ✅ 🟡 | `packages/jobs/src/mailbox/*`, `send_message`, `classify-reply.ts` | **Partly.** In-app intro threads are a separate thing, but the reply classifier carries over. |
| Safety: suppressions, send caps, per-contact frequency, SPF/DKIM checks, unsubscribe, kill switch | ✅ | `0017`, `0033`, `0048`, `0050`–`0053` | **Yes.** It's also where supplier notification throttling would go. |
| Threads, messages, message events | ✅ | `threads`, `messages` (`0004`) | **With change.** Today these are email threads between an org and a prospect, not org ↔ org or person ↔ org. |
| Personalised drafts, learned writing preferences | ✅ | `personalize-message.ts`, `learn_preferences` | Yes, for drafting intro and response messages. |
| Pipeline, Needs you, assignments, follow-up reminders | ✅ | `pipeline`, `needs-you`, `schedule_followups` | **Yes.** Accepted intros fall into the existing pipeline (as the spec already says). |
| HubSpot push | ✅ 🟡 | `packages/crm`, `sync_hubspot` | Yes, for accepted intros only. |

### 2.3 Learn, AI and notifications

| Capability | Status | Where | Reuse |
|---|---|---|---|
| One model client (Anthropic only) with structured JSON output, prompt caching, an allow-listed `web_fetch`, untrusted-content wrapping, cost recording per run | ✅ | `packages/ai/src/client.ts`, `untrusted.ts`, `runs.ts`, `ai_runs` | **Yes.** The questionnaire runs on this. There's a swap seam, but no OpenAI code exists. |
| Task → model routing (Opus for what customers read, Haiku for closed-set classification) | ✅ | `packages/ai/src/models.ts` | **Yes.** Add `intake_*` tasks here. |
| Chat assistants: "Ask Huntloop" (workspace) and per-opportunity sales agent; saved conversations; answers cite claims and list what's unresolved | ✅ ⚠️ | `workspace-assistant.ts`, `sales-agent.ts`, `conversations` (`0045`) | **Closest thing to the questionnaire.** It already does multi-turn chat with grounded answers and states unknowns. It doesn't do slot-filling. |
| Prospect demand themes: groups what *your prospects* asked for in replies | ✅ | `/demand`, `cluster-demand.ts`, `demand_themes`/`demand_signals` (`0042`) | **Clustering, yes.** It's not market demand. The spec warns not to confuse the two. |
| Learning loop: weekly analysis, findings you approve | ✅ | `analyze_performance`, `learning_findings` | Yes, to learn from match outcomes. |
| Memory (what HuntLoop knows about your business) | ✅ | `memories`, `/memory` | Yes, as profile context, so the questionnaire doesn't ask twice. |
| Notifications: email via Resend (invites, join, assignment, daily digest); in-app counts, question cards, nudges; per-user notification preferences | ✅ | `send_notifications`, `send_digests`, `notification_preferences` (`0040`) | **Yes.** "A buyer needs what you sell" would go out as a new notification type, in the digest or sent instantly. |
| Durable jobs on a tick (`/api/jobs/tick`, Inngest), backpressure, fair claiming | ✅ 🟡 | `packages/jobs/src/runner.ts`, `queue.ts`, `0038`, `0056` | **Yes.** Continuous re-matching runs here. It needs the cron actually wired (known blocker #3). |
| Data rights: retention, erase a person, unsubscribe, audit log, activity log | ✅ | `0029`, `enforce_retention`, `purge_contact_data`, `audit_logs` | **Yes.** It's the minimum for consumer data. |

### 2.4 Not built at all (relevant here)

| Missing | Why it matters |
|---|---|
| **Billing** (no Stripe, no payment path) | Provider plans and paid intros depend on it. |
| **Buyer / individual user role**: every useful action needs an org membership | B2C and buyer-side intake can't start without it. |
| **Category taxonomy, offerings, price/quantity/region on products** | Without these, you can't match "200 × module X in Germany". |
| **Embeddings / vector search** (no pgvector) | Matching free-text needs to offerings at scale. |
| **Org ↔ org or person ↔ org messaging** | The inquiry → response → thread step. |
| **Public API / webhooks** | Not needed now (deliberately not built). |
| **Any second LLM provider** | Only needed if a comparison shows it's worth the extra code to maintain. |
| **Proven live run** with real keys | Most engine pieces are 🟡. The first thing to fix before building more. |

---

## 3. What is already planned, and what is new

### 3.1 Already planned: Huntloop Exchange (📝, no code)

Three documents already plan most of the two-way idea:
[marketplace-spec.md](marketplace-spec.md), [decisions/exchange.md](../decisions/exchange.md),
[exchange-demand-test.md](exchange-demand-test.md).

| Already in the Exchange plan | Phase |
|---|---|
| A **buyer** user type who states **needs** (category, attributes, budget, currency, decide-by, urgency) | P0 |
| **Visibility levels 0 to 3** per need (private → counted → anonymised card → open to intros), revocable, logged | P0 |
| **Declared/enriched firewall**: buyer data never enriched, never sequenced, enforced by a CI gate | P0 |
| **Public provider catalogue**, built from public sources, claimable via verified domain | P0 |
| `categories`, `buyer_profiles`, `needs`, `provider_profiles`, `offerings`, `offering_evidence`, `matches` tables | P0 |
| Match scoring on named dimensions (category, requirement, budget, size, region, timing, trust) | P0 |
| **Market demand** dashboard for providers (aggregates, k ≥ 10) | P1 |
| Seller ICPs run against open needs; "Stated need" badge in Opportunities | P1 |
| Intro requests (state machine), in-app threads, outcomes, alerts both sides, provider billing | P1 |
| Continuous re-matching; needs expire | P0/P1 |
| **Conversational need capture (AI concierge)**, buyer teams, RFPs, CRM push, API | P2 |
| A hand-run **demand test** (form + spreadsheet + email) before any code | Gate |
| Open decisions: EX-1 brand/domain, EX-2 region/currency, EX-3 free provider claims, EX-4 domain verification for level 3, EX-5 first category list | Before P0 |

### 3.2 New add-ons in this request (beyond the Exchange plan)

| New add-on | How it relates to the plan | First concern to resolve |
|---|---|---|
| **The AI questionnaire is the entry point for everyone** | The plan puts it in P2. This request moves it to the front. | Could ship first as AI-assisted intake on top of the P0 `needs` form, not as a separate system. |
| **Eight intent categories** (find products, services, suppliers/manufacturers, customers/leads, buyers, partners; sell; describe your need) | The plan has one vertical (software for SMEs), one direction | Every new category needs its own attribute set (EX-5). Launching all eight at once spreads a cold-start marketplace thin. |
| **Physical products and bulk sourcing** (200 GPUs, manufacturers, authorised distributors, wholesalers) | The plan excludes it | Availability, pricing, authorised-reseller status and counterfeits are data we don't have. Apollo doesn't cover them. |
| **B2C: individuals as buyers** (one laptop, household items, a local service) | The plan excludes consumers | Consumer law, much higher volume, low value per need, and competition with Google/Amazon. |
| **Individuals and freelancers as providers** | The plan excludes them | Identity verification without a company domain (EX-4 assumes one). |
| **Business partnerships** | The plan excludes them | Partnerships don't fit "need → offering" matching well. They may need a separate flow. |
| **Discovering and notifying suppliers who aren't registered** | The plan builds a public catalogue but doesn't say how to contact unclaimed suppliers | That's cold outreach about someone else's need. It needs a lawful basis and the buyer's consent to share. |
| **Sellers find buyers "without waiting for a search"** (evidence-based potential demand) | The plan does it for companies (signals) and for consenting buyers (aggregates or cards) | For individuals, inferring intent from scraped data and contacting them conflicts with the firewall and privacy law. Restrict it to companies plus consented needs. |
| **Choosing between OpenAI, Claude and others** | The repo is Claude-only by decision (plan D5), with a swap seam | Only worth a second provider if a measured gap shows up in cost, latency or quality. |
| **Intent scoring: browsing vs. buying** | Partly covered (urgency is stored as an inference) | Needs explicit dimensions: stated timeline, budget, verified identity, need refreshed, past outcomes. |
| **Same user as buyer and seller** | The plan allows it with separate roles | Keep it: one login, two roles, no data crossing between them. |

### 3.3 Points the research should push back on

1. **The demand test hasn't been run** (master guide blocker #6). It's still the cheapest way to find out whether buyers will state needs at all, and the questionnaire version can be tested by hand too.
2. **Most of the engine isn't proven live** (🟡). Adding a second product on top of an unverified first one doubles the risk.
3. **"Universal" works against liquidity.** A marketplace works when one category has enough buyers and suppliers. Start with one or two categories even if the intake form accepts anything, and handle the rest as "we'll look for you" or "not yet".
4. **Contacting unregistered suppliers or individuals** is the step most likely to break the trust promise, and it deserves its own decision record.
5. **No checkout, inventory or escrow.** HuntLoop stops at an accepted intro and a reported outcome. That's also how it avoids turning into e-commerce.
