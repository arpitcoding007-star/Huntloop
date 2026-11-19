---
description: >-
  Proposed spec for Huntloop Exchange, a two-sided marketplace where buyers state
  what they need and providers find consented demand. Nothing on this page is built.
---

# Huntloop Exchange: intent marketplace (proposed)

> **Layer:** Product · **Audience:** product, engineering, design · **Status:** Proposed. Nothing here is built.

{% hint style="warning" %}
**This page is a proposal, not a description of the product.** Every other page
in `docs/product/` is written from the code. This one is written ahead of it.
When a part ships, move that part into the relevant page and delete it here.
{% endhint %}

## 1. The idea in one paragraph

Today Huntloop is used by **sellers**. It finds companies from observed signals,
explains *why now*, and helps the seller reach out. Exchange adds a **second
kind of user, the buyer**. A buyer signs up and *states* what they need, for
example "a CRM for a 6-person seed-stage startup in India, under ₹5k a month,
deciding this quarter". Huntloop matches that need to providers. Providers see
how much demand exists and, **only when the buyer allows it**, who is asking.

The key point: **a stated need is the strongest "why now" signal the scoring
model can receive.** It is a `fact` with a date and a source (the buyer), not an
inference built from a job post. So Exchange is not a separate product. It is a
**new demand source that feeds the opportunity pipeline sellers already use.**

```
BUYER STATES NEED → MATCH → PROVIDER SEES DEMAND → MUTUAL OPT-IN → INTRO → OUTCOME → LEARN
```

## 2. Scope of the first version

| In | Out (for now) |
|---|---|
| One vertical: **software and business services bought by startups and SMEs** | Consumer products, jobs, investment, partnerships |
| Buyers: founders and operators at companies with 1 to 200 people | Enterprise procurement with legal review cycles |
| Providers: Huntloop's existing seller orgs, plus claimed public profiles | Providers who are individuals or freelancers |
| Aggregate demand, matched leads, mutual intros | RFP bidding, the AI concierge, the public API (see §11, P2) |

Why this vertical: needs are structured (category, seats, budget, stack), the
providers are easy to identify, the outcome can be measured (a purchase), and
**Huntloop's current customers are already the supply side.** A marketplace with
too many categories fails because no single category has enough buyers and
providers.

## 3. The principles this inherits

The repo's three rules apply as they are and get stricter on the buyer side.

1. **Fact ≠ inference ≠ unknown.** A buyer's stated need is `fact`. Anything
   Huntloop guesses about the buyer (urgency from wording, for example) is
   `inference` and is shown as a guess.
2. **Scores are explainable.** Match scores use named dimensions. A dimension
   with no data reads UNKNOWN, never zero.
3. **Why now.** A need has a decision date and goes stale. A need that is past
   its timeline and not refreshed stops counting as current demand.

Two new rules:

4. **Signing up never exposes anyone.** Identity is revealed only by an explicit,
   per-need, revocable choice from the buyer (§5).
5. **Declared data never mixes with enriched data.** Exchange data never passes
   through Apollo, Hunter or any enrichment provider, and never enters an
   outbound sequence (§6).

## 4. Actors and identity

| Actor | What it is | Today's equivalent |
|---|---|---|
| **Buyer user** | A person stating needs. Has no seller-org membership. | None. `profiles` exists but every useful action requires a `memberships` row. |
| **Buyer team** | Optional group of buyer users at the same company who share needs and a shortlist | None |
| **Provider** | A seller org that has a public provider profile | `organizations` |
| **Unclaimed provider profile** | A public listing built from public sources that nobody has claimed yet | None (see the warning below) |

A single person can be both a buyer and a member of a seller org. The two roles
are separate. Acting as a buyer never gives a seller org access to anything.

{% hint style="danger" %}
**Do not seed the provider catalog from the tenant `companies` table.**
`companies.org_id` is `not null`, and each row is one org's *prospect list*.
Copying those rows into a global catalog would leak every tenant's targeting to
every other tenant. The catalog has to be built from public sources (company
websites, public directories), with its own provenance, in tables that have no
`org_id`.
{% endhint %}

**Claiming a profile** reuses the SEC-302 rule from migration 0052. A domain is
a claim until someone holds it. A profile at `acme.com` can be claimed only by
an owner or admin of an org who has a **confirmed address at `acme.com`**.

