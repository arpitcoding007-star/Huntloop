# Pass 17 — findings

**Counts: High 2 · Medium 6 · Low 5 · Info 1 (14).** No Critical. Full blocks are in the workstream file named. All severities follow the pass-16 schema.

## High

| ID | Title | Confidence | File |
|---|---|---|---|
| **SEC-301** | Approval can be bypassed by omission: a member can schedule an unapproved message, or rewrite an approved one, through the raw API. This is a gap in the uncommitted 0051. **Fixed in 0051 the same day** (see pass-16 `15_FIX_STATUS.md`) | CONFIRMED (trigger read) | `07_RECHECK.md` |
| **PERF-301** | The inbox is quadratic, because the indexes lead with `org_id` and PostgREST embeds join on the FK alone: 46.7 s → 0.74 s with three indexes (PGlite, 3,000 threads, 30.9 MB payload) | CONFIRMED (PGlite) | `06_PERF.md` |

## Medium

| ID | Title | Confidence | File |
|---|---|---|---|
| SEC-302 | A workspace's company domain is self-asserted, so anyone can appear as "your company's workspace" to every employee of a target domain | CONFIRMED (code + SQL) | `04_MODULES.md` |
| PROV-301 | An unexpected 200 response from Apollo or Hunter becomes a charged "no match", cached for the TTL | CONFIRMED (probe) / LIKELY (cache) | `05_FAILURE.md` |
| PERF-302 | 143 single-column FKs have no index leading on them, about 15 of them on hot paths | CONFIRMED (catalog) | `06_PERF.md` |
| SEO-301 | Every canonical, the sitemap and `robots` point at the TLS-failing apex | CONFIRMED (prod GET) | `03_SEO_ANALYTICS.md` |
| ANL-301 | Nothing measures whether the product works for a customer after onboarding (a measurement plan is included) | CONFIRMED | `03_SEO_ANALYTICS.md` |
| A11Y-301 | Four app screens fail WCAG A/AA (an unlabelled file input, two contrast failures, scroll regions keyboard users can't reach); the gate covers 5 of 43 routes | CONFIRMED (axe, 172 runs) | `02_A11Y.md` |

## Low

| ID | Title | File |
|---|---|---|
| FLOW-301 | Personal workspace named from the first name split on the letter "s" (`/s+/` for `/\s+/`, `welcome/actions.ts:189`): wrong permanent slug | `04_MODULES.md` |
| TRUST-301 | Model "why now" prose can carry relative time that goes stale, with no generation date shown | `01_UX.md` |
| TEST-301 | Two web tests time out (90 s) when the machine is loaded; pass alone | `07_RECHECK.md` |
| JOB-301 | Bulk company inserts enqueue two (free) jobs per company; folds into JOB-202 fairness | `06_PERF.md` |
| SEO-302 | `/discover` is neither in the sitemap nor allowed explicitly | `03_SEO_ANALYTICS.md` |

## Info
| UX-301 | `/compare` has no index page (404) | `01_UX.md` |

## Fix order (pass-17 items, slotted into the pass-16 roadmap)

1. **SEC-301 before 0051 is committed or applied.** It is a change to the same uncommitted migration, with two more test cases.
2. **PERF-301** as a small index migration (0052), plus the PERF-201 loader bound from pass 16.
3. **SEC-302 and FLOW-301:** small, user-facing, no dependencies.
4. **PROV-301:** before the first live vendor run (it decides whether a schema drift looks like an empty market).
5. **A11Y-301:** four component fixes, plus widening the e2e list (mechanizable).
6. **PERF-302** (with an FK-index check in CI), **ANL-301** (a measurement view), and the Lows.
7. **SEO-301** closes with PROD-001; no code.

## Mechanizable checks this pass adds

| Finding | Check |
|---|---|
| PERF-301/302 | `verify-migrations.ts` or `audit.mjs`: every FK has an index leading on its column, or is on an explicit allow-list |
| A11Y-301 | `e2e/a11y.spec.ts` iterates every `/demo/*` route |
| PROV-301 | `verify-providers.ts`: an unexpected 200 shape is a failure, per adapter |
| SEC-301, SEC-302 | `verify-migrations.ts` cases |
| SEO-301 | `live-check.ts`: strict-TLS fetch of every sitemap `<loc>` |
| FLOW-301 | unit test of the first-name split |
