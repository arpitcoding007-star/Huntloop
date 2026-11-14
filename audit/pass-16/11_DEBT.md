# Pass 16 — technical debt

Source: reviewer E §9 (`_raw/_debt.md`), plus debt-shaped findings from reviewers A–D. Counts are over non-test source in `apps/web/{app,lib}` and `packages/*/src` at `7e09759`.

| Marker | Count | Note |
|---|---|---|
| `as any` | **101** | `scripts/audit.mjs:445` caps it at 104 (ratchet) |
| `: any` / `any[]` annotations | **94** | **Not capped** (DEBT-202) |
| `as unknown as` | 11 | e.g. `fetch.ts` (undici types) |
| `@ts-ignore` / `@ts-expect-error` | 0 / 0 | — |
| `eslint-disable` | 73 (76 with tests) | 45 file-wide `@typescript-eslint/no-explicit-any` across **35 files**, 15 line-level `no-explicit-any`, 6 `no-control-regex`, 5 `jsx-a11y` |
| TODO / FIXME / HACK / XXX | 0 / 0 / 0 / 0 | — |

**tsconfig strictness:** every package has `strict: true` and `noUncheckedIndexedAccess: true`. `apps/web/tsconfig.json` has `strict: true` but **no `noUncheckedIndexedAccess`**, and it has `allowJs: true`. All use `skipLibCheck: true`. There are no generated DB types: `packages/db/src/types.ts` is "maintained by hand" (`docs/operations/migrations.md:117`). That is the root cause of the `any` casts.

| Debt | Where | Kind |
|---|---|---|
| Placeholder CRM link host | `packages/jobs/src/handlers/sync-hubspot.ts:125` | Hardcoded fallback (DEBT-201) |
| `any` ratchet blind spot | `scripts/audit.mjs:438-459` | DEBT-202 |
| Dead env names (Stripe ×3) | `.env.example` | DEBT-203 |
| Ops docs contradicting code | `heartbeat.md:70-96`, `migrations.md:10,59`, `deployment.md:62,74`, `SETUP.md:24`, `tick/route.ts:6` ("see vercel.json"), domain doc | PROD-203 |
| Hand-rolled Inngest protocol | `apps/web/app/api/inngest/route.ts` | SEC-202 |
| Unused but kept | `ActionRail` (kitchen-sink only); Toast mounted at root | Pass-15 DEBT-001: by design, accepted |
| `/kitchen-sink` on previews | `proxy.ts:58,221` | Pass-15 DEBT-002 withdrawn; still true that it is reachable on previews, fixtures only (Info) |
| Duplicate `escapeHtml` | `send-message.ts:871` vs `email/templates.ts:16` | Minor duplication (Info) |


## Debt-shaped findings from the other areas

| Debt | Why it will cause bugs | Finding |
|---|---|---|
| `messages.error` means both "permanent" and "try later" | One column, two meanings, and the sweeper reads it as permanent | OUT-202 |
| Schema readiness is one table name, bumped by hand | It lags the migrations every time a migration adds no new table, or someone forgets to bump it | PROD-201 |
| First-run reads handler results by field name, untyped | The handler changed shape and nothing failed | ENG-201 |
| Six status columns without CHECK or transition rule | Any writer can invent a state | DB-202 |
| `job_executions` idempotency keys spelled two ways for `research_company` | Duplicate research and spend | JOB-205 |
| Response shapes differ across actions and routes | Callers special-case each one | API-205 |
| Hand-rolled Inngest protocol | Dead code that looks like a second driver | API-204 |
| Ops docs that contradict code | The runbook a person follows at 2 a.m. is wrong | PROD-203, ENG-204, DB-204 |

## Simplify or remove

| Candidate | Recommendation | Why |
|---|---|---|
| `apps/web/app/api/inngest/route.ts` and the Inngest env names | Remove, or replace with the official SDK if Inngest is wanted | Unverified protocol; `tick.yml` is the only driver (API-204) |
| Vercel Cron references in docs and `tick/route.ts:6` | Remove | Obsolete driver (PROD-203) |
| Stripe env names in `.env.example` | Remove until billing exists | Dead names (DEBT-203) |
| `scheduled_at` as the sole go signal | Replace with an eligibility check at send time | OUT-201 |
| `LATEST_TABLE` probe | Replace with the migration ledger or a marker function | PROD-201 |

## Do not change

These held up under this pass's checks. A fix that weakens one of them is a regression.

- RLS as the tenant boundary on all 82 tables, `user_org_ids()`/`has_org_role()`, `security_invoker` views, and `enforce_same_org_refs` on every intra-tenant FK (reviewer B §11).
- `OrgScope` injecting `org_id` on every service-role write; sweepers fan out per org (reviewer D §10).
- `send_message`'s at-most-once claim (`send_attempted_at`), the `send:<id>` key, and fail-closed `can_contact` (reviewer D §10).
- The SSRF-guarded `fetchPage` and the provider seam: no vendor host is called outside `packages/providers` and `packages/crm` (reviewer C §9).
- The claim and evidence model: a fact needs a source, unknown stays NULL (CHECK on `evidence`).
- Constant-time secret compares that fail closed when the secret is unset (cron, Inngest, digest, seal).
- `safeNextPath` on every redirect; CSV formula escaping on export.
- `migrate.ts`: one transaction per file plus its ledger row, idempotent re-runs.
- `check-admin-imports`, `scripts/audit.mjs` as the place findings close, and the scripted-fake test harnesses.
