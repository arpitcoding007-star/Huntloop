# HuntLoop Engine — Architecture & Workflow Diagrams

> Companion to [`HUNTLOOP_ENGINE_EXPLAINED.md`](HUNTLOOP_ENGINE_EXPLAINED.md). All diagrams are Mermaid (render on GitHub, GitBook, VS Code). Every box below corresponds to code that was read; boxes drawn dashed are **implemented but have no producer / unverified** (see the technical document §14).
> Legend — `──►` data/control flow · `[(…)]` database · `{{…}}` external service · dashed = not wired / unverified.

---

## 1. System context — who talks to whom

```mermaid
flowchart LR
  user([Sales user / admin]) -->|browser| web["apps/web<br/>Next.js 16 · React 19<br/>pages · server actions"]
  visitor([Anonymous visitor]) -->|domain box| web
  web <-->|"RLS-protected reads/writes<br/>(user session)"| pg[("Supabase Postgres<br/>≈90 tables · RLS · SQL functions")]
  web -->|auth| sbauth{{Supabase Auth}}
  clock{{"Timer: GitHub Actions<br/>or Inngest (every 5 min)"}} -->|"Bearer CRON_SECRET"| tick["/api/jobs/tick<br/>(maxDuration 60 s)"]
  tick --> engine["packages/jobs<br/>sweep() + tick()"]
  engine <-->|"service-role,<br/>OrgScope per org"| pg
  engine --> ai["packages/ai<br/>16 Claude tasks"]
  engine --> prov["packages/providers<br/>cache · budget · breaker"]
  engine --> mail["Gmail / Outlook<br/>REST clients"]
  engine --> crm["packages/crm<br/>HubSpot"]
  engine --> fetch["Guarded fetch<br/>(SSRF-safe crawler)"]
  ai -->|"Messages API<br/>+ web_fetch tool"| anth{{Anthropic}}
  prov --> apollo{{Apollo}}
  prov --> hunter{{Hunter}}
  prov --> zb{{ZeroBounce}}
  mail --> gm{{Gmail / Microsoft Graph}}
  crm --> hs{{HubSpot}}
  fetch --> web2{{"Public web:<br/>RSS · Atom · JSON · HTML"}}
  engine -.-> resend{{"Resend (product emails)"}}
```

---

## 2. Package / module map

```mermaid
flowchart TB
  subgraph apps
    W["apps/web<br/>UI · server actions · /api/*"]
  end
  subgraph packages
    J["jobs<br/>queue · runner · registry<br/>34 handlers · fetch · extract<br/>mailbox · email"]
    A["ai<br/>task framework · client · models<br/>16 tasks · claims · untrusted"]
    P["providers<br/>contract · registry · call pipeline<br/>apollo · hunter · zerobounce"]
    D["db<br/>migrations 0001-0047<br/>rules · icp · identity · contact<br/>needs-you · style · crypto"]
    C["crm<br/>hubspot"]
    U["ui<br/>component library"]
  end
  W --> D
  W --> U
  W --> J
  J --> A
  J --> P
  J --> D
  J --> C
  P --> D
  A -.->|"no dependency<br/>(by design)"| U
```

---

## 3. The queue and the heartbeat

```mermaid
sequenceDiagram
  autonumber
  participant T as Timer (GH Actions / Inngest)
  participant R as /api/jobs/tick
  participant Q as job_executions (Postgres)
  participant H as Handler (registry)
  participant X as External API / Model
  T->>R: GET (Authorization: Bearer CRON_SECRET)
  R->>R: verify secret (503 if unset, 404 if wrong)
  R->>Q: sweep(): enqueue 14 sweepers (idempotent keys)
  R->>Q: requeue_stalled_jobs(10 min)
  R->>Q: claim_job_executions(limit 5) FOR UPDATE SKIP LOCKED
  loop each claimed job (sequential)
    alt time left < reserve (20 s)
      R->>Q: give back (retryable)
    else
      R->>H: handler(OrgScope(org), payload)
      H->>X: fetch / model / provider call
      X-->>H: result
      H->>Q: enqueue follow-up jobs (idempotency keys)
      H-->>R: {ok} or {ok:false, permanent?}
      R->>Q: succeed(result) OR markFailed(backoff attempts² min ≤ 60)
    end
  end
  R-->>T: 200 + TickReport (always 200)
```

### Job state machine

```mermaid
stateDiagram-v2
  [*] --> queued: enqueue()
  queued --> running: claim (SKIP LOCKED)
  running --> succeeded: handler ok
  running --> queued: failure & attempts < max (run_at += attempts² min, ≤ 60)
  running --> failed: permanent OR attempts ≥ 3
  running --> queued: stalled > 10 min (requeue_stalled_jobs)
  succeeded --> [*]
  failed --> [*]
```

