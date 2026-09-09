# Thirteenth pass — the two that were open, and one that was hiding

**Date** 2026-09-09 · **Previous** [PASS-12.md](PASS-12.md) · **Program** [README.md](README.md)

A short pass. It began as the last implementable item on the twelfth pass's
open list and turned up two defects on the way — one a silent data loss that
had been shipping, one a regression introduced by the twelfth pass's own final
commit.

---

## 1. `ICP-03` — the settings editor deleted ten criteria it never showed

**The defect.** `criteria` has fifteen keys (`0013`). The ICP settings form
renders five. `saveIcpAction` wrote the object wholesale:

```ts
criteria: { segments, sizes, regions, triggers }
```

So a user who finished onboarding with industries, technologies, an employee
range, pain points and use cases — every one of them drafted from their own
website, reviewed on screen, and scored against — and who then came back to fix
a typo in the profile's name, lost all of it.

**Why nothing caught it.** Nothing failed. `parseCriteria` degrades a missing
key to `null`, which is correct behaviour for a profile written by an older
version of the schema, and `mapRecord` degrades it again to `[]`. There is no
error, no warning, and no visible change on the screen that caused it. The only
symptom is that scores quietly stop reflecting most of what the user said —
later, on a different page.

This is the same failure the ICP module's own header already warns about: the
seed once wrote `industries` / `employee_count` / `signals` while the only
reader looked for `segments` / `sizes` / `regions`, and because the reader
degrades a missing key to an empty list, nothing failed — "it just judged every
company against an ICP that asserted nothing." The warning was right, and the
form did it anyway.

**The fix.**

- An update now **merges**. It reads the stored `criteria` and
  `negative_criteria`, replaces only the keys this screen is authoritative for,
  and carries everything else through untouched. A create still writes the
  object as-is, because there is nothing to carry.
- `mergeStoredJson` in `lib/data/icp.ts` performs the merge and guards the
  jsonb. `criteria` is jsonb, so Postgres will hand back a scalar, an array or
  null as happily as an object: `{...null}` is `{}` — the erasure itself — and
  `{...["a"]}` is `{0: "a"}`, a row that parses as an object and asserts
  nothing. Eight tests in `lib/data/icp.test.ts` hold this down, including that
  an *owned* key can still be emptied, since "stated as none" is a real answer
  the form has to be able to give.
- Read-then-write rather than a jsonb merge in SQL: PostgREST cannot express
  `criteria || '{...}'` through the query builder, and the alternative was a
  `SECURITY DEFINER` function bypassing RLS to perform one object merge.
- **"Also on this profile"** now renders the preserved keys read-only under the
  form. Preserving a criterion that shapes every score and appears nowhere in
  the product would trade a silent deletion for a silent presence.

---

## 2. `ONB-22` — what the example companies add, before a search exists

The twelfth pass shipped "What this searches for", which reports the example
companies' contribution by diffing the *saved* `discovery_queries` row against
the profile's own translation. That is the right panel for a workspace that has
been running, and it is unreachable for the person the feature is aimed at:
somebody typing their first example domain has no saved query, so the panel
renders nothing and the field appears to do nothing. They find out what it did
on the next discovery run — after the search they are paying for has already
been widened using attributes they never typed.

**What shipped.** `previewLookAlikes` runs the real `expandWithLookAlikes`
against the criteria *as currently edited* and reports the result without
saving anything. It is on both screens that ask the question: the onboarding
ICP step, where the domains are first typed, and the settings editor, where
they are revised.

Three decisions worth recording:

- **It re-runs the expansion rather than predicting it.** A prediction is a
  second implementation that agrees with the first until one of them changes.
  Calling the real function means the preview is wrong only when the search
  would also be wrong — and enrichment is cached, so the discovery run that
  follows a preview of the same domains costs nothing extra.
- **It is a button, not a debounce.** The reach counter beside it updates as
  you type, because a provider's search endpoint returns a total for one row.
  This is up to five metered enrichments; running it on a pause in typing would
  spend five credits every time somebody thought about their third domain. A
  press is the honest interface for a call that costs something.
