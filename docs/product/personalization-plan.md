# Personal mode, adaptive onboarding and the learning layer — implementation plan

Status: **Proposed** (2026-10-07). Not yet in COMMAND.md §16; add it as §16.3-K once accepted.

## 1. Goal

Huntloop should work like a personal research and work assistant. Today it works like a company workspace that one person happens to configure. It should:

1. let an individual start using it without being sent through "Research my company";
2. ask only the questions a task needs, when the task needs them;
3. learn from how each person works (corrections, decisions, writing, research habits, preferred outputs) and need fewer instructions over time;
4. keep four kinds of knowledge apart: **stated**, **learned**, **this task only** and **long-term**;
5. let people see, understand, correct, pause and delete what it has learned.

## 2. What exists today (verified in the code, 2026-10-07)

| Area | Today | Gap |
|---|---|---|
| Entry | `createWorkspace(url)` in `welcome/actions.ts` requires a website. Onboarding runs You → Company research → Goals → ICP (6 required fields) → Sources → Building → Review | No way in without a company domain. Every user sees the same 5 steps. `create_organization` (`0030`) already accepts `p_domain = null`, so the block is in the app layer only |
| Who the person is | `profiles.role` (closed set of 7), `profiles.onboarded_at` | Goals live on `organizations.goals`, so teammates share one set of goals. There are no per-person goals, preferences or working style |
| Memory | `memories` has scope (org/team/user/account/opportunity), `kind` (durable/conversational), `source` (user/derived), `confidence`, `expires_at`, tags. Retrieval goes through `applicableMemories` in `packages/db/src/memory.ts` | **A personal memory is not private**: the generic `tenant_read`/`tenant_write` policy (`0004` l.337) lets every member read *and edit* user-scoped rows. Nothing records why a memory exists, how many observations support it, or when it was last confirmed |
| Outreach drafting | `loadGuidance` (`advance-enrollments.ts:613`) passes org voice + org-scope durable memories to `personalize_message` | The sender's own preferences are never read, so a personal "keep it under 80 words" cannot reach the writer |
| Corrections | Draft edits keep the AI original (`original_subject`, `original_body_text`, `edited_at`, `0037`); rejections are recorded (`draft_rejected` activity); score overrides go to `human_overrides` | **Nothing learns from draft edits**: no job reads `original_body_text`. Overrides reach the 90-day org-level `analyze_performance`, not a per-person model |
| Learning loop | `analyze_performance` → findings with citations → human Accept → inactive rule or memory (`/learn`) | Org-level and batch only. The accept/decline-with-citations pattern is good and should be reused |
| Co-pilot | `workspace_assistant` answers from records, can *propose* a memory, keeps a personal conversation (RLS, `0041`) | Its corrections ("shorter", "use bullets") are not captured as signals |
| Control | `/memory` shows "You wrote" / "Huntloop concluded"; derived entries can be removed but not edited | There is no per-person view, no evidence, no pause, no "this task only", and no promote-to-workspace |

## 3. What to add beyond the request

These are what make a learning layer trustworthy instead of unsettling:

1. **Evidence for every learned item.** "Learned from 4 of your edits" with links to those edits. Without this, people can't tell a pattern from a guess. Huntloop already does this for findings.
2. **A risk class that decides whether something may apply itself.**
   - *Low risk* (writing style, format, length, sign-off, list sort, dashboard layout): apply automatically, label it "Learned", one-click undo.
   - *High risk* (who to target, ICP, scoring, sources, send cadence, who gets contacted): never applied automatically. Proposed and accepted like a Learn finding. This keeps the existing non-negotiable that rules are saved inactive.