---

## 4. Sweepers → work (the producer map)

```mermaid
flowchart LR
  subgraph every_tick["Every tick (~5 min)"]
    SS[schedule_scans] --> scan[scan_source]
    SD[schedule_discovery] --> disc[discover_companies]
    SY[schedule_syncs] --> sync[sync_mailbox]
    SE[schedule_sends] --> send[send_message]
    AE[advance_enrollments] --> draft["draft + queue messages"]
    SR[schedule_recomputes] --> rec[recompute_scores]
    SG[schedule_signal_fetches] --> sig[fetch_company_signals]
    SF[schedule_followups] --> f1[rank_contacts]
    SF --> f2[enrich_company]
    SF --> f3[research_company]
    SF --> f4[research_competitor]
    SF --> f5[sync_hubspot]
    SF --> f6[prospect_competitor_customers]
    SN[send_notifications]
  end
  subgraph hourly["Hourly"]
    SL[schedule_learning] --> ap[analyze_performance]
    SGd[send_digests]
    SDm[schedule_demand] --> cd[cluster_demand]
    SP[schedule_preferences] --> lp[learn_preferences]
  end
  subgraph daily["Daily"]
    ER[enforce_retention]
  end
  disc --> research[research_company]
  scan --> score[score_opportunity]
  research --> score
  rec --> score
  f3 --> score
  classDef dead stroke-dasharray: 5 5
  ep["enrich_person"]:::dead
  re["resolve_entity"]:::dead
  pc["purge_contact_data"]:::dead
```
*Dashed: handlers that exist in the registry but have no enqueue site in the source (technical doc §14, F1).*

---

## 5. The main pipeline — input to output

```mermaid
flowchart TD
  ONB["Onboarding<br/>company site → draft_icp, recommend_sources"] --> ICP[("icps · personas · sources<br/>scoring_rules · products")]
  ICP --> TR["translateIcp()<br/>filters + 'unmapped' list"]
  TR --> DQ[("discovery_queries<br/>filters_hash unique")]

  DQ -->|schedule_discovery| DC["discover_companies<br/>≤5 pages × 25 · ≤100 credits"]
  DC -->|callProvider| PV{{"company.search<br/>(Apollo)"}}
  PV --> ABS["absorb(): canonicalize domain<br/>exclusion · suppression · match · create"]
  ABS --> CO[("companies · discovery_results")]

  ICP -->|schedule_scans| SC["scan_source<br/>fetch → extract → Haiku signals"]
  SC --> EV[("source_documents · source_events<br/>evidence · company_triggers")]
  SC --> CO

  CO --> RC["research_company<br/>Opus + web_fetch · 30-day freshness"]
  RC --> EV
  RC --> SO["score_opportunity"]
  EV --> SO
  ICP --> SO
  SO --> QA["qualify_opportunity (Opus)<br/>8 dimensions + composite"]
  QA --> RU["applyRules()<br/>adjust ±40 · floor · veto"]
  RU --> OP[("opportunities · opportunity_scores<br/>evidence · rule_trace")]

  OP --> RK["rank_contacts (+people.search)"]
  RK --> PE[("people · contact_points<br/>contact_fit_scores")]
  OP --> EN["enrich_company (30 d)"]
  OP --> WN["explain_why_now"]

  PE --> ENR["Enrollment in campaign"]
  ENR --> AD["advance_enrollments<br/>personalize_message (Opus)"]
  AD --> HU{{"Human approval<br/>(autonomy 0–1)"}}
  AD -->|"autonomy ≥ 2"| SD2["scheduled_at set"]
  HU --> SD2
  SD2 --> SM["send_message<br/>can_contact + footer + quota + mailbox"]
  SM --> GM{{"Gmail / Outlook"}}
  GM --> RP["sync_mailbox → classify_reply (Haiku)"]
  RP --> OUT[("messages · outcomes · suppressions")]
  OUT --> LN["analyze_performance (Opus)<br/>≥ 8 signals"]
  LN --> FND[("learning_findings")]
  FND -->|"human approves"| ICP
```

---

## 6. Discovery in detail