- **It reports partial failures individually.** `expandWithLookAlikes` says
  "none of these is a domain" only when *every* entry failed, which on a form
  leaves somebody who typed "Stripe" beside "ramp.com" with a result that looks
  like it used both. The preview separates what is not a domain, what fell past
  the five-company cap, and what could not be read just now.

**Also.** The settings ICP form had no example-companies field at all, so a list
set during onboarding could never be corrected. It has one now — which is what
`ICP-03` had to be fixed first for, since adding a sixth owned key to a form
that overwrote the whole object would have made the data loss worse.

---

## 3. `MIG-01` — the combined paste broke the migration verifier

The twelfth pass's final commit added `COMBINED-0024-0027.sql` to
`packages/db/migrations/`. `verify-migrations.ts` runs every `.sql` in that
directory in sorted order, so it applied the four migrations and then applied
them a second time inside the paste:

```
✗ COMBINED-0024-0027.sql
    error: trigger "public_research_touch" for relation "public_research" already exists
```

`npm test` had been red since that commit.

**The fix, and why it is not just a filter.** A migration is a file named
`NNNN_*.sql`, and the verifier now says so. But excluding the paste would leave
the artefact that *actually reaches production* as the only unverified SQL in
the project — nobody in this repository has the database password, so the four
migrations are applied by a person pasting one file into the Supabase SQL
Editor. So it is instead checked to **be** them: every migration's body present
verbatim, in order, inside one transaction. A hand-edit to the paste, or a
fifth migration nobody added to it, now fails here rather than in somebody's
production database.

Migration checks: **227 → 235**.

---

## 4. Also in this pass

- **`stepIcp` extracted to `lib/onboarding/icp-step.ts`.** Three things build
  an `Icp` from the ICP step's form — the save, the reach counter and the new
  look-alike preview — and the fifteen-key literal had already been written out
  by hand twice. A key added to one copy and not the other fails silently,
  because a missing key reads back as "not stated" rather than as an error.
- **`LookAlikeResult` in `app/_components/`.** Two route groups render it. It
  is not in `@huntloop/ui`, which deliberately knows nothing about this
  product's domain.
- **The demo refusal says the right thing.** `mutate` refuses with "there is
  nothing to save to", which is the wrong sentence for an action that saves
  nothing. Both preview actions now refuse with the actual reason: looking a
  company up is a metered provider call, and there is nowhere to meter it.

---

## 5. Still open

| ID | What | Why |
|---|---|---|
| `BILL-01` | Billing, at all | Unchanged from the twelfth pass, and deliberately not started here. `subscriptions`, `plans` and `usage_counters` exist and `usage_limit()` enforces them, but nothing charges anybody and Stripe is env-vars-only. What is missing is not plumbing — it is a price, a plan shape, and a decision about whether this charges per seat, per workspace or per credit. Building a payments integration around a guess at those is the one kind of speculative abstraction that takes real money when it is wrong |

---

## 6. Verification

| Check | Result |
|---|---|
| `npm run typecheck` (6 workspaces) | clean |
| `npm run lint` | clean |
| `npm test` | all suites passing; `apps/web` 105 tests across 7 files (was 97 across 6) |
| `verify-migrations` | 235/235 (was 227 — the paste adds 8) |
| `verify-tasks` | 198/198 |
| `check:admin-imports` | 207 files in `apps/`, 120 in `packages/`; the service-role client is still confined to 5 named files |
| `npm run audit:site` | 39 checks, 0 failing, 0 warnings |
| `npm run build` | succeeds, 49 routes |
| `npm run audit:bundle` | 245.1 kB of 275 kB — unchanged |

**Walked in a browser** (demo configuration, no database): the ICP settings
screen rendering the new example-companies field, its preview control and the
"Also on this profile" panel with the preserved criteria; the onboarding ICP
step with the same control behind "Sharpen it further", where adding
`stripe.com` enables the button and pressing it returns the metering refusal —
the full path from field to chip to server action to rendered answer.

**Not verified:** the preview against a real provider. `expandWithLookAlikes`
is unchanged and covered by the jobs suite, but how many credits a real
five-domain preview spends, and what Apollo actually returns for a well-known
domain, need `APOLLO_API_KEY` and migrations `0024`–`0027` applied. Both are
still in the user's hands.