## 5. Visibility levels (the consent model)

Every **need** has a visibility level that the buyer sets and can change at any
time. Visibility belongs to the need, not the account, because "show my identity
for my CRM search" does not mean "show it for my accounting search".

| Level | What a matched provider sees | Default |
|---|---|---|
| **0 · Private** | Nothing. The need only drives the buyer's own recommendations. | |
| **1 · Counted** | Only aggregate counts and trends, and only when at least **k = 10** needs share a group (§9) | ✅ Default |
| **2 · Matchable** | An anonymised card for each need: category, size band, region, budget band, timeline, must-haves. No name, company or contact. The provider can *request* an intro. | |
| **3 · Open to intros** | Same as level 2, and the buyer gets a short list of matched providers to accept or decline. Identity is revealed only to providers the buyer **accepts**. | |

Rules:

- Lowering a level takes effect immediately. Providers who were not already
  introduced lose access on their next read. Existing intros stay, because the
  buyer accepted them.
- Every reveal is written to `audit_logs`: which need, which org, which level,
  when.
- Free-text fields stay hidden below level 3. People write their name, employer
  and phone number into text boxes.
- A level-2 card must not identify the buyer when combined with other cards. If
  a group (category × region × size band) has fewer than k needs, the card shows
  a wider band, for example region "South Asia" instead of "Pune".

### Should providers be notified proactively?

**Yes, at level 1 by default, and individually only at level 2 or above.** A CRM
provider gets "23 seed-stage teams in India started evaluating CRMs this week"
without anyone being exposed. An alert about a specific need is sent only for
needs at level 2 or 3.

## 6. The declared/enriched firewall

This is the biggest risk in the design. The existing engine enriches people who
never signed up and puts them into cold outreach. If a buyer's email ever goes
through that path, Exchange's trust promise is broken and cannot be repaired.

The rule must be enforced by the system, not by convention:

1. Buyer identity lives in Exchange tables (`buyer_profiles`, `needs`), which
   seller orgs cannot read under RLS. Seller orgs read only through
   security-definer functions that apply §5.
2. When an intro is accepted, it creates the opportunity and person rows in the
   seller org with `origin = 'exchange'`. A check constraint and the send path
   refuse to:
   - enrich a person with `origin = 'exchange'` (`packages/providers/src/call.ts`
     rejects it),
   - enrol them in a `sequence` (only one-to-one replies inside the intro
     thread are allowed),
   - export them through the CRM sync unless the intro is in `accepted` state.
3. A build gate (like `NAV-01`) fails CI if any provider adapter or sequence
   handler can be reached with an Exchange-origin row. An e2e test tries each
   path and expects a refusal.
4. If a buyer deletes a need or their account, the person row in the seller org
   is tombstoned, and the thread stays readable only to the people who were in it.

## 7. Data model (new tables)

Global tables have **no `org_id`**. Access to them goes through functions, not
through the org-scoped RLS pattern (`user_org_ids()`).

| Table | Key columns | Notes |
|---|---|---|
| `categories` | `id`, `slug`, `parent_id`, `name`, `attributes jsonb` | Controlled list, version 1 has about 40 leaf categories. Attributes define what a need in that category can specify (seats, integrations…). |
| `buyer_profiles` | `user_id`, `company_name`, `company_domain`, `size_band`, `country`, `region`, `stage`, `role` | `company_domain` is verified the same way as SEC-302 before it is shown at any level |
| `buyer_teams`, `buyer_team_members` | | Optional (P2) |
| `needs` | `id`, `buyer_id`, `category_id`, `summary`, `attributes jsonb`, `budget_min/max`, `currency`, `decide_by`, `urgency`, `visibility smallint 0–3`, `status (open/paused/fulfilled/expired/withdrawn)`, `last_confirmed_at` | `urgency` inferred from text is stored as a separate inference column, not as the buyer's answer |
| `provider_profiles` | `id`, `org_id null`, `domain`, `name`, `claimed_at`, `verified_at`, `source` | `org_id` is null while unclaimed |
| `offerings` | `provider_id`, `category_id`, `attributes jsonb`, `price_model`, `price_from/to`, `regions[]`, `size_bands[]`, `integrations[]` | Links back to the existing `products` and `icps` once claimed |
| `offering_evidence` | same shape as `evidence` | Public proof of a capability: pricing page, integrations page. `kind` is `fact`/`inference`/`unknown`. |
| `matches` | `need_id`, `offering_id`, `score`, `dimensions jsonb`, `explanation`, `computed_at`, `buyer_state (new/shortlisted/dismissed)` | Recomputed by a job, history kept |
| `intro_requests` | `id`, `need_id`, `provider_id`, `direction (buyer→provider / provider→buyer)`, `state`, `message`, `created_at`, `decided_at` | State machine in §8 |
| `exchange_threads`, `exchange_messages` | | In-app messaging before contact details are shared |
| `exchange_outcomes` | `intro_id`, `outcome (won/lost/no_decision/not_a_fit)`, `reported_by`, `reason` | Both sides can report, disagreements are kept |
| `exchange_reports` | `reporter`, `subject_type`, `subject_id`, `reason`, `state` | Trust and safety queue |

