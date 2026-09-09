# Twelfth pass — what shipped

**Date** 2026-09-09 · **Plan** [PLAN-12.md](PLAN-12.md) · **Program** [README.md](README.md)

The plan is the argument; this is the record of what was built against it, what
changed while building it, and what is still open. Written because the plan was
written before any of it existed and is now, in places, wrong about its own
sequencing.

---

## 0. The three defects this pass closed

**`ONB-01` — onboarding persisted nothing.** Four screens of questions wrote
two rows (`organizations`, `memberships`). The product research, the ICP and
the accepted sources lived in `sessionStorage`, and the final step called
`clearDraft()` on its way to the dashboard. A user answered every question and
arrived at a workspace that knew their organisation's name and nothing else.

**`NAV-01` — nothing routed anyone to `/welcome`.** `auth/callback` forwarded
to `safeNextPath(next)`, which defaults to `"/"`, and `app/page.tsx` redirected
`"/"` to `/login`. The last step of a successful sign-up was a redirect back to
the sign-in page. No code anywhere answered "which organisation does this
person belong to".

**`ICP-02` — the ICP step was hardcoded and said it wasn't.** It opened with
`useState(["Crypto trading desks"])` and three fixed triggers, under a heading
reading *"Drafted from your website."* Every customer, whatever they sold, was
shown one crypto-infrastructure company's profile and invited to correct it.

---

## 1. Migrations

| # | What | Why it was needed |
|---|---|---|
| `0024_onboarding` | `profiles.role`, `profiles.onboarded_at`; `organizations.onboarding_step`, `.onboarding_completed_at`, `.goals`; `advance_onboarding()` | Nothing recorded who the user was or how far a workspace had been configured |
| `0025_anonymous_research` | `public_research` + `claim_research()` + `purge_expired_research()` | The domain-first funnel researches a visitor before they have a tenant to key the row on |
| `0026_product_research` | `products.research`, `.researched_at`, `.research_is_live` | **Discovered while building.** `research_company` establishes five things; `products` had a column for one. `draft_icp` closes its citations to those five sentences, so persisting two of them meant a re-draft silently produced a thinner profile |

A fourth, `0027_org_directory`, arrived with `ONB-14` — see §4.

All four are verified by `verify-migrations.ts` against PGlite: **227 checks,
up from 192**. The assertions cover the backfill predicate, every CHECK
constraint, the tenant boundary inside `advance_onboarding`, the one-way
`onboarding_completed_at`, the "RLS on, no policy" posture of
`public_research`, and — for `0027` — that a colleague at the same email domain
finds the workspace while somebody at another domain finds nothing.

### The deploy-order problem, and the fix

Code and migrations do not land atomically. Building this surfaced a failure
that would have hit every existing customer: `listMemberships` selects
`onboarding_step`, PostgREST answers `42703`, the query returns no rows,
`resolveDestination` concludes the user belongs to no organisation, and
everybody is walked into onboarding for a workspace they already have.

`lib/data/onboarding-schema.ts` treats the new columns as a **capability**,
probed once per process exactly as `isSchemaApplied()` treats the schema as a
whole. Before the migration the product behaves as it did before this work;
after it, everything switches on with no second deploy. Verified against the
live database, which is at `0023`.

---

## 2. The flow, end to end

```
/                     landing page (was: redirect to /login)
  → /discover?d=      anonymous research, behind PUBLIC_RESEARCH_ENABLED
  → /signup?d=        copy adapts; domain travels as `next`
  → /auth/callback    resolveDestination() — the 40 lines that did not exist
  → /welcome          1 · you: name + role
  → /welcome/company  2 · website → research → review → products row
  → /welcome/goals    3 · what you want + how you reach people
  → /welcome/icp      4 · draft_icp, editable, reach counter, personas
  → /welcome/sources  5 · recommended + your own, written with recommended_by
  → /welcome/building 6 · five stages, each degrading independently
  → /welcome/review   7 · three companies, scored, cited
  → /<org>/dashboard  laid out by role and goal
```

Every step writes on submit, to the table the product already reads. Leaving
halfway leaves a partially configured workspace, not a lost session.

---

## 3. What changed from the plan

**`0026` was not in the plan.** See the table above. The plan explicitly
accepted losing the claim provenance and argued there was nowhere honest to put
it; that was wrong, and the right home is the product row the research
describes.

