# Twelfth pass — the front door

**Date** 2026-09-09 · **Program** [audit/README.md](README.md) · **Prior**
[PLAN-11.md](PLAN-11.md) (Apollo era) · **Scope** landing page → sign-up →
onboarding → first-run workspace, as one connected product

This plan covers everything a person sees before Huntloop is useful to them,
and it treats that as a single system rather than four. Nothing here is
implemented yet. The implementation order is §12.

---

## 0. What is actually there today

Six findings, each verified in the code. They set the shape of everything
below, and three of them are defects rather than gaps.

**F1 — There is no landing page.** [`app/page.tsx`](../apps/web/app/page.tsx)
is a `redirect("/login")` with a comment saying a landing page is where this
file goes when one lands. The sitemap and the Open Graph `url` already point
here. So the entire top of the funnel is a sign-in box whose subtitle —
"Know who needs you before you reach out" — is the only marketing copy in the
product.

**F2 — Onboarding persists almost nothing.** This is the big one. The four
steps at `/welcome` write exactly two rows: `organizations` and `memberships`
(in `apps/web/app/(onboarding)/welcome/actions.ts`). The company research, the
ICP, and the accepted sources all go into `sessionStorage` via
[`lib/onboarding/draft.ts`](../apps/web/lib/onboarding/draft.ts), and the last
step calls `clearDraft()` and navigates to the dashboard. The `products`,
`icps`, `personas` and `sources` tables are never written. A user completes
onboarding, answers every question, and arrives at a workspace that knows
their org's name and nothing else. The draft module's own header says this is
a seam awaiting `packages/db` — `packages/db` has been live since 0013.

**F3 — Nothing routes anyone to `/welcome`.** `grep` finds no reference to the
route outside its own folder. `auth/callback` forwards to `safeNextPath(next)`,
which defaults to `"/"`, and `/` redirects to `/login`. A user who signs up
successfully lands back on the sign-in page. There is no "which org do I
belong to" resolver anywhere, so even a returning member with one org has no
automatic path into it.

**F4 — Onboarding never asks about the person.** `profiles` holds
`email / full_name / avatar_url`, mirrored from `auth.users` by trigger. There
is no role, no job function, no seniority, no stated goal. Every question in
the flow is about the *company*. Huntloop therefore cannot vary a single thing
by who is using it — a founder, an SDR and a RevOps lead get identical
dashboards.

**F5 — The ICP step is hardcoded and says it isn't.**
`apps/web/app/(onboarding)/welcome/icp/IcpStep.tsx` opens with
`useState(["Crypto trading desks"])`, four fixed segment options, and three
default triggers including "Shipped an autonomous agent that moves funds". The
heading above them reads "Drafted from your website." It was not. The research
output from the previous step reaches this screen only as `sells`, and nothing
on the page uses it. This is the §7 failure the codebase is otherwise
scrupulous about, sitting in the onboarding flow.

**F6 — The schema is far ahead of the flow that fills it.** `0013` gave
`icps.criteria` fifteen typed keys (`industries`, `employeeRange`,
`technologies`, `businessModels`, `painPoints`, `useCases`, `buyingSignals`,
`keywords`, `exampleCompanies`, `notes` beyond the v1 four), `personas` six
matching columns, and `icps` a `quality_score`, an `addressable_estimate` with
provenance, and immutable `icp_versions`. Onboarding populates four of those
fields, in sessionStorage. `translateIcp()` in
[`discovery.ts`](../packages/db/src/discovery.ts) already maps the full
criteria set to provider filters and reports what it cannot map; the Apollo
adapter already declares `company.search`, `company.enrich`, `person.search`
and `person.match`. Everything needed to make onboarding produce a real
first-run workspace exists below the UI. The UI does not call it.

**The through-line.** Huntloop's engine can answer "who should I pursue next,
why are they a good fit, and what should I do about it?" — `qualify`,
`why_now`, scoring rules, contact ranking and the learning loop are all built.
It cannot answer it for a *new user*, because onboarding throws away the
premises. This plan is mostly about closing that gap, and the landing page is
the part that gets someone to the gap in the first place.

---

## 1. The one idea that connects all four surfaces

Every screen from the marketing site to the first dashboard is answering the
same question at a different resolution:

> **Who should I pursue next, why are they a good fit, and what should I do
> about it?**

- The **landing page** asserts that Huntloop answers it, and shows the answer's
  shape.
- **Sign-up** is the smallest possible interruption to seeing it for real.
- **Onboarding** collects only what is needed to answer it *for you*.
- The **first dashboard** answers it, with your companies, on day one.

The test for any question we consider asking during onboarding: *does the
answer change what Huntloop pursues, how it ranks, or what it says?* If not,
it is a settings screen, not an onboarding step. This single rule cuts a
30-field Apollo-style form down to what §2 describes.

The corresponding test for any landing-page section: *does it move someone
toward believing the loop works and that it will work on their business?* A
section that is merely true goes in the docs.

---

## 2. Onboarding: the question set

### 2.1 The design rules

1. **Nine required answers, total.** Everything else is inferred, defaulted, or
   deferred. See the count in §2.4.
2. **Ask nothing we can detect.** A company domain yields name, industry, size,
   description, technologies and location from `company.enrich`. Asking for
   them is asking the user to do the product's job.
3. **Never present an inference as an answer.** Every auto-filled field arrives
   with a `ClaimBadge` and is editable, exactly as `ProductStep` already does.
   The pattern exists; it needs to be applied to the ICP step, which currently
   violates it (F5).
4. **A question earns its place by configuring something.** §5 names the
   configuration for every question. A question with an empty "configures" cell
   is cut.
5. **Progressive, not front-loaded.** The flow asks what is needed to produce a
   first result. Everything that sharpens the result later is asked later, by
   the product, in context (§8).
6. **Every step is resumable and every optional step is skippable** without
   dead-ending (§7).

### 2.2 The steps

Seven screens, of which one is automatic and one is a review. Target: **under
three minutes** to a populated workspace.

