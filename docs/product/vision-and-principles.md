---
description: The load-bearing rules, where each one is enforced, and what breaks without it.
---

# Vision and principles

> **Layer:** Product / Internal · **Audience:** everyone

Huntloop's differentiator is not a feature. It is a set of epistemic
commitments that are enforced mechanically, so that they survive contact with
deadlines. This page lists each one and names the file that enforces it.

***

## 1. Fact ≠ inference ≠ unknown

Every claim the system makes carries its kind.

| Kind | Meaning | Colour |
|---|---|---|
| `fact` | Observed at a named source | green |
| `inference` | A model concluded it | violet |
| `unknown` | Nothing on file | gray |

**Where it is enforced**

| Layer | Mechanism |
|---|---|
| Database | `evidence.claim_kind` is a `claim_kind` enum; a fact cannot exist without a source (`0002`, asserted by `verify-migrations.ts`) |
| AI | `packages/ai/src/claims.ts` — `assertValidClaim` throws `ClaimValidationError`; a violation fails the run and is written to `ai_runs.error` |
| UI | `ClaimBadge` in `packages/ui`; the palette itself carries the distinction (`tokens.css`) |

**Why the colour matters.** Colour is the fastest place an inference can
quietly become a fact. Nothing in the UI is communicated by colour alone —
priority always ships with the word and a dot shape as well.

## 2. Scores are explainable

Eight named dimensions, each rendered:

`ICP fit` · `Problem severity` · `Evidence strength` · `Trigger strength` ·
`Trigger freshness` · `Buying likelihood` · `Product relevance` ·
`Decision-maker accessibility`

**There is no weights column.** The combination rule is deliberately *not
defined*, because inventing one and presenting it as "the model's arithmetic"
would be rule 1 broken against ourselves. A dimension that could not be
measured is stored `NULL` and rendered **UNKNOWN** — never `0`, because zero is
a measurement and unknown is not.

Scoring rules (`packages/db/src/rules.ts`) may adjust the single overall score,
veto, or floor a priority. They may **not** touch the eight dimensions. Every
rule application is recorded in `opportunity_scores.rule_trace` beside the
untouched `model_score`.

## 3. Why now

A strong opportunity has a recent trigger. Freshness decays: `Freshness` and
`freshnessBand` in `packages/ui` render age as a band, and
`company_triggers` carries the timestamp that makes old evidence stop counting
as current.

## 4. A refusal is a result

Several subsystems can refuse, and a refusal is never dressed up as an answer:

* `qualify_opportunity` must be willing to return `IGNORE`.
* A provider call can return `refused` with a reason — `no_provider`,
  `credentials_invalid`, `budget_exhausted`, `breaker_open`,
  `capability_unsupported` — and the discovery UI shows which.
* With no company-search provider the reach counter says *"no company-search
  provider is connected"* rather than showing `0`. "We cannot count" and
  "there are none" are opposite statements.
* With no contact provider, `enrich_person` stops rather than guessing
  `first.last@company.com`. A guessed address is a plausible string with no
  evidence behind it, and the bounce lands on the customer's sending domain.

## 5. The app never shows invented numbers as real

Three data states, not two:

| State | Meaning |
|---|---|
| `live` | Supabase connected and migrated |
| `unconfigured` | No credentials — running on fixtures |
| `no-schema` | Credentials work, migrations not applied |

`DataSourceBanner` announces anything that is not `live`. `DemoFigures`
announces *per screen* that its figures are illustrative. The `FEAT-DEMO`
check in `scripts/audit.mjs` fails the build if a screen under `/[org]` stops
doing one of the two.

## 6. The tenant boundary lives in Postgres

Row Level Security is the security boundary. The middleware guard and the
role-based UI are conveniences. `SEC-ADMIN` fails the build if anything under
`apps/` imports the service-role client; the isolation suite runs as a
**non-superuser** role so RLS genuinely applies.

See [Security model](../security/model.md).

## 7. An affordance that fails is a product bug

A button a viewer can click and that Postgres then refuses teaches people not
to trust the interface — and they cannot tell "I am not allowed" from "this is
broken". `lib/data/membership.ts` exists so screens can decide what to
*render*; the `NAV-03` audit check requires that every button either acts,
navigates, submits, or says why it cannot.

## 8. Cost control precedes the first call

`packages/providers` ships cache → budget → circuit breaker → append-only
ledger before a single vendor call is made, and `ai_runs` records cost and
latency for every model call. This is unusual for the stage and is deliberate:
the alternative is discovering the unit economics on an invoice.

***

## Related

* [Security model](../security/model.md)
* [AI subsystem](../architecture/ai.md)
* [Design system](../architecture/design-system.md)
* [Decision log](../decisions/README.md)
