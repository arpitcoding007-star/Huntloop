# Signals & intent audit

## What exists

Two independent signal mechanisms, correctly kept separate:

| Mechanism | Path | Produces |
|---|---|---|
| **Source scanning** | `scan_source` → `extract_signals` → `company_triggers` + `evidence` | Triggers extracted from a feed/page the user chose to monitor, each with a real `source_url` |
| **Provider signals** | `fetch_company_signals` → Apollo job postings → `evidence` | Hiring signals, one evidence row per posting, cited to the listing URL where Apollo provides one |

Plus funding data arriving as a by-product of `company.enrich` (`funding.stage`, `total_raised`, `last_round_at`).

## The model is right

A signal becomes an **evidence row**, not a separate "signals" table with its own UI. That is the correct decision for this product: evidence is what the scoring engine reads, what the opportunity page shows, and what the fact/inference/unknown rule governs. Adding a parallel signals surface would create a second place to look for the same truth.

Freshness is modelled (`trigger_freshness` is one of the eight score dimensions), and the product's stated rule — "old evidence stops counting as current" — has a home.

## 🔴 The gap: a signal never becomes an action

The brief asks for: **Signal → why it matters → who to contact → recommended action → opportunity/task/outreach.**

Today the chain stops at step one. `fetch-company-signals.ts` writes:

> *"Posted a job — Sales — Senior AE (Austin, TX) — according to apollo."*

…as an evidence row on the company. Nothing:

- re-scores the opportunity because a new signal arrived (scoring is recomputed only by `recompute_scores`, on a cron, after an **ICP or rules** change — not on new evidence);
- notifies anyone;
- produces a task or a recommended action;
- surfaces "what changed since you last looked" anywhere in the UI.

A hiring signal that nobody sees and that changes no score is, functionally, a row.

## Findings

| # | Severity | Finding | Evidence |
|---|---|---|---|
| SG-1 | **Critical** | Neither signal mechanism runs — `schedule_scans` and `schedule_signal_fetches` are both cron-gated, and the cron never existed | `15_JOBS_AUTOMATION_AUDIT.md` |
| SG-2 | High | New evidence does not trigger re-scoring; an account can acquire a strong trigger and keep a stale score indefinitely | `recompute_scores` is driven by profile/rule changes |
| SG-3 | High | No "what changed" surface. The Command Center is the natural home and does not have it | `dashboard/page.tsx` |
| SG-4 | High | No notification of any kind — no email, no digest, no in-app badge | no notification table or sender |
| SG-5 | Medium | Signal relevance is not scored. Every hiring post becomes evidence with `confidence: medium`, whether or not the role relates to the customer's product | `fetch-company-signals.ts` |
| SG-6 | Medium | No expiry/decay job. `trigger_freshness` is a score input, but nothing ages evidence out | — |
| SG-7 | Medium | Only one signal *kind* is wired (`hiring`). `SignalKind` is a union of one | `providers/src/contract.ts` |
| SG-8 | Low | Signals are fetched for every Apollo-known company, not only those with a live opportunity | documented in-file |

## Recommendations

1. **Enqueue a rescore when new evidence lands** on a company with a live opportunity. One `enqueue()` in `fetch-company-signals.ts` and `scan-source.ts`.
2. **Build the "what changed" rail** on the Command Center: accounts whose evidence changed since the viewer last looked, ordered by score delta. This is the product's natural front door and the thing a daily user would open it for.
3. **Score signal relevance** with the existing AI layer — a hiring post for a role unrelated to the product should not read the same as one for the function the product replaces.
4. **Add `job_change` and `intent`** as signal kinds once a clean provider endpoint is confirmed (the union is written to make this a one-place change).