`evidence.subject_type` today allows `company`, `opportunity`, `contact`,
`signal`. An opportunity created from an intro gets an evidence row whose claim
is "the buyer stated this need on <date>", `kind = 'fact'`, `confidence = 'high'`.
No new subject type is needed on the seller side.

## 8. Intro lifecycle

```
           provider requests (need at level 2 or 3)
                        │
buyer requests ──► REQUESTED ──► buyer declines ──► DECLINED
                        │
                  buyer accepts
                        ▼
                    ACCEPTED ──► opportunity created in the seller org (origin = exchange)
                        │        thread opens, contact details shared only if the buyer chooses
                        ▼
                    IN_PROGRESS ──► OUTCOME (won / lost / no_decision / not_a_fit)
                        │
          no activity for 30 days ──► STALE (both sides asked once, then closed)
```

- Only the **buyer** can accept. A provider request to a level-2 need is shown
  to the buyer as "Acme CRM would like to talk about your CRM search".
- Providers have a weekly cap on intro requests per plan, plus a decline-rate
  limit: too many declines and requests are throttled. This stops spam.
- Outcomes go into `outcomes` and `learning_runs`, the same loop that tunes
  seller-side scoring today.

## 9. Matching

**Candidate retrieval:** hard filters (category, region, size band, budget
overlap, still open), then embedding similarity between `need.summary` +
attributes and offering text + evidence. Embeddings go through `packages/ai`
and are recorded by `lib/ai/recorder.ts` like every other model call.

**Scoring:** named dimensions in the same style as the 8-dimension opportunity
score.

| Dimension | Measures | UNKNOWN when |
|---|---|---|
| Category fit | The offering serves the need's category or sub-category | |
| Requirement fit | Share of must-haves backed by offering evidence | The offering has no evidence for a must-have |
| Budget fit | The price range overlaps the budget | Either side has no price |
| Size fit | The buyer's size band is in the offering's served bands | |
| Region fit | Service region and data residency | |
| Timing | Days until `decide_by` | No decide-by date |
| Trust | Profile claimed, verified, outcome history | Unclaimed profile |

Each match stores its dimensions and a written explanation. Paid placement
(§12) never changes `score`. A promoted listing is shown in a separate, labelled
slot.

**Continuous matching:** a job on `/api/jobs/tick` re-matches open needs when
an offering is created or changed, and expires needs past `decide_by + 14 days`
that the buyer has not confirmed again.

**From the provider side:** the provider's existing `icps` are run against the
open level-2 and level-3 needs. Matches appear in **Opportunities** with a
"Stated need" badge, ranked above signal-based opportunities when scores are
equal.

## 10. Screens

### Buyer side (new route group, for example `app/(exchange)`)

1. **Onboarding:** role → company (domain verify optional) → first need:
   category, must-haves, budget, timeline, visibility level (explained in plain
   words with an example of exactly what a provider would see).
2. **My needs:** each need with its matches, the shortlist, a compare view, and
   pending intro requests.
3. **Compare:** side-by-side offerings on the match dimensions, with evidence
   links.
4. **Intros and messages.**
5. **Privacy:** every need's level, a log of who has seen what, export, delete.

