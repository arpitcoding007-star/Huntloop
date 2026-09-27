# AI & research audit

## Inventory — 12 tasks, all reachable

| Task | Called from | Purpose |
|---|---|---|
| `research-company` | onboarding, `research_company` job, public research | what a company sells, ICP inputs |
| `research-competitor` | `research_competitor` job | competitor profile |
| `recommend-sources` | onboarding, sources screen | where this ICP's companies appear |
| `draft-icp` | onboarding, ICP settings | ICP from company research |
| `draft-scoring-rules` | scoring settings | proposed rules |
| `qualify-opportunity` | `score_opportunity`, analyze screen | the verdict |
| `explain-why-now` | `score_opportunity`, analyze | the trigger narrative |
| `extract-signals` | `scan_source` | triggers from documents |
| `personalize-message` | outreach | the opener |
| `classify-reply` | `sync_mailbox` | reply → outcome |
| `analyze-performance` | `analyze_performance` job | learning |
| `sales-agent` | opportunity `AgentPanel` | per-opportunity Q&A |

No orphan tasks. Every symbol is imported by at least one caller (verified by symbol-level grep, not filename).

## The machinery around them is the good part

- **`runTask`** is the single entry point: prompt + input hash + model route + structured-output validation + run ledger.
- **Claim validation** (`claims.ts`, `ClaimValidationError`): a model's output cannot enter the system as a "fact" without a source — the same rule the database enforces, applied at the model boundary. Three enforcement layers total (CHECK constraint, model boundary, design-system colour).
- **Untrusted-content wrapping** (`untrusted.ts`): scraped page content is fenced before it reaches a prompt — prompt-injection defence that most products at this stage do not have.
- **Spend guard**: every model-calling wrapper refuses when the caller's org cannot be resolved (`SEC-SPEND`), consumes a rate limit (`SEC-RATELIMIT`) and checks + increments a monthly quota (`SEC-QUOTA`). All three are build-failing audit checks, so a new wrapper cannot skip them.
- **Cost observability**: `ai_runs` records model, tokens, cost estimate and latency; `/analytics` reads it. A product that can answer "what did last month's AI cost, per task" before it has customers is unusual.
- **Input bounds**: zod validates shape *and size* on every action, so a caller cannot hand a task 500 claims of 50 kB and make HuntLoop pay Opus to read them.

## 🔴 The one enormous caveat

**No AI task has been confirmed to run against a live model.** Everything above is exercised against a scripted client. That means:

- prompt quality is unknown,
- structured-output conformance under real model variance is unknown,
- hallucination rate is unknown,
- real latency and real cost per task are unknown,
- the `explanation` strings that the entire explainability story depends on have never been read by anyone.

The architecture for evaluating AI is present; the evaluation has not happened.

## Findings

| # | Severity | Finding |
|---|---|---|
| A-1 | **Critical** | Zero live model calls verified |
| A-2 | High | No evaluation harness — no golden set, no regression corpus, no way to tell whether a prompt edit improved or degraded output |
| A-3 | Medium | No output review surface: a user cannot see, correct or reject what the model said about an account (beyond the agent panel's chat) |
| A-4 | Medium | Model routing exists (`models.ts`, `ROUTES`) but cost/quality trade-offs per task are unvalidated |
| A-5 | Medium | `analyze-performance` has only one caller and no manual trigger from `/learn` |
| A-6 | Low | No prompt versioning tied to score provenance — `opportunity_scores.model_version` exists, but nothing links a score to the exact prompt text that produced it |

## Research / account intelligence

Against the brief's checklist, the opportunity detail page covers: company summary, industry/region/size, identified problem, potential gap, current approach, why-now, use case, outreach angle, evidence with citations, triggers, ranked buyers, and an agent for follow-up questions.

Missing: **customers**, **market position**, **competitor set for this account** (the competitor subsystem models *your* competitors, not the prospect's), and **relationship history** (no view of prior touches across the account).

The right split — automatic vs on demand — is already implemented correctly: company research runs automatically on discovery; deeper questions go through the agent panel, which is user-initiated and metered. Keep that.