```mermaid
flowchart TD
  A[claim_due_discovery_queries<br/>advances next_run_at, skips saturated orgs] --> B[discover_companies]
  B --> C{open/resume discovery_run}
  C -->|already live| X1[skip]
  C --> D[loop: pages < max_pages AND credits < budget]
  D --> E["searchCompanies(filters, cursor, 25)"]
  E --> F{callProvider}
  F -->|breaker open| R1[refused: breaker_open]
  F -->|cache hit| G
  F -->|budget out| R2[refused: budget_exhausted]
  F -->|call ok| G[items]
  G --> H[absorb each item]
  H --> I{outcome}
  I -->|no domain| N1[invalid]
  I -->|ICP exclusion| N2[excluded + reason]
  I -->|on suppression list| N3[suppressed]
  I -->|known company| N4[matched]
  I -->|else| N5[new → companies row]
  N5 --> J["≤25 new → research_company"]
  D -->|cursor saved each page| D
  D --> K[finish_discovery_run<br/>stop_reason: exhausted | page_cap | credit_budget | …]
```

---

## 7. Scanning a source

```mermaid
flowchart TD
  S1[scan_source] --> S2{enabled & has URL?}
  S2 -->|no| S3[record failure / skip]
  S2 --> S4["fetchPage: SSRF check → DNS → connect-time re-check<br/>15 s · 4 MiB · ETag"]
  S4 -->|304| S5[record success, done]
  S4 -->|blocked/failed| S6[record_source_failure → backoff]
  S4 --> S7["extract(): JSON Feed | RSS/Atom | HTML | unreadable"]
  S7 --> S8["INSERT source_documents<br/>unique url_hash"]
  S8 -->|duplicate| S9[skip]
  S8 --> S10{"text ≥ 200 chars?<br/>(first 10 new docs)"}
  S10 -->|no| S11[no model call]
  S10 --> S12["extract_signals (Haiku)<br/>needs quote from document"]
  S12 --> S13["per signal: find/create company by domain<br/>insert source_events + evidence"]
  S13 --> S14{"dated trigger type?"}
  S14 -->|yes| S15[insert company_triggers]
  S14 -->|no| S16[evidence only]
  S15 --> S17[enqueue score_opportunity score:company]
  S16 --> S17
  S17 --> S18[merge_duplicate_evidence · record_source_success]
```

---

## 8. Scoring & ranking logic

```mermaid
flowchart LR
  subgraph inputs
    I1[company row]
    I2["ICP summary"]
    I3["≤25 recent evidence rows"]
    I4["competitor relations<br/>signal event types"]
  end
  I1 & I2 & I3 --> Q["qualify_opportunity<br/>Opus · high effort · JSON schema"]
  Q --> V{{"parse() checks:<br/>8 labels, each 0-100 or unknown<br/>HOT needs ICP-fit + pain + trigger<br/>WARM needs ICP-fit"}}
  V -->|invalid| FAIL[run fails → retry/backoff]
  V --> M["model_score + priority"]
  M --> RE["applyRules(active rules)"]
  I4 --> RE
  RE --> S["score = clamp(model + Σ weights, 0–100)<br/>priority = best floor; veto → ignore"]
  S --> W[(opportunity_scores row<br/>+ rule_trace + versions)]
  S --> U{"priority_set_by = user?"}
  U -->|yes| KEEP[keep human priority]
  U -->|no| SET[set priority]
```

### Priority tiers

```mermaid
flowchart LR
  hot["HOT<br/>strong fit + pain + recent trigger"] --- warm["WARM<br/>fit established"] --- watch["WATCH<br/>not enough signal"] --- ignore["IGNORE<br/>weak fit or vetoed"]
```

### Contact ranking

```mermaid
flowchart TD
  P[each person] --> V1{departed?} -->|yes| Z0[score 0 · vetoed]
  P --> V2{title in a persona exclude list?} -->|yes| Z0
  P --> PS[for each persona]
  PS --> T["titleMatch ×3"] & SN["seniorityFit ×2"] & DP["departmentFit ×2"]
  T & SN & DP --> PM["personaMatch = weighted mean"]
  PM --> TOT["total = (personaMatch×5 + contactability×3 + recency×1) / 9"]
  TOT --> BEST[best persona wins; ties → persona.priority]
  BEST --> DM{"score ≥ 70?"} -->|yes| IDM[is_decision_maker = true]
  BEST --> PRIM{"human chose contact?"} -->|no| SETP[primary_person = top non-vetoed]
```

---

## 9. Outreach — gates before an email leaves

