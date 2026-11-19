# Pass 16 — system map

Commit `7e09759`. Shapes come from the reviewers' inventories: 13 route handlers and 138 server actions (reviewer A §1), 82 tables and 128 triggers (reviewer B §1–2), the job registry (reviewer D §1) and the provider and AI seams (reviewer C §2–3).

## Architecture

```mermaid
flowchart LR
  U[Browser] --> V[Vercel · Next.js 16<br/>proxy.ts guard · CSP report-only]
  V -->|Server Components / 138 Server Actions<br/>session client · RLS| DB[(Supabase Postgres<br/>repo 0001–0050 · configured DB 0001–0047)]
  V -->|13 route handlers| RH[/api: health · jobs/tick · inngest ·<br/>mailboxes OAuth · unsubscribe · csp-report · memory/extract/]
  GH[GitHub Actions tick.yml<br/>*/5 · Bearer CRON_SECRET] --> T[/api/jobs/tick/]
  ING[Inngest route<br/>hand-rolled · dead] -.-> R
  T --> R[runner: sweep + tick<br/>claim skip-locked · 4 lanes · OrgScope]
  R -->|service role| DB
  R --> P[packages/providers<br/>Apollo · Hunter · ZeroBounce<br/>cache · breaker · budget/reserve · ledger]
  R --> AI[packages/ai<br/>Opus / Sonnet / Haiku 5.5<br/>runTask · spend guard]
  R --> MB[Gmail / Outlook<br/>send + sync]
  R --> CRM[packages/crm · HubSpot]
  R --> W[fetchPage · SSRF-guarded<br/>ATS boards · homepages]
  MG[migrate.yml → migrate.ts<br/>schema_migrations ledger<br/>never run on configured DB] --> DB
  V -.Sentry DSN unset.-> S[(Sentry)]
```

## Core loop data flow (job names)

```mermaid
flowchart LR
  D[discover_companies] --> RC[research_company] --> SO[score_opportunity] --> RK[rank_contacts] --> EP[enrich_person]
  D --> RE[resolve_entity] --> MC[(merge_candidates)]
  D --> PC[profile_company] --> EV[(evidence)]
  FS[fetch_company_signals] --> EV --> SO
  SO --> AE[advance_enrollments] --> PM[personalize_message] --> M[(messages<br/>scheduled_at = only go signal)]
  M --> SS[schedule_sends] --> SM[send_message<br/>can_contact · quota · lane · gates · defer]
  SM --> MB[mailbox] --> SY[sync_mailbox<br/>classify_reply · bounces] --> OUT[(outcomes)] --> AP[analyze_performance] --> LP[learn_preferences]
  SO --> HS[sync_hubspot]
  FR[first-run stages<br/>inside a Server Action] -.reads stale result contract.-> D
```

Two weak points sit on this map. Both are findings:
- `messages.scheduled_at` is the only signal that a message may go. Parent state (enrollment, campaign, opportunity, org) is never re-read at send time. That is **OUT-201**.
- First run calls the stage handlers inline from a request and reads result fields the handlers no longer return. That is **ENG-201**.

## Repo → database → deploy (the theme of this pass)

```mermaid
flowchart LR
  B[branch feat/pass-15-audit-fixes<br/>7e09759 · 0048–0050 + fixes] -.not merged.-> MAIN[main]
  MAIN -.not deployed.-> PROD[www.huntloop.pro<br/>serves 8021d3f · health 503]
  B -.migrations not applied.-> CDB[(configured Supabase<br/>0001–0047)]
  PROD --> CDB
  APEX[huntloop.pro<br/>TLS wrong principal] -.siteUrl in every email link.-> PROD
```

Safe order for the next deploy: `09_OPS_AND_SCALE.md` § Deploy state.

## Trust boundaries

| Boundary | Enforced by | Weak point |
|---|---|---|
| Browser → app | `proxy.ts`, `mutate`/`currentViewer` org resolution from the slug | none found (reviewer A §8) |
| Session → DB | RLS on all 82 tables; `enforce_same_org_refs`; guard triggers | within a tenant, `FOR ALL member` on safety tables (DB-201) |
| Jobs → DB | service role through `OrgScope` (injects `org_id`) | not covered by the admin-import guard (SEC-205) |
| App → vendors | `packages/providers` seam, SSRF guard | key invalidity never recorded (PROV-204) |
| App → model | prompt wrapping of untrusted input; claim downgrade | grounding is checked by domain, not by fetched page (AI-204, TRUST-202) |
