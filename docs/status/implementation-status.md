---
description: >-
  What is actually built, what is reachable, and the honest summary — verified
  by running the suites on 2026-09-16.
---

# Implementation status

> **Layer:** Internal · **Audience:** everyone

## Method

Every number here comes from running something, not from reading a plan.

```bash
npm run typecheck    # exit 0
npm test             # 1,024 assertions, exit 0
npm run audit:site   # 40 checks, 0 failing, 0 warning
npm audit --audit-level=high    # exit 0
```

Reachability claims come from cross-referencing `packages/jobs/src/queue.ts`
against every `enqueue()` call site in the repository.

## The headline

{% hint style="info" %}
**Huntloop is not an early prototype with a thin veneer.** It is a
well-architected system with an unusual amount of correctness machinery, whose
connective tissue is missing in a small number of specific, identifiable
places — and those gaps are concentrated almost entirely in **triggering**, not
in **doing**.

Four handlers with no caller. One cron that was never configured. One button
that was never built.

That is a genuinely good position to be in, and it is also why the product has
never been observed working end to end. Fixing the triggering layer is a matter
of days. Proving it works against live vendors is the gate everything else waits
behind.
{% endhint %}

## By the numbers

| | |
|---|---|
| Nav destinations | **19 / 19 built** |
| Migrations · tables · functions | 28 · 69 · 63 |
| Job handlers | 26 registered — **22 reachable**, 4 not |
| AI tasks | 12 — **0 verified against the live API** |
| Server actions | 71 |
| HTTP routes | 8 |
| UI components | 20 |
| Test assertions | 1,024 + 90 browser tests |
| Audit checks | 40 passing |
| `TODO` / `FIXME` markers | **0** |

## What works end to end today

* Sign-in — magic link (Google present, hidden in the UI)
* The org membership guard and its deliberate 404
* Invitations with seat-quota enforcement, and same-domain join requests
* Onboarding, all seven steps, resumable across devices
* First run — five stages, each degrading independently
* The analyze screen — a real qualification and why-now against a pasted URL,
  and saving the result as a real opportunity
* The opportunity list and detail pages, reading the database: the join, the
  evidence, the triggers, the buyers
* Every one of the 19 destinations, each either showing rows or saying it is not
* Scoring-rule authoring, preview and dry-run
* The learning review screen — findings approved one at a time
* AI spend analytics over `ai_runs`
* Engine health with retry and cancel
* Unsubscribe, suppression and cadence caps

## What is built and cannot be reached

### The four unreachable handlers

| Job | Consequence |
|---|---|
| `enrich_person` | Contact enrichment unreachable. Emails and phones are only acquired during first run |
| `resolve_entity` | **Deduplication never runs while discovery does** |
| `purge_contact_data` | GDPR erasure cannot be triggered |
| `sync_hubspot` | CRM sync has no trigger. Connecting HubSpot pushes nothing |

{% hint style="danger" %}
`resolve_entity` is the serious one, because it creates an **architectural
contradiction.** Migration `0012` argues in its own header that deduplication
"ships BEFORE any provider search does, and the plan makes that a hard ordering
constraint", on the grounds that "duplicates created at provider volume are the
one class of data defect that gets harder to fix with time."

`discover_companies` runs. `resolve_entity` does not. The constraint the
migration named as hard is currently **inverted** in production behaviour.

Downstream: `merge_candidates` is written only by `resolve_entity`;
`company_merges` only by `merge_companies()`; and `merge_companies_for_org()` —
the `SECURITY DEFINER` wrapper `0012` built specifically so a Server Action
could call it — **is called by nothing.** There is no merge review UI. The whole
deduplication subsystem is complete, tested, and inert.
{% endhint %}

### The missing trigger

**Nothing in the app starts discovery.** The only callers of
`discover_companies` are `first-run.ts` (inside the onboarding request) and the
`schedule_discovery` sweeper. In any deployment to date, discovery has run
**once per workspace, during onboarding** — and nothing has re-run it.

That is not a bug in a handler. It is the difference between a product that
hunts and a product that hunted once.

### The missing clock

See [The heartbeat](../operations/heartbeat.md). Every scheduled behaviour in
the product depends on `/api/jobs/tick` being called, and no `vercel.json`
existed in this repository until 2026-09-15.

## The commercial layer is display-only

| Metric | Displayed | Counted | Checked |
|---|---|---|---|
| `seats` | ✅ | ✅ | **✅** |
| `ai_runs` | ✅ | ✅ | **✅** |
| `enrich` | ✅ | ✅ | only inside an unreachable handler |
| `emails` | ✅ | ✅ | ❌ |
| `opportunities` | ✅ | ❌ | ❌ |

**There is no payment path at all.** The three `STRIPE_*` variables are read by
zero lines of code, and `subscriptions` has been unused since `0001`.

## Launch blockers

| # | Blocker | Evidence |
|---|---|---|
| 1 | Nothing runs on a schedule | No `vercel.json` before 2026-09-15; the plan must support minute-level cron |
| 2 | Discovery cannot be started from the app | Only caller is `first-run.ts` |
| 3 | Deduplication never runs while discovery does | `resolve_entity` unenqueued; `0012`'s own header |
| 4 | GDPR erasure unreachable | `purge_contact_data` unenqueued |
| 5 | Three of five plan limits unenforced | `usage.ts` vs. the single `checkQuota` call site |
| 6 | **No live vendor call has ever succeeded** | No Apollo / Anthropic / HubSpot key in any verified environment |
| 7 | CSP still report-only | Deliberate; flip after a quiet week |
| 8 | No billing | Pricing implies a purchase that is impossible |

Blocker 6 gates the others: until one real key has been used, every AI and
provider behaviour in this book is *tested* but not *observed*.

## What was found to be better than documented

The README (last substantively updated 2026-08-19) claims eleven of seventeen
nav destinations are unbuilt, that nothing sends an email, and that nobody can
be invited. **All three are false.** See
[Documentation vs. code](doc-vs-code.md).

## Schema objects nobody reads

`company_gaps` (`0003`) · `contact_frequency` (`0017`) · `evidence_citations`
(`0022`) · `company_merges` (`0012`, in practice) · `subscriptions` (`0001`).

Either wire them or drop them. **A schema that carries tables nobody reads
teaches the next reader that tables are decorative.**

## Related

* [Feature reference](../product/features.md) — capability by capability
* [Technical debt](technical-debt.md)
* [Roadmap](roadmap.md)
* [Documentation vs. code](doc-vs-code.md)
