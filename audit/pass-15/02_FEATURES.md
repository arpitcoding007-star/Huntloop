# Pass 15 — feature inventory

Statuses describe the code as audited (before fixes). "Working" means traced end to end and covered by tests against fakes; nothing is proven against live vendors.

| Feature | Status | Entry → backend | Evidence |
|---|---|---|---|
| Sign-in (magic link, Google) | Working in code; **Broken in prod** | `(auth)/actions.ts` → Supabase | PROD-001 (redirect origin fails TLS) |
| Onboarding | Working | `(onboarding)/welcome/**` | E2E demo |
| Discovery | Working | `discover_companies` → Apollo adapter | jobs suite |
| Research & qualification | Working | `research_company`, `score_opportunity` | ai suite |
| Hiring signals (Apollo + job boards) | Partial | `fetch_company_signals`, `ats.ts` | TRUST-102/103, FLOW-103/104 |
| Site facts | Partial | `profile_company` | TRUST-101, FLOW-106 |
| Duplicate detection & merge review | Partial | `resolve_entity` → `MergeReview.tsx` | FLOW-102, UX-001 |
| Company remove / re-add | Partial | `companies/actions.ts` | SEC-101, DB-102 |
| Contact ranking | Working | `rank_contacts` | jobs suite |
| Contact enrichment | Partial (outside budget) | `enrich_person` | PROV-003 |
| Sequences, approvals, send safety | Working | `advance_enrollments`, `send_message`, inbox actions | jobs suite; OUT-011 |
| Warm-up & domain readiness | Partial (needs 0048) | 0048, `check_mailbox_domain` | DB-101, SEC-103 |
| Reply sync & classification | Partial | `sync_mailbox` | AI-009 |
| HubSpot push | Partial (unverified live) | `sync_hubspot` | CRM-002/003/005 |
| Learning & analytics | Working | `analyze_performance`, `/performance` | E2E demo |
| Erasure | Working (direct action); job Dead | `settings/privacy/actions.ts` | COMP-001 |
| Migrations in deploy | Partial | `migrate.yml` | OPS-101 |
| Billing | Missing | — | AUDIT.md B-15 |
