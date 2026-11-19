# Pass 20 — feature inventory (dashboard and panels)

Statuses: `Working` · `Partial` · `Broken` · `Mock/Demo-only` · `Dead` · `Missing`. "Working" means the chain from UI → action → logic → table/job → UI was traced in code, not run against a live database (see README, "Not verified"). All 31 `/demo/*` routes rendered with 200 and no console or server errors, and e2e passed 388/392. That proves the demo branches only.

## Command Center, Needs-you, Opportunities, Pipeline, shell

| Feature | Entry | Backend | Status | Finding |
|---|---|---|---|---|
| Priority counts (Hot/Warm/Watch/Ignore) | `dashboard/page.tsx:166-209` | `lib/data/dashboard.ts` head counts on `opportunities` | Working (errors swallowed) | PANEL-106 |
| Header "N qualified against your ICP" | `dashboard/page.tsx:488-490` | same | Partial | PANEL-112 |
| Why-now cards, evidence | `dashboard/page.tsx:220-322` | `dashboard.ts:133-207` | Working | — |
| Loop, outcomes, sending capacity, signals, source performance | `dashboard/page.tsx:330-458` | `opportunities`, `messages`, `outcomes`, `mailboxes`, `company_triggers`, `evidence` | Working | PANEL-112 (two reply counts) |
| Hunt now | `HuntNowButton.tsx:21` | `huntNowAction` → `followActiveIcp` → `discovery_queries` → `schedule_discovery` | Partial | PANEL-105 |
| What changed | `ChangesCard.tsx`, `MarkSeen.tsx` | `lib/data/changes.ts` | Partial | PANEL-104 |
| Learning news, QuestionCard | `LearningNewsCard.tsx`, `QuestionCard.tsx` | `preference_state`, `memories`, `user_questions` | Working | — |
| LearningNudge, IcpQualityCard | `dashboard/page.tsx:600-604` | `nudges.ts`, `getIcpQuality` | Partial | PANEL-114 |
| Needs-you ranking | `needs-you/page.tsx` | `packages/db/src/needs-you.ts` `gatherAttention` (score/25 + fit/100 tie-breaks) | Working (ranking), Partial (labels and errors) | PANEL-103, 106, 111 |
| Snooze, clear snoozes | `NeedsYouList.tsx:109` | `attention_snoozes` | Working | — |
| Unsnooze one | — | `unsnoozeAttentionAction` | Dead | PANEL-113 |
| Log touch, reach-out goal | `NeedsYouList.tsx:263`, `ReachOutGoal.tsx` | `activities`, `outcomes` | Working | — |
| Opportunities list, filters | `OpportunityTable.tsx` | `listOpportunities` (500 cap, filters in the browser) | Partial | PANEL-108 |
| Bulk archive, enrol | `OpportunityTable.tsx:497,668` | `opportunities`, `enrollments` (unique key) | Working | PANEL-301 (downstream) |
| Opportunity brief, evidence, triggers | `opportunities/[id]/page.tsx` | `getOpportunity` | Working | PANEL-103 (angle) |
| Contact fit on opportunity | `[id]/page.tsx:312-324` | `contact_fit_scores` (wrong column) | **Broken** (Demo-only) | PANEL-102 |
| Work out why now | `WhyNowButton.tsx` | `refreshWhyNowAction` → `why_now`, `why_now_written_at` | Partial | PANEL-110 |
| Ask agent | `AgentPanel.tsx:80` | `askAgentAction` → `conversation_messages` | **Broken** | PANEL-101, 107 |
| Disagree, Not a fit, Assign | `OpportunityActions.tsx` | `record_override`, `outcomes`, `owner_id` | Working | — |
| Push to HubSpot | `OpportunityActions.tsx:134` | `crm_sync_requested_at` → `schedule_followups` → `sync_hubspot` | Working | — |
| Research this | `ResearchThisButton.tsx` | `research_asked_at` → `research_company` | Working | — |
| Deal value | `DealValue.tsx` | `estimated_value_cents` | Partial | PANEL-116 |
| Next step, activity timeline | `NextStepBar.tsx`, `ActivityPanel.tsx` | `opportunities.next_step*`, `activities` | Working | — |
| Pipeline board | `PipelineBoard.tsx` | `listAssignments` (unbounded) | Partial | PANEL-109, 116 |
| Shell nav, banner, SetupCard, account menu | `OrgShell.tsx`, `layout.tsx` | `chrome.ts` | Working (every href resolves; non-members get 404) | — |
| Shell Needs-you badge | `OrgShell.tsx:183` | full gather on every page | Partial | PANEL-106, 117 |

