# Pass 20 — system map (panel view)

## Request path every panel uses

```mermaid
flowchart LR
  UI[Panel component<br/>app/(app)/[org]/**] -->|server action| M["mutate()<br/>membership · minRole · orgId"]
  UI -->|server render| L["lib/data/* via load()<br/>live DB or fixtures"]
  M --> DB[(Supabase Postgres<br/>RLS · CHECKs · same-org triggers)]
  L --> DB
  M -->|request columns<br/>research_asked_at, crm_sync_requested_at,<br/>next_scan_at, score_recompute_requests| DB
  Tick[GitHub Actions tick 5 min<br/>or Inngest] --> T["/api/jobs/tick<br/>CRON_SECRET"]
  T --> S[schedule_* sweepers] --> Q[(job_executions<br/>fair claim 0056)]
  Q --> H[handlers<br/>packages/jobs] --> P[providers / AI / mailbox / HubSpot<br/>budget · ledger · kill switch]
  H --> DB
  M -->|revalidatePath| UI
```

## Where the chain breaks (Highs)

```mermaid
flowchart TD
  subgraph ReachOut[Reach Out]
    C1[Create campaign: draft] --> C2[Enrol] --> C3[advance_enrollments parks: campaign not running]
    C3 --> C4[Start campaign: updates campaigns only]
    C4 -.x.-> C5[due_enrollments_fair needs status=active] 
    A1[Approve] --> A2[send_message: quota / cadence / postal refusal writes error]
    A2 -.x.-> A3[schedule_sends skips error rows]
  end
  subgraph Trust[Provenance]
    W[writer: claim_kind=inference] --> LD[loader drops claim_kind] --> B["UI: hasEvidence ⇒ Fact"]
    AI["AI wrapper: ok + unconfigured example"] --> SV[askAgentAction saves it]
  end
  subgraph Schema[Schema drift]
    SEL["select 'explanation' / 'approved_at'"] --> ERR[42703] --> SW["error swallowed ⇒ empty"]
  end
  subgraph Discover
    D1[Delete ICP] -.x.-> D2[discovery_queries still enabled] --> D3[claim ignores icps ⇒ daily paid search]
  end
```

## Panel → table → producer map (abridged)

| Panel | Reads | Writes | Engine producer / consumer |
|---|---|---|---|
| Command Center | opportunities, company_triggers, messages, outcomes, mailboxes, evidence | discovery_queries (Hunt now) | schedule_discovery → discover_companies → resolve_entity, score_opportunity |
| Needs-you | threads, messages, opportunities, activities, enrollments, learning_findings, sources, demand_signals, attention_snoozes | attention_snoozes, activities, outcomes | — |
| Opportunity detail | opportunities, people, contact_fit_scores (broken), evidence, opportunity_scores | conversation_messages, opportunities.*, outcomes | research_company, sync_hubspot, rank_contacts |
| Companies | companies, company_problems, company_gaps (no writer), company_competitor_signals | companies, merge_candidates, company_merges | resolve_entity (discover only), scan_source |
| Sources | sources, evidence, source_documents | sources | schedule_scans → scan_source → resolve_competitor_mentions |
| Imports | companies, people, contact_points | same | none (no resolve_entity) |
| Outreach | campaigns, sequences, enrollments | same | advance_enrollments → schedule_sends → send_message |
| Inbox | threads, messages, message_events | messages, threads, enrollments | sync_mailbox → classify, outcomes, suppressions |
| Learn | learning_runs, learning_findings | scoring_rules, memories | schedule_learning (hourly) → analyze_performance |
| Performance | opportunities, activities, outcomes, ai_runs, org_activation | organizations.settings | — |
| Settings ICP / scoring | icps, personas, scoring_rules | same, discovery_queries | score_opportunity, rank_contacts, discover_companies |
| Team | memberships, invitations, usage_counters (seats never written) | memberships, invitations | — |
| Ops | job_health, job_dead_letters, queue_pressure, provider_health | retry_job, cancel_job | — |

## Integration map
- **Apollo / Hunter / ZeroBounce** — via `packages/providers` registry with fallback (Hunter → Apollo for person.match), budget reservation, ledger, kill switch. Reached from discover/enrich/rank handlers only; no panel calls a provider directly except the ICP look-alike preview (metered, `limitRefusal`).
- **Anthropic** — via `lib/ai/recorder.ts` (`canSpend`, rate limit) from panels and `packages/jobs/src/ai.ts` from handlers. Unconfigured returns worked examples (RC-2).
- **HubSpot** — OAuth/private token encrypted in `hubspot_connections` (admin-only RLS); push on request column.
- **Gmail / Microsoft** — `/api/mailboxes/[provider]/{start,callback}` with nonce cookie; tokens encrypted with `MAILBOX_ENCRYPTION_KEY`.
- **Production** — UNVERIFIED (see README).