```mermaid
flowchart TD
  M0[message with scheduled_at] --> G1{already sent?} -->|yes| SK1[skip]
  M0 --> G2{send_attempted_at set?} -->|yes| PF1["PERMANENT FAIL<br/>'delivery unknown'"]
  M0 --> G3{outbound · approved · single valid address?} -->|no| PF2[permanent fail / skip]
  G3 --> G4["can_contact():<br/>suppressed? erasure hash?<br/>min days between contacts?<br/>30-day cap per address?<br/>org daily ceiling?"]
  G4 -->|no| RF[refuse with typed reason]
  G4 --> G5{unsubscribe URL buildable?} -->|no| RF
  G5 --> G6{org postal address set?} -->|no| RF
  G6 --> G7{monthly email quota left?} -->|no| WAIT[stay queued]
  G7 --> G8{mailbox with allowance today?} -->|no| WAIT
  G8 --> G9["claim_mailbox_send (atomic counter)"]
  G9 --> G10["UPDATE messages SET send_attempted_at<br/>WHERE both null (compare-and-set)"]
  G10 -->|lost race| SK2[skip]
  G10 --> SEND["Gmail/Outlook send<br/>+ footer + List-Unsubscribe"]
  SEND --> REC["record sent_at · usage · contact_frequency<br/>opportunity → contacted"]
```

### Reply handling

```mermaid
flowchart LR
  IN[incoming mail] --> CL["classify_reply (Haiku)"]
  CL -->|positive| A1[stop sequence · notify human · status=replied]
  CL -->|neutral| A2[sequence continues]
  CL -->|negative / wrong_person| A3[stop]
  CL -->|unsubscribe| A4[stop + suppress address]
  CL -->|out_of_office| A5[continue later]
  CL -->|bounce| A6[stop · mark undeliverable · suppress]
```

---

## 10. Provider call pipeline

```mermaid
flowchart TD
  C0[callProvider] --> B{breaker open?} -->|yes| X[refuse + ledger]
  C0 --> K{cache hit?} -->|yes| H[return, cost 0 + ledger]
  K -->|no| BU{budget allows?} -->|no| X2[refuse budget_exhausted]
  BU -->|yes| RUN["run() — up to 3 attempts<br/>jittered backoff 500·2ⁿ ms"]
  RUN -->|ok| OK["outcome ok | empty | partial<br/>write ledger · write cache"]
  RUN -->|fails| FA["outcome failed | rate_limited<br/>ledger only · NEVER cached"]
```

TTL: search 24 h · enrich 30 d · person search 7 d · person match 30 d · verify 90 d · signals 48 h.

---

## 11. Learning loop

```mermaid
flowchart LR
  OUT[(outcomes<br/>replies · meetings · losses)] --> N{"≥ 8 signals<br/>in 90 days?"}
  OV[(human overrides<br/>ai_decisions)] --> N
  N -->|no| STOP["stop — spend nothing,<br/>say why"]
  N -->|yes| AN["analyze_performance (Opus)<br/>≤ 10 findings · ids from closed enum"]
  AN --> FN[(learning_findings)]
  FN --> HR{human reviews<br/>each finding}
  HR -->|approve| R1[one scoring rule]
  HR -->|approve| R2[one memory]
  HR -->|reject| X[nothing changes]
  R1 --> RC[request_score_recompute] --> SC[rescore opportunities]
  ED[draft edits ≥3 consistent] --> ST[style preference]
  NT[typed notes ≥3 statements] --> IP[infer_preferences · Sonnet] --> ST
  ST --> PM[injected into personalize_message]
```

---

## 12. Security & isolation layers

```mermaid
flowchart TB
  L1["Edge proxy.ts: session refresh · route bounce · CSP nonce<br/>(convenience, bypassable)"] --> L2
  L2["Server actions: membership / role checks · 404 not 403"] --> L3
  L3["Postgres RLS on every tenant table<br/>user_org_ids() · has_org_role() · same-org FK guard<br/>(THE boundary)"] --> L4
  L4["Engine: OrgScope injects org_id on service-role client<br/>sweepers use explicit global scope · nil-UUID default"] --> L5
  L5["Secrets: AES-256-GCM for mailbox/CRM tokens<br/>CRON_SECRET bearer (constant-time compare)<br/>Inngest HMAC"] --> L6
  L6["Outbound: SSRF guard (DNS + connect-time)<br/>can_contact gate · suppression · erasure hash"]
```

---

## 13. Deployment view (as designed)

```mermaid
flowchart LR
  gh["GitHub repo main"] -->|"push"| ci["CI: typecheck · lint · tests<br/>audit · build · bundle · Playwright"]
  gh -->|"git integration"| vc["Vercel project<br/>Next.js serverless + /api/jobs/tick"]
  gha["GitHub Actions: tick.yml<br/>*/5 * * * *"] -->|curl + Bearer| vc
  vc <--> sb[("Supabase<br/>Postgres + Auth<br/>pg_cron optional")]
  vc --> sentry{{Sentry}} & ph{{PostHog}}
```
*Notes:* `apps/web/vercel.json` has no `crons` (Hobby plan). Per `AUDIT.md` (2026-10-13), production lacked `CRON_SECRET`, vendor keys and the encryption key at that time — **[UNVERIFIED today]**.