## Companies, Competitors, Intelligence, Sources, Imports, Analyze, Demand

| Feature | Entry | Backend | Status | Finding |
|---|---|---|---|---|
| Companies list | `companies/page.tsx` | `listCompanies` (unbounded) | Partial | PANEL-208 |
| Company add, edit, remove | `CompanyManager.tsx` | `companies`, 0049 propagation | Working | — |
| Merge review | `MergeReview.tsx` | `merge_candidates` → `merge_companies_for_org` | Partial | PANEL-206, 213 |
| Company detail: competitors | `BriefSections.tsx:118` | `company_competitor_signals` | Partial (inference shown as fact) | PANEL-201 |
| Company detail: gaps | `BriefSections.tsx:168` | `company_gaps` (no writer) | Dead | PANEL-205 |
| Evidence "Seen in N sources" | `EvidenceList.tsx:112` | `evidence_citations` | Partial | PANEL-207 |
| Competitors list, detail, research | `CompetitorList.tsx`, `CompetitorEditor.tsx` | `competitors`, `research_competitor` | Partial (list) / Working (detail) | PANEL-210 |
| Intelligence | `intelligence/page.tsx` | `evidence` (50), `company_triggers`, `ai_decisions` | Partial | PANEL-204, 212 |
| Sources CRUD, suggest, scan now | `SourceManager.tsx` | `sources` → `schedule_scans` → `scan_source` | Working (bulk Partial) | PANEL-215, 211 |
| Discovered feeds | — | `sources.config.discovered_feeds` | Missing (no reader) | PANEL-214 |
| CSV import | `ImportForm.tsx` | `importCsvAction` (chunked) | Partial | PANEL-203, 209 |
| Analyze URL, why-now | `Analyzer.tsx` | `qualify` via recorder (`canSpend`) | Working | PANEL-216 |
| Analyze → Save | `Analyzer.tsx:458` | blind upserts | **Broken** on existing rows | PANEL-202 |
| Demand board | `DemandBoard.tsx` | `demand_*` → `cluster_demand` | Partial | PANEL-201 (quotes), 208 |

## Outreach, Inbox, Assistant, Memory, Learn, Performance, Analytics