```
0  Sign up                 email / Google           (existing)
1  You                     2 questions              ~15s
2  Your company            1 input + review         ~30s   ← domain does the work
3  What you want           2 questions              ~15s
4  Who you sell to         review + edit            ~45s   ← drafted, genuinely
5  Where to look           review + edit            ~20s
6  [ Building your workspace ]  automatic           ~40s
7  First recommendations   the payoff               —
```

Steps 1 and 3 are new. Step 2 exists and is good. Step 4 exists and must be
rebuilt (F5). Step 5 exists and needs persistence. Steps 6 and 7 are new and
are the reason the whole flow is worth doing.

### 2.3 Every question, in order

Legend: **R** required · **O** optional · **A** auto-detected, shown for
confirmation

---

#### Step 1 — You

Two questions. This is the step that does not exist today (F4) and it is the
cheapest personalization in the whole plan.

| # | Question | Type | Req | Auto | Configures |
|---|---|---|---|---|---|
| 1.1 | What's your name? | text | **R** | A — from OAuth `full_name`; skip the field entirely if present | `profiles.full_name`; email signatures; greetings |
| 1.2 | What do you do? | single-select, 7 options | **R** | — | `profiles.role` → dashboard layout, default filters, which surfaces are primary, outreach defaults |

Options for 1.2, chosen because each maps to a different default workspace:

- **Founder / CEO** — wants volume and signal; dashboard leads with new
  opportunities and why-now.
- **Sales / AE** — wants owned pipeline; leads with assigned opportunities and
  inbox.
- **SDR / BDR** — wants a work queue; leads with today's outreach queue and
  contacts ready to reach.
- **Founder-led sales / GTM generalist** — the default; balanced.
- **RevOps / Growth** — wants the system; leads with analytics, scoring rules,
  source health.
- **Marketing** — wants segments and content signals; leads with intelligence
  and competitor mentions.
- **Agency / consultant** — sells on behalf of clients. **Branches the flow**:
  §7.4.

*Why single-select and not free text:* this drives a layout switch and a set of
defaults. A free-text role is unmappable, and a model classifying it would put
a guess in front of a decision the user could have made in one click.

*Deliberately not asked here:* seniority, team size, tenure. None of them
changes anything Huntloop does.

---

#### Step 2 — Your company

One input. Everything else is research, reviewed. **This step already exists
and is well built** — it stays, with additions.

| # | Question | Type | Req | Auto | Configures |
|---|---|---|---|---|---|
| 2.1 | Your company website | url | **R** | Prefill from the email domain when it is not a free provider | Everything downstream |
| 2.2 | Company name | text | **R** | **A** research + `company.enrich` | `organizations.name`, `products.name` |
| 2.3 | What you sell | textarea | **R** | **A** research | `products.description`; every `qualify` and `personalize` call |
| 2.4 | Who buys it | textarea | **R** | **A** research | Seeds ICP `segments`, `useCases` |
| 2.5 | What problem it solves | textarea | O | **A** research | `products.value_props`; `why_now` framing |
| 2.6 | Your industry | select | O | **A** `company.enrich` | Competitor research; source recommendation |
| 2.7 | Your company size | select | O | **A** `company.enrich` | Peer-company inference for ICP defaults |

**Change to the current step:** the org name is currently asked *first*, on its
own screen, before we know anything (`OrgForm`). Reverse it. Ask for the
website first, derive the org name and slug from the research, and show the
slug for confirmation. That deletes a whole screen and produces a better
default than the user typing "Acme" into an empty box.

The org row still has to exist before the research is attributable to a tenant.
Create it *after* research returns, from the researched name — or create a
provisional org on first sign-in keyed to the user, and rename it here. The
first is simpler and is what §12 assumes.

**New in this step:** persist. `products` gets a real row. The findings become
`evidence` rows with `subject_type = 'company'`, `kind = 'fact'` and the source
URL the research cited — the constraint in `0002` already enforces that a fact
names a source, and the research output already carries `sourceUrl`.

---

#### Step 3 — What you want

Two questions. New. This is where "personalize the product" stops being a
slogan.

| # | Question | Type | Req | Auto | Configures |
|---|---|---|---|---|---|
| 3.1 | What do you mainly want Huntloop to do? | multi-select, pick up to 2 of 5 | **R** | — | Dashboard priority, which jobs are enabled, nav emphasis, first-run recommendation type |
| 3.2 | How do you want to reach people? | single-select, 4 | **R** | — | Whether mailbox connection is prompted; outreach defaults; whether contact enrichment runs |

Options for 3.1, named as the loop stages so the product and the question use
one vocabulary:

- **Find companies I don't know about** → *Discover.* Enables
  `discover_companies` on a schedule; dashboard leads with new companies;
  Apollo search is the primary inbound path.
- **Tell me which of my accounts are ready now** → *Qualify.* Leads with
  why-now and scoring; prompts a CSV import (`/imports` exists) as the first
  action rather than a discovery run.
- **Find the right person and their contact details** → *Enrich.* Enables
  `rank_contacts` and `enrich_person`; dashboard leads with contacts.
- **Write and send the outreach** → *Reach out.* Prompts mailbox connection in
  step 6; leads with the outreach queue.
- **Tell me what's working** → *Learn.* Leads with analytics; enables the
  learning sweep prominently.

*Why max two:* a user who picks all five has told us nothing, and the answer's
only job is to rank the dashboard. Capping it forces the discrimination that
makes the answer useful.

Options for 3.2: **My work email (connect Gmail/Outlook)** · **LinkedIn /
manually — just tell me who and why** · **Export to my CRM or a sequencer** ·
**Not sure yet**. This decides whether step 6 prompts OAuth, which is the
single most abandonment-prone thing in the flow — so it is asked as a
preference, and acted on later, rather than being sprung as a connection
screen.

---

#### Step 4 — Who you sell to (the ICP)

**Drafted from steps 2 and 3, and this time actually drafted.** The user's job
here is to correct, not to compose. Every field arrives populated with a claim
badge and an editable control.

