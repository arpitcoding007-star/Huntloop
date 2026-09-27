# Competitive capability gaps

Prior research in this repository covers Apollo and Clay in depth (see the Clay/Apollo comparison work and `audit/PLAN-12.md`). This document only asks the five questions the brief specifies, per capability.

For each: *(1) does it serve HuntLoop's loop? (2) does HuntLoop already solve it? (3) build? (4) integrate? (5) deliberately not?*

## Where HuntLoop already wins

| Capability | Against |
|---|---|
| **Explainable scoring** — 8 named dimensions, no invented weights, mandatory explanation, UNKNOWN ≠ 0 | Neither Apollo nor Clay attempts this. Apollo stops at filters; Clay leaves scoring to user-built formulas |
| **Fact / inference / unknown enforced at three layers** | No competitor models provenance at schema level |
| **Refusing to launder a guess** — pattern-derived emails stay `low`/unverified even when the vendor implies otherwise | Apollo surfaces its own optimistic statuses directly |
| **Autonomy ladder** — drafts stop until a human approves | Closer to Clay's philosophy than Apollo's, and more explicit than either |
| **Onboarding economy** — 9 required answers, 3 text fields | Materially better than both |
| **Cost control before scale** — cache/budget/breaker/ledger, per-capability TTLs | Clay charges per attempt including failures; Apollo meters credits with limited visibility |

None of this should be traded away for feature parity.

## Gaps worth closing

| Capability | Serves the loop? | Already solved? | Verdict |
|---|---|---|---|
| **Provider waterfall** | Yes — contact coverage determines whether outreach bounces | No; one adapter per capability | **BUILD** (registry change, `08_ENRICHMENT_AUDIT.md` E-2) |
| **Job-change signals** | Yes — strongest warm-intro trigger in B2B | No | **INTEGRATE** when a clean endpoint exists; `SignalKind` is written for it |
| **Intent data (Bombora-style)** | Yes — "why now" is the product | No | **INTEGRATE**, as evidence rows, not a separate dashboard |
| **Website visitor ID** | Yes — freshest possible signal | No | **INTEGRATE**, after GDPR review; US-only person-level |
| **Bulk CSV enrichment** | Partly | Import exists; bulk enrich does not | **BUILD** small |
| **Saved-search management** | Yes | Schema yes, UI no | **BUILD** |
| **Next-best-action queue** | **This is the product** | Three scores, no composition | **BUILD** — highest priority |

## Deliberately not building

| Capability | Why not |
|---|---|
| **Dialer** | Different product category: telephony, local presence, TCPA. Apollo, Orum, Nooks own it. Integrate if ever needed |
| **LinkedIn automation** | Against LinkedIn's terms; account-ban exposure for what a URL field already gives |
| **Generic workflow canvas** (Clay's model) | The fastest way to destroy HuntLoop's differentiation. Its advantage is an opinionated path; a canvas is the opposite |
| **General-purpose AI agent** (Apollo's Assistant, Claygent) | Out-funded arms race. The narrow, evidence-cited agent already fits better |
| **In-house deliverability / warm-up** | Commodity, solved well elsewhere, real operational risk |
| **Becoming a CRM** | The product's own governing doc forbids it. A thin push is the correct scope |
| **Owning a contact database** | Capital-intensive, zero differentiation. Apollo is infrastructure, correctly |

## The strategic risk worth naming

Apollo's 2026 agentic assistant moves it *up-stack* into prioritisation — the layer HuntLoop is betting on. HuntLoop consumes Apollo for discovery while competing with it on judgement.

That is not a reason to stop using Apollo; building a 275M-contact database is not a realistic alternative. It is a reason the moat must be the part Apollo structurally cannot copy quickly: **provenance and explainability enforced in the data model**. A competitor can add a scoring feature in a quarter. Retrofitting "every claim carries whether it is a fact, an inference, or unknown, and a fact cannot exist without a source" into an existing schema is a multi-year migration nobody undertakes voluntarily.

Concretely: keep investing in evidence, explanation and refusal. Do not spend engineering on matching Apollo's channel breadth or Clay's canvas flexibility.
