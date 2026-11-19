# Pass 15 — plan

## Order
- **P0** (consent and data integrity): SEC-101, FLOW-102, OUT-011, AI-009.
- **P1** (truthfulness of evidence and spend): TRUST-101, TRUST-102/103, PROV-003, AI-002b, DB-101/OUT-010, AI-007 remainder.
- **P2** (reliability and least privilege): SEC-102, SEC-103, DB-102, OPS-101, JOB-010, OUT-012, JOB-011, FLOW-104, UX-001/002, TEST-001, AI-011, AI-012, CRM `loadEmail`, COMP-001 doc.
- **P3**: AI-010, FLOW-103, FLOW-106, PROV-015, OUT-013, PERF-001, CRM-002/003/005 (need a live portal), Lows.
- **Outside the repo**: PROD-001 (Vercel certificate / site URL, env vars), applying 0048 (and 0049 once added), live vendor verification, legal facts, billing.

Dependencies: DB-101 needs 0048 applied. The SEC-101 trigger and the FLOW-102 evidence move ship as one migration (0049).

## Mechanizable checks to add to `scripts/audit.mjs`
| Finding | Check |
|---|---|
| PROV-003 | No `fetch(` to `api.apollo.io`, `api.hunter.io`, `api.zerobounce.net` outside `packages/providers` |
| SEC-101 | Migration test: soft-deleting an opportunity leaves no active enrollment and no scheduled unsent message |
| FLOW-102 | Migration test: merging moves company evidence to the winner |
| TRUST-101 | Each site detector has a positive and a negative fixture |
| OPS-101 | Workflows that need a secret exit non-zero without it |
| PROD-001 | Health check fetches `siteUrl` with strict TLS |

## Do not change
See 00_SUMMARY.md §Q.