**The sources gate moved rather than tightening.** The plan said to gate on
"sources **or** a non-empty discovery translation". In practice the screen now
does not block at all — it says what is lost. Sources catch triggers;
discovery finds companies, and a workspace with a searchable profile has a full
pipeline without a single feed.

**Personalization sections were renamed.** The plan's list (`attention`,
`outcomes`) did not match the dashboard's actual sections. Corrected to
`whyNow`, `counts`, `loop`, `capacity`, `signals` while wiring it up.

**The landing page shows in demo mode.** The plan implied redirecting a
database-less deployment straight to the fixture workspace. That makes the
landing page unreachable on exactly the setup every reviewer runs.

**Every onboarding save succeeds without persisting in demo mode.** Refusing
made the remaining four screens unreachable on a fresh checkout — the same call
the original `createOrganisation` made, for the same reason.

---

## 4. The seven that were open, and are now closed

Listed in the order they were built, with what each turned out to require.

| ID | What shipped |
|---|---|
| `ONB-11` | **Look-alike discovery.** `packages/jobs/src/look-alike.ts` enriches up to five named domains and folds their industry, technologies and size into the discovery filters. Built as an enrichment fold rather than a vendor similar-company endpoint: it uses a capability the adapter already declares, the result is inspectable ("added Financial Services because stripe.com and ramp.com share it"), and it degrades to nothing with no provider. **Widen, never narrow** — a stated size band is extended to cover an example, never replaced. The examples themselves are added to `excludeDomains`, since surfacing somebody's own named account back to them is not a discovery |
| `ONB-12` | **Default scoring rules.** A sixth stage on the building screen calls the existing `draftRulesAction`. Rules land **inactive**, as that action already enforces, and the review screen surfaces them — a proposal nobody is told about is a proposal in a settings page nobody opens |
| `ONB-13` | **Agency branch.** The company step asks agencies whether the workspace is for a client or for themselves, and changes the heading, label, placeholder and button accordingly. It stores nothing extra; what it changes is *which domain gets entered*, which was a silent trap — an agency owner typing their own address gets a coherent, wrong ICP for selling agency services |
| `ONB-14` | **Domain-collision detection**, plus the join request it implies. Migration `0027`: `organizations.primary_domain` / `is_discoverable`, `discoverable_workspaces()`, a `join_requests` table, `request_to_join()` and `approve_join_request()`. Detection appears on the company step *above* the form — the last screen before a duplicate exists — and admins decide on the team page |
| `ONB-15` | **Progressive learning prompts.** `lib/data/nudges.ts` returns at most one, from signals already recorded (`human_overrides`, `outcomes`, `opportunities.status`, `icp_versions`). Floors are high enough that a handful of clicks cannot trip them, and a rejection streak outranks a first reply outranks accumulated approvals |
| `ONB-16` | **ICP quality nudge.** Recomputed with `scoreIcp` rather than read from `quality_score`, because the settings screen writes `criteria` without touching the column — a stored score would be stale the moment somebody edits. Two suggestions, not nine. Dismissible per score, so a changed profile surfaces fresh advice |
| `ONB-17` | **Programmatic surface**, as four hand-written pages at `/for/[useCase]` with `dynamicParams = false`, so `/for/anything-else` is a 404. Each carries a usable profile shape and a **caveat naming where Huntloop is the wrong tool**. `/compare/[alternative]` was deliberately *not* built: an honest comparison needs checked facts about somebody else's product, and what we would actually produce is a table where our column is researched and theirs is guessed |

### Also fixed in this pass

- **The flaky test.** `spend-guard.test.ts` was tripping the 5s default because its first case pays to transform `@huntloop/ai` behind a dynamic import — 2.4s warm, 26s cold. Raised to 30s with the reasoning recorded, rather than pre-importing, because the dynamic import is load-bearing: the module must evaluate *after* `vi.mock` or the wrapper closes over the real `runTask`.
- **`draft_icp` had no spend-guard test.** Every other model wrapper has one; the file exists because a grep cannot tell a correct guard from a subtly wrong one. Added.
- **`/for/*` was not in the proxy's public prefixes**, so every use-case page answered 307 to `/login` — marketing content submitted in the sitemap and invisible to the audience it was written for. Caught in the browser, not by any check.
- **The sitemap** now carries `/` and the four use-case pages, enumerated from the same list that renders them. Its note about `/` being deliberately excluded is gone, because the reason (it redirected) is gone.

