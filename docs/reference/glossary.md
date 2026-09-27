---
description: The vocabulary, and the words this product deliberately does not use.
---

# Glossary

> **Layer:** Product / Developer · **Audience:** everyone

{% hint style="info" %}
Vocabulary is load-bearing here. The nav says **Opportunities**, not Leads,
because §1 of the master context is explicit that the unit of the product is a
qualified opportunity with evidence — and the nav is where that vocabulary
either sticks or quietly reverts.
{% endhint %}

## Product terms

**Autonomy level** — `campaigns.autonomy_level`, 0–5. At 0–1 the engine drafts
and stops; a human approves. At ≥ 2 it sends within every safety limit. The
only field on a campaign that can hurt somebody.

**Claim kind** — `fact` | `inference` | `unknown`. Every evidence row carries
one. A fact cannot exist without a source.

**Company** — the canonical word. Never "account".

**Contact fit score** — how well a person matches the buyer persona, used to
order buyers on the opportunity page. Distinct from the opportunity score.

**Contact point** — an email address or phone number for a person, with a
confidence and a verification status. Never guessed.

**Demo figures** — the per-screen notice that a screen's numbers are
illustrative. Distinct from the data-source banner: a screen renders it or does
not, and it has no quiet state.

**Discovery run** — one execution of a saved search against a provider.
Resumable via `page_cursor`; carries a `status` and a `stop_reason`.

**Evidence** — a claim about a subject, with its kind, confidence and source.
The epistemic core of the product.

**ICP** — Ideal Customer Profile. Fifteen criteria keys, versioned, drafted by
a model and edited by a human. Upstream of discovery and scoring.

**Look-alike** — expansion of a search from companies that already scored well.

**Opportunity** — **the unit of the product.** Unique on `(company, icp)`.
Carries a priority with a mandatory reason, an eight-dimension score, and a
trail of evidence.

**Persona** — a buyer archetype, scoped to an ICP.

**Priority** — `HOT` / `WARM` / `WATCH` / `IGNORE`. Always rendered with the
word and a dot shape as well as the colour.

**Reach estimate** — how many companies a profile addresses. **Provider total
only, never inferred.** With no provider it says "we cannot count", not "0".

**Score dimension** — one of eight: ICP fit · Problem severity · Evidence
strength · Trigger strength · Trigger freshness · Buying likelihood · Product
relevance · Decision-maker accessibility. An unmeasured dimension is `NULL` and
renders **UNKNOWN**.

**Scoring rule** — a small expression that may `adjust` the overall score,
`veto` an opportunity, or `floor` its priority. It may never touch a dimension.

**Signal** — an event extracted from a source or a provider. Becomes a
`company_triggers` row.

**Source** — a monitored *place* (a feed, a site). Distinct from a signal,
which is an *event* from one. A pending recommendation is a source with
`is_enabled = false`.

**Suppression** — an address that must not be contacted. **Survives erasure.**

**Trigger** — a timestamped reason to act now. Freshness decays.

**Why now** — the sentence explaining why this opportunity is worth a message
today, generated from recent triggers and cited evidence.

## Engineering terms

**Adapter** — a vendor implementation in `packages/providers/src/adapters/`.
Nothing outside that directory may know a vendor exists.

**Capability** — a unit of provider functionality that is either configured or
is not: `company.search`, `company.enrich`, `person.search`, `person.match`,
`email.verify`, `company.signals`.

**Claim boundary** — where `task.parse()` validates a model's output. A
violation fails the run and is recorded in `ai_runs.error`.

**Data source** — `live` | `unconfigured` | `no-schema`. Three states, not two.

**Handler** — one job. 26 of them in `packages/jobs/src/handlers/`.

**`Loaded<T>`** — what every loader returns: `{ data, source }`.

**`mutate()`** — the common preamble for every write: database check,
membership, role, then the work.

**OrgScope** — the engine's substitute for RLS. Refuses to be constructed
without an org id.

**Partial** — a provider returned fewer rows than asked **because it hit a
limit**. A different fact from "the provider has that many".

**Refusal** — a call that was never made, with a reason. Costs nothing and must
never be presented as a result.

**Sweeper** — a job that asks a cross-tenant question and fans the answer out
into per-org work. A closed set in `runner.ts`.

**Tenant client** vs. **admin client** — the request path uses the caller's
session and RLS applies; the engine path uses the service role and RLS is
bypassed. The admin client is confined to five named files.

**Tick** — one invocation of the runner: sweep, claim up to five due jobs, run
them, report.

**Unbuilt flag** — renders a nav item as a label rather than a link. Comes off
in the same commit that adds the page. No item carries it today.

## Words this product does not use

| Not | Use | Why |
|---|---|---|
| Lead | Opportunity | The unit is evidenced, not listed |
| Account | Company | Only `companies` exists |
| Deal | Opportunity | "Deal" is HubSpot's word, used only inside `packages/crm` |
| Contact record | Person + contact point | Two different things |
| Feed, channel | Source | |
| Event | Trigger, or signal | `events` is a specific table |
| Rating, grade | Priority | |
| Confidence score | Confidence | It is graded, not numeric |

## Section references

Code comments cite the master context by section number. The ones that appear
most:

| § | Subject |
|---|---|
| §1 | The unit of the product |
| §4 | The loop: signal → context → intent → opportunity |
| §6 | Ten excellent opportunities over a thousand weak leads |
| §7 | **Never present the unverified as established** |
| §10 | The user controls what a hunt reads |
| §15 | The four priority classifications |
| §17 | Qualification must be willing to say no |
| §33 | The normalised signal event |
| §38 | Tenancy |
| §46 | The autonomy ladder |
| §51 | The dimension combination rule is **not defined** |
| §52 | Evidence carries its source |
| §58 | Source management |
| §60 | Deduplication |
| §78 | A strong trigger must not lift a poor-fit company |

## Related

* [Data model](../architecture/data-model.md)
* [Source document map](source-documents.md)