The draft comes from a new AI task, `draft_icp`, which takes the researched
product understanding and the role/goal answers and returns a full
`IcpCriteria` — not the four v1 fields. It refuses rather than guesses on any
field the research does not support, and those fields render as *unknown* and
empty rather than as a plausible default. That refusal behaviour is the
existing house pattern (`recommend_sources` already does it).

| # | Field | Type | Req | Auto | Configures |
|---|---|---|---|---|---|
| 4.1 | Segments | chips, editable + free add | **R** | **A** `draft_icp` | `criteria.segments` → discovery keywords |
| 4.2 | Industries | multi-select from provider taxonomy + search | O | **A** | `criteria.industries` → Apollo `industry` filter (exact, high-precision) |
| 4.3 | Company size | band chips | **R** | **A** from own size + segment norms | `criteria.sizes` + derived `employeeRange` → Apollo `employee_count` |
| 4.4 | Regions / geographies | multi-select, searchable | **R** | **A** from own HQ + research | `criteria.regions` → Apollo `locations`; also `settings.voice.targetRegions` |
| 4.5 | Buying triggers | list, add/remove | **R** (≥1) | **A** | `criteria.triggers` → source recommendation, `why_now`, scoring |
| 4.6 | Technologies they use | chips, searchable | O | **A** when research names integrations | `criteria.technologies` → Apollo `technologies` |
| 4.7 | Business model | chips (B2B SaaS, marketplace, agency, hardware, fintech…) | O | **A** | `criteria.businessModels` |
| 4.8 | Pain points you solve | list | O | **A** from 2.5 | `criteria.painPoints` → `qualify`, `personalize` |
| 4.9 | Example customers or dream accounts | free text, comma-separated, domain-resolved | O | — | `criteria.exampleCompanies` → **look-alike discovery**, the highest-leverage optional field in the flow |
| 4.10 | Who is never a fit | chips + free add | O | **A** | `negative_criteria` → hard IGNORE, `excludeDomains` |
| 4.11 | Job titles to reach | chips, editable | **R** | **A** `draft_icp` | **`personas` row** — `title_patterns`, `seniority`, `departments`, `is_primary` |
| 4.12 | Titles that look right but aren't | chips | O | — | `personas.exclude_titles` |

4.11 is the one genuinely new *required* question versus today, and it is
required because contact discovery is dead without it — `rank_contacts` and
`person.search` both need a persona to match against, and `personas` has had
these columns since `0013` with nothing writing them.

**The live reach counter.** As the user edits 4.1–4.7, a debounced call runs
`translateIcp()` and issues a **zero-row** Apollo `company.search` to read
`total_entries`. The screen shows *"About 3,400 companies match — 2 criteria
can't be searched directly and are applied at qualification"*. Written to
`icps.addressable_estimate` / `addressable_source = 'provider'` /
`addressable_at`. Never inferred — `0013`'s comment is explicit that a
model-invented market size is the most expensive kind of §7 violation, and this
is the call site that comment was written for.

This counter is also the flow's best correction mechanism: a user whose ICP
returns 12 companies or 400,000 finds out here, while editing is free, rather
than after a week of empty scans.

**Unmapped criteria are shown, not hidden.** `translateIcp` already returns
`UnmappedCriterion[]` with a `handledElsewhere` field. Render it: *"'Hiring a
VP of Data' can't be searched for directly — it's applied when we qualify each
company."* This is a differentiator, not an apology, and it is the exact
honesty the rest of the codebase is built around.

**Persistence:** `icps` row + `personas` row + `bump_icp_version_for_org()` for
version 1. `scoreIcp()` computes `quality_score` and the screen can show the
working — the function is deterministic precisely so it can.

---

#### Step 5 — Where to look

Exists and is well built. Two changes.

| # | Question | Type | Req | Auto | Configures |
|---|---|---|---|---|---|
| 5.1 | Recommended sources | accept/remove list | **R** (≥1, or discovery on) | **A** `recommend_sources` | `sources` rows, `recommended_by = 'system'` |
| 5.2 | Your own sources | url add | O | — | `sources`, `recommended_by = 'user'` |

**Change 1 — persist.** Write `sources` rows. The `recommended_by` column was
added in `0002` specifically so the learning loop could later ask whether
system picks or user picks produced better opportunities; nothing has ever
written to it.

**Change 2 — the "≥1 source" gate is wrong once discovery exists.** Today the
Continue button is disabled with zero sources, correctly, because sources were
the only inbound path. With `discover_companies` and an ICP that maps to a
provider search, a user can have zero sources and a full pipeline. Gate on
*"there is at least one way for companies to arrive"* — sources **or** a
non-empty discovery translation — not on sources alone.

---

#### Step 6 — Building your workspace

Automatic. No questions. A progress screen with real line items that complete
as the jobs return, and a **"Skip — I'll wait in the dashboard"** escape that
converts the screen into a background job with a dashboard banner.

What runs, in order, with the ICP now on disk:

1. `discover_companies` — one Apollo `company.search` from `translateIcp()`,
   capped at 25 for the first run. *"Found 3,400 matching companies. Pulling
   the first 25."*
2. `enrich_company` on each result.
3. `score_opportunity` + `qualify` against the freshly written ICP version.
4. `rank_contacts` on the top 5, using the persona from 4.11.
5. `person.match` on the single top contact of the top 3 companies only —
   contact reveals cost credits, and 3 is enough to prove the capability
   without burning a trial's budget.
6. `explain_why_now` on the top 3.
7. Accepted sources scheduled via `schedule_scans`.

Budget: capped by `packages/providers/src/budget.ts` with a dedicated
first-run ceiling, so a pathological ICP cannot spend a month's credits in
onboarding. Every step degrades independently — a failed contact reveal leaves
the company recommendation intact and says so.

If the ICP maps to nothing searchable (a service business selling locally, say)
this step says so plainly and pivots to the import path: *"Your profile is
better matched by your own account list than by a search. Import a CSV or paste
some domains."* `/imports` already exists.

---

#### Step 7 — First recommendations

The payoff, and the reason every preceding step is short. **Three companies,
full-width cards**, each answering the core question in the product's own
components:

