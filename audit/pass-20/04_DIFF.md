# Pass 20: changes since pass 17 and the pass-18/19 work

This pass covers the panels only. Earlier findings outside the panels (providers, DB, production) were not re-audited and keep their last status.

## Pass 17 findings, rechecked where a panel touches them

| Old ID | Now | Evidence |
|---|---|---|
| SEC-301 approval bypass | Fixed | 0051:97-143 trigger read; approve uses compare-and-swap on `scheduled_at` |
| PERF-301 quadratic inbox | Fixed (join cost). The payload is still unbounded → PANEL-311 | 0052:82-86 |
| ANL-301 activation measure | Fixed (view and card). The reply figures are wrong → PANEL-313 | 0054:78-128 |
| A11Y-301 | Fixed | e2e a11y passes on every `/demo/*` route (388 passed) |
| TRUST-301 why-now date | Fixed on the opportunity page. **Still open** on Needs-you and the dashboard rail → PANEL-103 | `NeedsYouList.tsx:187-191` |
| FLOW-301, UX-301, PERF-302, JOB-202/301 | Fixed (per pass-18 status; not re-audited) | — |
| SEC-302, PROV-301, SEO-301/302, TEST-301 | Not in scope | — |
| Pass-16 Critical: stop/archive does not stop queued mail | Fixed at send time (`send-message.ts:781-850`). The inbox still shows it as queued → PANEL-303 | — |

## Pass 18/19 debt items the panels depend on

| Debt # | Claim in `docs/status/technical-debt.md` | Verdict |
|---|---|---|
| 1 | `resolve_entity` wired after discover | True, but for discover only. The five other company-creation paths have no resolve step → PANEL-206 |
| 2 | Hunt now on the Command Center | Wired. It doesn't check engine readiness or the backlog → PANEL-105 |
| 4 | `emails` and `opportunities` quotas checked | True. But the email-quota refusal strands the message → PANEL-302 |
| 8 | `evidence_citations` read ("Seen in N sources"); `company_gaps` kept "until research produces gaps" | Citations wired; they count URLs, not sources → PANEL-207. Gaps still have no writer → PANEL-205 |
| 9 | Activity log reads `audit_logs` | True. Most admin actions don't write to it → PANEL-404 |
| 10 | Merge review on Companies | Working; auto-merges are invisible → PANEL-213 |
| 12 | Needs-you uses score and contact fit | True in ranking. Fit is unavailable on the opportunity page → PANEL-102 |
| 13 | "What changed" card | Wired; it resets on any interaction → PANEL-104 |
| 20 | Imports chunked by 100 | True. Imports fail on a domain that was removed earlier → PANEL-203 |
| HL-1606 kill switch | Read by sending, AI and providers | True; no UI shows it → PANEL-410 |
| `/api/inngest` fix (0251994) | Inngest's protocol and HMAC | True; the PUT is unauthenticated → PANEL-411 |
| `/api/health` queue stall (debt #19) | 503 when stalled | True (code) |

## New this pass
59 findings, all marked "New" in [03_FINDINGS.md](03_FINDINGS.md), plus one regression path: PANEL-401 reopens the FLOW-008 intent (old discovery searches retired) for the delete and empty-ICP cases.
