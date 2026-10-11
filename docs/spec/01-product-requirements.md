---
description: Product Requirements Document — what Huntloop is, who it serves, and every feature with its true implementation status.
---

# 1 · Product Requirements Document (PRD)

> **As of 2026-10-08** · code at `feat/personal-learning` @ `4c8576a` · schema through `0045`.
> Companion documents: [TRD](02-technical-requirements.md) · [App Flow](03-app-flow.md) ·
> [Design Brief](04-design-brief.md) · [Schema](05-backend-database-schema.md) ·
> [Plan](06-implementation-plan.md) · [Gap Report](07-specification-gap-report.md).
>
> **Convention.** Statuses are defined in the [README](README.md#status-vocabulary-used-in-every-document).
> Element-level behaviour (every button, branch and message) lives in
> [COMMAND.md](../../COMMAND.md); this PRD states *what the product is for and what each feature
> must do*, and points there for the mechanics.
>
> **Where code lives (the "Ships in" column).** The repository is split three ways, which matters
> because **production runs `main`, and `main` lacks most of the recent work**:
>
> | Code | Meaning |
> |---|---|
> | **main** | On `main`/`origin/main` @ `14cf749` — what production serves. Migrations through `0039`. |
> | **PR#2** | On `feat/p3-p6-roadmap` (pushed; GitHub PR #2 open, unmerged). Migrations `0040`–`0043`. |
> | **local** | Only on local branch `feat/personal-learning` (never pushed). Migrations `0044`–`0045`. Includes everything in PR#2. |

---

## 1 · Product overview

**Huntloop** is a multi-tenant, AI-assisted **B2B sales-intelligence and outreach workspace**. Its
organising claim: most tools help a seller *find* prospects; Huntloop answers **"why is this
prospect worth contacting *right now*, and what is the evidence?"** The unit of the product is a
**qualified opportunity with evidence**, not a lead (`docs/product/what-it-is.md`; Master Context
§85 "CONFIRMED").

The loop it implements:

```
SIGNAL → CONTEXT → INTENT → OPPORTUNITY → ENGAGE → LEARN
 (sources,   (company     (qualify,    (company × ICP,   (campaigns,    (outcomes →
  provider    research,    why-now,     scored, with     inbox, log,    findings →
  search,     enrich)      score)       evidence)        pipeline)      rules/memory)
  CSV, URL)
```

It is a web application (Next.js) backed by Supabase (Postgres + Auth), a Postgres-resident job
queue (the "engine"), the Anthropic API for reasoning, and pluggable data providers.

**It is not** a CRM (it pushes to HubSpot), a sending service (it sends through the customer's own
Gmail/Outlook), a data vendor, or a lead database (`docs/product/what-it-is.md`).

## 2 · Purpose, problem and value proposition

| | |
|---|---|
| **Problem** | Filter-matching lists are a commodity. The unsolved problem is knowing *which* matching company deserves a message *today* and what to say, with sources a person can check. Generic sequences have marginal reply rates. |
| **Purpose** | Turn a company's own website + a short profile into a continuously refreshed, ranked, *evidenced* queue of accounts; draft grounded outreach; and learn from outcomes. |
| **Value proposition** | (1) Every claim is labelled **fact / inference / unknown** and a fact must have a source. (2) Scores are eight named dimensions — no hidden arithmetic; unmeasured = UNKNOWN, never 0. (3) A *why-now* trigger with freshness. (4) A human-controlled **autonomy ladder** (0–5) for sending. (5) Cost control before the first vendor call. (6) A learning loop that **proposes** and never silently applies. |

Evidence: `docs/product/vision-and-principles.md`; enforced in `packages/db/migrations/0002`, `0003`,
`packages/ai/src/claims.ts`, `packages/ui/src/components/ClaimBadge.tsx`.

## 3 · Target users, needs and goals

### 3.1 Users (modelled in the product)

Role is asked in onboarding step 1 and stored on `profiles.role`
(CHECK: `founder | sales | sdr | gtm_generalist | revops | marketing | agency`).
`apps/web/lib/data/personalization.ts` orders the Command Center by role and goals;
**personalisation reorders, never removes** (`docs/product/audiences.md`).

| Role | Who | Default Needs-you / Performance scope | Dashboard leads with |
|---|---|---|---|
| `founder` | Founder/CEO who also sells | Everyone | Why now |
| `gtm_generalist` | Founder-led sales (also fallback) | Everyone | Why now |
| `sales` | Account executive | **Mine** | Priority counts |
| `sdr` | High-volume outbound | **Mine** | Sending capacity |
| `revops` | Owns system and numbers | Everyone | Learning loop |
| `marketing` | Signal-led demand gen | Everyone | Why now |
| `agency` | Runs the motion for clients | Everyone | Priority counts |

(`COMMAND.md` §6 table; the "Mine" default is `defaultFilter = "assigned"`.)

**Secondary / intended audiences** (Master Context §5, **CONFIRMED** as intent): BD managers and
directors, CROs, growth teams, enterprise sales, consultants, partnership and channel teams. **Web2
and Web3** sellers are in scope per Master Context §85; no Web3-specific feature exists in code
(see §19).

### 3.2 Needs → how the product meets them

| User need | Meeting feature | Status |
|---|---|---|
| "Tell me who to contact today and why" | Needs you queue, Command Center why-now (F-06, F-07) | EXISTS |
| "Don't make me trust a black box" | Fact/inference/unknown, 8-dimension scores, evidence lists (F-08, F-22) | EXISTS |
| "I already have a list" | CSV import → research/score (F-11) | EXISTS |
| "Just check this one company" | Analyze a URL (F-10) | EXISTS |
| "Find new customers for me continuously" | ICP → discovery → opportunities (F-12, F-13) | EXISTS in code; **engine undriven in production** (DEF-01) |
| "Write the email, but let me approve it" | Campaigns, drafts, approval queue, autonomy ladder (F-17, F-19) | EXISTS in code; not exercised live |
| "Track what I did on LinkedIn/phone too" | Activity ledger, Log activity, Outreach log (F-08, F-18) | EXISTS (local) |
| "Show me what's working" | Performance, Share report (F-21) | EXISTS (Performance main; share report local) |
| "Learn how I work, ask me only when needed" | Personal learning layer, just-in-time questions (F-27) | EXISTS (local) |
| "Answer questions about my pipeline" | Ask Huntloop (F-25) | EXISTS (PR#2/local); needs model key |
| "Prove compliance" | Suppression, unsubscribe, export/erase, retention (F-29, F-33) | EXISTS (legal text PENDING, DEF-08) |

### 3.3 Product goals

Derived from `docs/product/*` and Master Context §85 (CONFIRMED items only):

1. Qualified opportunities with evidence, explained and ranked (HOT/WARM/WATCH/IGNORE).
2. Research starting from a company website; ICP created and editable; sources recommended.
3. Users can paste a URL or bring a list.
4. Outreach with human control; outcomes recorded; learning from outcomes.
5. Organisation memory and per-user memory.
6. Team functionality; performance analytics.
7. The product becomes more valuable as context and outcomes accumulate.

### 3.4 Business goals

| Goal | Evidence | Status |
|---|---|---|
| Paid SaaS with tiered plans (Free $0 / Growth $99 / Scale $299 per month; five metered limits) | `plans` seed in `0007`; pricing section reads the same rows | PARTIALLY EXISTS — **display and enforcement only; no checkout** (MIS-01) |
| Enterprise/Team/Professional packaging as in Master Context §56 (Core/Professional/Team/Enterprise) | Master Context | **UNCLEAR** — code has 3 plans with different names; final packaging is "UNKNOWN" per Master Context §87 (DEC-03) |
| Funnel: domain-first anonymous read → signup → onboarding | `0025`, `/discover` | EXISTS, **off by default** (`PUBLIC_RESEARCH_ENABLED`) |
| Revenue / activation / retention targets | none in repository | **UNCLEAR** — no goals defined; PostHog events exist (`onboarding_step_*`) but PostHog is unconfigured in prod |
| Compliance posture (GDPR Art. 14 notice, CAN-SPAM identification) | `lib/legal.ts`, `0017`, `0029` | PARTIALLY EXISTS — mechanisms built; **legal identity facts PENDING** (`LEGAL-01` warning) |

## 4 · Core use cases

| ID | Use case | Primary role | Path through the product |
|---|---|---|---|
| UC-01 | Evaluate Huntloop on my own domain without an account | Visitor | `/` → DomainInput → `/discover` → `/signup?d=` (F-01) |
| UC-02 | Set up a company workspace from my website | Founder | `/welcome` → company → goals → ICP → sources → building → review (F-03) |
| UC-03 | Start as an individual with a task, not a company profile | Any | `/welcome/start` → personal workspace → Analyze / Imports / dashboard (F-04) |
| UC-04 | Check one company now | AE/SDR | `/{org}/analyze` → verdict → Check timing → Save (F-10) |
| UC-05 | Bring my own list | AE | `/{org}/imports` → engine researches and scores (F-11) |
| UC-06 | Work today's queue | SDR/AE | `/{org}/needs-you` or dashboard rail → reply / draft / follow up / log touch (F-07) |
| UC-07 | Decide on an opportunity | AE | Opportunity detail: brief, evidence, buyers, timeline, Disagree, Not a fit, Assign (F-08) |
| UC-08 | Run an outreach campaign with approval | Founder/SDR | Outreach: campaign + sequence + mailbox → enrol from Opportunities → Inbox approve (F-17, F-19) |
| UC-09 | Record non-email activity and see the whole relationship | AE | Opportunity → Log activity; Outreach log (F-08, F-18) |
| UC-10 | See what's working and share it | RevOps/Manager | Performance; Share report; CSV (F-21) |
| UC-11 | Teach the system | Any | Learn → accept findings; Memory; Settings → You (F-23, F-24, F-27) |
| UC-12 | Ask about my pipeline | Any | Ask Huntloop (F-25) |
| UC-13 | Capture what prospects ask for | Founder/PM | Prospect demand (F-26) |
| UC-14 | Manage the team | Owner/Admin | Members, invitations, join requests, assignments (F-05) |
| UC-15 | Fulfil a data-subject request | Admin | Settings → Data & privacy (F-29) |
| UC-16 | Know whether the engine is healthy | Admin/RevOps | Operate → Engine, AI spend (F-30, F-21) |

## 5 · Product principles (enforced rules, not style)

| # | Principle | Enforcement |
|---|---|---|
| P-1 | **Fact ≠ inference ≠ unknown.** A fact has a source URL; an unknown carries no confidence. | DB CHECKs `evidence_fact_needs_source`, `evidence_unknown_has_no_confidence`; `assertValidClaim`; `ClaimBadge` |
| P-2 | **Scores are explainable.** Eight dimensions, nullable; no weights column. | `0003`; `opportunity_scores`; `ScorePill`/`HoverPanel` |
| P-3 | **Why now.** Old evidence stops counting as current. | `company_triggers`, `Freshness` |
| P-4 | **A refusal is a result.** "No provider connected" ≠ "0 matches"; no guessed emails. | provider contract; reach counter |
| P-5 | **No invented numbers.** Demo/unconfigured states are announced. | `DataSourceBanner`, `DemoFigures`, audit `FEAT-DEMO` |
| P-6 | **Tenancy lives in Postgres RLS**; UI gating is convenience. | 140 policies; `check-admin-imports` |
| P-7 | **An affordance that fails is a bug** — controls act or say why they can't. | audit `NAV-03` |
| P-8 | **Cost control precedes the first call.** | cache → budget → breaker → ledger; `ai_runs` |
| P-9 | **Nothing durable is created by AI without a human accept** (memory, rule, ICP, competitor, theme). | `COMMAND.md` §16.2 |
| P-10 | **Low-risk learned preferences apply (labelled, undoable); high-risk ones are only proposed.** | `0044`, `resolvePreferences` |

## 6 · Feature inventory

"Code" = implementation status as read from code and tests. "Ships in" per the key above.
"Prod" = what can be said about production *today* from `/api/health` (**prod has no AI key, no
provider keys, no cron secret, no mailbox OAuth, no Sentry/PostHog; Resend is not reported by the health endpoint**; DEF-01/02/03).

| ID | Feature | Code | Ships in | Prod today | Evidence (primary) |
|---|---|---|---|---|---|
| F-01 | Marketing site: landing, `/for/*` (4), `/compare/*` (4), legal pages, OG image, sitemap/robots | EXISTS | main | Live (legal pages draft, unlinked) | `app/(marketing)/*`, `app/sitemap.ts`, `lib/legal.ts` |
| F-01b | Anonymous company read `/discover` | EXISTS (flag **off** by default) | main | Off; and no AI key | `0025`, `discover/actions.ts`, `PUBLIC_RESEARCH_ENABLED` |
| F-02 | Auth: email magic link; Google button behind `NEXT_PUBLIC_AUTH_GOOGLE` | EXISTS | main | Live (Supabase Auth) | `app/(auth)/*`, `app/auth/*` |
| F-03 | Company onboarding (7 steps, resumable) | EXISTS | main | Needs AI key to research | `app/(onboarding)/welcome/*`, `0024` |
| F-04 | First-job fork + personal workspaces | EXISTS | **local** | Not deployed | `welcome/start`, `0044` |
| F-05 | Workspaces, membership, roles, invitations, join requests, assignments | EXISTS | main | Live | `team/*`, `0001`, `0007`, `0027` |
| F-06 | Command Center (role/goal-ordered dashboard) | EXISTS | main | Live (empty data) | `dashboard/page.tsx`, `lib/data/dashboard.ts` |
| F-07 | **Needs you** ranked daily queue (+ snooze, Log touch, Draft, goals strip) | EXISTS | main; reach lines/Log touch/Draft/goal strip **local** | Live (no data) | `needs-you/*`, `lib/needs-you/*`, `0037` |
| F-08 | Opportunities list + detail (brief, evidence, buyers, timeline, next step, Disagree, Not a fit, Assign, enrol, AgentPanel) | EXISTS | main; brief sections/deal value **PR#2**; product filter/Also fits/Stale-archive **local** | Live | `opportunities/*`, `0003`, `0037`, `0040` |
| F-09 | Companies list + company page | list main; page **PR#2** | — | Live (list) | `companies/*` |
| F-10 | Analyze a URL (+ `?url&run=1`) | EXISTS | main; auto-run **local** | Needs AI key | `analyze/*` |
| F-11 | CSV import → research → score | EXISTS | main | Live; engine must run to qualify | `imports/*`, `0036` |
| F-12 | ICP-driven discovery (provider search), **Hunt now**, reach counter, look-alikes | EXISTS | main | **Inert**: no Apollo key, no engine | `settings/icp`, `0013`, `0014`, `discover_companies` |
| F-13 | Sources, scanning, signals, backlog cap & pause | EXISTS | main | **Inert**: no engine | `sources/*`, `scan_source`, `0038` |
| F-14 | Scoring: 8 dimensions + user rules (draft, preview, test, rescore) | EXISTS | main | Needs AI key | `settings/scoring`, `rules.ts`, `0016`, `0023` |
| F-15 | Company profile: Product(s), ICP(s) (versioned), personas | EXISTS | main; product list/cards **PR#2/local** | Live | `settings/product`, `settings/icp`, `0013` |
| F-16 | Competitors: list, accept/dismiss, positioning, research, signals | EXISTS | **PR#2** (research request seam `0039` on main) | Not deployed | `competitors/*`, `0015`, `0021`, `0039` |
| F-17 | Outreach: campaigns, sequences, steps, mailbox OAuth (Gmail/Outlook), warm-up, autonomy 0–5 | EXISTS | main | **Inert**: no OAuth creds / encryption key | `outreach/*`, `jobs/mailbox/*`, `0004`, `0017`, `0033`, `0035` |
| F-18 | Outreach log (all channels, derived outcomes, Got a reply) | EXISTS | **local** | Not deployed | `outreach/log/*`, `0037` |
| F-19 | Inbox: threads, approval queue, edit/redraft/reject, reply | EXISTS | main | Live (empty) | `inbox/*` |
| F-20 | Pipeline board (11 statuses; lost-reason capture; card facts/values) | EXISTS | main; card facts/values **local** | Live | `pipeline/*` |
| F-21 | Performance (funnel, insights, breakdowns, goals, CSV), Share report, AI spend | Performance/AI spend main; report **local**; product split/Me **local** | — | Live (empty) | `performance/*`, `analytics/*`, `lib/performance/compute.ts` |
| F-22 | Intelligence (read-only evidence, triggers, decisions) | EXISTS | main | Live | `intelligence/page.tsx` |
| F-23 | Learn: analysis runs, findings, accept/decline | EXISTS | main; competitor/demand findings **PR#2** | Needs AI + engine | `learn/*`, `0010`, `0018`, `0043` |
| F-24 | Memory: org/team/account/opportunity notes, URL/PDF/DOCX ingest | EXISTS | main; scope picker/PDF-DOCX **PR#2** | Live | `memory/*`, `/api/memory/extract` |
| F-25 | Ask Huntloop (workspace co-pilot, saved conversations, focus) | EXISTS | **PR#2**; conversations list/focus **local** | Not deployed; needs AI key | `assistant/*`, `0041`, `0045` |
| F-26 | Prospect demand themes | EXISTS | **PR#2** | Not deployed | `demand/*`, `0042` |
| F-27 | Personal learning layer: Settings → You, signals, just-in-time questions, Written-with, Is-it-working | EXISTS | **local** | Not deployed | `settings/you/*`, `lib/learning/*`, `lib/questions/*`, `0044` |
| F-28 | HubSpot push (private-app token; encrypted) | PARTIALLY — pushes company/contact/deal and reads back one field (deal stage); no webhooks, no general two-way sync, no OAuth | main | Needs `MAILBOX_ENCRYPTION_KEY` (absent) | `settings/integrations`, `packages/crm`, `0028` |
| F-29 | Data & privacy: contact export/erase, workspace export, delete workspace/account, retention | EXISTS | main; export excludes colleagues' personal prefs **local** | Live | `settings/privacy/*`, `0017`, `0029`, `0044` |
| F-30 | Engine (Operate): dead letters, retry/cancel, job table, provider health | EXISTS | main | Shows "nothing is running the queue" | `ops/*`, `0019` |
| F-31 | Product email (Resend): invitations, join-request notices, approvals, daily digest, notification preferences | EXISTS | **PR#2** | Not deployed; no `RESEND_API_KEY` | `packages/jobs/src/email/*`, `send-notifications`, `send-digests`, `0040` |
| F-32 | Plans, quotas and metering | PARTIALLY — catalogue, counters, enforcement exist; **no payment path** | main | Free plan only possible | `plans`, `usage_counters`, `lib/data/usage.ts` |
| F-33 | Public unsubscribe (page + RFC 8058 one-click) | EXISTS | main | Live | `unsubscribe/*`, `api/unsubscribe/*` |
| F-34 | App shell: sidebar, top bar, Jump-to (pages only), shortcuts, account menu, theme | EXISTS | main | Live | `OrgShell.tsx`, `packages/ui` |
| F-35 | Duplicate-company detection and merge | **PARTIALLY EXISTS / dormant** — SQL + handler built, **no trigger, no UI** | main | Inert | `0012`, `resolve-entity.ts` (DEF-04) |
| F-36 | Email finding and verification (`enrich_person` → Hunter `person.match`, ZeroBounce `email.verify`) | **PARTIALLY EXISTS / dormant** — handler built, **no producer**; it is the only caller of those two adapters | main | Inert | `enrich-person.ts` (DEF-05); contacts still arrive via `rank_contacts` (Apollo) with provider-reported verification only |
| F-37 | Legal pages (Privacy, Terms, Acceptable use) | PARTIALLY — text written; identity facts PENDING; unlinked + noindex until complete | main | Draft, hidden | `lib/legal.ts`, `LEGAL-01` |
| F-38 | Billing / checkout / invoices | **MISSING** | — | — | zero references to `STRIPE_*` in code (MIS-01) |
| F-39 | Record-level search | **MISSING** — Jump-to indexes nav pages only | — | — | `COMMAND.md` §1.1.5 (MIS-02) |
| F-40 | SSO / SCIM / MFA | **MISSING** (PLANNED in Master Context §86 as "recommended") | — | — | none in code (MIS-05) |

## 7 · Feature specifications

Each entry states the *required behaviour*. Bracketed refs point to the element-level map.

### F-02 Authentication [COMMAND §3]
- Email magic link only (Supabase OTP). `shouldCreateUser` is `false` on login and `true` on signup.
- Response is enumeration-safe ("If an account can be created or found…"). Link expiry stated as one hour.
- "Check your email" state has **Resend** and **Use a different address**.
- Callback maps failure codes (`missing_code`, `invalid_link`, `oauth`) to messages on `/login`.
- Post-login destination by `resolveDestination` (§App Flow 2.1). `?next=` is path-only and re-validated (`lib/safe-next.ts`).
- Google OAuth button renders only if `NEXT_PUBLIC_AUTH_GOOGLE === "true"` and Supabase's Google provider is enabled.
- **Not present:** passwords, MFA, SSO/SAML, SCIM, session-management UI, device list (MIS-05).

### F-03 / F-04 Onboarding [COMMAND §4]
- Resumable via `organizations.onboarding_step` (`you → company → goals → icp → sources → building → review → done`).
- Step 1 asks name + role (7 options). A person with no workspace then chooses a first job (F-04); only *Find new customers* continues the company path.
- Company step researches a website (model), shows an editable "Here's what we understood" review; `fact`/`inference`/`unknown` per finding; saving requires a live-run seal (worked examples cannot be saved as live).
- Goals: at most 2 of 5 (`discover, qualify, enrich, reach_out, learn`) + preferred channel.
- ICP: drafted from stored research; required: segment-or-industry, size, region, trigger, title; "reach bar" counts matching companies via provider (or says none connected).
- Sources: recommended list, toggle, own URLs.
- Building: six stages (`discover → enrich → score → contacts → explain → rules`), each degrading independently.
- Review: top 3 opportunities, proposed rules, finish.
- Same-domain people are offered **Ask to join** instead of a second workspace (`discoverable_workspaces`, `0027`).

### F-05 Workspaces, roles and team [COMMAND §5, §11]
- Roles: **owner › admin › member › viewer**. Matrix in §13.3.
- Invitations: admin creates (seat-quota checked), 14-day expiry, bound to the invited address; link is emailed if Resend is configured and always copyable; revoke/re-issue.
- Join requests: same-domain discovery; admin Approve → member / Decline.
- Last owner cannot be removed or demoted; only an owner can grant/change/remove owner.
- Workspace slug is permanent. Multi-workspace users pick on `/orgs`; the last-used workspace is remembered (cookie `huntloop.org`).

### F-06 / F-07 Command Center and Needs you [COMMAND §6]
- Section order and lead sentence follow role then first goal; every section is always present.
- **Needs you** is one ranked list (`lib/needs-you/rank.ts`: kind weight × priority weight × stage weight + age). Kinds: positive/plain/other-channel reply, approve draft, next step due, gone quiet (≥ N business days, default 4), hot-untouched, no next step, learning proposals, discovery paused, sources failing, stale scores.
- One item per opportunity (strongest) except drafts. Snooze (≤ 30 days, per user). Filters Mine / Unassigned / Everyone (role-default).
- Items offering reach-out show *why now* and *who to reach*, with **Log touch** and **Draft** (not sent).
- "Reached out today" strip against an optional weekly touches goal.
- Ranking is deterministic and free (no model call).

### F-08 Opportunities [COMMAND §7.1]
- Opportunity = company × ICP (unique), with `priority` (+ mandatory reason), `status` (11 values), owner, eight nullable score dimensions via `opportunity_scores`, why-now, outreach angle, next step + due date, optional deal value (`estimated_value_cents`).
- List: priority chips, scope search, product filter (≥ 2 products), Stale view (found ≥ 60 days, never past `assigned`, no trigger in 90 days), bulk **Archive** (pre-contact rows only), bulk **Add to campaign**; capped at 500 rows with a visible notice.
- Detail: next-step bar (state-aware recommendation with listed inputs), evidence (fact/inference/unknown), decision makers (only verified emails shown), competitor "what they use", problems/gaps, activity timeline (ledger), **Log activity**, **Disagree** (records correction for learning), **Not a fit** (reason → outcome, archived, sequences stop), Assign, Add to campaign, Push to HubSpot, per-user AgentPanel with closed-set citations.
- Logging activity moves the stage **forward only**.

### F-10 Analyze a URL [COMMAND §7.3]
Verdict card (priority, score pill, summary, recommendation, evidence) → **Check timing** (why-now) → **Save as an opportunity** (live seal required) → **Open it**. Without a model key the result is labelled a worked example and cannot be saved.

### F-11 Imports [COMMAND §7.4]
Paste or choose `.csv`; live client preview; ≤ 1,000 rows; needs a domain column; existing companies are never overwritten; CSV cells beginning `= + - @` are neutralised on export. After import the engine researches and scores new companies (≤ 5 per tick, once a day — `0036`).

### F-12 / F-13 Discovery and sources [COMMAND §6.1, §10.3, §10.5]
- Active ICP → saved discovery search (provider filters vs. qualification-only criteria shown in **SearchPreview**). **Hunt now** requests an immediate run (rate-limited).
- Sources: add/pause/remove (with Undo)/interval/Scan now/Suggest; "Scan now" is disabled with a reason unless the engine is actually driven.
- **Backlog cap** (default 250 open opportunities; workspace-settable; 0 = none) pauses both free scans and paid discovery; Sources, Engine and Needs you show why.

### F-14 Scoring [COMMAND §10.4]
Rules are few, typed and testable (`RULE_FIELDS`, operators, effects `adjust | floor | veto`); **Draft from my ICP** proposes inactive rules; **Test it** previews against the 50 most recent scores; **Rescore all** is a tracked request spanning ticks. Rules may adjust the overall score or priority; they never alter the eight dimensions; every application is traced in `opportunity_scores.rule_trace`.

### F-17 / F-19 Outreach and Inbox [COMMAND §8.1–8.2]
- Campaign = sequence + enrolled opportunities; autonomy 0 *Draft only* … 5 *Autonomous*; new campaigns start at 0/draft.
- Email steps must cite evidence for personalised claims; a message with no evidence is badged "No evidence cited".
- **Send gates** (`send_message`): idempotency (already sent?) → suppression/`can_contact` (cadence caps, erased/unsubscribed) → postal address on file (CAN-SPAM) → mailbox daily cap claimed *before* send → send → record `sent_at` + provider id together. Failures are recorded as events, never as sent.
- Approval queue lists every unsent, unapproved outbound draft (threaded or not). Approve / Edit (keeps unapproved; original preserved) / Redraft with a note / Reject (parks the sequence). Replies are classified (`classify_reply`).
- Mailbox connect needs provider credentials **and** `MAILBOX_ENCRYPTION_KEY`; otherwise the button is aria-disabled with the reason.

### F-20 Pipeline [COMMAND §8.3]
Eleven statuses; columns show counts and (when values exist) value totals; choosing **lost** asks for a reason (or skip). No drag-and-drop.

### F-21 Performance [COMMAND §9.1]
Cohort funnel; statistically-gated insights (Wilson 95% intervals; two-proportion test; minimum samples) else "not enough data"; breakdowns by first channel/source/trigger/priority/owner/product; loss reasons; pipeline value from typed values only; goals and pace; stalled deals; cost per outcome; CSV export; optional `explain_performance` narrative whose parser rejects any number not in its cited facts.

### F-23 / F-24 Learn and Memory [COMMAND §9.3–9.4]
Run an analysis (90 days) → findings with closed citations → **Accept** creates an *inactive* rule or a memory note → human activates. Memory holds workspace knowledge; personal items live under Settings → You.

### F-25 Ask Huntloop [COMMAND §9.5]
Answers only from this workspace's records via `workspace-context.ts`; typed citations; "Not in your records" when nothing supports an answer; proposed actions run only on click through existing actions; conversations are personal (RLS).

### F-26 Demand [COMMAND §9.6]
Statements from reply classification, closed-lost reasons, and activities tagged as product feedback → proposed themes (hourly clustering, ≤ 1 call/workspace/day) → human accept/merge/status. **Shipped** surfaces matching lost/stalled deals in Needs you.

### F-27 Personal learning [COMMAND §1.1.10, §10.8]
Four knowledge kinds kept apart (stated / learned / task-only / long-term). Learned item requires ≥ 3 cited own-actions on ≥ 2 drafts for style. Precedence: task instruction > stated > learned > opportunity > account > workspace. People can pause learning, reset, export, share with admins, and admins can promote to workspace policy. Personal memories are private to their subject, admins included.

### F-29 Data & privacy [COMMAND §10.7]
Contact export (JSON) and erase (typed re-entry; bodies of mail to *and from* the person redacted; suppression hash retained); workspace export; owner-only workspace delete; account delete refused for a sole owner; retention days ≥ 30, never touching messaged people or live opportunities' contacts.

### F-30 Engine [COMMAND §11.3]
Dead letters with verbatim errors, Retry once / Cancel (admin), job table, provider health (24 h), "nothing is running the queue" warning, noisy-neighbour warning.

## 8 · Pages and screens

Complete route inventory with auth, role and state behaviour is the **App Flow §3** table (R-01 … R-69). Summary counts from `app/` (verified by listing):

| Group | Routes | Notes |
|---|---|---|
| Marketing (public) | `/`, `/discover`, `/for/[useCase]` (4), `/compare/[approach]` (4), `/privacy`, `/terms`, `/acceptable-use` | `/discover` noindex; legal noindex until complete |
| Auth | `/login`, `/signup`, `/auth/callback`, `/auth/signout` | |
| Onboarding | `/welcome`, `/welcome/start`, `/company`, `/goals`, `/icp`, `/sources`, `/building`, `/review` | |
| Account | `/orgs`, `/invite/[token]` | |
| Workspace (signed-in) | 21 sections under `/{org}/…` → 33 `page.tsx` | listed in `lib/protected-routes.ts WORKSPACE_SECTIONS` |
| Token pages | `/unsubscribe/[token]` | public |
| Machine | `/api/health`, `/api/jobs/tick`, `/api/inngest`, `/api/csp-report`, `/api/mailboxes/[provider]/{start,callback}`, `/api/memory/extract`, `/api/notifications/unsubscribe`, `/api/unsubscribe/[token]`, `/{org}/performance/export` | |
| Dev only | `/kitchen-sink`, `/dev/onboarded` | 404 in production |

## 9 · Navigation

Top bar (workspace switcher, Jump-to search, Feedback if configured, account menu) + 76 px rail of 8 sections + 240 px panel. Sections and items (verified against `OrgShell.tsx` by audit `NAV-01`):

| Rail | Items |
|---|---|
| Home | Command Center |
| Hunt | Opportunities · Companies · Analyze a URL · Imports |
| Engage | Needs you · Outreach · Outreach log · Inbox · Pipeline |
| Learn | Performance · Ask Huntloop · Intelligence · What we've learned · Memory · Prospect demand |
| Company | Product · ICP · Sources · Competitors |
| Team | Members · Assignments |
| Operate | Engine · AI spend |
| Settings | General · You · Product · ICP · Scoring · Integrations · Data & privacy |

Mobile (< lg): drawer; tapping a rail with a panel selects it. Active state = longest-prefix match. See [Design Brief §9](04-design-brief.md).

## 10 · Forms and inputs

Validated by Zod 4 schemas (`lib/validation.ts`) at the Server Action boundary; plain-language field errors. Principal forms:

| Form | Key rules |
|---|---|
| Sign-in / sign-up | Email required; enumeration-safe response |
| You (onboarding 1) | Name required; one of 7 roles |
| Company research | Website URL; free-mail domains refused on `/discover` |
| Goals | 1–2 of 5 + channel |
| ICP (onboarding) | Required: segment-or-industry, size, region, trigger, title |
| ICP (settings) | Free-text lines (sizes/regions use the same options as onboarding since the last sync) |
| Product | Name required; value propositions/proof points one per line |
| Organisation | Name; postal address (required before sending); retention days 30–3650 |
| Voice and limits | Tone; competitors; regions; backlog limit (blank 250, 0 none); follow-up days 1–20 |
| Source | Name, kind, URL |
| Campaign / sequence / step | Name; autonomy 0–5; step type email/wait/condition; delay hours; subject/body |
| Company (manual) | Name + domain required |
| CSV import | Domain column required; ≤ 1,000 rows |
| Log activity | Kind, channel, direction, optional contact, datetime (≤ now, ≤ 2 years back), summary, notes, optional next step |
| Next step | ≤ 280 chars; due date default +2 days at 09:00 local |
| Memory | Scope + subject (non-org), label, text |
| Invitation | Email; role admin/member/viewer |

## 11 · Notifications and product email

| Channel | What | Status |
|---|---|---|
| Inline `FormMessage` / `Confirmed` | Outcome of every action | EXISTS (the pattern in use) |
| Toast component | `packages/ui/Toast` mounted in root layout | EXISTS as a component, **used only in `/kitchen-sink`** — no product screen calls `useToast` |
| In-app notification centre | — | MISSING (attention is expressed by the Needs-you count and rail dot only) |
| Email via Resend: invitation, join-request notice to admins, join approved, daily **Needs you** digest | per-user `notification_preferences`; signed one-click off link `/api/notifications/unsubscribe` | EXISTS in PR#2; **inert without `RESEND_API_KEY` + `EMAIL_FROM`** |
| Supabase Auth email (magic link) | sent by Supabase, not this app | EXISTS; Supabase's built-in limit applies unless custom SMTP is set (documented in `.env.example`) |
| Prospect outreach | sent from the customer's own mailbox, never via Resend | EXISTS |

## 12 · States

System-wide patterns (`packages/ui/States.tsx`, `loading.tsx`, `error.tsx`):

| State | Pattern |
|---|---|
| Loading | `[org]/loading.tsx` skeleton (title + 6 rows); `opportunities/loading.tsx`; per-action "Saving…/Sending…" button text; AI waits show a named skeleton ("Researching…") |
| Empty | `EmptyState` with icon, title, a sentence on *why*, and a next action where one exists (e.g. "No opportunities discovered yet" → Analyze / Review sources) |
| Error | `[org]/error.tsx` inside the shell: "This screen failed to load. Nothing was changed." + digest + Try again + Home; root `error.tsx`/`global-error.tsx`; `ErrorState` with optional retry; `RateLimited` states the absolute retry time |
| Success | Inline confirmation near the control; `Confirmed` strip with **Undo** only where a restore action exists (Sources remove) |
| Demo / unconfigured | Yellow `DataSourceBanner` on every workspace page; `DemoFigures` on list pages; destructive/privacy controls disabled |
| Not found | `not-found.tsx`; non-members of a workspace get **404, not 403** (no existence leak) |
| Production not ready | Plain 503 page |
| Read-only role | Controls hidden, disabled with a Note, or `aria-disabled` + tooltip reason |

## 13 · Authentication, account and permission-dependent behaviour

### 13.1 Authentication behaviour — see F-02 and App Flow §2.

### 13.2 Account behaviour

- Account = Supabase `auth.users` row mirrored to `profiles` (name, role, goals, `learning_paused`).
- A user may belong to many workspaces; each membership has one role.
- **Delete my account** requires typing "delete my account"; refused if the user is the sole owner of a live workspace (names it).
- There is no profile-edit screen for email or avatar (UNCLEAR whether intended — `profiles.avatar_url` exists, referenced by no UI code).

### 13.3 Role matrix (UI helpers `canWrite/canSpend/canAdmin/canOwn`; RLS is the boundary)

| Capability | viewer | member | admin | owner |
|---|---|---|---|---|
| Read workspace data | ✅ | ✅ | ✅ | ✅ |
| Create/edit most records (companies, opportunities, campaigns, rules, sources, memory) | ❌ | ✅ | ✅ | ✅ |
| Spend AI/provider credits (Analyze, Hunt now, Draft, rules draft, summaries) | ❌ | ✅ | ✅ | ✅ |
| Own personal items (Settings → You, snoozes, conversations, notification prefs, questions) | ✅ | ✅ | ✅ | ✅ |
| Rename organisation, voice/limits, goals, members, invitations, join requests | ❌ | ❌ | ✅ | ✅ |
| Connect/disconnect HubSpot; Engine retry/cancel; export/erase contacts; export workspace | ❌ | ❌ | ✅ | ✅ |
| Promote a shared personal preference to workspace policy | ❌ | ❌ | ✅ | ✅ |
| Grant/change/remove **owner**; delete workspace | ❌ | ❌ | ❌ | ✅ |

Server enforcement: 16 `mutate` call sites pass `minRole: "admin"`, 1 passes `"owner"`, 4 explicitly admit `"viewer"` (code lines only, counted by grep; every other action uses the default member-or-above rule).

## 14 · Business rules

| ID | Rule | Enforced by |
|---|---|---|
| BR-01 | A `fact` claim must have a `source_url`; an `unknown` cannot carry a confidence | DB CHECKs (`0002`) |
| BR-02 | An opportunity's priority must carry a non-empty reason | DB CHECK (`0003`) |
| BR-03 | Score dimensions are nullable; NULL = UNKNOWN, never 0 | Schema + UI |
| BR-04 | One opportunity per `(org, company, ICP)` | `UNIQUE NULLS NOT DISTINCT` |
| BR-05 | Roles are ordered owner › admin › member › viewer; unknown role degrades to viewer | `has_org_role`, `membership.ts` |
| BR-06 | The last owner cannot be demoted/removed | trigger `memberships_guard_owner` + UI |
| BR-07 | Plan quotas: `opportunities` (checked at creation), `ai_runs`, `emails` (checked before send), `enrich`, `seats` (checked at invite). `NULL` limit = unlimited | `check_quota*`, `usage.ts` |
| BR-08 | Every model call: rate limit → plan quota → per-org spend guard → recorded in `ai_runs` | `lib/rate-limit.ts`, `lib/ai/budget.ts` |
| BR-09 | A result produced without a live model (worked example) can never be saved as live | HMAC seal (`lib/ai/seal.ts`) |
| BR-10 | New campaigns start at autonomy 0 / draft; autonomy ≥ 3 sends without per-message approval | `OutreachManager.tsx`, `advance_enrollments` |
| BR-11 | A message cannot be recorded as sent without a provider id; one send per message; one message per enrollment step | `messages_sent_has_provider_id`, `0033`, `0035` |
| BR-12 | Never contact a suppressed/unsubscribed/erased address; cadence: min 2 days between contacts, ≤ 6 sends/contact/30 d, ≤ 3 contacts/company (workspace-settable) | `can_contact` (`0017`) |
| BR-13 | Postal address must be on file before a send (CAN-SPAM); every send carries an unsubscribe link | `send-message.ts` step 3c, `0017` |
| BR-14 | Contact discovery never guesses an address | provider contract |
| BR-15 | Backlog cap (default 250) pauses free scans and paid discovery | `0010`, `0038` |
| BR-16 | Draft edits never approve; a rejected draft parks its enrollment; sequences stop on reply or when closed as not a fit | `inbox/actions.ts`, `advance_enrollments` |
| BR-17 | Activity logging moves stage forward only | `activity-actions.ts` |
| BR-18 | Archive affects only opportunities still before contact | `archiveOpportunitiesAction` |
| BR-19 | Retention ≥ 30 days; never deletes a messaged person or a live opportunity's contact | `0017` |
| BR-20 | Erasing a contact redacts mail to **and from** them and retains only a suppression hash | `erase_contact` |
| BR-21 | Invitations expire in 14 days and bind to the invited address | `0007` |
| BR-22 | Workspace slug is permanent (shape `^[a-z0-9]+(-[a-z0-9]+)*$`, ≤ 48) | UI + `orgSlugSchema` |
| BR-23 | AI never writes durable memory, rule, ICP, competitor or theme without a human accept | Architecture (COMMAND §16.2) |
| BR-24 | A learned preference needs ≥ 3 cited own-actions; high-risk categories (targeting, ICP, scoring, sources, cadence) are only proposed | `0044`, `learn_preferences` |
| BR-25 | Personal memories are private to their subject (admins excluded unless shared); a colleague cannot write one about another | RLS `memories_read/write_own`; `saveMemoryAction` |
| BR-26 | Just-in-time questions: ≤ 1 per screen, ≤ 3 handled/day, snooze 7 days, never repeat | `lib/questions/planner.ts` |
| BR-27 | Anonymous research runs only if `PUBLIC_RESEARCH_ENABLED === "true"`; it is rate-limited and budgeted | `0025`, env |
| BR-28 | Legal pages are unindexed and unlinked until every `lib/legal.ts` fact is supplied | `LEGAL-LINK` audit |
| BR-29 | Free plan includes **0 emails** (outreach cannot send on Free) | `plans` seed — see DEC-03 |
| BR-30 | Stored third-party credentials are encrypted at the application layer; connecting is refused without the key | `crypto.ts`, `MAILBOX_ENCRYPTION_KEY` |

## 15 · Settings and preferences

| Where | What |
|---|---|
| Settings → General | Organisation name (slug fixed), postal address, retention, tone, competitor names, regions, backlog limit, follow-up reminder days |
| Settings → You | Personal preferences, learning pause/reset/export, sharing |
| Settings → Product / ICP / Scoring / Integrations / Data & privacy | See F-15, F-14, F-28, F-29 |
| Account menu | Theme (System/Light/Dark; cookie `hl-theme`), keyboard shortcuts |
| Browser-local | Sidebar panel state (`hl:sidebar-panel`), nudge dismissals, onboarding furthest-step |
| Notification preferences | Per-user digest on/off (`notification_preferences`) |

## 16 · Integrations

| Integration | Purpose | Auth | Status |
|---|---|---|---|
| Supabase (Postgres, Auth) | Data, sessions | publishable + secret keys | EXISTS; prod configured |
| Anthropic | 16 AI tasks | `ANTHROPIC_API_KEY` | EXISTS in code; **prod key absent**; no live call ever observed in a verified environment |
| Apollo | Company search/enrich, person search/match | `APOLLO_API_KEY` | EXISTS in code; unverified live |
| Hunter | Email finding | `ENRICHMENT_API_KEY` | EXISTS in code; unverified live |
| ZeroBounce | Email verification | `EMAIL_VERIFICATION_API_KEY` | EXISTS in code; unverified live |
| Gmail, Outlook | Customer mailbox send/sync | OAuth app creds + encryption key | EXISTS in code; unverified live |
| HubSpot | Push opportunity | Private-app token (encrypted) | PARTIALLY EXISTS |
| Resend | Product email | `RESEND_API_KEY`, `EMAIL_FROM` | EXISTS in code (PR#2); unconfigured |
| Inngest | Optional engine driver | `INNGEST_*` | PARTIALLY — route exists; "not a real driver" per prior audit; unverified |
| Sentry, PostHog | Errors, product analytics | DSN/key | EXISTS in code; **unconfigured in prod** |
| Stripe | Billing | `STRIPE_*` | **MISSING** — variables documented, never read |

## 17 · Important edge cases

- **No database / no schema / partial schema**: demo fixtures; in production a 503 instead.
- **Model unavailable**: "worked example" everywhere; unsaveable as live.
- **Provider refusal**: `no_provider`, `credentials_invalid`, `budget_exhausted`, `breaker_open`, `capability_unsupported` are shown as such.
- **Engine not driven**: Sources, Learn and Engine warn; "Scan now"/"Run an analysis" disabled with reasons.
- **At-least-once queue**: every handler tolerates a second run; unique idempotency keys collapse duplicates.
- **A killed worker mid-send**: send claimed before provider call; recorded sends require provider id.
- **Same company, two products**: two opportunities; "Also fits" chips; company-level contact caps still apply (design intent in COMMAND §16.3-H; cross-campaign cap tests are **UNCLEAR**).
- **Erasure**: hand-written activities about the person lose their text; demand statements from them are deleted.
- **Viewer clicks a write control**: never reaches Postgres — rendered disabled with the reason.
- **Session expiry mid-action**: actions return "Your session expired. Sign in again."; no automatic redirect.
- **Free-mail address on `/discover`**: refused.
- **Duplicate-domain company**: refused with an inline error.

## 18 · Current limitations (observable today)

1. Production cannot run the engine, call a model, search providers, connect a mailbox, or send email (DEF-01/02).
2. Production serves `main`, which lacks Ask Huntloop, Competitors UI, Demand, Outreach log, Settings → You, the first-job fork, share report, company page, and Resend email (DEF-03).
3. No checkout; the Growth/Scale cards say "Talk to us" or are inert (MIS-01).
4. No record search; no in-app notification centre; no drag-and-drop pipeline.
5. Duplicate detection is built but never triggered; no merge review screen (DEF-04).
6. No profile/email edit screen (`profiles.avatar_url` exists but no UI reads or writes it); no MFA/SSO. (Mailbox **Disconnect** does exist — `disconnectMailboxAction`.)
7. Legal pages are drafts; outreach compliance text depends on facts the owner has not supplied (DEF-08).
8. English only; no localisation framework (UNCLEAR whether required — DEC-12).
9. Web3-specific signals/packs described in Master Context are not implemented.
10. ~~The dependency tree carried known advisories and CI on `main` was red (DEF-16).~~ Resolved in the working tree on 2026-10-09 (0 advisories); `main` turns green when the patch lands there.

## 19 · Specified in the Master Context but not present

(Master Context §85 *CONFIRMED* = direction; §86 *RECOMMENDED* = not a requirement.)

| Item | Class | Status |
|---|---|---|
| Social/public-source research (Reddit, X, GitHub, etc.) as signal sources | CONFIRMED direction | PARTIALLY — `source_kind` includes `social`, `github`, `community`; adapters are feed/page based; no per-network integration verified |
| Web3 signal pack | CONFIRMED audience | MISSING |
| CRM capabilities inside Huntloop ("should have CRM capabilities") | CONFIRMED | PARTIALLY — pipeline, activity ledger, owner assignment; HubSpot push; not a full CRM (and `what-it-is.md` says "Not a CRM") → **contradiction** CON-12 / DEC-13 |
| Global (cross-tenant) learning | HuntLoop-level learning §802 | MISSING and, per `memories` comment, deliberately excluded ("nothing global-scoped lives here") |
| AI coaching | RECOMMENDED | MISSING |
| Search/indexing layer, vector database | RECOMMENDED | MISSING (no vector store; Postgres only) |
| SSO/SCIM, fine-grained RBAC | RECOMMENDED | MISSING (4 fixed roles) |
| Detailed observability | RECOMMENDED | PARTIAL (Sentry/PostHog wired, unconfigured) |

## 20 · Recommendations (RECOMMENDED — not requirements)

Held in the Gap Report's register [REC-01 … REC-14](07-specification-gap-report.md#9--recommendations-register).
Product-facing ones: REC-06 (record search), REC-08 (surface the Toast or delete it), REC-10 (decide the
CRM-vs-not stance), REC-12 (in-app notification centre only if email proves insufficient).