- **Who** — company, domain, size, industry (`enrich_company`)
- **Why a fit** — the `ScorePill` and `BreakdownList` naming the ICP criteria
  matched, with the version cited
- **Why now** — the trigger, with `EvidenceList` and a real source URL
- **What to do** — the contact from 4.11's persona, and a drafted opener

And one primary action: **"Take me to my workspace."** Plus, per the step-3
goal answer, a single contextual secondary: connect a mailbox / import your
accounts / invite a teammate.

If nothing was found, this screen says exactly that with the reason and the fix
— *"Your ICP matches 3,400 companies but none of the first 25 cleared your
qualification bar. That usually means the bar is high, which is fine. Here's
what we found and why each fell short."* An empty state that shows the working
is a demonstration of the product; a spinner that resolves to nothing is a
bounce.

### 2.4 The count

**Required: 9 distinct answers.** Name (usually auto), role, website, product
description, primary goal, outreach method, segments + sizes + regions,
triggers (≥1), job titles. Of these, five arrive pre-filled and are confirmed
rather than composed.

**Optional: 12**, every one of which is either auto-filled or deferrable.

**Screens with a text cursor in them: 3.** Everything else is selection or
confirmation.

### 2.5 What we deliberately do not ask

Each of these is a real Apollo/Clay onboarding question, cut for a stated
reason:

| Not asked | Why | Where it comes from instead |
|---|---|---|
| Phone number | Nothing uses it | — |
| Team size / how many reps | Doesn't change behaviour | Seats, at invite time |
| CRM in use | No CRM integration ships in this phase | Asked when export is built |
| Current tools / stack | Vanity question | — |
| Annual revenue target | Doesn't reach the engine | — |
| Deal size, sales cycle | Would only decorate analytics | Learned from outcomes |
| How did you hear about us | Attribution, not configuration | Post-signup one-click, dismissible |
| Number of leads per month | Plan limits already express this | Usage screen |

---

## 3. The landing page

### 3.1 Positioning

The category is crowded and Huntloop's actual difference is narrow and real:
**it shows its work.** Every score decomposes, every claim cites a source,
every inference is labelled as one, and the system refuses rather than
fabricates. That is unusual enough to be the whole position.

**Primary headline:** *Know who needs you before you reach out.* Already in the
product (the login subtitle) and it is good.

**Subhead:** *Huntloop watches your market, finds companies that just became a
fit, tells you why — with sources — and drafts the outreach. You approve.*

**The proof line, near the top and repeated:** *Every score shows its working.
Every claim names its source. When we don't know, we say so.*

**Category framing:** not "AI SDR" — that promises autonomy the product
deliberately does not take, and it invites the comparison Huntloop loses.
Closer to **"a research analyst for your pipeline."** Discovery is a feature;
*explained* discovery is the product.

### 3.2 The sections, in order

**1 · Nav.** Logo · Product · How it works · Use cases · Pricing · Docs ·
*Sign in* · **Start free** (primary). Sticky, condensing on scroll.

**2 · Hero.** Headline, subhead, proof line. Primary CTA is **a domain input,
not a button**: `[ yourcompany.com ] → See what Huntloop finds`. This is the
single most important decision on the page. It is the *same input as
onboarding step 2*, so the visitor's first act on the marketing site is
literally the first step of the product, and the sign-up wall moves from before
the value to after it (§3.4). Secondary: *Watch the 90-second loop.*

Beneath: a live product frame showing one opportunity card — score, why-now,
evidence with a real citation, the drafted opener. Not a hero illustration.
The card *is* the pitch.

**3 · The loop.** Six stages as the product names them —
**Discover → Qualify → Enrich → Reach out → Track → Learn** — as a horizontal
diagram, each stage one sentence and one screenshot on hover/tap. This is the
section that makes Huntloop legible as a system rather than a feature list, and
it uses the same vocabulary as the onboarding goal question (3.1), the nav, and
the docs. One vocabulary everywhere.

**4 · "Why now" — the differentiator section.** The strongest single section on
the page. A real opportunity card, expanded, annotated:

