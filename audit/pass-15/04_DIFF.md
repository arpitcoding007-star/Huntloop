# Pass 15 — diff against pass 14 and AUDIT.md (2026-10-13)

## Fixed (verified in code)
SEC-001, SEC-002, SEC-003 (SSRF; new ATS fetches use fixed hosts and `encodeURIComponent`), SEC-005/006, org `plan_id`/`deleted_at` rewrite (0047), AI-001 (timeout), PROV-004, CRM-001, CRM-004, OUT-001, OUT-005, JOB-001 (tick.yml now fails red), MAP-001 except `purge_contact_data`, AUDIT.md B-03, B-04, B-06, B-08 (copy), B-09, B-10, B-12, B-14, dependency advisories (critical/high).

## Still open
AI-002 (research half → AI-002b), AI-004, AI-005, AI-006, AI-007 (mostly mitigated), PROV-005, PROV-011, PROV-012, CRM-002, CRM-003, CRM-005, SEC-011 (CSP report-only), TRUST-008, MAP-003, FLOW-009 (partial), FLOW-011 (→ FLOW-106), AUDIT.md B-01/B-02 (→ PROD-001), B-15 billing, B-16 legal, B-17 E2E.

## Regressed
PROV-003 — `enrich_person` wired this session without going through the provider seam.

## New
SEC-101/FLOW-101, FLOW-102, TRUST-101, TRUST-102/103, AI-009, DB-101/OUT-010, OUT-011, SEC-102, SEC-103, DB-102, OPS-101, JOB-010, OUT-012, JOB-011, FLOW-103, FLOW-104, UX-001/002, TEST-001, AI-010, AI-011, AI-012, PROV-015, OUT-013, PERF-001, and the Lows in 03_FINDINGS.md. Most are in code added this session.
