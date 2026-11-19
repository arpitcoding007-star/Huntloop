## Debt register and counts

Counts were taken over non-test source in `apps/web/{app,lib}` and `packages/*/src`:

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

