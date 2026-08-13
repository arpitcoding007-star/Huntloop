# The Huntloop audit program

A repeatable, phased review of the whole product — not a checklist someone runs
once before a launch and never again.

| File | What it is |
|---|---|
| **README.md** (this file) | How the program works, and the checklist for each phase |
| [FINDINGS.md](FINDINGS.md) | The findings from the most recent full pass, with evidence |
| [BACKLOG.md](BACKLOG.md) | Every finding as a task: priority, effort, dependencies |
| [ROADMAP.md](ROADMAP.md) | Those tasks sequenced into releases |
| [AGENT-REACH.md](AGENT-REACH.md) | What still needs a human after the Agent-Reach integration |
| [`scripts/audit.mjs`](../scripts/audit.mjs) | The mechanizable checks, gating CI |

```bash
npm run audit:site
```

## The rule this program is built on

**A check that only exists in a document is accurate on the day it is written
and wrong a fortnight later.**

So the program splits in two, and the split is the whole design:

- **Decidable from the repo** → `scripts/audit.mjs`, wired into `npm run verify`
  and CI. "Twelve nav links return 404" is a failing build step, not a
  paragraph. It cannot rot, because it re-runs on every pull request.
- **Requires judgement** → `FINDINGS.md`, owned by a person. Is the visual
  hierarchy right? Is the ICP model correct? Is this the right order to build
  in? A script that scored these would be inventing a measurement it never
  made — which is precisely the failure [§7](../README.md) exists to prevent,
  turned against ourselves.

When a finding moves from the second category to the first, that is progress
and the finding should be closed by adding a check, not by editing a sentence.

## Scope note, so the phase names are not misleading

This is a **single-tenant SaaS product behind authentication**, not a content
website. Two phases therefore mean something different here than the generic
names suggest, and pretending otherwise would generate busywork:

- **Phase 8 (SEO)** — Technical SEO applies (crawler policy, canonical URLs,
  metadata, indexability). *Content* SEO largely does not: there is no public
  content surface today. The honest finding is that the marketing site does not
  exist, not that its keyword density is poor.
- **Phase 10 (Analytics & growth)** — There is no analytics implementation to
  audit. The finding is the absence, and the deliverable is a measurement plan,
  not a review of dashboards that were never built.

## The loop

Each phase runs the same eight steps. The last one is the one that gets skipped
and the one that makes it a program rather than an event:

```
1. Audit          Read the code. Run the tools. Record what is, not what
                  the plan says should be.
2. Identify       Write findings with evidence — file:line, command output,
                  a reproduction. A finding with no evidence is an opinion.
3. Prioritize     Severity × reach × cost-to-fix. See the scale below.
4. Task           One task per finding, with effort and dependencies.
5. Implement      Fix.
6. Test           typecheck · lint · test · audit:site · build. Plus a
                  reproduction of the specific finding.
7. Document       Update the docs the change invalidates, in the same commit.
8. Re-audit       Re-run the phase. Add a script check so the finding cannot
                  come back silently.
```

### Severity

| | Meaning | Response |
|---|---|---|
| **Critical** | Data loss, cross-tenant leakage, unauthenticated spend, or a security hole reachable in production | Fix before anything else ships |
| **High** | Breaks a core flow, or a security/cost weakness with a precondition | Fix this cycle |
| **Medium** | Degrades the experience, or accrues debt that gets more expensive to pay | Schedule |
| **Low** | Polish, consistency, nice-to-have | Batch opportunistically |

Priority is severity moderated by **reach** (how many users hit it) and
**cost** (how long the fix takes). A Low that takes five minutes outranks a
Medium that takes a week, when both are queued behind nothing.

---

## Phase 1 — Repository & infrastructure

**Structure.** Folder layout · unused files and dependencies · duplicate code ·
architecture · coding standards · naming conventions · environment
configuration · package management · Git workflow · branch strategy.

**Environment.** Local setup · environment variables · build process ·
deployment configuration · CI/CD · containerization · build optimization.

*Automated:* `REPO-01` Node floor consistency · `REPO-02` undocumented env vars
· `REPO-CI-*` the four CI gates.

## Phase 2 — Frontend

**UI.** Layout consistency · typography · spacing scale · color system ·
responsive behaviour · design consistency · component reuse · dark mode ·
visual hierarchy · empty / loading / error / success states.

