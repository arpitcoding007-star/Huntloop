# W7 — fix re-verification and production probe

## Mechanical baseline (tree = `69c8d4c` + uncommitted 0051)

| Check | Result |
|---|---|
| typecheck, lint | pass |
| tests | db migrations 407 · migrator 9 · security leads 59 · rules 150 · admin-imports · schema-reference · jobs 478 · providers 20 · crm 86 · ai 243 · web 296 — all pass |
| site audit | 47 checks, 0 failing, 1 warning (LEGAL-01) |
| build, bundle | pass · 201.7 / 275 kB |

**TEST-301 (Low).** In the full `npm run verify` run on this machine, which took over 10 minutes, two web tests hit the 90 s per-test timeout: `lib/ai/spend-guard.test.ts` "is refused by qualify()" and `lib/data/merge-actions.test.ts` "merges the pair…". Re-run alone, the web suite passed 296/296 in 36 s. These are load-sensitive timeouts, not logic failures, but a CI runner under load can go red for no reason. Fix: find which import makes the first test of each file slow (the transform/import time was 133 s / 140 s of a 36 s run), or raise the timeout for those two files only.

## Pass-16 fixes at HEAD

| Fix | Holds? | Evidence |
|---|---|---|
| OUT-201 send-time guard | yes | `send-message.ts` `withdrawnOrHeld` before `can_contact`; 15 verify-jobs cases |
| OUT-201 advance does not finish over a waiting email | yes | 2 verify-jobs cases |
| DB-203 callback write | yes (PGlite) | verify-migrations block with 0049's grant re-applied |
| PROD-201 probe + loud lane failure | yes | SCHEMA-01; verify-jobs PGRST202 case |
| DB-201 (0051) | yes, **with a gap**: SEC-301 below | verify-migrations DB-201 block |

## Adversarial review of 0051

### [High] SEC-301: Approval can still be bypassed by omission: a member can schedule an unapproved message, or rewrite an approved one, through the raw API
- Confidence: CONFIRMED by reading the trigger. It is consistent with the 0051 test block: no case covers these writes, and the guard has no branch for `scheduled_at`, `subject`, `body_text` or `to_email`.
- Where: `packages/db/migrations/0051_safety_record_integrity.sql` `guard_message_integrity` (UPDATE branch). App behaviour for comparison: `inbox/actions.ts` approve sets `scheduled_at` **and** `approved_by` together (`:302-313`), and edit only touches rows with `scheduled_at is null` (`:398`).
- Evidence: the guard only checks that approver fields, *when written*, name the caller. Two paths remain open:
  1. `update messages set scheduled_at = now() where id = <draft>`, with `approved_by` left null. `send_message` needs only `scheduled_at` (step 3), so at autonomy 0–1 a message nobody approved goes out, and nothing records that anybody approved it.
  2. `update messages set body_text = …, to_email = … where id = <approved, unsent>`. The email goes to a new address, with new words, under the original approver's name.
- Impact: this is the human-approval gate (§46), the same class DB-201 closed for `approved_by`. It needs a member acting outside the UI, so High rather than Critical.
- Root cause: the guard protects the approver *columns* rather than the *approval*.
- Fix (in 0051, before it is applied anywhere): for sessions, require `approved_by = auth.uid()` when `scheduled_at` goes from null to set. When `subject`, `body_text`, `body_html` or `to_email` change on a row whose `scheduled_at` is set, either refuse or require that the same write clears `scheduled_at` and `approved_by` (a re-approval).
- Acceptance criteria: as `authenticated`, both writes above are refused; the app's approve, edit, reply and withdraw writes still pass.
- Test to add: two cases in the verify-migrations DB-201 block.
- Effort: S · Mechanizable: yes (test) · Status: New (gap in the uncommitted HL-1604 fix)

### Checked in 0051, nothing found
- Definer functions (`erase_contact`, `delete_organization`, `record_unsubscribe`) and FK `on delete set null` actions run as another role, so the guard skips them, as intended. This follows the `guard_mailbox_safety` precedent.
- 0049's opportunity trigger writes only `scheduled_at`/`error` on unsent mail, so it is allowed.
- Viewers are refused by the `has_org_role(…,'member')` policies before the trigger runs.
- Resurrecting a `stopped` enrollment to `active` through the raw API is still possible (Low; not filed separately). The UI only resumes parked or paused enrollments; filed under SEC-301's follow-up note.

## Production (GET only, 2026-11-14)

| URL | Result | vs pass 16 |
|---|---|---|
| `https://www.huntloop.pro/api/health` | 503 · commit `8021d3f` · schema "complete" via `message_unsubscribe_tokens` · `cronSecret`, `credentialEncryption` false · all integrations false | unchanged |
| `https://huntloop.pro/api/health` | no response (TLS) | unchanged (PROD-001) |
| `https://www.huntloop.pro/` | 200 · CSP script-src report-only · HSTS, XFO, nosniff, Referrer, Permissions present | unchanged |
| `https://www.huntloop.pro/robots.txt` | `Host: huntloop.pro`, `Sitemap: https://huntloop.pro/sitemap.xml`, both on the TLS-failing apex | new observation → SEO-301 (W3) |

Production is still pre-pass-15. Nothing from 95175a5..69c8d4c is deployed.
