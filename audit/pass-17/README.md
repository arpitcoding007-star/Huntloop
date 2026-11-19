# Pass 17 — index

**Date** 2026-11-14 · **Tree audited** `69c8d4c` (`feat/pass-15-audit-fixes`) + uncommitted HL-1604 (migration 0051) · **Scope** everything pass 16 left open: UX, accessibility, SEO, analytics, unread modules, failure injection, measured query plans, fix re-check, production probe. Plan first, then audited by it.

**Counts:** High 2 · Medium 6 · Low 5 · Info 1 (14). No Critical. Start with [08_FINDINGS.md](08_FINDINGS.md).

| File | What it is |
|---|---|
| [00_PLAN.md](00_PLAN.md) | The plan this pass followed: workstreams, methods, environment limits |
| [01_UX.md](01_UX.md) | W1: 172-load sweep, hand walk, provenance, design-system check |
| [02_A11Y.md](02_A11Y.md) | W2: axe on 43 routes × 2 themes × 2 devices |
| [03_SEO_ANALYTICS.md](03_SEO_ANALYTICS.md) | W3: crawl policy, canonicals, analytics and a measurement plan |
| [04_MODULES.md](04_MODULES.md) | W4: the onboarding and directory modules pass 16 did not trace |
| [05_FAILURE.md](05_FAILURE.md) | W5: failure-injection inventory and malformed-response probe |
| [06_PERF.md](06_PERF.md) | W6: EXPLAIN ANALYZE at volume on PGlite, FK index scan |
| [07_RECHECK.md](07_RECHECK.md) | W7: verify run, pass-16 fixes, adversarial review of 0051, prod GETs |
| [08_FINDINGS.md](08_FINDINGS.md) | All findings, fix order, mechanizable checks |
| [09_ACCESS_NEEDED.md](09_ACCESS_NEEDED.md) | What only the owner's access can settle (A1–A9) |

**Method notes.** Read-only on the repo apart from this folder. Probes (`provider-malformed.ts`, `perf.ts`, `ux/sweep.spec.ts`) lived in the session scratchpad and used the repo's own dependencies. The UI sweep ran on a production build in demo mode. Database measurements are PGlite (WASM, one connection): plan shapes and ratios carry over, seconds do not. One step was refused by the safety classifier, injecting axe-core from a CDN into the browser page; the sweep used the repo's installed `@axe-core/playwright` instead.

## Not verified in this pass

See [09_ACCESS_NEEDED.md](09_ACCESS_NEEDED.md) for the exact access each item needs: hosted Supabase behaviour, live vendors, real multi-connection concurrency, mailboxes, HubSpot, dashboards (Vercel, Supabase prod, GitHub, OAuth consoles, Sentry, DNS), legal facts, screen-reader testing, and a post-deploy pass.