- the score, decomposed into the criteria it matched
- the trigger, with the date it happened *and* the date we saw it
  (`event_date` vs `observed_at` — the schema distinguishes them and most
  competitors' UI does not)
- the evidence list, every row a live link
- a `fact` badge and an `inference` badge side by side, with the caption
  *"These are different, so we show them differently."*

Headline: **"Every claim, or we don't make it."**

**5 · The scoring section.** Screenshot of `BreakdownList`. *"Not a black-box
number. Rules you wrote, weights you set, and the exact evidence that moved
each one."* Links to the scoring-rules screen.

**6 · Use cases.** Four cards, matching the step-3 goal options, each linking
to a dedicated page (§3.5):

- **Founder-led sales** — you are the pipeline; Huntloop is the research team.
- **Outbound teams** — stop building lists; start with a ranked queue.
- **Agencies** — one workspace per client, one loop each.
- **Account-based** — bring your target list; we tell you when each one wakes
  up.

**7 · Explained by comparison.** A small, fair table. Rows are the things we
actually do differently: *sources cited*, *fact vs inference distinguished*,
*score decomposed*, *refuses when uncertain*, *your ICP versioned*. Columns:
Huntloop / typical list tool / typical AI SDR. No competitor named, no
strawmen — a table that overclaims poisons the honesty position the whole page
rests on.

**8 · Social proof.** Honest at current stage: logos if any exist, otherwise
**skip the section entirely** rather than shipping "trusted by" with three
stock logos. In its place, the credible alternatives:

- a real, named opportunity card built from a public company with public
  evidence (a genuine funding announcement, cited) — proof by demonstration
- specific claims about the system, not about customers: *"Every score
  decomposes into the rules that produced it. Every source is scanned on a
  schedule you set."*
- a signed founder note.

When testimonials exist: outcome-specific, named, with role and company. A
placeholder testimonial on a page whose thesis is honesty is a self-inflicted
wound.

**9 · Integrations & data.** Apollo, Gmail, Outlook, CSV. Plus the data
posture, stated plainly — where data lives, retention (`enforce_retention`
exists), unsubscribe handling (RFC 8058, already built), and that we do not
train on customer data. B2B buyers read this section.

**10 · Pricing.** Three tiers from the `plans` catalogue already seeded in
`0007` — Free / Growth $99 / Scale $299 — with the real limits from
`plans.limits` (opportunities, AI runs, emails, enrich, seats). *The page must
read its numbers from the same source the app enforces*, or the first invoice
is a support ticket. Annual toggle. FAQ beneath.

**11 · FAQ.** Where does the data come from · How is this different from a list
tool · What if the AI is wrong · Do you send email for me (no — you approve
every message) · Can I use my own sources · What happens after the trial ·
GDPR/data handling. Marked up with `FAQPage` schema.

**12 · Final CTA.** The domain input again, identically. *"See what Huntloop
finds for you — no card, takes two minutes."*

**13 · Footer.** Product, use cases, company, legal, docs, status, changelog,
sitemap.

### 3.3 Messaging hierarchy

```
1  Know who needs you before you reach out.             ← the promise
2  Finds them, explains why, drafts the reach-out.      ← the mechanism
3  Every claim cites a source.                          ← the differentiator
4  Discover → Qualify → Enrich → Reach → Track → Learn  ← the system
5  Use case proof                                       ← the relevance
6  Pricing / FAQ                                        ← the objection handling
```

Each scroll depth must be independently sufficient: a visitor who leaves at any
point should be able to say what Huntloop does.

### 3.4 CTA strategy — the domain-first funnel

The whole page has **one** primary CTA, repeated: enter your domain.

```
visitor types domain
      ↓
public research runs (rate-limited, cached, no account)
      ↓
"Here's what we understood about you" — the real ProductStep review UI
      ↓
"…and here's who we think you should be selling to" — 3 sample companies,
   qualified, blurred beyond the first
      ↓
"Create a free account to see the rest and start the loop"
      ↓
sign-up → onboarding resumes exactly where it left off, pre-filled
```

The visitor has completed onboarding steps 2 and part of 4 **before creating an
account**, and post-signup onboarding is correspondingly shorter. This is the
mechanism that makes "the website understands who the user is" literally true
rather than aspirational.

It needs care, and §3.6 lists the abuse controls.

Secondary CTAs: *Watch the loop* (90s), *Read the docs*, *Book a walkthrough*
(enterprise only, on pricing).

### 3.5 Programmatic surface (post-launch)

Once the core page ships, the same research pipeline produces real SEO surface:

- `/for/[use-case]` — the four use-case pages
- `/for/[industry]` — ICP templates per industry, each seeded from real
  criteria, each a working "start with this profile" onboarding entry point
- `/compare/[alternative]` — honest comparisons
- Docs and changelog

Each templated page must offer something real (a usable ICP template, a working
example) or it is doorway spam that damages the domain.

### 3.6 The public-research endpoint

The domain-first CTA runs an AI research call for an anonymous visitor, which
is a cost and an abuse surface. Controls, all of which have precedent in the
codebase:

- IP + domain rate limit, short window, at the edge. The existing
  `consume_rate_limit` requires a session and an org, so this needs a separate
  unauthenticated limiter — `(auth)/actions.ts` already records that gap.
- aggressive cache on `(domain)` — the second visitor from the same company
  costs nothing, and this is common
- a hard daily budget for anonymous research, degrading to "create an account
  to run this" when exhausted
- reject free-mail domains, disposables, and non-resolving hosts before spending
- the result is cached and **claimed** at signup by matching the email domain,
  which also serves as a weak verification signal

---

## 4. The complete journey

```
LANDING  /
  │  domain input → public research → teaser
  ↓
SIGN UP  /signup?claim=<research-token>
  │  magic link or Google
  ↓
CALLBACK  /auth/callback
  │  ── resolve destination ──────────────────────  ← NEW, fixes F3
  │    no membership, no invite     → /welcome
  │    pending invite for email     → /invite/<token>
  │    membership + onboarding done → /<org>/dashboard
  │    membership + incomplete      → /welcome/<next-incomplete-step>
  │    several memberships          → /orgs (picker)
  ↓
ONBOARDING  /welcome/*
  1 you  →  2 company  →  3 goals  →  4 ICP  →  5 sources  →  6 build  →  7 first look
  │  every step writes to the database on submit
  ↓
WORKSPACE  /<org>/dashboard
     laid out by role (1.2) and goal (3.1), populated by step 6
```

**The destination resolver is the single highest-value piece of code in this
plan.** It is perhaps 40 lines, it does not exist, and without it none of the
rest is reachable (F3).

---

## 5. What every answer configures

The complete mapping. This table is the specification for the
`applyOnboarding()` module in §12.

| Answer | Writes | Configures at runtime |
|---|---|---|
| Name (1.1) | `profiles.full_name` | Greetings; email signature; `personalize_message` sender context |
| Role (1.2) | `profiles.role` **(new column)** | Dashboard section order; default opportunity filter; nav emphasis; whether outreach or analytics is primary |
| Website (2.1) | `products.website`, `organizations.settings` | Research; competitor detection; self-exclusion from discovery |
| Company name (2.2) | `organizations.name`, `products.name`, slug | URLs; email signature |
| What you sell (2.3) | `products.description` | `qualify`, `why_now`, `personalize_message` — the single most-read field |
| Who buys (2.4) | seeds `criteria.segments`, `useCases` | Discovery keywords |
| Problem solved (2.5) | `products.value_props` | Outreach framing; `criteria.painPoints` |
| Own industry (2.6) | `settings` | Competitor research; source recommendation |
| Own size (2.7) | `settings` | Peer inference for ICP defaults |
| Primary goal (3.1) | `organizations.goals` **(new)** | **Which jobs are scheduled**; dashboard hero section; first-run action; nav ordering |
| Outreach method (3.2) | `settings.outreach.channel` **(new key)** | Whether mailbox OAuth is prompted; whether `enrich_person` runs; export affordances |
| Segments (4.1) | `criteria.segments` | Discovery keywords; `qualify` |
| Industries (4.2) | `criteria.industries` | Apollo `industry` filter — exact and high-precision |
| Sizes (4.3) | `criteria.sizes` + `employeeRange` | Apollo `employee_count`; scoring |
| Regions (4.4) | `criteria.regions`; `settings.voice.targetRegions` | Apollo `locations`; outreach timing |
| Triggers (4.5) | `criteria.triggers` | `recommend_sources`; `why_now`; scoring rules |
| Technologies (4.6) | `criteria.technologies` | Apollo `technologies` |
| Business models (4.7) | `criteria.businessModels` | `qualify` |
| Pain points (4.8) | `criteria.painPoints` | `qualify`; `personalize_message` |
| Example companies (4.9) | `criteria.exampleCompanies` | **Look-alike discovery**; ICP validation |
| Exclusions (4.10) | `negative_criteria` | Hard IGNORE; `excludeDomains`; provider filter |
| Job titles (4.11) | `personas` row | `person.search`; `rank_contacts`; contact fit scoring |
| Exclude titles (4.12) | `personas.exclude_titles` | Contact ranking |
| Sources (5.1/5.2) | `sources` rows + `recommended_by` | `scan_source` schedule; learning attribution |
| — derived — | `icps.quality_score` | Onboarding-completeness nudges |
| — derived — | `icps.addressable_estimate` | Reach counter; ICP-too-narrow/broad warnings |
| — derived — | `icp_versions` v1 | Every score cites the profile version it used |
| — derived — | default scoring rules from triggers | `settings/scoring` pre-populated rather than empty |

That last row matters and is easy to miss: the scoring-rules screen exists and
ships empty. Triggers from 4.5 should generate a starting rule set — the
`draft_scoring_rules` AI task already exists — so a first-run user has scores
that decompose into rules they recognise, rather than a screen asking them to
invent a rubric on day one.

---

## 6. What's missing from the product

Grouped by whether it blocks the flow.

### 6.1 Blocking — the flow cannot work without these

| # | Gap | Detail |
|---|---|---|
| B1 | **Onboarding persistence** | F2. `applyOnboarding()`: transactional writes to `products`, `icps`, `personas`, `sources`, `evidence`, + `bump_icp_version_for_org()`. The single biggest item in this plan. |
| B2 | **Post-auth destination resolver** | F3. Nothing routes to `/welcome`; `/` bounces signed-in users to `/login`. |
| B3 | **Onboarding state on the org** | Which step is complete, so resume works and the flow is not a client-side wizard. New columns, §6.4. |
| B4 | **A landing page** | F1. |
| B5 | **`profiles.role`** | F4. Nothing personalizes without it. |
| B6 | **`draft_icp` AI task** | F5. The ICP step's copy currently claims a draft that does not exist. |
| B7 | **First-run orchestration** | Step 6. A job that runs the chain and reports progress. |

### 6.2 High value — the flow works but is much weaker without these

| # | Gap | Detail |
|---|---|---|
| H1 | **Live reach counter** | `addressable_estimate` columns exist and are never written. This is the moment a user believes the ICP is real. |
| H2 | **Look-alike discovery from 4.9** | "Companies like Stripe and Ramp" is the most natural way a person states an ICP, and company enrich + similar-company search supports it. Highest-leverage optional field. |
| H3 | **Default scoring rules from triggers** | `draft_scoring_rules` exists; nothing calls it at onboarding. |
| H4 | **Public research endpoint** | §3.6. Makes the domain-first funnel possible. |
| H5 | **Mailbox connection deferral** | OAuth exists (`/api/mailboxes/*`); it is the highest-abandonment step and must never be inside the required path. |
| H6 | **Org picker `/orgs`** | Multi-org users, agencies, and anyone invited to a second workspace currently have no way to switch. |
| H7 | **Empty-state honesty on the dashboard** | The dashboard is built to hide empty sections. A first-run user needs *"nothing here yet, and here's the one thing to do"*, which is different from an absent section. |

### 6.3 Deferred — real, but not this pass

CRM export · a sequencer integration · SSO/SAML · usage-based upgrade prompts ·
in-app product tour · a second ICP per org (schema supports it; the UI assumes
one) · ICP templates by industry · onboarding A/B infrastructure.

### 6.4 Database changes

Two migrations. Everything else this plan needs already exists — the happy
consequence of `0013` having been designed properly.

**`0024_onboarding.sql`**

```sql
-- Who the user is, beyond a name. `profiles` is a projection of auth.users
-- for identity; these two columns are the product's own facts about the
-- person and are written by onboarding, not by the mirror trigger.
alter table profiles
  add column role text
    check (role is null or role in (
      'founder','sales','sdr','gtm_generalist','revops','marketing','agency'
    )),
  add column onboarded_at timestamptz;

-- Onboarding progress, on the org rather than the user: the flow configures a
-- workspace, and a second member joining a configured org must not be sent
-- through company research again.
alter table organizations
  add column onboarding_step text not null default 'you'
    check (onboarding_step in (
      'you','company','goals','icp','sources','building','review','done'
    )),
  add column onboarding_completed_at timestamptz,
  -- What the person said they wanted, kept structured rather than in
  -- `settings`, because the scheduler reads it to decide which jobs to enable
  -- and a job that mis-parses a settings blob silently does nothing.
  add column goals text[] not null default '{}';

create index organizations_onboarding_idx on organizations (onboarding_step)
  where onboarding_completed_at is null;
```

**`0025_anonymous_research.sql`** — cache + claim for the public endpoint.

```sql
create table public_research (
  id               uuid primary key default gen_random_uuid(),
  canonical_domain text not null unique,
  understanding    jsonb not null,
  -- Claimed when a user signs up with a matching email domain, which both
  -- saves the second research call and is a weak verification signal.
  claimed_by       uuid references auth.users(id) on delete set null,
  claimed_at       timestamptz,
  ip_hash          text,
  created_at       timestamptz not null default now(),
  expires_at       timestamptz not null default now() + interval '30 days'
);

-- No tenant policy: this is pre-tenant data, written by the service role and
-- read by the claim path only. RLS on with no policy = unreachable through the
-- API, which is the correct posture.
alter table public_research enable row level security;
```

`settings` additions (`org-profile.ts`, no migration — the column is jsonb and
the parser is additive): `outreach.channel`, `onboarding.sourceHint`.

### 6.5 New AI tasks

- **`draft_icp`** — product understanding + role/goals → full `IcpCriteria` +
  a `personas` draft. Refuses per-field rather than filling. Must return the
  basis for each field, as `recommend_sources` does, so the ICP step can show
  *"because your site says you sell to trading desks"*.
- **`draft_first_outreach`** — reuses `personalize_message` with first-run
  context, for step 7.
- Existing tasks reused unchanged: `research_company`, `recommend_sources`,
  `qualify_opportunity`, `explain_why_now`, `draft_scoring_rules`,
  `personalize_message`.

---

## 7. Edge cases

### 7.1 Incomplete onboarding

State lives on the org (B3), not in sessionStorage. Leaving mid-flow and
returning three days later resumes at `onboarding_step`. From step 4 onward the
user may **enter the workspace early** — the dashboard shows a persistent
"finish setting up" card with the remaining steps and the reason each matters,
and discovery stays paused until the ICP exists. Never trap someone in a
wizard; never pretend a half-configured engine is running.

### 7.2 Returning users

The resolver (B2) sends a member with a completed org straight to
`/<org>/dashboard`. Multiple orgs → `/orgs`, remembering the last used in a
cookie and skipping the picker when there is one obvious answer.

### 7.3 Invited teammates

An invite means the workspace is already configured. The invitee's flow is
**step 1 only** — name and role — then straight into the workspace, with a
short "here's how this workspace is set up" panel (the ICP, the sources, who
owns what). They must never see company research or the ICP builder; an SDR
joining on Tuesday re-answering "what does your company sell?" is how a
workspace acquires a second contradictory ICP.

Their role answer still personalizes *their* dashboard. That is the payoff for
having put role on `profiles` rather than on the org.

The invitation flow itself exists and is sound (`0007` + `/invite/[token]`),
with one gap to verify: an invite for an address that has no account should
land on `/signup` with the token carried through, and be redeemed automatically
after sign-in.

### 7.4 Agencies (role = agency)

Branches after step 1: *"Are you setting up Huntloop for your own agency, or
for a client?"* A client workspace is a separate org with its own ICP, and the
agency user holds membership in several. This makes `/orgs` (H6) required
rather than nice-to-have, and it is the main reason the org picker is in this
pass.

### 7.5 Research fails or the site is thin

Already handled well by `ProductStep` — it returns to input rather than showing
invented findings. Add a manual path: *"Tell us in a sentence what you sell"*,
feeding `draft_icp` directly. Stealth companies and pre-launch sites are common
and must not be dead ends.

### 7.6 No AI key configured

Every step already detects `source === "unconfigured"` and says so. Extend the
same treatment to `draft_icp` and step 6: worked examples, clearly labelled,
never passed off as real. This pattern is one of the best things in the
codebase and the new screens must not break it.

### 7.7 Free-mail signups

`gmail.com` is not a company domain. Ask for the company website explicitly and
skip the prefill. Do not block — plenty of legitimate founders sign up from
Gmail.

### 7.8 ICP too broad or too narrow

The reach counter (H1) makes this visible during editing. Over ~50,000: *"This
is very broad — Huntloop will surface a lot that isn't a fit. Add an industry
or a size band."* Under ~50: *"Very narrow. That's fine for account-based
selling — you may want to import your target list instead."* Both are
suggestions with a working next action, never blocks.

### 7.9 The user is not allowed to spend

A viewer-role member cannot spend (`canSpend` already enforces this). Their
first-run experience is read-only and must say why, rather than presenting
buttons that fail at the database.

### 7.10 Someone at the company already signed up

Domain matching at signup should offer *"Three people from acme.com already use
Huntloop — ask to join?"* rather than silently creating a fourth workspace.
This needs an org-domain claim and an admin approval path; scope it in this
pass as **detect and offer**, with the join request itself deferred if it
grows.

---

## 8. How the system keeps learning about the user

Onboarding is the first 20% of what Huntloop should know. The rest arrives from
use, and most of the machinery exists.

**Implicit, from behaviour** — every one of these is already recorded:

- approve/reject on opportunities → `learning_targets`, `analyze_performance`
- which companies get worked vs ignored → refines criteria weights
- reply classification (`classify_reply`) → which triggers actually convert
- edits to drafted messages → `memories`, the freeform house-style store
- source quality by outcome → the `recommended_by` column finally paying off

**Explicit, in context** — asked once, at the moment the answer matters, never
in a settings screen the user has to find:

- after 10 approvals: *"You've approved 10 companies. Should we tighten the ICP
  to match? Here's what they have in common."*
- after a rejection streak: *"You've passed on 5 in a row that scored high.
  What are we missing?"*
- after the first reply: *"That worked. Want more like it?"*
- monthly: *"Your reply rate went up since you added the funding trigger."*

**The mechanism.** `icp_versions` makes this safe: every refinement is a new
version with a diff, every score cites the version it used, and
`analyze_performance` can attribute a change in outcome to a specific edit.
That is the whole point of the table `0013` added, and it has been waiting for
a flow that writes versions. This plan is that flow.

**Profile completeness.** `quality_score` is already deterministic and
explainable. Surface it as a small, dismissible workspace card — *"Your ICP is
72% complete. Adding technologies would let us filter for it directly."* Never
a nag, always with the specific benefit named.

---

## 9. Personalization matrix

What actually differs by role (1.2) and goal (3.1). Everything here is layout
and default, not capability — no role gets a smaller product.

| Role | Dashboard leads with | Default filter | Nav emphasis | First-run action |
|---|---|---|---|---|
| Founder | New opportunities + why-now | HOT + WARM | Hunt | Review 3 recommendations |
| Sales / AE | My assigned opportunities | Assigned to me | Engage | Connect mailbox |
| SDR / BDR | Today's outreach queue | Ready to contact | Engage | Review drafted messages |
| GTM generalist | Balanced (the current dashboard) | HOT | Hunt | Review recommendations |
| RevOps | Analytics + source health + scoring | All | Learn | Tune scoring rules |
| Marketing | Intelligence + competitor mentions | Signals | Learn | Review sources |
| Agency | Org picker, then per-client | Per client | — | Set up first client |

| Goal | Enables | Dashboard hero |
|---|---|---|
| Discover | `discover_companies` on schedule | New companies found |
| Qualify | Import prompt; scoring emphasis | Accounts that just became ready |
| Enrich | `rank_contacts`, `enrich_person` | Contacts ready to reach |
| Reach out | Mailbox prompt; `advance_enrollments` | Outreach queue |
| Learn | Learning sweep prominent | What's working |

---

## 10. Making it feel like one product

The failure mode is four teams' worth of screens. The controls against it:

1. **One design system.** `@huntloop/ui` renders the landing page too. The
   opportunity card on the marketing site is the *same component* as the one in
   the app. This is the strongest single anti-drift measure and it is free.
2. **One vocabulary.** Discover / Qualify / Enrich / Reach out / Track / Learn
   appears on the landing page, in the goal question, in the nav, and in the
   docs. No synonyms.
3. **The domain input is the same input.** Hero, and onboarding step 2. Same
   component, same action, same review UI.
4. **Continuity of the answer.** What the visitor saw on the landing page
   ("here's what we understood") is what they see in onboarding, pre-filled and
   claimed — not re-asked.
5. **Progressive disclosure, not a wall.** Onboarding hands off to the
   workspace with the setup card still visible; the workspace keeps asking, in
   context, forever (§8).
6. **The honesty pattern everywhere.** Claim badges, cited sources, and the "no
   model configured" warnings are already consistent in the app. The landing
   page adopts them as *design language* — the fact/inference distinction is
   literally the marketing.

---

## 11. Metrics

The funnel events already exist (`onboarding_step_viewed` / `_completed` /
`_failed` in `lib/analytics.ts`, server-side, no PII). Extend to the new steps
and add:

- landing → domain entered (the top-of-funnel rate that matters)
- domain entered → research completed → signup (the value-first conversion)
- signup → step 1 → … → workspace, per step
- **time to first recommendation** — the north star
- % arriving at the dashboard with ≥1 scored opportunity — *the real measure of
  whether this plan worked*; today it is 0
- % completing each optional ICP field (tells us which to cut)
- 7-day return rate by role and by goal

---

## 12. Implementation order

Six phases. Phase 1 is the one that matters most and is invisible to users —
that is the correct order, because the landing page's job is to send people
into a flow that works.

**Phase 1 — Make onboarding real** *(B1, B2, B3, B5)*
Migration `0024`. `applyOnboarding()` writing `products` / `icps` / `personas` /
`sources` / `evidence` / `icp_versions` transactionally. Replace the
sessionStorage draft with server state keyed to the org. The post-auth
destination resolver. `profiles.role`. Steps 1 and 3 as screens.
*Ship gate:* a user completing the existing four steps arrives at a dashboard
whose ICP screen shows what they typed. Nothing else changes.

**Phase 2 — Make the ICP step honest** *(B6, H1, H3)*
`draft_icp`. Rebuild step 4 against it, with claim badges and per-field basis.
The reach counter writing `addressable_estimate`. Personas from 4.11. Default
scoring rules from triggers. Unmapped-criteria display.
*Ship gate:* the "drafted from your website" claim is true, and the reach
counter returns a provider number.

**Phase 3 — The first-run payoff** *(B7, H7)*
Step 6 orchestration with progress and per-step degradation. Step 7. Dashboard
empty states that name the one next action. Budget ceiling for first runs.
*Ship gate:* a new user sees three scored companies with cited evidence within
five minutes of signing up.

**Phase 4 — The landing page** *(B4)*
Sections 1–13 on `@huntloop/ui`. Replace the `redirect("/login")`. Update
sitemap, `robots`, OG, and the canonical URL — audit SEO-04 becomes applicable
here for the first time. Pricing reading from `plans`.
*Ship gate:* Lighthouse ≥95, correct metadata, real content.

**Phase 5 — Domain-first funnel** *(H4, §3.6)*
Migration `0025`. Public research endpoint with the abuse controls. Claim-at-
signup. Teaser UI.
*Ship gate:* an anonymous visitor gets a real reading of their site, and it
carries into their account.

**Phase 6 — Multi-org and roles** *(H6, 7.4, §9)*
`/orgs`. Agency branch. Role-based dashboard layouts. Invite flow verification
(7.3). Look-alike discovery (H2).

**Sequencing note.** Phases 1–3 are the product; 4–5 are the funnel. If effort
has to be cut, cut Phase 5 and the programmatic surface (§3.5), not Phase 2 —
an onboarding flow that lies about drafting an ICP is worse than no landing
page, because it damages the one thing this product is selling.

---

## 13. Open questions for the owner

These genuinely need a decision and I have not assumed one:

1. **Is Apollo the only provider at launch?** The reach counter and look-alike
   discovery both assume `company.search`. Hunter and ZeroBounce are
   verification, not search. If Apollo access is limited, Phase 2's counter
   degrades to "we can't estimate this yet" — honest, but much weaker.
2. **Trial shape.** Free tier by default (`plans` seeds `free` and
   `organizations.plan_id` defaults to it), or a time-boxed Growth trial?
   Affects the first-run budget ceiling and the pricing section's CTA.
3. **Is the landing page in this repo or separate?** In-repo is what §10.1
   assumes and is strongly preferable for component sharing; a separate
   marketing site would drift within a quarter.
4. **Do any real customers or logos exist yet?** Decides whether §3.2's social
   proof section ships or is deliberately omitted.
5. **Anonymous research budget.** A hard monthly ceiling is needed before
   Phase 5 ships. What is it worth?
