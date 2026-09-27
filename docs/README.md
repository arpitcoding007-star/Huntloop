---
description: >-
  The single source of truth for Huntloop — product, architecture, operations
  and current build status, written from the code rather than from the plans.
---

# Huntloop documentation

Huntloop is an **AI-native sales intelligence system**. Most tools help a
salesperson *find* prospects. Huntloop exists to answer a harder question:

> **Why is this prospect worth contacting right now?**

The unit of the product is a **qualified opportunity with evidence**, not a
lead.

```
SIGNAL  →  CONTEXT  →  INTENT  →  OPPORTUNITY  →  ENGAGE  →  LEARN
```

***

## How to read this book

| If you are… | Start with |
|---|---|
| New to the product | [What Huntloop is](product/what-it-is.md) → [Core workflows](product/core-workflows.md) |
| A new engineer | [Architecture overview](architecture/overview.md) → [Development setup](developer/setup.md) |
| A product manager | [Feature reference](product/features.md) → [Implementation status](status/implementation-status.md) |
| A designer | [Design system](architecture/design-system.md) → [User journeys](product/user-journeys.md) |
| An operator deploying it | [Deployment](operations/deployment.md) → [The heartbeat](operations/heartbeat.md) → [Migrations](operations/migrations.md) |
| Evaluating security | [Security model](security/model.md) |
| An AI agent working in the repo | [Code conventions](developer/conventions.md) + [Documentation conventions](meta-documentation-conventions.md) |

***

## The three rules everything else follows from

These are not style preferences. They are enforced in the schema, in the AI
layer, in the colour palette and in CI.

1. **Fact ≠ inference ≠ unknown.** Every claim carries which one it is. An
   inference is never silently promoted to a fact, and "we don't know" is a
   valid, first-class answer. Enforced by a `CHECK` on `evidence.claim_kind`,
   by `packages/ai/src/claims.ts`, and by the `ClaimBadge` component.
2. **Scores are explainable.** Eight named dimensions, each shown. There is no
   weights column and no invented arithmetic. An unmeasured dimension reads
   **UNKNOWN**, never zero.
3. **Why now.** A strong opportunity has a recent trigger, and old evidence
   stops counting as current.

A fourth rule governs this documentation: **the code outranks every document
on the question of what exists.** A requirement described in a plan is not
evidence that it is implemented. See
[Documentation vs. code](status/doc-vs-code.md) for where they currently
disagree.

***

## Status at a glance

{% hint style="info" %}
Verified on **2026-09-16** against branch `feat/sidebar-modules` by running the
suites, not by reading the plans.
{% endhint %}

| | |
|---|---|
| Nav destinations built | **19 / 19** |
| Migrations | 28 · 69 tables · 63 functions |
| Job handlers | 26 (4 of them have no caller — see below) |
| AI tasks | 12, none yet verified against the live Anthropic API |
| Test assertions | 1,024 passing (`npm test`) + 90 browser tests |
| Repository audit checks | 40 passing, 0 failing, 0 warning |
| Dependency advisories | 2 moderate, dev-only (`vitest`) |

**The one thing to know:** the engine is built and the *triggering* layer is
where the gaps are. Four handlers have no caller, and until 2026-09-15 no cron
was committed at all. See [Implementation status](status/implementation-status.md)
and [The heartbeat](operations/heartbeat.md).

***

## Documentation layers

This book is written in three layers, and the layer is stated on each page.

* **Internal** — architecture, database, operations, audits, technical debt.
* **Developer** — setup, endpoints, server actions, testing, conventions.
* **Product** — what the product does, for whom, and how the workflows run.

No page in this book contains a secret, a key, a token, or a live credential.
Real values live only in `.env.local` and in the deployment platform.