---

## 5. The last four

| ID | What shipped |
|---|---|
| `ONB-18` | **Per-client usage on the workspace switcher.** Not billing — there is none. `subscriptions` has existed since `0001` and nothing reads it; the Stripe variables are reserved and unused. Building a "billing group" on top of a billing system that does not exist would be a speculative abstraction whose first real requirement would break it. What an agency actually needs to invoice a client is *what that client used*, and `usage_counters` already records it. `/orgs` now shows this month's opportunities, AI runs, enrichments and emails per workspace — one query, scoped by `usage_read`. The `/for/agencies` caveat was rewritten to say exactly this rather than "not built yet" |
| `ONB-19` | **`/compare/[approach]` — four pages, comparing approaches rather than named products.** The earlier refusal was about *vendors*: an honest comparison needs current checked facts about someone else's software, and what we would produce is a table where our column is researched and theirs is guessed. "A list tool", "an autonomous AI SDR", "hiring an SDR" and "doing it by hand" are categories defined by what they structurally are, so every claim is checkable and stable. Each page **opens with what the other approach is genuinely better at** and closes with **when to choose it instead** — a comparison whose every row favours us is an advert wearing a table's clothes |
| `ONB-20` | **"What this searches for" on the ICP settings screen.** No saved-search editor exists, so this went where the profile is edited. It reads the stored `discovery_queries` row — what actually runs, not what would run — and shows three things nothing rendered before: the search as a sentence, the criteria `translateIcp` could not map (with what handles them instead), and **what the example companies added**, computed as the diff between the profile's own translation and the stored filters |
| `ONB-21` | **The rejection-streak nudge on the opportunity detail page.** Only that kind: it is a question about verdicts, and this is the page where a verdict gets overruled. The other two are milestones about the pipeline and would be a non-sequitur beside one company. Dismissal is shared with the dashboard by key, because it is the same question |

### Also fixed

- **`/compare` was missing from the proxy's public prefixes**, the same class of bug as `/for` in the previous round — a page in the sitemap that answers 307 to `/login`.
- **`toLowerCase()` mangled an acronym**: "When to choose an autonomous ai sdr instead". Replaced with an explicit `labelInSentence`, because lowercasing is the wrong tool for a string that contains one.
- **The comparison pages are linked from the footer.** A page in the sitemap that nothing links to is orphaned to crawlers and unfindable by readers.

---

## 6. Still open

| ID | What | Why |
|---|---|---|
| `BILL-01` | Billing, at all | Not a gap in this work — `subscriptions`, `plans` and `usage_counters` exist and are enforced by `usage_limit()`, but nothing charges anybody. Stripe is env-vars-only. This is the real prerequisite behind the agency invoice question |
| `ONB-22` | ~~Look-alike preview before saving~~ | **Closed in the [thirteenth pass](PASS-13.md).** A button on both the onboarding ICP step and the settings editor runs the real expansion against the criteria as currently edited, and reports what it would add without saving anything |

---

## 7. Verification

| Check | Result |
|---|---|
| `npm run typecheck` (6 workspaces) | clean |
| `npm run lint` | clean |
| `npm test` | 964 checks across 8 suites, all passing |
| `verify-migrations` | 227/227 |
| `verify-tasks` | 198/198 (18 new, for `draft_icp`) |
| `npm run audit:site` | 39 checks, 0 failing, 0 warnings |
| `npm run build` | succeeds, 49 routes |
| `npm run audit:bundle` | 245.1 kB of 275 kB |

**Walked in a browser:** landing page, `/discover` (disabled path), `/signup`
with a carried domain, all seven onboarding screens including the drafted ICP
with its basis lines, the building screen and the review screen; `/for/agencies`
and `/compare/ai-sdr` rendering in full, `/for/anything-else` returning 404, and
the sitemap carrying 11 URLs — `/`, four use cases, four comparisons, signup and
login.

**Not verified:** anything requiring `0024`–`0027` against a live Postgres, and
anything requiring `ANTHROPIC_API_KEY` or `APOLLO_API_KEY` — so the live
`draft_icp`, the reach counter's real number, look-alike expansion against real
provider data, and the first-run stages producing actual companies are all
untested outside PGlite and worked examples. Those are named in the handover.
