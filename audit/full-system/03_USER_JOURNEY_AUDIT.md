# User journey audit

Traced by following code paths, not by clicking (no live database in the audit environment).

## Landing → signup → workspace

| Step | Path | Verdict |
|---|---|---|
| Landing | `app/(marketing)/page.tsx` | ✅ Honest copy; the domain box is the primary CTA |
| Anonymous research | `/discover` + `public-research.ts` | ✅ Gated behind `PUBLIC_RESEARCH_ENABLED`, off by default, with a documented reason (an Opus call with web fetch behind an unauthenticated endpoint is "the single most expensive misconfiguration available in this codebase") |
| Signup / login | `(auth)/signup`, `(auth)/login` | ✅ Magic link + Google |
| Auth callback | `app/auth/callback/route.ts` | ✅ |
| Org resolution | `(app)/[org]/layout.tsx` | ✅ 404 not 403 for non-membership |
| No org yet | `/orgs`, `welcome/company/JoinExisting.tsx` | ✅ Same-domain discovery (`0027`) offers joining an existing workspace — a genuinely good touch |

## Onboarding → first value

| Step | Persists via | Verdict |
|---|---|---|
| You | `saveYou` | ✅ |
| Company / workspace | `createWorkspace` | ✅ |
| Goals | `saveGoals` | ✅ (≤2 goals, enforced in DB) |
| ICP | `saveIcp` + `previewLookAlikes` | ✅ strongest screen |
| Sources | `saveSources` | ✅ gate correctly does not require one |
| Building | `first-run.ts` | ✅ real work, staged progress |
| Review → finish | `finishOnboarding` | ✅ idempotent |

**First-run is the product's best moment** and is properly engineered: it drives the real handlers in-request so companies, scores and evidence appear while the user watches, rather than promising "we'll email you".

## Product loop — where it breaks

| Step | Verdict | Problem |
|---|---|---|
| Command Center | ✅ | Live loaders, priority counts agree with the list they link into (E2E-tested) |
| Opportunities list | ✅ | Filters, deep links, honest empty states |
| Opportunity detail | ✅ | Evidence, score breakdown, triggers, ranked buyers, agent panel |
| **Hunt again** | 🔴 | **No control exists.** After onboarding the user cannot ask for more companies |
| Companies | ✅ | |
| Analyze a URL | ✅ | Real qualification against a pasted URL |
| Imports | ✅ | |
| Outreach | 🟡 | Campaigns can be built; sending/advancing depends on a cron that was never configured |
| Inbox | 🟡 | Real screen; replies only arrive if `sync_mailbox` runs (cron) |
| Pipeline | ✅ | |
| Analytics / Learn / Memory / Intelligence | 🟡 | Real loaders, no data to show until the loop runs |
| Engine (`/ops`) | ✅ | Job + provider health — the right screen to have built |
| Settings (5 tabs) | ✅ | Org, Product, ICP, Scoring, Integrations |

## Dead ends and missing consequences

| # | Finding | Evidence |
|---|---|---|
| U-1 | **No "hunt now"** — the core loop cannot be restarted from inside the product | no `enqueue` of discovery under `app/(app)` |
| U-2 | **No "push to CRM"** — the HubSpot integration can be connected but never invoked | `sync_hubspot` has no caller |
| U-3 | **No erasure request path** — a GDPR deletion cannot be initiated | `purge_contact_data` has no caller |
| U-4 | **No merge review** — duplicate companies cannot be resolved by a human | `merge_companies_for_org()` has no caller |
| U-5 | Audit log has no reader — privileged actions are recorded and unreadable | `lib/data/audit.ts` |
| U-6 | Saved searches cannot be created or edited in-app | `discovery_queries` written by `first-run.ts` only |

Every one of these is a **backend capability with no front door**, which is the defining shape of this codebase's incompleteness.

## What is notably well handled

- **Loading, empty and error states are systematically present** — `EmptyState`, `DemoFigures`, `error.tsx`, `global-error.tsx`, `not-found.tsx`, and `loading.tsx` in onboarding.
- **The honest-UI invariant holds**: audit check `FEAT-DEMO` fails the build if any `/[org]` screen shows figures without either reading `lib/data` or declaring itself illustrative. E2E asserts the banner's presence.
- **Nothing on any page is a link that goes nowhere** — asserted by Playwright (`routing.spec.ts`), and `NAV-02` fails the build on a placeholder `href`.
- Buttons that cannot act **say why** rather than being silently disabled (`NAV-03`).
