# Pass 21: summary

- **Commit audited:** `dab37db` (PR 18's tree)
- **Fixes:** branch `feat/pass-21-loop`, migration `0070_pass21_integrity.sql`
- **Method:** `/audit-system` across all 18 areas, run as five parallel read-only sweeps, then a fix → test → re-verify loop in the same session
- **Findings:** [03_FINDINGS.md](03_FINDINGS.md), with status per finding
- **Evidence:** the `raw-*.md` area reports

## Verdict

**Conditional. The code is close; production runs nothing.**

The core loop (Discover → Qualify → Enrich → Prioritize → Reach out → Track → Learn) is implemented end to end.

- **Verified on PGlite:** tenant isolation, at-most-once send, unsubscribe and approval enforcement.
- **Verified by scripted tests:** provider spend atomicity.

The defects this pass found cluster in three areas:

- **Recovery from partial failure.** A killed run, a stuck send claim and a starved sweep each stayed stuck forever.
- **Lifecycle edges.** A deleted workspace, the last owner, erasure and retention all had gaps.
- **Writes that reported success on 0 rows.**

All of those are fixed on this branch except the items marked Open. Nothing has run against the live database, a live model, real email or real vendors, because production has none configured.

## Counts

| Severity | Found | Fixed | Open | External / rejected |
|---|---|---|---|---|
| P0 | 0 | — | — | — |
| P1 | 9 | 8 (DB-002 in part) | 1 part (org purge job) | 1 (PROD-001) |
| P2 | 24 | 20 | 2 (JOB-203, rest of PERF-001) | 2 (SEC-001 external, PROD-002 rejected in part) |
| P3 | 19 | 15 | 4 | — |

## Blockers that need you

1. **Production secrets on the Vercel project `huntloop-web`, Production environment.** `/api/health` reports these as missing:
   - `CRON_SECRET`
   - `MAILBOX_ENCRYPTION_KEY`
   - `ANTHROPIC_API_KEY`
   - `RESEND_API_KEY` and `EMAIL_FROM`
   - `SENTRY_DSN` and `NEXT_PUBLIC_SENTRY_DSN`

   The vendor keys are optional but each turns on a stage: Apollo, Hunter, ZeroBounce, and the Google and Microsoft OAuth credentials.
2. **The GitHub `CRON_SECRET` secret**, set to the same value as on Vercel. `HUNTLOOP_URL` is already set. Without it, every scheduled "Engine tick" run fails at once. Better: set the `INNGEST_*` keys, because GitHub runs the schedule every 4–8 hours, not every 5 minutes.
3. **The canonical host.** `siteUrl` is `https://huntloop.pro`, but the tick calls `https://www.huntloop.pro`. Pick one, and redirect the other.
4. **Decisions:**
   - Billing (DN-07).
   - The grace period after which a deleted workspace is purged (DB-002). The privacy page promises "a recovery period".
   - Whether retention should remove more than contact points (DB-006).
   - Legal facts and counsel review for the Exchange (DN-08, DN-93).
5. **The stray "Vercel – huntloop" project,** which fails on every PR. Delete it in Vercel (DN-04).

## Top 10 fixed this pass

| # | Problem | Fix |
|---|---|---|
| 1 | A killed discovery run blocked its search forever (ENG-001) | Reaper plus compare-and-swap adoption |
| 2 | Enrichment refresh starved every tenant (ENG-002) | `enrich_requested_at` marker |
| 3 | A stuck send claim was re-queued every tick and never shown (OUT-201) | Error written on the message |
| 4 | Gmail sync dropped replies but reported the inbox fresh (OUT-202) | INBOX filter, honest cursor, freshness only when drained |
| 5 | A model call could outlive the function and kill sends (JOB-202) | A per-request deadline |
| 6 | A deleted workspace kept its roles and Exchange presence (DB-001) | `has_org_role` and `delete_organization` |
| 7 | Reversed wins were counted forever (FLOW-001) | Retraction on move |
| 8 | Domain squatting on the Exchange, and Verified outliving a rename (TRUST-001/002) | Trigger |
| 9 | Last-owner and self-promotion holes (DB-004) | Trigger |
| 10 | Erasure left phone, LinkedIn and thread participants (DB-005) | `erase_contact` |

## Do not change

- `mutate()` and its role tiers.
- `FOR UPDATE SKIP LOCKED` claiming (0056).
- The `send_attempted_at` at-most-once claim.
- The 0051 approval trigger.
- `can_contact` failing closed.
- `fetchPage`'s per-hop and connect-time address checks.
- Provider credit reservation (0052).
- `wrapUntrusted` on every task.
- The total `HANDLERS` registry.
