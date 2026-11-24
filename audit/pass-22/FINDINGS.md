# Pass 22: findings

## Fix status

| ID | Status | Fix | Proof |
|---|---|---|---|
| V-01, V-02 | **Fixed** | Both rows of a turn get the same columns (`lib/data/conversation-turns.ts`) | `opp.agent`, `asst.ask`; unit test; live browser test; audit check AI-TURNS |
| V-04 | **Fixed** | A known opportunity is updated, not upserted. A failed lookup stops the job instead of overwriting a person's priority | `prio.override-rescore`; simulation, 5 checks |
| V-05 | **Fixed** | Events are read through their document. A failed read fails the run | `learn.full` with no refused query; simulation, 2 checks; audit check DATA-C11 |
| V-16 | **Fixed** | The new owner is emailed, unless they assigned it to themselves. Assigning an opportunity that no longer exists is now refused | `email.assign`; template test |

The simulation and audit checks were also run against the old code and failed there. `results-before-fixes.json` holds the failing `opp.agent`, `asst.ask`, `prio.override-rescore` and `email.assign` checks. Everything below is as found.

## Implemented but not working

| ID | Finding | Cause | Evidence |
|---|---|---|---|
| V-01 | The opportunity agent never completes a conversation | `opportunities/[id]/actions.ts` inserts the user and assistant rows together. The user row omits `cited_evidence_ids`; in a bulk insert supabase-js lists the union of columns, so the missing value is sent as null into a `not null` column | `opp.agent`: 23502 |
| V-02 | Ask Huntloop never completes a conversation | Same pattern in `assistant/actions.ts` for `citations` (and `actions`) | `asst.ask`: 23502 |
| V-03 | `https://huntloop.pro` fails TLS | The apex domain serves a certificate for another name; `siteUrl` still points there | Production probe: SEC_E_WRONG_PRINCIPAL |

## Partially implemented

| ID | Finding | Cause | Evidence |
|---|---|---|---|
| V-04 | Rescoring fails for every opportunity whose priority a person set | `score-opportunity.ts` omits `priority` and `priority_reason` from an upsert. Postgres checks `not null` on the proposed row before resolving the conflict. The job retries, then dies | `prio.override-rescore`: 23502 |
| V-05 | Learning shows zero results for every source | `analyze-performance.ts` `loadSourcePerformance` filters `source_events.source_id`, which does not exist, and ignores the error. The C1 check parses `select` lists, not filters | `learn.full`: 42703 |
| V-06 | Company gaps section has no writer | Nothing inserts `company_gaps` | Code search |
| V-07 | Discovered feeds are stored, not followed | No job reads `discovered_feeds` as sources | Code search |
| V-08 | Regulated categories show a notice only | No rule blocks anonymous cards or unverified buyers | Code search |
| V-09 | Exchange moderation is operator SQL | No screen | Code search |
| V-10 | Individual suppliers cannot be verified | `kind = 'individual'` exists; verification is undecided (EX-7) | Code search |
| V-11 | Retention deletes contact details only | Scope decision DB-006 | `priv.retention` |
| V-12 | Content security policy is report-only | Waiting for monitoring | Code |
| V-13 | Legal pages are drafts | Seven facts and counsel review (LEGAL-01, DN-08, DN-93) | `audit:site` warning |
| V-14 | Error and usage monitoring is not configured | No DSN or key | `/api/health` |
| V-15 | A stopped engine does not alert anyone | The workflow fails without paging | Last five runs failed |

## Not implemented

| ID | Finding | Evidence |
|---|---|---|
| V-16 | No email when work is assigned. The master guide says there is one | `email.assign`; no such template |
| V-17 | Record search: Jump-to finds pages only | `search.records` |
| V-18 | Profile email and picture editing | No screen |
| V-19 | Purge of deleted workspaces | No job |
| V-20 | Rehearsed database restore | No record |

## Planned, confirmed absent

| Item | Evidence |
|---|---|
| Payment | `bill.checkout`: no checkout code |
| Verified domain for visibility level 3 (EX-4) | `ex.unverified`: level 3 accepted with no domain verification (set directly in SQL; no trigger or constraint refuses it) |
| Supplier invitations and public claim pages | Code search |

## Configuration dependencies in production

| Missing | Blocks |
|---|---|
| `CRON_SECRET` (Vercel and GitHub) | All background work |
| `ANTHROPIC_API_KEY` | All AI |
| `APOLLO_API_KEY`, `ENRICHMENT_API_KEY`, `EMAIL_VERIFICATION_API_KEY` | Discovery, enrichment, verification |
| `MAILBOX_ENCRYPTION_KEY`, Google and Microsoft OAuth | Mailboxes, sending, replies, HubSpot |
| `RESEND_API_KEY`, `EMAIL_FROM` | Product email |
| `HUNTLOOP_EXCHANGE` | Exchange |
| `PUBLIC_RESEARCH_ENABLED` | Public company reader |
| Sentry and PostHog keys | Monitoring |
| Deployment of `dab37db` and the pass-21 branch; migrations 0069 and 0070 | Exchange quotas, offering page reader, pass-21 fixes |

## Mock data

Demo mode shows fixtures only when no database is configured, and labels them. In the isolated stack with a database, no fixture appeared on any screen visited. AI "worked examples" are refused rather than stored.