### Provider side (inside the existing `app/(app)/[org]`)

1. **Exchange profile** (under Settings): claim, verify, offerings, evidence.
2. **Market demand:** aggregate counts and trends for the provider's
   categories, with the k ≥ 10 rule. Not to be confused with the existing
   `/demand` page, which shows what *prospects in replies* asked for. Name it
   "Market demand" to keep the two apart.
3. **Matched needs:** level-2 and level-3 cards with a "Request intro" action.
4. **Opportunities:** accepted intros appear here with the "Stated need" badge
   and flow into the existing pipeline.

## 11. Delivery phases

| Phase | Ships | Exit criterion |
|---|---|---|
| **P0 · Foundation** | Category list, buyer onboarding and needs, visibility levels, public provider catalog, claim and verify, need → offering matching with explanations, the firewall (§6) with its build gate and e2e test | 50 real buyers with open needs, every need with at least one eligible match |
| **P1 · Two-sided loop** | Market demand dashboard, provider-side matching via ICPs, intro requests and lifecycle, in-app threads, outcomes, alerts for both sides, billing for providers | First 20 accepted intros, outcomes reported for at least half |
| **P2 · Depth** | Buyer teams, structured RFP posts with proposals, conversational need capture (AI concierge), CRM push of accepted intros, public API and webhooks | Decided per item once P1 metrics are known |

Nothing in P1 starts until the §6 gate is green in CI.

## 12. Monetisation

- **Buyers:** free. A paid tier with premium help can come later. It must never
  be "pay to hide your data", because privacy is the default.
- **Providers:** a subscription that includes market demand analytics, a
  monthly intro-request allowance, and matched-needs access. Overage is charged
  per **accepted** intro, never per view.
- **Promoted listings:** a separate, labelled slot. They never change the match
  score.
- **Never sold:** raw buyer data, lists of buyers, or exports of needs.

Billing does not exist today (`README.md`: "there is no payment path at all").
P1 depends on adding it, and `docs/product/plans-and-quotas.md` is where that
work is described.

## 13. Trust, safety and legal

- **Fake buyers:** email verification is required. Needs from unverified domains
  are marked as such and count with less weight in demand aggregates. Rate limit
  on new needs per account.
- **Provider abuse:** intro caps, decline-rate throttling, reporting, and
  suspension that uses the existing platform pause (`packages/db/src/pause.ts`,
  migration 0053).
- **Moderation queue** for reported profiles, needs and messages.
- **Law:** stated purchase intent tied to a person is personal data under GDPR
  and India's DPDP Act 2023. Required items: a purpose-specific privacy notice
  at need creation, consent records (the visibility level *is* the consent
  record and is logged), export, deletion within the statutory window, and a
  record of processing activities. Get legal review before P0 launches.

## 14. Metrics

| Metric | Definition | P1 target |
|---|---|---|
| Need capture rate | Buyer accounts with at least one open need ÷ buyer signups | 60% |
| Match coverage | Open needs with at least one match scoring ≥ threshold ÷ open needs | 80% |
| Match acceptance | Matches shortlisted ÷ matches shown | 25% |
| Time to first qualified match | Median time from need created to first shortlisted match | < 24 h |
| Intro acceptance | Accepted ÷ requested intros | 30% |
| **Qualified intros per open need** | Accepted intros ÷ open needs (the headline metric) | ≥ 1.0 |
| Provider activation | Providers with at least one accepted intro in 30 days ÷ claimed providers | 40% |
| Outcome rate | Intros with a reported outcome ÷ accepted intros | 50% |

Search volume and page views are not success metrics for Exchange.

## 15. Open questions

1. **Brand:** does Exchange live on the same domain as the seller product? A
   buyer who once got a cold email from a Huntloop customer may not trust
   "Huntloop" with their needs. Consider a separate brand for the buyer side.
2. **k for aggregates:** 10 is a starting value. Confirm it against real group
   sizes once there is data.
3. **Can providers who are not Huntloop customers claim a profile?** Recommended
   yes, free with a limited allowance. It grows supply and leads into the paid
   seller product.
4. **Buyer verification:** is a verified company domain required for level 3?
   Recommended yes.
5. **Currency and region:** version 1 is India-first or global?