| Feature | Entry | Backend | Status | Finding |
|---|---|---|---|---|
| Campaign create, edit, start | `OutreachManager.tsx:811` | `campaigns` | **Broken** (enrollments never restart) | PANEL-301, 308 |
| Archive campaign | `OutreachManager.tsx:736` | send-time withdraw | Working (send), Partial (UI) | PANEL-304 |
| Sequences, steps | `OutreachManager.tsx:434-669` | `sequences`, `sequence_steps` | Working | — |
| Enrollment Resume, Stop | `OutreachManager.tsx:870-937` | `enrollments`, `withdrawQueuedMail` | Partial | PANEL-309 |
| Mailbox connect, disconnect | `/api/mailboxes/[provider]/*` | `mailboxes` (encrypted) | Working | PANEL-404 (no audit) |
| Drafting engine | — | `advance_enrollments` (`due_enrollments_fair`) | Working | — |
| Sending engine | — | `schedule_sends` → `send_message` | Partial | PANEL-302 |
| Approve, edit, reject | `InboxView.tsx:628-695` | `messages` (0051 guard) | Working / Partial | PANEL-304 |
| Redraft | `InboxView.tsx:680` | `enrollments.redraft_note` | Partial (can lose the draft) | PANEL-305 |
| Reply from inbox | `InboxView.tsx:476` | `messages` | Partial | PANEL-303 |
| Thread list | `inbox/page.tsx` | `listThreads` (unbounded) | Partial | PANEL-303, 311 |
| Reply classification | `sync-mailbox.ts` | `threads`, `suppressions`, `outcomes` | Partial (no correction) | PANEL-307 |
| Outreach log | `outreach/log/page.tsx` | `activities`, `messages` | Working | — |
| Assistant | `AssistantChat.tsx` | `conversations` | Partial | PANEL-306 |
| Memory (add, edit, ingest) | `MemoryManager.tsx` | `memories` → used in drafting | Working | — |
| Learn: run analysis | `LearningReview.tsx:115` | `learning_runs` → hourly `schedule_learning` | Partial | PANEL-310 |
| Learn: approve, reject finding | `LearningReview.tsx:402` | `scoring_rules`, `memories` | Partial | PANEL-312 |
| Performance metrics, narrative, goals, report | `performance/*` | `getPerformance`, `explain` | Working | PANEL-314 (export) |
| Is the loop working? | `ActivationCard.tsx` | `org_activation` view | Partial (reply figures wrong) | PANEL-313 |
| Analytics (AI spend) | `analytics/page.tsx` | `getSpend` | Partial (no demo banner) | PANEL-314 |

## Settings, Team, Ops, endpoints

| Feature | Entry | Backend | Status | Finding |
|---|---|---|---|---|
| General: name, postal address, retention, voice, backlog, quiet days | `settings/actions.ts:43,125` | `organizations.settings` → read by engine | Working | PANEL-404 |
| Notifications | `notification-actions.ts` | `notification_preferences` → `send_digests` | Working | — |
| Activity log | `settings/activity` | `audit_logs` | Partial | PANEL-404 |
| ICP save, apply proposal, personas, look-alike | `settings/icp/*` | `icps` → `discovery_queries`; `personas` → `rank_contacts` | Working | — |
| ICP activate, delete | `icp/actions.ts:256,297` | `icps` | **Broken** (old search keeps running) | PANEL-401 |
| Scoring rules, rescore | `settings/scoring/*` | `scoring_rules` → `score_opportunity` | Working | — |
| Draft rules (AI) | `scoring/actions.ts:62` | `scoring_rules` | Partial | PANEL-406 |
| Product | `settings/product/*` | `products` | Working | PANEL-409 |
| HubSpot connect | `settings/integrations/*` | `hubspot_connections` → `sync_hubspot` | Working | PANEL-407 |
| Privacy: erase, export, delete workspace | `settings/privacy/*` | `erase_contact_for_org`, `export_*`, `delete_organization` | Working | PANEL-404 |
| You (personal learning) | `settings/you/*` | `memories`, `preference_signals` | Working | — |
| You: "Is it working?" trend | `settings/you/page.tsx:22` | `messages.approved_at` (missing column) | **Broken** (Demo-only) | PANEL-115 |
| Team: roles, invite, revoke, join requests, assignments | `team/*` | `memberships`, `invitations` | Working | PANEL-402 (seats) |
| Ops: queue, dead letters, providers, retry, cancel | `ops/*` | `job_health`, `queue_pressure`, `retry_job` | Partial | PANEL-403, 405, 410 |
| Kill switch | SQL only (`platform_pauses`) | read by sending, AI and providers | Working (no UI by design) | PANEL-410 |
| `/api/health`, `/api/jobs/tick`, `/api/inngest`, digest unsubscribe | `app/api/*` | — | Working | PANEL-411 |
| Billing | — | — | Missing (held by decision #1) | PANEL-408 |
