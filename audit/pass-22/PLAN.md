# Pass 22: implementation plan

Sizes: S up to 2 days, M up to 1 week, L up to 3 weeks. Every fix needs a test that fails without it.

## P0 — Defects in shipped flows (done)

| # | Work | Finding | Size | Acceptance |
|---|---|---|---|---|
| 1 | Give both rows identical keys in the two conversation inserts (or pass `defaultToNull: false`) | V-01, V-02 | S | `opp.agent` and `asst.ask` pass |
| 2 | Update existing opportunities instead of upserting a partial row; or always send the kept priority and reason | V-04 | S | `prio.override-rescore` passes, the person's priority is unchanged and a score is added |
| 3 | Resolve source events through `source_documents`; surface the error | V-05 | S | `learn.full` with no refused query and non-zero source results |
| 4 | Add an audit check: bulk inserts with unequal keys, and filter columns against the schema | V-01, V-05 | S | Fails on the current tree, passes after fixes |
| 5 | Add these flows to `e2e-live`, failing on any refused query | All | M | Runs in CI |

## P1 — Make production operate (owner access)

| # | Work | Depends on | Size |
|---|---|---|---|
| 6 | Correct the apex certificate and choose one canonical host | Domain access | S |
| 7 | Deploy the tested tree; apply migrations 0069 and 0070 | 1–3 | S |
| 8 | Set `CRON_SECRET` on Vercel and GitHub; move to minute-level scheduling or Inngest | 7 | S |
| 9 | Set encryption key, AI, data, OAuth and email credentials; run `npm run live-check` | 7 | M |
| 10 | Configure Sentry and an engine-stopped alert | 8 | S |
| 11 | Complete one live loop, discovery to reply, in the product | 8–10 | M |
| 12 | Rehearse a restore; confirm point-in-time recovery | Supabase access | S |
| 13 | Supply legal facts; complete counsel review of prospecting and Exchange | Owner | — |

## P2 — Complete partial features

| # | Work | Finding | Size |
|---|---|---|---|
| 14 | Assignment email: done. A per-person preference is still to do | V-16 | S |
| 15 | Record search in Jump-to | V-17 | M |
| 16 | Decide and build retention scope and workspace purge | V-11, V-19 | M |
| 17 | Offer discovered feeds as one-click sources | V-07 | S |
| 18 | Write or remove company gaps | V-06 | S |
| 19 | Enforce the content security policy after a quiet week | V-12, 10 | S |
| 20 | Profile editing | V-18 | S |

## P3 — Open Exchange

| # | Work | Depends on | Size |
|---|---|---|---|
| 21 | Decide EX-1, EX-3, EX-4, EX-6 to EX-10 | Owner, counsel | — |
| 22 | Enforce verified domain for level 3 | EX-4 | M |
| 23 | Enforce regulated-category rules | EX-10 | S |
| 24 | Moderation screen | — | M |
| 25 | Individual supplier verification | EX-7 | M |
| 26 | Switch on; enable categories with five active suppliers | 11, 13, 22–24 | S |
| 27 | Supplier invitations and claim pages | EX-8, counsel | L |

## P4 — Commercial

| # | Work | Depends on | Size |
|---|---|---|---|
| 28 | Payments, customer portal and webhooks | Billing decision | L |
| 29 | Supplier plans | 28, 26 | M |
