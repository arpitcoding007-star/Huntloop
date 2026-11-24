# Huntloop feature inventory (for the Product Overview PDF)

Compiled 2026-11-24 from branch `feat/pass-21-loop` (commit `dab37db` + working tree).
Sources: the code under `apps/web/app` and `packages/*`, `audit/pass-20/02_FEATURES.md`,
`audit/pass-21/00_SUMMARY.md`, `HUNTLOOP_MASTER_SYSTEM_GUIDE.md` (19 Nov 2026),
`docs/product/*`, `docs/spec/07-specification-gap-report.md`, `CHANGELOG.md`.

## Status rules used

| Badge | Rule |
|---|---|
| **Available** | Built in code, reachable from a screen or the background engine, passing its tests. |
| **In development** | Built but switched off, partial, or still being finished. |
| **Planned** | Written down in plans/specs only; no meaningful code. |

**Important caveat that applies to all "Available" items:** the product has been tested
against stand-ins, but the live site does not yet run the background engine, the AI, email
or data providers, because production keys and the scheduler are not configured
(`audit/pass-21/00_SUMMARY.md`, "Blockers that need you"). So "Available" means
*built and working in the app*, not *switched on for customers today*.

## Inventory

| Category | Feature | Plain-English description | Status | Evidence |
|---|---|---|---|---|
| Getting started | Website + free "read my company" tool | Type any website; Huntloop explains what that company does | Available | `(marketing)/discover`, master guide §5.1 |
| Getting started | Sign-in by email link (no password); Google sign-in optional | Log in with a link sent to your email | Available | `(auth)`, guide §5.2 |
| Getting started | 7-step guided setup, resumable | Tell Huntloop who you are, what you sell, who you want to reach, where to look | Available | `(onboarding)/welcome`, guide §5.3 |
| Getting started | AI reads your website and drafts your product + ideal customer profile | Huntloop writes the first draft; you edit | Available (not proven live) | `draft-icp.ts`, `research-company.ts` |
| Getting started | Look-alike preview and reach estimate | See example companies that match before you commit | Available (needs data provider) | `settings/icp`, features.md |
| Find companies | Company search from your ideal customer profile | Searches business databases for matching companies | Available (needs data provider) | `discover-companies.ts` |
| Find companies | "Hunt now" button and saved/recurring searches | Start a search any time; searches repeat on a schedule | Available | `HuntNowButton.tsx`, pass-20 |
| Find companies | Sources (news feeds, websites) watched for clues | Huntloop keeps reading sources you pick | Available | `sources`, `scan_source` |
| Find companies | AI-recommended sources | Suggests where to look | Available | `recommend-sources.ts` |
| Find companies | Import your own list (CSV spreadsheet) | Upload companies you already know | Available | `/imports` |
| Find companies | Analyze one website on demand | Paste a URL, get a fit score and "why now" | Available | `/analyze` |
| Find companies | Companies list, add/edit/remove | Your list of companies | Available | `CompanyManager.tsx` |
| Find companies | Duplicate detection + merge review | Spots the same company twice and lets you merge | In development (partial) | `MergeReview.tsx`, pass-20 PANEL-206 |
| Understand them | Company research and enrichment | Fills in size, industry, location etc., each with its source | Available (not proven live) | `enrich-company.ts`, `research-company.ts` |
| Understand them | Signals: hiring, funding, launches, source mentions | Clues that a company may need you now | Available | features.md "Signals" |
| Understand them | Fact / guess / unknown labels on every claim | Never mixes what is known with what is guessed | Available | `claims.ts`, `ClaimBadge` |
| Understand them | Competitor tracking and research | Who your competitors are and where they show up | Available (list partial) | `/competitors` |
| Understand them | Intelligence browser | Everything observed, in one place | Available | `/intelligence` |
| Understand them | Job-change signals, intent data, website-visitor identification | More types of clues | Planned | features.md (⚪) |
| Score & prioritise | 8-part explainable score | Each part shown; unmeasured parts say UNKNOWN | Available | vision-and-principles §2 |
| Score & prioritise | Priority Hot / Warm / Watch / Ignore with reason | A label you can act on, always with a reason | Available | features.md |
| Score & prioritise | "Why now" explanation, dated | Plain-words reason to reach out now | Available (not proven live) | `WhyNowButton.tsx`, guide §14 |
| Score & prioritise | Your own scoring rules (preview, dry-run, AI-drafted) | Tell Huntloop what matters to you | Available | `/settings/scoring` |
| Score & prioritise | Disagree / override a score | Correct Huntloop; it remembers | Available | `OpportunityActions.tsx` |
| Score & prioritise | Right person to contact, ranked by fit | Finds the best buyer inside the company | Available | `rank-contacts.ts` |
| Score & prioritise | Email finding and verification | Finds and checks the person's address | Available (needs data providers) | CHANGELOG (enrich_person queued) |
| Daily work | Command Center (home) | Today's counts, why-now cards, what changed | Available | `/dashboard` |
| Daily work | Needs you | Ranked list of who to act on next; snooze | Available | `/needs-you` |
| Daily work | Opportunities list + detail page | Every scored company with evidence and buyers | Available | `/opportunities` |
| Daily work | Research this / Ask the agent on one opportunity | Deeper research, or ask questions about one deal | Research: Available · Agent: In development | pass-20 (PANEL-101) |
| Outreach | Campaigns and multi-step email sequences | Plan a series of emails | Available | `/outreach` |
| Outreach | AI-written drafts grounded in evidence and your memory | Each email is about that company's real situation | Available (not proven live) | `personalize-message.ts` |
| Outreach | Send from your own Gmail or Outlook | No shared sending system | Available (not proven live) | `mailbox/gmail.ts`, `outlook.ts` |
| Outreach | Autonomy ladder; approve every email by default | You decide how much Huntloop does alone | Available | features.md |
| Outreach | Safety: unsubscribe, do-not-contact list, daily caps, warm-up, domain checks, business hours | Protects prospects and your reputation | Available | CHANGELOG, guide §8 |
| Outreach | Inbox: replies read and sorted, reply, assign | Replies come back into Huntloop | Available (not proven live) | `/inbox`, `sync-mailbox.ts` |
| Outreach | Outreach log | History of every touch | Available | `/outreach/log` |
| Relationships | Pipeline board (deal stages), next step, activity timeline, deal value | A simple record of every deal | Available | `/pipeline`, pass-20 |
| Relationships | Team: roles, invites, join requests, assignments | Work together with clear permissions | Available | `/team` |
| Relationships | HubSpot push | Sends companies, contacts and deals to HubSpot | Available (not proven live) | `sync-hubspot.ts` |
| Relationships | Two-way CRM sync, Salesforce, Pipedrive | — | Not planned for now (deliberate) | features.md |
| Learn | Outcomes (meeting, won, lost) | Records what happened | Available | features.md |
| Learn | "What we've learned": findings you approve one by one | Huntloop proposes, you decide | Available | `/learn` |
| Learn | Memory: what Huntloop knows about your business | Facts you add, documents you upload | Available | `/memory` |
| Learn | Personal learning (Settings → You) | Learns your preferences | Available | `/settings/you` |
| Learn | Prospect demand themes | Groups what prospects ask for and object to | Available | `/demand` |
| Learn | Performance report, "Is the loop working?" | Plain numbers on how outreach is going | Available | `/performance` |
| Learn | Ask Huntloop (workspace assistant) | Chat about your whole workspace | In development (partial) | `/assistant`, pass-20 PANEL-306 |
| Learn | AI spend and engine health screens | See cost and background work | Available | `/analytics`, `/ops` |
| Trust & control | Emergency stop for sending/AI/providers | One switch stops everything | Available (operator-only) | guide §4 |
| Trust & control | Privacy: erase a contact, export, delete workspace | Control over data | Available | `/settings/privacy` |
| Trust & control | Daily "Needs you" digest and other emails | Reminders by email | Available (needs email key) | guide §8 |
| Trust & control | Plans with usage limits (Free / Growth / Scale) | Limits per plan are tracked and enforced | Available | plans-and-quotas.md |
| Trust & control | Payments / checkout | Pay for a plan | Planned (decision pending) | gap report MIS-01 |
| Trust & control | MFA, SSO, SCIM; record-level search | Enterprise login; search all records | Planned (not started) | gap report MIS-02, MIS-05 |
| Exchange | Buyers state a need via a guided AI questionnaire | "I need X" turned into a clear request | In development (built, switched off) | `exchange/new/IntakeFlow.tsx`, `intake-turn.ts`, `lib/exchange/flag.ts` |
| Exchange | Supplier profile; AI reads the supplier's site | Businesses list what they offer | In development | `exchange/supplier`, `read-supply-page.ts` |
| Exchange | Matching with explained match | Needs matched to suppliers, with reasons | In development | `explain-match.ts` |
| Exchange | Visibility levels: counted only / anonymous card / open to intros; reveal log; data export | Buyers stay anonymous until they choose | In development | `exchange/privacy` |
| Exchange | Introductions, messaging, outcomes | Both sides agree before they talk | In development | `exchange/intros`, commit `04be4c0` |
| Exchange | Market demand view (category shows at 10+ open requests) | Suppliers see demand trends | In development | `exchange/market` |
| Exchange | Alerts, Updates feed, notification settings, report button, trust & safety | Keeping both sides informed and safe | In development | commits `13f99b4`, `ba5c981` |
| Exchange | Separate buyer website (front door "/find") | A home page for buyers | In development | `(marketing)/find`, `buyer-host.ts` |
| Exchange | Stated needs feed the seller pipeline as the strongest "why now" | A real, declared need becomes an opportunity | In development | marketplace-spec §1, commit `04be4c0` |
| Future | Two-way discovery network for anyone (individuals, freelancers, manufacturers, resellers) | Anyone says what they want, Huntloop finds the match | Planned (exploration) | `discovery-network-exploration.md` §6 |
| Future | Individual consumers as buyers (C2B-style) | People, not just companies, can ask | Planned (exploration, decision EX-6) | same, §6.2, §9 |
| Future | Web3 signal packs | Clues for the Web3 market | Planned | gap report MIS-11 |
| Future | In-app notification centre | Notices inside the app | Planned (optional) | gap report MIS-12 |

## Left out on purpose
- Internal infrastructure, security findings, vendor-key details, founder personal data.
- Exact prices (pricing/plan names awaiting decision DEC-03).

## Not verified
- The live public site (huntloop.pro) was not fetched; brand and copy were taken from the code
  that serves it (`(marketing)/page.tsx`, `packages/ui/src/tokens.css`, `brand.ts`).
- No feature was run against live AI, email, CRM or data providers (none configured in production).