3. **Show what was applied.** Every AI output gets a "Written with" disclosure listing the preferences used ("your short-email preference · workspace tone: direct"), each with a **Don't use this** control. That control is the correction surface, and it is also a training signal.
4. **A fixed precedence order, shown to the user:** this task's instruction > what you told us > what we learned about you > workspace policy > defaults. When a lower item is overridden, say so; never blend two conflicting items silently.
5. **Decay and contradiction.** A learned preference that isn't reinforced for 90 days loses confidence. Two contradicting signals demote it to "unsure" and trigger a question instead of a guess.
6. **Personal by default, shared by choice.** A person's learned preferences are private. An admin can promote one to workspace policy ("Make this the team's style"), and the promotion is recorded.
7. **Learn only from the user's own actions.** Prospect emails, websites and imported files are never a source of preferences. That would be a prompt-injection path straight into every future prompt. Use the existing `untrusted.ts` wrapping.
8. **A question budget.** At most one question per screen, a small daily cap, never ask again once answered or dismissed, always skippable, and "ask me later" is a real state.
9. **Global controls.** Pause learning, "this task only" mode for a single request, reset, and export. Export plugs into the data-rights work in `0029`.
10. **Proof that it is working.** Track, per person, how much they edit drafts over time, how often they regenerate, and how many questions they are asked per active day. "Requires less instruction" becomes a measurable number.
11. **Task-first entry.** "What do you want to get done first?" (research an account, find companies like X, write outreach, import a list, set up my company's workspace). This gets someone to first value in one step, and company research becomes one of the options.

Deliberately **not** included: inferring sensitive attributes (age, gender, health, politics, and so on), learning across tenants (master context §54), tracking time spent in the app (already rejected in §16.6), and free-form "the AI decides what to remember about you" without a typed category.

## 4. Model: four kinds of knowledge

| Kind | Where it lives | Lifetime | Example |
|---|---|---|---|
| **Stated** | `memories` with `origin = 'stated'` | Until changed | "I sell to hospitals in the EU", "Sign off as Arpit" |
| **Learned** | `memories` with `origin = 'learned'`, plus `memory_evidence` rows | Decays without reinforcement | "Cuts drafts to ~70 words" (from 5 edits) |
| **This task only** | The request payload (draft request, assistant turn, analyze run). **Never written to `memories`** | Ends with the task | "Make this one formal, it's a CFO" |
| **Long-term** | Stated or learned, `status = 'active'` | Persistent | Any of the first two once confirmed |

A "this task only" instruction gets a **Remember this** button that promotes it to stated. Repeating the same task-only instruction 3 times creates a learned *proposal* ("You've asked for formal tone with CFOs three times — always do that?").

## 5. Data model changes

### 5.1 Extend `memories` (reuse it, don't fork it)

```sql
alter table memories
  add column origin       text not null default 'stated'
    check (origin in ('stated', 'learned', 'promoted')),   -- replaces the meaning of source over time
  add column category     text
    check (category in ('writing_style', 'output_format', 'research', 'targeting',
                        'workflow', 'context', 'interface')),
  add column risk         text not null default 'low' check (risk in ('low', 'high')),
  add column status       text not null default 'active'
    check (status in ('proposed', 'active', 'paused', 'rejected')),
  add column applies_to   text[] not null default '{}',     -- task names: personalize_message, workspace_assistant, …
  add column support      int not null default 0,           -- consistent observations
  add column contradicts  int not null default 0,
  add column last_reinforced_at timestamptz,
  add column last_applied_at    timestamptz,
  add column promoted_from uuid references memories(id);
```

`source` stays for backward compatibility; a backfill sets `origin` from it (`user` → `stated`, `derived` → `learned`).

### 5.2 New tables

- **`preference_signals`**: append-only observations of the user's own behavior. Columns: `org_id, user_id, kind` (`draft_edited`, `draft_rejected`, `draft_regenerated`, `assistant_correction`, `score_override`, `disqualified_with_reason`, `filter_used`, `export_format`, `question_answered`, `applied_pref_dismissed`), `subject_type/subject_id`, `features jsonb` (computed deterministically, e.g. word delta, greeting changed, bullets added), `created_at`. Owner-only RLS. Pruned after 180 days.
- **`memory_evidence`**: `(memory_id, signal_id)`, the citations behind a learned memory.
- **`user_questions`**: `org_id, user_id, question_key, status` (`pending`/`asked`/`answered`/`dismissed`/`snoozed`), `asked_at, answered_at, snooze_until, answer jsonb, context jsonb`. Owner-only RLS. Unique on `(org_id, user_id, question_key)`.
- **`profiles` additions**: `goals text[]` (personal goals; `organizations.goals` stays as what the scheduler reads), `learning_paused boolean default false`, `workspace_intent` (`individual`/`team`/`agency`).

### 5.3 RLS fix (blocker, ship first)

Replace the generic policy on `memories` with:
- `scope = 'user'` → read/write only when `scope_id = auth.uid()`; admins **cannot** read colleagues' personal rows (same reasoning as conversations in `0004`).
- Other scopes keep `tenant_read`, and keep `has_org_role(member)` for writes.
- A `promote_memory(p_id)` SECURITY DEFINER RPC copies a personal row to org scope when the caller is admin **and** the owner has shared it (`status`/flag set by the owner).

Update `erase`/export functions (`0029`, `0037` l.881) to include the new tables.

## 6. Components

### 6.1 One resolver, like `applicableMemories`

`resolvePreferences(db, { orgId, userId, task, accountId?, opportunityId?, temporary?: string[] })` in `packages/db/src/preferences.ts` returns an ordered, de-conflicted list:

```ts
{ text, kind: 'task' | 'stated' | 'learned' | 'workspace', category, memoryId?, confidence, evidenceCount }
```

Rules: filter by `status = 'active'`, by `applies_to` containing `task` (or empty), and by decay-adjusted confidence ≥ threshold. Order by precedence. Within a category a higher-precedence item suppresses a conflicting lower one, and the suppressed item is returned with `suppressedBy` so the UI can explain it. Cap at about 12 items, chosen by category relevance to the task, to bound tokens.

Every AI task that writes for a person takes `preferences` and wraps it in its own labelled block. `loadGuidance` in `advance-enrollments.ts` calls the resolver for the **campaign owner** (the person whose name is on the email), which fixes the gap where the sender's preferences are ignored.

### 6.2 Signal capture (deterministic, no AI)

| Signal | Producer (exists?) | Features |
|---|---|---|
| Draft edited | `editDraftAction` (exists) → write signal | word count before/after, subject length, greeting/sign-off changed, bullets, sentences removed, phrases deleted (n-gram diff) |
| Draft rejected | rejection path (exists) | reason if given |
| Draft regenerated with a note | new "Regenerate with a note" control on drafts | the note text (temporary instruction) |
| Assistant correction | `askAssistantAction` follow-ups matching a correction pattern ("shorter", "bullets", "don't…") | the instruction text |
| Score disagreement | `human_overrides` (exists) | field, direction |
| Disqualify / lost reason | outcomes (exists) | reason |
| List filter / sort / export | list pages, CSV export | which filter, which format |
| "Don't use this" on an applied preference | new control | memory id → `contradicts += 1` |

Signals are written only when `learning_paused` is false and the action came from the user, never from content the user is reading.

### 6.3 Learner job `learn_preferences`

`packages/jobs/src/handlers/learn-preferences.ts`, scheduled from `/api/jobs/tick` per user with ≥5 new signals or 7 days since the last run; budgeted through `budget.ts`.

1. **Deterministic pass first.** Aggregate features, for example median word reduction ≥ 25% across ≥3 drafts on ≥2 opportunities produces the candidate "Keep first-touch emails under N words". Many style preferences need no model at all.
2. **Model pass** (`packages/ai/src/tasks/infer-preferences.ts`) for what features can't express (phrases removed, tone shifts, recurring assistant corrections). Its input is signals only, with edit texts wrapped as untrusted. Its output is typed candidates `{category, text, appliesTo, signalIds[]}`. Every candidate must cite ≥3 signal ids; an uncited candidate is dropped, which matches how findings already work.
3. **Merge.** If a candidate matches an existing memory, reinforce it (`support++`, `last_reinforced_at`). If it contradicts one, increment `contradicts`; when `contradicts ≥ support`, set the memory to `paused` and queue a question.
4. **Apply by risk.** Low-risk candidates become `active` learned memories and the user is told ("I noticed…", with Undo). High-risk candidates become `proposed` and appear on the control page and in Needs you.
5. **Decay.** Nightly: confidence = f(support, contradicts, days since reinforced). Below the floor, the memory stops being applied but is still listed as "fading".

### 6.4 Question planner

A **typed catalog** in `apps/web/lib/questions/catalog.ts`, not free model generation:

```ts
{ key: 'outreach.signoff', category: 'writing_style', ask: 'How do you sign your emails?',
  input: 'text', when: { firstTime: 'draft_review' }, skipIf: (ctx) => ctx.prefs.has('signoff'),
  unlocks: ['personalize_message'], writesTo: { category: 'writing_style', appliesTo: ['personalize_message'] } }
```

`nextQuestion(ctx, surface)` returns at most one question for the current surface. It respects the budget (1 per screen, 3 per day by default), `user_questions` state and `skipIf`. A model may **rephrase** a question with context ("You're writing to a hospital — should I mention HIPAA?") but cannot invent new keys. This keeps it testable and prevents question spam.

Surfaces: onboarding (task-first), first draft review, first ICP edit, Analyze a URL, Ask Huntloop, an empty dashboard. Answers are written as `stated` memories.

### 6.5 Adaptive onboarding

New flow:

1. **You**: name, role (existing), plus *"How will you use Huntloop?"* → Just me / My company's team / Clients (agency). This sets `workspace_intent`.
2. **First job**: *"What do you want to get done first?"*
   - Research a company or account → workspace created **without a domain** → `/analyze` with the URL.
   - Find companies that fit → asks only what discovery needs (who you sell to, plus 2–3 ICP fields). The rest becomes optional and is asked later by the planner.
   - Write or improve outreach → product one-liner + tone question → draft.
   - Ask about my pipeline / import a list → `/imports`.
   - Set up my company's workspace → today's full flow (company research → goals → ICP → sources → building).
3. **Land in the workspace** with the first job running. Everything not yet known becomes a planner question.

Implementation notes:
- `createPersonalWorkspace(name)` calls `create_organization(p_slug, p_domain => null)`; slug from the person's name, with collision handling via the existing slug helper.
- `onboarding_step` gains `'intent'` and `'first_job'`. `done` is reached as soon as the first job starts. `resolveDestination` and the `/welcome` forwarding rules change accordingly.
- Required-field gates move from the ICP step to **the features that need them**. Discovery refuses to run without an ICP and offers the missing questions inline. Company research stays available from Settings → Product ("Read my website").
- Join-existing (`discoverable_workspaces`) is still offered on the team path.
- Dashboard `personalize()` reads personal goals first, then org goals.

### 6.6 "What Huntloop knows about you" (control center)

New page `/{org}/settings/you` (rail: Settings → You), plus a link from the account menu. Sections:

- **You told us**: stated items, editable; category, where it applies, last used.
- **Learned from how you work**: each item shows "from N observations" (expand to see them, linked), confidence, last reinforced, and controls **Correct** (edit → becomes stated), **Pause**, **Forget**; admins also get **Share with workspace**.
- **Waiting for you**: proposed high-risk items (Accept / Decline), and questions you snoozed.
- **Workspace policy**: read-only for members; shows which items override yours.
- Controls: **Pause learning**, **Reset learned items**, **Export**.

Existing `/memory` remains the workspace knowledge base (documents, account notes). The two pages link to each other, and personal rows no longer appear on `/memory`.

On each AI output, a "Written with ▸" disclosure lists applied items with **Don't use this** (pause for this task, or always).

## 7. Phases

| Phase | Contents | Size | Risk | Ships value alone? |
|---|---|---|---|---|
| **K0 Foundations** | RLS fix for personal memories; `memories` columns + backfill; `preference_signals`, `memory_evidence`, `user_questions`; `resolvePreferences`; route `loadGuidance` through it (sender preferences reach drafts); export/erase coverage; metrics events | M | Medium (RLS on a live table) | Yes: privacy fix + sender preferences |
| **K1 Individual entry** | Intent + first-job steps; domain-less personal workspace; feature-level gates instead of onboarding gates; personal goals; `resolveDestination` and `/welcome` rules; COMMAND.md §4 rewrite | M–L | **High** (router, onboarding state machine) | Yes: the headline ask |
| **K2 Control center** | `/settings/you`; "Written with" disclosure on drafts and assistant answers; Remember this / Don't use this; pause learning | M | Low | Yes: people can already state preferences |
| **K3 Learn from corrections** | Signal capture for draft edit/reject/regenerate and assistant corrections; deterministic style learner; `infer_preferences` task; reinforcement, contradiction, decay; "I noticed…" notices | L | Medium (AI output quality, cost) | Yes: the self-learning promise |
| **K4 Just-in-time questions** | Catalog, planner, budget, surfaces; onboarding questions moved into the catalog | M | Low | Yes |
| **K5 Broader learning** | Research patterns (what they analyse, which fields they open), output formats, filters/sorts as defaults, recurring tasks ("You check new hot opportunities every Monday — put them in your digest?"), high-risk proposals for targeting from overrides | L | Medium | Yes |
| **K6 Measurement** (runs from K0) | Per-user edit-distance trend, regenerate rate, undo rate, questions/day, time-to-first-value; eval set for `infer_preferences` in `packages/ai/scripts/verify-tasks.ts` | S–M | Low | Proves it |

Order: **K0 → K1 → K2 → K3 → K4 → K5**, with K6 instrumented from K0. K2 comes before K3 deliberately: people must be able to see and undo what is learned before anything learns automatically.

## 8. Acceptance criteria

- A new user can sign up, choose "Just me" and "Research a company", and see a research result **without entering their own company's website**, in ≤ 3 screens.
- No onboarding path asks more than 4 questions before the first result; every later question is skippable and never repeated once answered or dismissed.
- A teammate (including an admin) cannot read another person's personal memory through the API (RLS test).
- After 3 drafts where a person cut ≥ 25% of the words, the next draft is shorter, the disclosure says why, and one click undoes it.
- A high-risk learned change (ICP, scoring, targeting) is never applied without an explicit accept.
- A task-only instruction never appears in `memories` unless the person pressed Remember this.
- Pausing learning stops new signals immediately; Forget removes the memory and its evidence links.
- Every learned item shows ≥ 3 cited observations.
- Median per-user draft edit distance falls over a user's first 4 weeks (tracked metric, not a release gate).

## 9. Tests

- **DB**: RLS for personal memories, signals and questions (owner yes; colleague and admin no); `promote_memory` rules; erase/export include the new tables.
- **Unit**: resolver precedence and conflict suppression; decay function; deterministic feature extraction from edit diffs; planner budget and `skipIf`.
- **AI**: `infer_preferences` rejects uncited candidates; prospect text inside signals cannot create a preference (injection fixtures).
- **E2E** (`e2e/`): individual signup → research a company → workspace; full company path unchanged; draft edits ×3 → learned preference shown → undo.

## 10. Regressions to watch

- `resolveDestination` and `/welcome` forwarding (M-02-class bugs): existing users at any `onboarding_step` must land where they do today.
- Scheduler jobs that assume every org has an ICP or a domain (discovery, `research_company`, look-alikes) must skip cleanly for personal workspaces.
- Prompt size and cost for every task that gains `preferences`; watch AI spend after K0 and K3.
- Existing user-scoped memories created by colleagues on someone's behalf become invisible to their author after the RLS fix. Migrate them to `account`/`organization` scope or notify, decided in K0.

## 11. Decisions for the owner

1. **Auto-apply low-risk learned preferences?** Recommended: yes, labelled with one-click undo. The alternative (always ask first) is safer but defeats "requires less instruction".
2. **Should personal preferences follow a person across workspaces** (agencies, people in two companies)? Recommended: not yet. Keep them workspace-scoped (`memories.org_id` is required), and revisit with a user-global table if agencies ask.
3. **Can a personal workspace become a team workspace later?** Recommended: yes, by inviting people into it. There is no merging of two workspaces.
4. **Plan gating.** Is the learning layer on every plan? Recommended: stated preferences and the control page on every plan; automatic learning possibly Professional+.
5. **Existing user-scoped memories written by colleagues:** convert them to account scope, or keep them visible to the author only?
