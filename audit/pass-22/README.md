# Pass 22: independent verification of every documented capability

- **Date:** 24 November 2026
- **Tree tested:** `dab37db` plus the uncommitted `feat/pass-21-loop` work (migrations to 0071 after the fixes)
- **Production:** at the time of the audit, `www.huntloop.pro` ran commit `1a59f5a`, schema 0068. After pull requests 19 and 20 merged, it was rechecked: commit `d8c272c`, schema 0071 complete, still `ok:false` because no production services are configured
- **Product code changed:** V-01, V-02, V-04, V-05, V-06, V-16, V-17 and V-18 fixed (others built and off) after the audit, in the same session. The results from before the fixes are in [RESULTS-before-fixes.md](RESULTS-before-fixes.md) and `results-before-fixes.json`

| File | Contents |
|---|---|
| [RESULTS.md](RESULTS.md) | 236 capabilities: classification, what is missing, evidence; and every recorded check |
| [FINDINGS.md](FINDINGS.md) | Defects and gaps, with cause and reproduction |
| [PLAN.md](PLAN.md) | Prioritized implementation plan |
| `results.json` | Raw results |
| `harness/` | The tests |

## Result

| Classification | Count |
|---|---|
| Fully functional and live | 7 |
| Built and tested but not live | 194 |
| Partially implemented | 9 |
| Implemented but not working | 1 |
| Not implemented | 2 |
| Planned for the future | 23 (9 planned, 14 uncommitted ideas) |

The product is broadly built and works end to end in isolation. It is **not** operating in production: no scheduled engine, AI, data, mailbox or email service is configured there.

## Method

1. **Isolated stack.** The production build of the web app, with every migration and row-level security, on `packages/db/testing`. The real engine runs through `/api/jobs/tick`.
2. **Simulated vendors.** Apollo, Hunter, ZeroBounce, Claude, Gmail, Microsoft Graph, HubSpot and Resend are answered by `harness/vendors.mjs` at the network edge. Adapters, retries, quotas and parsing are the real code.
3. **Real network.** Company sites, RSS feeds, a public Greenhouse board and mail DNS were read live through the product's own fetcher.
4. **Browser-driven checks.** 179 checks across `a.mjs` (accounts, onboarding, lists), `b.mjs` (daily work, scoring, knowledge, HubSpot), `c.mjs` (outreach, replies, safety, privacy), `d.mjs` (Exchange, public site, limits) and `e.mjs`, `f.mjs` (gaps) and `g.mjs` (autonomy levels). Each asserts the database row or vendor call, and records any query the database refused.
5. **Existing suites, rerun:** `npm test` exit 0 (769 + 9 + 59 + 150 database, 628 jobs plus a 46-check simulation, 109 providers, AI, CRM, 42 UI, web); `npm run test:e2e:live` 12 of 12.
6. **Production probes.** Read-only: public pages, `/api/health`, TLS, authentication settings, anonymous database reads, workflow history.

## Evidence strength

Of the 194 "Built and tested" capabilities, 161 have an end-to-end check here. The other 33 rely on the repository's own suites only (`suite:` in RESULTS.md), rerun in this pass.

## Not verified, and what would settle it

| Item | Needs |
|---|---|
| Signed-in screens in production | A production test account, with your permission |
| Delivery of a sign-in link | A test inbox |
| Real vendor behaviour, AI output quality, deliverability | Production keys, then `npm run live-check` |
| Concurrency and performance at scale | A hosted staging database; PGlite has one connection |
| Reply reading through Outlook | Covered by unit tests only |
| Browser suites `e2e/*` (demo mode) | Desktop rerun after the fixes: 206 passed, 3 skipped. Mobile runs in CI |

## Rerun

Build first: `npm run test:e2e:live` builds for the isolated backend. Then, from the repository root, run `bash audit/pass-22/harness/stack.sh` in one terminal and `node audit/pass-22/harness/a.mjs` through `g.mjs` in order in another. Finish with `node audit/pass-22/report.mjs`.