**UX.** User flows · navigation · onboarding · discoverability · search ·
readability · interaction design · accessibility · mobile · desktop.

*Automated:* `UX-404` / `UX-ERR` / `UX-GERR` route-level boundaries exist.

## Phase 3 — Features

**Authentication.** Login · registration · password reset · session management ·
authorization · role-based access.

**Core.** Audit every shipped feature. Identify what is missing, what is
half-built, what is broken, and what edge cases are unhandled. Every gap
becomes a task.

*Automated:* `NAV-01` no nav item links to a nonexistent route ·
`FEAT-FIXTURE` no screen still renders fixtures.

## Phase 4 — Backend

**API.** Architecture · consistency · request validation · response handling ·
error handling · versioning · rate limiting.

**Database.** Schema · relationships · indexing · migrations · query
optimization · data integrity · backups.

## Phase 5 — Security

**Authentication.** Password hashing · session security · token handling · JWT
validation · cookie flags.

**Application.** SQL injection · XSS · CSRF · CORS · input sanitization · file
upload · secret management · environment variable exposure.

**Dependencies.** Third-party review · known vulnerabilities · version currency
· removal of the unnecessary.

*Automated:* `SEC-H-*` five response headers · `SEC-CSP` script-src policy ·
`SEC-ADMIN` no service-role client in `apps/` · `SEC-SPEND` every model-calling
path resolves its org · `SEC-VAL` runtime validation on action inputs.

> `SEC-ADMIN` is checked twice on purpose — here and in
> `packages/db/scripts/check-admin-imports.ts` — because plan D2 rates
> cross-tenant leakage as the one Critical risk with no recovery. Two cheap
> checks on the highest-severity risk is not redundancy worth trimming.

## Phase 6 — Performance

**Frontend.** Bundle size · lazy loading · code splitting · assets · images ·
fonts · caching.

**Backend.** Query plans · API latency · memory · CPU · database load · caching
strategy.

*Automated:* `PERF-01` internal links use the router rather than full reloads.

## Phase 7 — Accessibility

Keyboard navigation · screen readers · semantic HTML · ARIA · color contrast ·
focus indicators · form labelling · accessibility at every breakpoint.

Contrast is measured, not eyeballed: every foreground token is checked against
all five surface tokens. See the note in `packages/ui/src/tokens.css` — the
muted-text token was moved after measurement showed the documented ratio was
wrong.

## Phase 8 — SEO

**Technical.** Metadata · structured data · sitemap · robots · canonical URLs ·
Open Graph · Twitter cards.

**Content.** Heading hierarchy · keywords · internal linking · URL structure ·
indexability. *(See the scope note above — mostly N/A until a public surface
exists.)*

*Automated:* `SEO-ROBOTS` · `SEO-SITEMAP` · `SEO-BASE` · `SEO-OG` ·
`SEO-MW` (crawler routes are not behind the auth guard) · `SEO-ICON`.

## Phase 9 — Testing

**Automated.** Unit · integration · end-to-end · API · security.

**Manual.** User flows · cross-browser · mobile · regression.

*Automated:* `TEST-*` per-workspace test scripts · `TEST-E2E` a browser suite
exists.

## Phase 10 — Analytics & growth

**Analytics.** Event tracking · funnels · user journeys · retention ·
conversion.

**Growth.** Activation · referral · engagement loops · retention loops ·
feedback collection.

---

## Adding a check

Findings should end their life as code. In `scripts/audit.mjs`:

```js
check(
  5,                                  // phase
  "SEC-XX",                           // stable id, referenced from BACKLOG.md
  "What must be true",                // stated positively
  someCondition,                      // true when it passes
  "fail",                             // "fail" gates CI, "warn" reports
  "detail shown only on failure",
);
```

Two rules learned from writing the existing ones:

1. **Match code, not prose.** The first version of `SEC-ADMIN` grepped whole
   files and flagged `lib/data/source.ts`, which merely *mentions* the admin
   client in a comment explaining why it doesn't use one. A noisy check on the
   highest-severity risk is worse than no check, because it teaches people to
   skim past it.
2. **Assert the value, not the file.** `SEC-CSP` originally passed because
   `next.config.ts` contained the string `script-src` — inside a comment
   explaining why there isn't one yet. It now parses the header value.
