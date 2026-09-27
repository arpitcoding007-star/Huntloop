# Qualification & scoring audit

**Verdict: the strongest product idea in the repository, correctly built, and not yet composed into an answer.**

## The systems

| System | Table | Produced by | Shape |
|---|---|---|---|
| Opportunity score | `opportunity_scores` | `score_opportunity` | 8 nullable dimensions + `model_score` + rule-adjusted `score` + `rule_trace` + mandatory `explanation` |
| Priority | `opportunities.priority` | same | `HOT` / `WARM` / `WATCH` / `IGNORE` + mandatory `priority_reason` |
| Contact fit | `contact_fit_scores` | `rank_contacts` | score + `base_score` + named dimensions (jsonb) + rule trace + explanation |

The eight opportunity dimensions: `icp_fit`, `problem_severity`, `evidence_strength`, `trigger_strength`, `trigger_freshness`, `buying_likelihood`, `product_relevance`, `decision_maker_accessibility`.

## Why this is good

- **No weights column, deliberately.** `0003`'s comment: the combination rule is recorded as NOT DEFINED, so nothing can invent one and present it as HuntLoop's arithmetic. When a real weighting exists it arrives as its own versioned table.
- **NULL means UNKNOWN, never 0.** An unmeasured dimension cannot be silently penalised as a zero. Enforced by nullable columns and a CHECK range.
- **Model opinion separated from customer policy.** `model_score` vs rule-adjusted `score` with a `rule_trace` of every rule that fired. This is what makes the learning loop answerable — when average score moves you can tell a market change from a prompt edit.
- **Explanation is NOT NULL.** An unexplained score cannot exist in the database, and `ScorePill` requires it to render.
- **Rules are user-editable** (`/settings/scoring`, `draft-scoring-rules` to propose them) with effects `adjust` / `veto` / `floor`.

Answering the brief's test — *"why is this prospect ranked above another?"* — the product can answer it precisely for one opportunity, and for one contact within it.

## 🟡 The gap: three ranked signals, no composition

There is no conflict between the systems, but there is no **composition** either:

- `priority` answers "how hot is this account".
- `opportunity_scores.score` answers "how well does it fit, numerically".
- `contact_fit_scores.score` answers "who at this account".

Nothing combines them with recency, signal freshness, previous outreach, or CRM stage into a single ordered queue. The Command Center shows priority counts; the opportunity list filters by priority; the detail page ranks buyers. A user still has to assemble "who should I contact next" themselves.

This is the product's own stated purpose, and it is the one thing no screen does.

## Findings

| # | Severity | Finding |
|---|---|---|
| Q-1 | High | **No next-best-action composition** (above) |
| Q-2 | High | Scores are not recomputed when new evidence arrives — only when the profile or rules change | see `06_SIGNALS_AUDIT.md` SG-2 |
| Q-3 | Medium | `recompute_scores` is cron-gated; after an ICP edit, scores stay stale indefinitely without a clock |
| Q-4 | Medium | No capture of user disagreement — no score override, no "not a fit, because…". The learning loop therefore has no supervised signal, only replies |
| Q-5 | Medium | Contact-fit dimensions live in `jsonb` (`dimensions`) while opportunity dimensions are columns. Defensible (the contact set is more fluid) but it means one is queryable and one is not |
| Q-6 | Low | Nothing surfaces *dimension-level* comparison between two opportunities — the data supports "why A over B" and no screen asks it |

## Recommendations

1. **Build one recommendation surface** that *reads* the three existing scores and never recomputes them. The risk to avoid is a fourth ranking system; the rule should be that the engine composes and explains, and the scorers remain the only things that score.
2. **Rescore on new evidence** (one enqueue).
3. **Capture overrides.** A "not a fit" button with a reason is the cheapest supervised-learning signal available and does not exist.
