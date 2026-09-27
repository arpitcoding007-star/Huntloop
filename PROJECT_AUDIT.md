# Huntloop — design, UX, privacy and compliance audit

**Date** 2026-09-21 · **Branch** `feat/sidebar-modules` · **Commit base** `de3e50d`
**Scope** The whole repository: 39 page routes, 8 API routes, 27 Server Action modules, 20 design-system components, 29 migrations, 6 Playwright specs.
**Method** Source inspection, cross-referenced mechanically, plus the project's own verification suite run end to end. Every claim below names the file it came from. Existing documentation was treated as a hypothesis, not evidence — and in two places it is wrong.

**Relationship to the existing audit.** `audit/full-system/` (2026-09-15) is an engineering audit — jobs, schema, providers, architecture. This one covers what that one did not: design originality, interaction quality, privacy, legal readiness, consumer protection, marketing claims, accessibility and licensing. Where they overlap, findings here were re-verified independently rather than cited.

---

## Executive Summary

Huntloop is a B2B opportunity-intelligence product built to an unusually high engineering standard, with a design system that is genuinely purpose-built rather than generated, and it is **not ready to be offered to the public** — for reasons that are almost entirely non-engineering.

What is strong, and rare:

- **The design is not vibe-coded.** Of thirty generic AI/SaaS patterns audited in Part 1, **twenty-five are simply absent** — no gradients anywhere in the source, no glassmorphism, no emoji, no decorative orbs or dot-grids, no fake testimonials, no logo wall, no neon, no pastel. Exactly one shadow exists in the entire system and it is documented as the only one. The colour system encodes an epistemic rule (green = source-verified fact, violet = model inference, gray = unknown) that is load-bearing in the product, not decoration.
- **Contrast was measured, not assumed — in the dark theme.** `packages/ui/src/tokens.css` records the actual ratio of every dark text colour against all five surfaces and documents two that were changed for failing AA. **This did not extend to the light theme**, which was added later and derived from reference screenshots; see the correction under *Accessibility Findings*.
- **The product refuses to present invented data as real.** `DemoFigures` and `DataSourceBanner` mark unreal figures on screen, a build check (`FEAT-DEMO`) fails if a screen stops doing so, and the landing page's sample opportunity says in plain text that the company is fictional.
- **Privacy engineering is well above typical.** Analytics is server-side only with a closed event union and no PII; Sentry has `sendDefaultPii: false` and Session Replay off, both with written reasoning; fonts are self-hosted at build time so there is no third-party request on first paint; tenant isolation is enforced in Postgres and proven by a non-superuser cross-tenant test.

What blocks launch:

1. **There is no legal surface at all.** No Privacy Policy, no Terms, no Cookie Policy, no contact details, no business identity — not as routes, not as files, not linked from the footer or signup. The application processes third-party personal data (prospects' names, emails, employers) that those people never gave it, and sends them commercial email. That is the highest-risk configuration a privacy notice exists for, and there is none.
2. **The landing page makes four data-handling promises. Two are not true as shipped.** "Contact data has a retention window you set" — there is no UI to set it; `contact_retention_days` appears nowhere in `apps/web`. "An erasure path that actually deletes" — `purge_contact_data` is written, registered and tested, and is enqueued by nothing, so no user can trigger it.
3. **The pricing section states "these are the limits the product actually enforces." Three of the five are not enforced.** `seats` and `ai_runs` are. `emails` is counted after the fact and never checked. `opportunities` is neither. `enrich` is checked only inside a job nothing enqueues.
4. **Two paid plans are advertised with working buy buttons and there is no way to pay.** Stripe variables are declared in `.env.example` and read by zero lines of code.
5. **Every outbound email could ship with no unsubscribe mechanism at all** if `NEXT_PUBLIC_SITE_URL` were unset — the footer link and the `List-Unsubscribe` header both derive from it, and both degraded silently to nothing. **Fixed in this audit**, with a test.
6. **The entire marketing content surface was blocked from search engines.** `robots.ts` emitted `Disallow: /*/`, which matched all eight URLs `sitemap.ts` submits. **Fixed in this audit**, with a build check that fails if the two files disagree again.

Two documentation claims are false and should be corrected: `README.md` says eleven of seventeen nav destinations are unbuilt, that nothing sends email, and that nobody can be invited. All three are wrong — there are nineteen destinations, all resolving; `send_message` and the mailbox adapters exist and are tested; `inviteMemberAction` exists with seat enforcement.

**Verdict: not launch-ready.** The gap is not engineering quality — it is that a product this careful about not overstating what it knows about *prospects* currently overstates what it does about *retention, erasure, metering and payment* on its own front page.

---

## Critical Issues

### CR-1 · No Privacy Policy, Terms, or any legal surface exists

**Evidence.** `find apps/web -ipath "*privacy*" -o -ipath "*terms*" -o -ipath "*legal*" -o -ipath "*cookie*"` returns nothing. The landing page footer (`apps/web/app/(marketing)/page.tsx:900-945`) links only to How it works, Pricing, two comparison pages, Sign in and Create an account. The signup page (`apps/web/app/(auth)/signup/page.tsx`) has no "by creating an account you agree to…" line and no consent control.

**Why this is critical rather than a to-do.** Huntloop's data model is the hard case, not the easy one. It stores `contacts` with names, job titles, email addresses and phone numbers for people who are not users, acquired from a data broker (Apollo) and from public sources, and it emails them. Under GDPR that is Article 14 processing — personal data not obtained from the data subject — which carries an affirmative duty to inform, and the product has no document that could discharge it. It also has no lawful-basis statement, no processor list, no retention statement and no contact point for a data-subject request.

**Do not fabricate this.** A generated policy naming an invented company, address or jurisdiction would be worse than none. `REQUIRES LEGAL/JURISDICTION REVIEW` — see *Legal/Policy Findings* for the specific facts a drafter needs and which of them the code can already supply.

### CR-2 · Two of four public data-handling claims are false as shipped

`apps/web/app/(marketing)/page.tsx:730-748` makes four promises under "How your data is handled". Verified one at a time:

| Claim | Verdict | Evidence |
|---|---|---|
| "Your workspace is isolated at the database level… even if we ship a bug" | **TRUE** | RLS on every tenant table; 236 migration checks including a cross-tenant test run as a non-superuser; ESLint + a standalone script both forbid the service-role client in `apps/` |
| "We do not train models on your data" | **UNVERIFIABLE HERE** | A statement about Anthropic's terms, not about this code. True of the Anthropic API's default posture; needs a DPA on file to assert publicly. `REQUIRES LEGAL REVIEW` |
| "Contact data has a retention window **you set**" | **FALSE** | `contact_retention_days` exists on `organizations` (`0017_outreach_safety.sql:103`) and is read by `enforce-retention.ts`. It appears **nowhere** in `apps/web` — no form field, no action, no settings screen. No user can set it. The default is null, meaning "keep everything forever" |
| "…and an erasure path that actually deletes rather than flags" | **FALSE** | `purge_contact_data` is a complete, tested handler (`packages/jobs/src/handlers/purge-contact-data.ts`) registered at `registry.ts:87`. Grepping the whole repository for callers finds only the registry, the queue's type union, and its own test. **Nothing enqueues it.** There is no UI, no action, no endpoint |

The mechanisms are built and good. They are unreachable. Either wire them up or delete the sentences — the product's own thesis is that an unestablished claim must not be presented as established, and this is that failure pointed at itself.

### CR-3 · Paid plans are advertised and cannot be bought

`apps/web/lib/data/plans.ts:50-67` defines Growth at $99/month and Scale at $299/month; the pricing section renders each with a `Start on {plan}` primary button. Every one of those buttons goes to `/signup`, which creates a Free-plan account. `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` and `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` are declared in `.env.example` and read by **zero** lines of application code. The `subscriptions` table has existed since `0001` and no application code references it.

A visitor clicking "Start on Growth" is told they are starting a $99/month plan and is silently given a different one. Even with no money changing hands this is a misleading commercial representation, and it is the kind that consumer-protection regimes treat as actionable regardless of intent.

---

## High Priority

### H-1 · The pricing page's central honesty claim is false for three of five rows

The section leads with: *"These are the limits the product actually enforces — read from the same catalogue the metering reads, not typed into this page."* The first clause is the claim; the second is true and does not support it. Verified by locating every `check_quota` / `check_quota_internal` call site in the repository:

| Limit | Advertised | Checked before the action? | Counted after? | Reality |
|---|---|---|---|---|
| `seats` | yes | **yes** — `team/actions.ts:294` | — | Enforced |
| `ai_runs` | yes | **yes** — `lib/ai/budget.ts:50`, `packages/jobs/src/ai.ts:111` | yes | Enforced |
| `enrich` | yes | in `enrich-person.ts:59` only | yes | **Unreachable** — nothing enqueues `enrich_person` |
| `emails` | yes | **no check anywhere** | yes — `send-message.ts:246` | **Metered, not enforced.** A Free workspace (`emails: 0`) is counted and never stopped |
| `opportunities` | yes | **no** | **no** | **Not implemented at all** |

The usage screen (`lib/data/usage.ts:141`) renders all five as if they were equivalent. Note `emails` does have a *separate* control — `claim_mailbox_send`, a per-mailbox daily cap — but that is not the plan limit and does not vary by plan.

**Action.** Either enforce `opportunities` and `emails`, or change the sentence. The honest interim wording is available and costs nothing: say which limits are enforced today.

### H-2 · An email could ship with no unsubscribe mechanism — **FIXED**

`send-message.ts` built both the footer link and the RFC 8058 `List-Unsubscribe` header from `absolute()`, which returns null when `NEXT_PUBLIC_SITE_URL` is unset. `withFooter` then returned the body unchanged and the provider was handed a null unsubscribe URL, so the message went out with **no opt-out of any kind** — not a broken link, no link. The file's own comment reasoned that a dead unsubscribe link is worse than none; it did not consider that no link is worse than both, and it is the one failure in that handler that breaks a law (CAN-SPAM §7704(a)(3), CASL, PECR) rather than a deliverability guideline.

**Fixed.** A precondition now refuses the send, placed before `claim_mailbox_send` so a misconfiguration cannot also burn a day's allowance. Retryable, because setting the variable fixes it. Five new checks in `verify-jobs.ts` cover it; the jobs suite went from 199 to 204 passing.

### H-3 · The whole marketing content surface was disallowed from crawling — **FIXED**

`robots.ts` emitted `Disallow: /*/` to cover tenant routes. That pattern matches any path with a second segment, which is also every marketing page. Confirmed against the built artifacts rather than by reading: `.next/server/app/robots.txt.body` carried the rule, and `.next/server/app/sitemap.xml.body` submitted eight URLs it blocks — `/for/` ×4 and `/compare/` ×4, all linked from the landing-page footer, all written specifically to be found in search.

**Fixed.** `/for/` and `/compare/` are now explicit `Allow` entries; robots.txt resolves conflicts by rule-path length, so the longer prefixes win while everything else with a second segment stays shut — the "a new tenant route is disallowed by default" property is preserved. A new build check, `SEO-AGREE` in `scripts/audit.mjs`, fails if the two files disagree again; it was validated by reverting the fix and confirming it fails, then restoring.

### H-4 · No account deletion, no workspace deletion, no data export

Searching the repository for account deletion, data export, portability or DSAR handling finds **one** result, and it is a SQL comment. There is no way for a user to delete their account, delete a workspace, or obtain a copy of their data. `organizations.deleted_at` exists and every query respects it; nothing in the product can set it. The single `organizations.delete()` call in the codebase (`welcome/actions.ts:223`) is onboarding rollback.

For a product whose own marketing promises "an erasure path that actually deletes", the absence of erasure for the *customer* — as distinct from their prospects — is the more serious half. GDPR Articles 15, 17 and 20 each have no implementation.

### H-5 · Destructive actions have no confirmation, no undo, and a 28px target

Eleven destructive Server Actions fire immediately on a single click: `deleteCompany`, `deleteMemory`, `deleteCampaign`, `deleteStep`, `deleteIcp`, `deletePersona`, `deleteProduct`, `deleteRule`, `removeMember`, `revokeInvitation`, `disconnectHubspot`. None prompts. Only one area of the product — sources — offers an undo, and its code comments (`SourceManager.tsx:525`, tagged UX-14) show the team already decided this matters and built the pattern.

Three things compound:

- The control is an icon-only `size="sm"` Button, which resolves to `h-7 w-7` = **28×28 CSS px** (`packages/ui/src/components/Button.tsx:62,89`). That clears WCAG 2.2 SC 2.5.8's 24px floor and is well under the 44px that phone use calls for — and the mobile Playwright project (`Pixel 7`) exercises these screens.
- Removing a team member is an access-control change with no prompt.
- There is no restore path. The deletes are all soft (`deleted_at`, verified on all six checked) so nothing is destroyed in the database, but no screen surfaces a soft-deleted row, so from the user's side it is indistinguishable from permanent.

**Recommendation.** Extend the existing UX-14 undo rather than adding dialogs — it is the project's own pattern, it is already built, and an undo suits soft deletes better than a confirm does. Reserve a genuine confirm for `removeMember` and `disconnectHubspot`, where the consequence reaches outside the workspace.

### H-6 · Outbound email carries no sender postal address

`withFooter` (`send-message.ts:340`) appends only the unsubscribe line. CAN-SPAM §7704(a)(5) requires a valid physical postal address in every commercial email; CASL requires sender identification and a mailing address. There is no schema field anywhere to hold one — grepping every migration for postal/mailing/street address fields returns nothing relevant.

This is a product gap, not just a template gap: the sending org has no way to supply the address even if the footer wanted it.

### H-7 · Two third-party processors are undisclosed

| Service | What leaves | When | Consent | Disclosed? |
|---|---|---|---|---|
| **PostHog** (`lib/analytics.ts`) | Supabase user UUID as `distinctId`, org UUID, step name, duration, refusal reason | Server-side, on onboarding steps | none | **No** |
| **Sentry** (`instrumentation-client.ts`, `sentry.server.config.ts`) | Exception payloads, browser context | Client **and** server, whenever a DSN is set | none | **No** |

Both are implemented with real care — PostHog is `posthog-node` specifically to avoid a client bundle and autocapture, its properties are a closed typed set, its host defaults to EU, and the org *slug* is deliberately excluded because it derives from the customer's company name. Sentry has PII and Session Replay off with written reasoning.

The gap is disclosure, not design. A pseudonymous user ID is still personal data under GDPR. Note the good news for consent: because PostHog runs server-side and Sentry sets no cookies, there is **no non-essential client-side storage anywhere in the app** — the only cookies are the Supabase auth session, `hl-theme`, `LAST_ORG_COOKIE` and a short-lived OAuth state cookie, all strictly necessary. On the evidence, **a cookie consent banner is not required**, which is a genuinely strong position most products cannot claim. It needs a privacy policy to state it.

---

## Medium Priority

### MED-1 · README materially misdescribes the product

`README.md` states that eleven of seventeen nav destinations are unbuilt and marked "Soon", that nothing sends an email, and that nobody can be invited. Verified against `OrgShell.tsx:82-156`: there are **nineteen** destinations and every one resolves to a real route reading a real loader — the project's own `NAV-01` check enforces this. `send_message` and the Gmail/Outlook adapters exist and are tested. `inviteMemberAction` exists with seat-quota enforcement at `team/actions.ts:294`.

A README that undersells the product by this much misleads reviewers, contributors and anyone evaluating the repository.

### MED-2 · The landing page promises something that is off by default

The hero and the final CTA both say "Put in your domain… Two minutes, no card." That path (`/discover`) is gated behind `PUBLIC_RESEARCH_ENABLED`, which is off by default for a well-argued reason — an unauthenticated endpoint calling Opus with web fetching is the most expensive misconfiguration available. The degradation is honest ("Not available without an account") and routes to signup, so nothing is broken. But the page's only primary CTA, used twice, currently advertises a disabled feature.

### MED-3 · `body_html` emails would carry no unsubscribe footer

`withFooter` is applied to `text` only; `html` is passed through untouched (`send-message.ts:175-176`). Most clients render the HTML part, so the visible unsubscribe link would be absent. **Latent, not live** — nothing in the codebase writes `body_html` today; it is read and nulled only. Worth fixing before the first HTML template ships, because it will not announce itself.

### MED-4 · Marketing claims that need evidence on file

Not false, but not self-supporting either. Each needs something behind it before it is defensible:

- "one tenant cannot read another's rows even if we ship a bug" — strongly supported by the test suite; the phrasing is absolute and an absolute claim invites an absolute counterexample.
- "We do not train models on your data" — needs an Anthropic DPA.
- FAQ: "Work stops rather than silently continuing on a bill you did not agree to." Since three of five limits are unenforced (H-1) and there is no billing (CR-3), this is currently true only by accident.
- FAQ: "There is no autonomous sending mode and adding one is not on the roadmap." Verified consistent with the code — `autonomy 0` is the created default and `send_message` requires `scheduled_at`.

### MED-5 · Brand asset provenance is unverifiable from the repository

`apps/web/public/brand/*.png` (3 files) and the untracked `HuntLoop_SVGs/` (3 files, ~2 MB) have no licence, no source note and no attribution anywhere in the repo. They are presented as Huntloop's own marks, which is the likely truth, but the checklist's rule applies: an asset is not licensed because it is in the repository. One line in a `NOTICE` or `public/brand/README` settles it.

### MED-6 · Fonts are self-hosted without the OFL notice

Inter, JetBrains Mono and Lora are all SIL Open Font License, and `next/font/google` downloads and serves them from Huntloop's own origin at build time — which is excellent for privacy and is exactly what the OFL permits. The OFL does ask that the copyright and licence notice travel with the font files. Common practice ignores this for build-time subsets; a `NOTICE` file costs nothing and removes the question.

---

## Low Priority

- **LOW-1 · Brand images use raw `<img>` with no dimensions.** `(auth)/layout.tsx:8-17` and `OrgShell.tsx:225` — no `width`/`height`, so they contribute layout shift on first paint, and they bypass `next/image` optimisation on ~200-330 kB PNGs. The two-element theme swap is correct (`display:none` removes the hidden one from the accessibility tree, so "Huntloop" is announced once).
- **LOW-2 · The AI sparkle icon appears on a non-AI card.** `IcpQualityCard.tsx:63` renders `Sparkles` in `text-brand` (green = system fact). The score *is* deterministic — computed from weights in `packages/db/src/icp.ts` — so the colour is right and the icon is wrong: `Sparkles` marks model output everywhere else in the app (`AgentPanel.tsx:113` in `text-ai`, `InboxView.tsx:291`, `IcpEditor.tsx:423`). Icon and colour disagree about what kind of thing this is, in a system whose whole point is that distinction.
- **LOW-3 · No Open Graph image.** Deliberate and documented — a card pointing at a 404 is worse than none, and some clients cache the failure. Correct decision; still a gap before launch.
- **LOW-4 · ZeroBounce sends the API key and the prospect's email in the URL query string.** `adapters/zerobounce.ts:33-35`. Forced by that vendor's v2 API design, not a Huntloop choice, and it is server-to-server over TLS — but query strings are the part of a request most likely to be logged by intermediaries and by the vendor. Worth noting in the processor list rather than fixing.
- **LOW-5 · Only 3 `loading.tsx` files for 39 routes.** Not a defect — `[org]/loading.tsx` covers every child segment by App Router's own semantics, and `LoadingSkeleton` is used directly where streaming is finer-grained.

---

## Vibe-Code / Design Findings

The honest summary: **this is not a generated interface, and the audit should say so as clearly as it would report the opposite.** Twenty-five of the thirty patterns in Part 1 are absent from the source, and the five that are present are each traceable to a product reason.

| Pattern | Status | Evidence |
|---|---|---|
| Harsh gradients | **Absent** | `grep -rn "gradient"` across `apps/web/app`, `apps/web/lib`, `packages/ui/src` — zero hits. The only matches in the tree are unused Tailwind utilities in `.next` build output |
| Generic icon-library usage | **Purposeful** | Lucide, 71 distinct icons, uniform `strokeWidth={1.75}`, `size-4`, and `aria-hidden` on every decorative instance. Consistency is the customisation |
| Excessive pure white | **Absent** | Dark canvas `#171717`. Light canvas is a warm paper `#f3f1ea`; `#ffffff` is reserved for the raised card surface only |
| Rainbow / multi-colour | **Absent** | Six-stop chart ramp, five semantic hues, each with a stated meaning |
| Excessive drop shadows | **Absent** | Exactly one shadow token, `--hl-shadow-popover`, labelled "the ONLY shadows in the system". One usage: `HoverPanel.tsx:239`. Depth is carried by 1px borders |
| Three-feature-card layouts | **Justified** | Three occurrences on the landing page. One is fact/inference/unknown — three because there are three claim kinds. One is the pricing tiers, read from the database catalogue. Semantic, not decorative |
| Unnecessary emojis | **Absent** | Unicode emoji scan across all `.ts`/`.tsx` in `apps/web` and `packages/ui` — zero |
| Glassmorphism | **Absent** | No `backdrop-blur` or `backdrop-filter` in any source file |
| AI copy patterns / em dashes | **Partial — intentional** | Em dashes are frequent in both comments and user copy. The prose is specific, opinionated and occasionally self-critical ("We're early, and we'd rather say so") — the opposite of generated filler. One "not X, it is Y" construction in user-facing copy (`compare/approaches.ts:161`), used where the contrast is the argument. **No change recommended**; this is a voice, and it is a good one |
| Default AI/SaaS typography | **Justified** | Inter is present, but inside a deliberate system: a nine-step scale with stated line-heights and weights, an 11px uppercase `.hl-label` treated as the signature, `hl-tabular` for figures that update in place, and a serif display face (Lora) that appears in Light only, derived from reference screenshots. Inter-by-default is the smell; this is not that |
| Colored-left-stripe cards | **Absent** | Callouts use a full tinted surface plus matching border |
| Fake / placeholder testimonials | **Absent, and argued** | `Proof()` in `page.tsx:650` has a comment explaining why there is no logo wall: "we have not earned one yet… presenting something unverified as established." The section that replaces it makes only checkable claims about the system |
| Unnecessary bento grids | **Absent** | Uniform grids |
| Decorative terminal windows | **Absent** | — |
| "It's not X, it's Y" | **Once, load-bearing** | See above |
| Checkmark-heavy feature lists | **Justified** | One comparison table, three columns, with a third state (`Minus`, "Sometimes") rather than a binary — and each mark carries `aria-label` |
| Default three-tier pricing | **Justified** | Three tiers because `plans` holds three rows, read live from the same catalogue the metering reads. The *layout* is honest; the enforcement claim above it is not (H-1) |
| Missing real product screenshots | **Better than screenshots** | The hero renders the actual `Card`, `ClaimBadge`, `ScorePill` and `PriorityBadge` components the product uses, with a caption stating the figures are invented |
| Excessively uniform rounded corners | **Absent** | 138 `rounded-md` (6px) and 52 `rounded-sm` (4px). Tight and restrained, not the 12-16px pill aesthetic |
| Generic purple/black AI-SaaS look | **Absent** | Violet is reserved for "a model produced this" and is never a brand colour. Brand is green |
| Missing skeleton/loading states | **Present** | `LoadingSkeleton` plus `EmptyState`, `ErrorState`, `PermissionDenied`, `RateLimited`, `Confirmed` — a full state vocabulary in `States.tsx` |
| Radial gradient orbs | **Absent** | No gradients at all |
| Dot-grid backgrounds | **Absent** | No `radial-gradient`, `repeating-*` or `bg-[url(...)]` in source |
| Excessive sparkle icons | **Near-pass** | `Sparkles` is the AI marker and is used consistently as one — except LOW-2 |
| Decorative animated arrows | **Absent** | — |
| Missing ToS | **FAIL** | CR-1 |
| Missing Privacy Policy | **FAIL** | CR-1 |
| Excessive hover animations | **Absent** | Transitions are 120/180ms on colour only, and `prefers-reduced-motion` zeroes both durations at the token level |
| Excessive neon | **Absent** | — |
| Generic pastel palette | **Absent** | Light mode is warm paper and rust, derived from reference material, not a tint ramp |

**Design system (Part 2).** Coherent throughout. Brand, colour, type, spacing (4px base), radius, shadow, iconography, buttons, inputs, cards, nav, tables, empty/loading/error/success states, both themes, and both desktop and mobile are consistent and centralised in `packages/ui`. The single inconsistency found is LOW-2. Charts are the one area with tokens (`--hl-chart-1..6`) but no component — nothing renders a chart yet, so the ramp is untested in use.

---

## UX Findings

Workflows were traced end to end rather than screen by screen.

**Strong.** Onboarding is a real six-step pipeline where each step consumes the previous one's output, with progress, skeletons, rate-limit states and honest refusals. The marketing→discover→signup→onboarding path carries the domain through and claims the research server-side from the verified email domain rather than from the URL parameter — so it cannot be pointed at someone else's company by editing a link. Every Server Action validates its input at runtime (enforced by the `SEC-VAL` build check). Errors are written for people, not for logs: "Not sent: this address was contacted too recently", "No connected mailbox has any send allowance left today. This message stays queued and is sent when the daily limit resets."

**Findings.**

| ID | Finding | Severity |
|---|---|---|
| H-5 | No confirmation or undo on eleven destructive actions; 28px icon-only targets; no restore path for soft-deleted rows | High |
| MED-2 | The primary CTA, used twice on the landing page, advertises a path that is disabled by default | Medium |
| UX-1 | Soft-deleted rows are invisible everywhere. The data survives; the user cannot see or recover it. A trash view for companies and campaigns would make the existing `deleted_at` columns pay for themselves | Medium |
| UX-2 | Plan limits are shown on the usage screen with equal weight regardless of whether they are enforced (H-1). A user watching `opportunities` climb toward a ceiling that does not exist is being misinformed by a progress bar | Medium |

**Explicitly checked and clean:** navigation (all 19 destinations resolve; `NAV-01`/`NAV-02`/`NAV-03` enforce it), no dead-end flows, no duplicate functionality, no placeholder content exposed to users, no fake data presented as real (`FEAT-DEMO` fails the build), keyboard usability, and touch behaviour on mobile (score/priority explanations are tap-to-open with outside-tap dismissal, covered by Playwright).

---

## Accessibility Findings

Audited against WCAG 2.2 AA. This is the strongest area of the product outside tenant isolation.

**Verified present.** Contrast measured and documented per surface, with two colours changed *because* they failed AA — `#6f6f6f` was recorded in the plan as 4.6:1, measured at 3.57:1, and replaced with `#949494`, which clears 4.5:1 against all five surfaces; `#e5484d` measured 4.35:1 and was lightened to `#ff6369`. Semantic HTML throughout. Heading hierarchy intact — no page has an `h2`/`h3` without an `h1`. Every form control has a `<label htmlFor>` or an `aria-label`. A universal `.hl-focusable` focus-ring convention, with a separate `.hl-focusable-row` because `box-shadow` on a `<tr>` under `border-collapse` is clipped inconsistently in Safari — a level of care that is unusual. A skip link that actually moves focus (Playwright-tested). Escape closes the mobile drawer, tested as a keyboard-trap guard. `prefers-reduced-motion` zeroes motion at the token level rather than per component. Icons are `aria-hidden` when decorative and `aria-label`ed when meaningful, including the comparison table's ✓/−/✓ marks. `eslint-plugin-jsx-a11y` recommended runs on all JSX and passes clean.

**Never colour alone** is enforced as a product rule, not a guideline: priority always ships the word and a dot shape alongside the hue, and there is a Playwright test named for it.

### Correction — the light theme's contrast was not measured

**The PASS above was wrong, and this is the most important finding in the audit.**

The first version of this report marked colour contrast a clean pass on the strength of `tokens.css`'s own notes, which record ratios to two decimal places and name two colours changed for failing AA. Those notes are accurate. They are also **entirely inside the `[data-theme="dark"]` block.** The light theme was added later, derived from reference screenshots rather than by inverting dark, and its ratios were never taken. I read careful documentation and credited it to code it did not cover — the exact failure this repository's own method warns about, committed while auditing.

Running `axe-core` against both themes, which is what should have happened first, found it in seconds:

| Pair | Measured | Where |
|---|---|---|
| `#fbfaf7` on `#1c9463` | **3.68:1** | Every primary button label in light — Save, Start free, Connect |
| `#1c9463` on its own 15% tint | **2.70:1** | `ScorePill` at a strong score, 70–89 |
| `#0e8f6f` on its own 15% tint | **3.36:1** | `ScorePill` at 90+ |
| `#a15a13` on `#faead4` | **4.46:1** | The demo-data banner, at the top of most screens |
| `#12734d` at `opacity-70` | **2.96:1** | `ClaimBadge`'s confidence suffix |
| info dot at `opacity-70` | **2.92:1** | `PriorityBadge` WATCH (3:1 applies — non-text) |

Two of these are structural rather than a bad hex:

- **`ScorePill` mixed its own background** — `color-mix(in srgb, {color} 15%, transparent)`. Text on a tint of itself has a contrast ceiling the tint sets, so no colour choice could have fixed it. Every other status component in the system pairs an ink token with a designed surface token; this was the one that invented its own.
- **`opacity-70` as de-emphasis** silently multiplies whatever contrast a pair already had, which is why it cannot be checked by reading the palette. Light's `brand-text` starts at 5.17:1, so any dimming at all put it under.

All six are fixed, each verified by measurement rather than by eye, and `e2e/a11y.spec.ts` now runs axe over five layouts × two viewports × both themes on every CI run. The suite went from 68 browser tests to 256, all passing.

**What this says about the rest of the report.** Every other accessibility row here was checked by reading code, the same method that produced the wrong answer on this one. Structural findings are now corroborated — axe reports zero violations of any rule other than contrast across all five layouts — but A-10 (screen readers) and A-18 (zoom) remain unverified by anything, and should be read as untested rather than as passing.

| ID | Finding | Severity |
|---|---|---|
| AX-1 | Icon-only `size="sm"` buttons are 28×28 px. Clears WCAG 2.2 SC 2.5.8 (24px, AA) but is below the 44px comfortable for touch — and these are the delete controls in list rows, on screens the mobile test project exercises | Medium |
| AX-2 | Brand `<img>` elements carry no `width`/`height`, so they shift layout on load (LOW-1) | Low |
| AX-3 | No automated a11y assertion runs in CI. `axe-core` is present in `node_modules` but only as a transitive dependency of `eslint-plugin-jsx-a11y` — nothing imports it. The existing Playwright suite is the natural home for an `axe` pass | **Fixed** |
| AX-4 | Zoom/text-scaling and screen-reader behaviour were not exercised — this audit is static analysis and the project's own tests, not assistive-technology testing | Needs review |

---

## Privacy & Data Findings

**What the application actually processes**, established from the schema and the provider adapters rather than from any document:

- **Users:** email address, name, Supabase user UUID, org membership and role. Authentication is magic-link or Google OAuth — **no passwords are stored at all**, so there is no hash to leak and no reset flow to attack.
- **Third-party individuals (prospects):** name, job title, seniority, email address, phone, employer, and inferred "fit" scores. Sourced from Apollo, Hunter, ZeroBounce and public web pages. These people are not users and have not been asked.
- **Customer commercial data:** ICP definitions, product positioning, scoring rules, outreach drafts, reply contents, pipeline state.
- **Derived:** AI inferences about companies and people, each stored with provenance and a fact/inference/unknown label.

| Check | Status | Evidence |
|---|---|---|
| Privacy Policy | **FAIL** | Does not exist (CR-1) |
| Accurate disclosures | **FAIL** | No disclosures exist; two of four public claims are false (CR-2) |
| Cookie Policy | **FAIL** | Does not exist |
| Cookie consent mechanism | **NOT REQUIRED (verify)** | Only strictly-necessary cookies exist: Supabase auth, `hl-theme`, `LAST_ORG_COOKIE`, a short-lived `__Host-hl_mailbox_oauth` state cookie. No analytics or advertising cookies. PostHog is server-side; Sentry sets none. `localStorage` is used for two dismissible dashboard nudges only |
| Consent collection | **FAIL** | No consent is collected at signup for anything |
| Data minimisation | **PASS** | Analytics properties are a closed typed union; the org *slug* is deliberately excluded because it derives from the customer's company name; `sendDefaultPii: false`; Session Replay off with reasoning; IP addresses hashed before storage in the anonymous-research path |
| Data retention | **PARTIAL** | `contact_retention_days` and `enforce_retention` are built and correct — default null means keep forever, which is the honest default. No user-facing control (CR-2) |
| Data deletion (prospects) | **FAIL** | `purge_contact_data` is complete, tested, and enqueued by nothing (CR-2) |
| Account deletion | **FAIL** | Does not exist (H-4) |
| Data export / portability | **FAIL** | Does not exist. CSV handling is import-only (H-4) |
| Third-party sharing | **PARTIAL** | Real and defensible, entirely undisclosed (H-7, and the processor table below) |
| Analytics tracking | **PASS (design) / FAIL (disclosure)** | Server-side, closed event set, opaque IDs, EU host default |
| Advertising tracking | **PASS** | None exists |
| Authentication data | **PASS** | Magic link / OAuth; no passwords stored; the failure message is deliberately identical for "no such account" and "wrong details" to avoid an account-enumeration oracle |
| Sensitive data handling | **PASS** | Mailbox OAuth tokens encrypted at rest (`MAILBOX_ENCRYPTION_KEY`); the service-role client is confined to 5 named files and forbidden in `apps/` by two independent checks |
| Children's data | **N/A — verify** | B2B sales tooling; no plausible child audience. No age gate, no DOB collected, which is correct for the audience. `REQUIRES CONFIRMATION` that no minors are targeted |
| Privacy settings | **FAIL** | No user-facing privacy or notification preferences exist |
| Tracking before consent | **PASS** | Nothing tracks before sign-in; onboarding events fire only for an authenticated user |

**The central privacy observation.** The engineering consistently chooses the more private option and writes down why. What is missing is the paperwork and the two user-facing controls (erasure, retention) that would let the engineering be exercised. That is a much better position than the reverse, and it is a few days of work plus a lawyer — not a rebuild.

---

## Legal/Policy Findings

> **This is a technical and product compliance review, not legal advice.** Everything in this section requires review by a qualified practitioner before the product takes a customer.

| Document | Required? | Present | Note |
|---|---|---|---|
| Terms of Service | **Yes** | **No** | Multi-tenant SaaS with user-generated content, third-party data and planned billing |
| Privacy Policy | **Yes** | **No** | GDPR Art. 13 (users) **and Art. 14** (prospects, the harder duty) |
| Cookie Policy | Likely not | No | Only strictly-necessary cookies — see the privacy table. State the position rather than omit it |
| Refund / Cancellation Policy | Yes, once billing exists | No | Blocked on CR-3 |
| Subscription terms & billing disclosures | Yes, once billing exists | No | Blocked on CR-3. **Plans are advertised today with no terms at all** |
| Acceptable Use Policy | **Yes** | **No** | The product drafts and sends cold outbound email. An AUP is what separates "our customer spammed people" from "we facilitated it" |
| Data Processing Agreement (offered to customers) | **Yes** | **No** | Huntloop is a processor for its customers' prospect data |
| Sub-processor list | **Yes** | **No** | See the Third-Party Services table |
| Copyright / IP notice | Yes | Partial | `© {year} Huntloop` in the footer; no entity name |
| Contact information | **Yes** | **No** | No email, no address, no support route anywhere on the public site |
| Business identity | **Yes** | **No** | No legal entity, registration number or jurisdiction stated anywhere |

**Facts a drafter needs that this repository cannot supply.** `REQUIRES LEGAL/JURISDICTION REVIEW` for every one: the legal entity name and registered address; the jurisdiction of establishment; whether an EU/UK representative is needed under GDPR Art. 27; the lawful basis chosen for prospect data (legitimate interest is the usual answer and requires a documented balancing test); whether an Art. 30 record and a DPIA are required — given large-scale processing of personal data obtained from third parties and automated scoring of individuals, a DPIA is plausibly mandatory; whether the `contact_fit_scores` feature constitutes profiling with legal or similarly significant effects under Art. 22; signed DPAs with Anthropic, Apollo, Hunter, ZeroBounce, PostHog, Sentry, Supabase and Vercel; and the transfer mechanism for each US-hosted processor.

**Facts the code can supply, and which a drafter should be handed:** the complete processor list below, the exact prospect fields stored (`packages/db/migrations/0003_companies_opportunities.sql`), the retention mechanism (`0017_outreach_safety.sql:103`, `enforce-retention.ts`), the erasure mechanism (`purge-contact-data.ts`), the suppression model (`0008_engine_columns.sql:257`), and the tenant-isolation guarantee with its test evidence.

**Accessibility of policies from the right places.** Once written, they need to be linked from: the footer, the signup page, the outreach screen (where a customer takes on sender obligations), and the account settings area. None of those links exist today.

---

## Consumer Protection & Dark Patterns

Audited against all twenty items in Part 6. **Eighteen are clean**, and several are not merely absent but actively argued against in code comments.

| Check | Status |
|---|---|
| Hidden fees · Preselected paid options · Misleading buttons | Clean — no `defaultChecked` anywhere; no pre-ticked options |
| Artificial urgency · Fake scarcity · Fake countdowns · Fake activity | **Clean.** A scan for urgency and scarcity language returns only legitimate expiry notices (magic link: one hour; invitation: 14 days) |
| Fake reviews · Fake testimonials · Fake customer numbers | **Clean, and deliberate.** `Proof()` refuses a logo wall in writing |
| Confirmshaming · Consent manipulation | Clean — no consent UI exists to manipulate |
| Difficult unsubscribe | **Clean and well built.** RFC 8058 one-click, POST acts / GET asks (because scanners prefetch links), `SECURITY DEFINER` so no account is needed, suppression honoured workspace-wide |
| Misleading free-trial language | Clean — "no card" is accurate; there is no card path at all |
| **Unsupported claims** | **FAIL** — CR-2, H-1 |
| **Subscription traps** | **FAIL, inverted** — plans are advertised that cannot be subscribed to (CR-3) |
| Difficult account deletion | **FAIL** — deletion is not difficult, it is impossible (H-4) |
| Important information in low-visibility UI | Clean — demo-data warnings use a warning surface and `role="status"` |

The pattern is worth stating plainly: Huntloop has none of the manipulative patterns, and instead has the opposite failure — **claims that are more favourable than the implementation**, arrived at by describing intent rather than by deception.

---

## Marketing & Claims

| Claim | Location | Verdict |
|---|---|---|
| "Every score shows its working. Every claim names its source. When we don't know, we say so." | Hero | **Supported** — enforced in the schema (a fact cannot exist without a source), in the UI (`ClaimBadge`) and in the colour system |
| "A worked example. Northwind is not a real company and these figures are invented" | Hero card caption | **Exemplary.** Model behaviour for an illustrative example |
| "There is no logo wall on this page because we have not earned one yet" | Proof | **Exemplary** |
| "every fact is stored with the URL it was read on and cannot be saved without one" | Proof | **Supported** — a database constraint, tested |
| "no message leaves your account without you pressing send" | Proof / FAQ | **Supported** — `autonomy 0` default; `send_message` requires `scheduled_at` |
| "Your workspace is isolated at the database level" | Integrations | **Supported** (absolute phrasing noted, MED-4) |
| "We do not train models on your data" | Integrations | **Needs a DPA** (MED-4) |
| **"Contact data has a retention window you set"** | Integrations | **FALSE** (CR-2) |
| **"an erasure path that actually deletes rather than flags"** | Integrations | **FALSE** (CR-2) |
| "Every outbound message carries a working unsubscribe, and a suppression is honoured across the whole workspace" | Integrations | **TRUE** — and, before H-2 was fixed, conditionally false under a missing environment variable |
| **"These are the limits the product actually enforces"** | Pricing | **FALSE for 3 of 5** (H-1) |
| "Start on Growth / Start on Scale" | Pricing | **Misleading** — no payment path exists (CR-3) |
| "Work stops rather than silently continuing on a bill you did not agree to" | FAQ | **Accidentally true** (MED-4) |
| "Two minutes, no card" | Final CTA | **Conditional** — gated behind a flag that is off by default (MED-2) |

No unsupported statistics, no fake social proof, no unverifiable customer logos, no absolute guarantees, no placeholder copy shipped. The failures are concentrated in exactly one place: **statements about data handling and metering that describe the design rather than the deployment.**

---

## Third-Party Services

| Service | Purpose | Data sent | Loads | Necessary | Consent likely needed | Disclosed | Secrets |
|---|---|---|---|---|---|---|---|
| **Supabase** | Postgres, Auth, Storage | All application data | Server + auth client | Yes — core | Contractual (processor) | No | `SUPABASE_SECRET_KEY` server-only; publishable key is public by design |
| **Anthropic** | All AI tasks | Company research text, ICP definitions, page content, outreach context | Server only | Yes — core | Contractual (processor) | Partially — "Apollo today" is named, Anthropic is not named on the page | `ANTHROPIC_API_KEY` server-only |
| **Apollo** | Company/contact search and enrichment | Search criteria; receives prospect PII | Server, via the provider seam | Yes | Contractual (processor) | **Yes** — named on the landing page | Server-only |
| **Hunter** | Email discovery | Domain, name; receives prospect email | Server | Optional | Contractual | No | Server-only |
| **ZeroBounce** | Email verification | **Prospect email in the URL query string** with the API key (LOW-4) | Server | Optional | Contractual | No | Server-only, but in a query string |
| **PostHog** | Product analytics | User UUID, org UUID, onboarding step, duration, refusal enum. **No PII, no free-form strings** | **Server only** (`posthog-node`) | Useful, not essential | **Yes — disclosure at minimum** | **No** (H-7) | Key is `NEXT_PUBLIC_` but only read server-side |
| **Sentry** | Error monitoring | Exception payloads, browser context. `sendDefaultPii: false`, Session Replay off, `ModelRefusalError` filtered | **Client and server** | Useful, not essential | **Yes — disclosure at minimum** | **No** (H-7) | DSNs are write-only by design; server and client DSNs deliberately separate |
| **Gmail / Outlook** | Mailbox send + reply sync | Message content, recipient addresses | Server, user-authorised OAuth | Optional | User-authorised | **Yes** — named on the landing page | Tokens encrypted at rest |
| **HubSpot** | CRM sync | Company name, domain, industry, headcount; contact email and name; three custom deal properties | Server, user-authorised | Optional | User-authorised | No | Token encrypted; verified on connect |
| **Inngest** | Job queue (alternative to Vercel Cron) | Job payloads | Server | Optional | Contractual | No | Signing key server-only |
| **Vercel** | Hosting | All traffic | — | Yes | Contractual | No | — |
| **Google Fonts** | Inter, JetBrains Mono, Lora | **Nothing at runtime** | **Build time only** — `next/font/google` downloads and self-hosts | Yes | **No** — this is the privacy-correct configuration | N/A | — |

**No advertising or marketing SDKs exist. No unused SDKs were found** — every dependency in `apps/web/package.json` is imported by application code. The Google Fonts handling deserves specific credit: it removes a third-party request from first paint, keeps the font CDN out of the eventual CSP, and eliminates a common GDPR exposure, and the reasoning is written down in `app/layout.tsx`.

---

## Licensing/IP Findings

479 packages resolved. **No copyleft or source-available licence reaches the browser bundle** — verified by identifying every non-permissive package and confirming each is build- or dev-time only.

| Licence | Count | Notes |
|---|---|---|
| MIT | 391 | |
| Apache-2.0 | 38 | |
| ISC | 15 | includes `lucide-react` |
| BSD-2/3-Clause | 17 | |
| MPL-2.0 | 3 | `axe-core` (transitive, unused), `lightningcss` ×2 — build tooling, file-level copyleft, not modified |
| BlueOak-1.0.0 | 3 | permissive |
| **FSL-1.1-MIT** | 2 | `@sentry/cli` — **source-available with a non-compete clause**, converts to MIT after two years. Build-time sourcemap upload only. Huntloop does not compete with Sentry, so the clause is not engaged, but it is the one licence here that is not simply permissive and should be noted rather than assumed |
| **Apache-2.0 AND LGPL-3.0-or-later** | 1 | `@img/sharp-win32-x64` — LGPL applies to the bundled libvips, dynamically linked, build-time image optimisation, not distributed by the app |
| CC-BY-4.0 | 1 | `caniuse-lite` — data, build time, attribution |
| Python-2.0, Unlicense, MIT-0, CC0-1.0, 0BSD | 7 | permissive |

| Asset | Licence verifiable? | Action |
|---|---|---|
| Inter, JetBrains Mono, Lora | Yes — SIL OFL, self-hosted via `next/font` | Add the OFL notice to a `NOTICE` file (MED-6) |
| Lucide icons | Yes — ISC, via npm | Clean |
| `public/brand/*.png` (3) | **No** | Confirm authorship and record it (MED-5) |
| `HuntLoop_SVGs/*.svg` (3, untracked) | **No** | Same, or remove from the working tree |
| AI-generated assets | None found | — |

---

## Security-Related Findings

**This is not a full security assessment.** It covers the application-level, user-facing items in Part 13 only.

**Verified strong.** Tenant isolation enforced in Postgres by RLS, proven by 236 migration-level checks including a cross-tenant read/write test run as a **non-superuser** so the policies genuinely apply. The service-role client — the one thing that can dissolve that boundary — is confined to five named files and forbidden in `apps/` by two independent mechanisms (ESLint `no-restricted-imports` and a dependency-free script), because, as the config puts it, one check can be misconfigured. No passwords are stored. The sign-in error message is deliberately uniform to avoid account enumeration. Every Server Action validates its inputs at runtime, enforced by a build check. Rate limiting wraps every model-calling wrapper, enforced by a build check. Mailbox OAuth tokens are encrypted at rest. Security headers are all set and checked. CSP is nonce-based with a per-request nonce, and the root layout is `force-dynamic` specifically so every page gets one. Anonymous research IPs are hashed. No secret is exposed to the client: every non-`NEXT_PUBLIC_` variable is read only from `server-only` modules or route handlers.

| ID | Finding | Severity |
|---|---|---|
| SX-1 | **CSP is report-only.** Known, documented, passes its full suite under `CSP_ENFORCE=true`. Enforcing it is a deliberate later step (SETUP.md step 8) — but until then it is a monitor, not a control | High (pre-launch) |
| SX-2 | **The rate limiter has never been driven through HTTP.** Proven by seven database-level tests and no load test. Its correctness under concurrency is asserted, not measured | Medium |
| SX-3 | **No AI task has ever called the real Anthropic API.** All twelve are tested against a scripted client. Every AI path in production will be executing for the first time | Medium |
| SX-4 | **No account recovery path**, because there is no account to recover — magic link is the whole mechanism. Correct for the design; worth stating in the eventual ToS | Low |
| SX-5 | ZeroBounce receives its API key in a URL query string (LOW-4) | Low |
| SX-6 | File uploads: CSV import parses client-supplied files. Validation exists (`lib/csv.ts`, 21 tests) and is CSV-only; no binary upload surface exists | Pass |
| SX-7 | Privileged routes: admin capability is checked per action via `canAdmin(viewer)`, not by route. Consistent and verified across the settings and team actions | Pass |

---

## What was fixed in this audit

Seventeen recommendations were made below. Fifteen are done; two cannot be done from inside this repository and are named at the end.

**Critical**

| # | Was | Now |
|---|---|---|
| CR-1 | No Privacy Policy, Terms, AUP, contact or business identity anywhere | `/privacy`, `/terms` and `/acceptable-use` exist. Everything in them about what the software does is derived from the code and checked — the complete sub-processor list, the exact prospect fields, the cookie position, how retention and erasure actually work. The seven facts only the business can supply are `PENDING` in `apps/web/lib/legal.ts` and render as visible `REQUIRES LEGAL REVIEW` blocks. While any remain, the pages are noindex, disallowed in robots.txt and unlinked from the footer; `LEGAL-02` fails the build if that stops being true. Signup's agreement line is written and appears on the same condition. **Filling in `IDENTITY` publishes all of it with no other change.** |
| CR-2 | "A retention window you set" with no way to set it; "an erasure path that actually deletes" reachable by nobody | Retention is a field on Settings → Organisation, validated against `0017`'s own 30-day floor. Erasure and per-person export are a new Settings → Data & privacy screen, calling the admin-gated wrappers `0017` was built for and `0029` finally exposes |
| CR-3 | "Start on Growth" created a Free account; no Stripe code exists | Paid tiers carry a contact CTA instead, and the section states plainly that there is no checkout and every account starts on Free |

**High**

| # | Was | Now |
|---|---|---|
| H-1 | 3 of 5 advertised limits unenforced | `emails` is checked before every send; `opportunities` is checked and counted on creation only, so re-scoring an existing one is never blocked. The pricing claim is reworded to what is true |
| H-2 | An email could ship with no unsubscribe at all | Refused before the allowance is claimed. 5 tests |
| H-3 | All 8 marketing pages disallowed from crawling | Fixed, with `SEO-AGREE` guarding it |
| H-4 | No account deletion, no workspace deletion, no export | All three, in `0029`. Workspace deletion is owner-gated and stops outreach in the same statement. Account deletion refuses a sole owner and says which workspace blocks it |
| H-5 | 11 destructive actions with no confirm, no undo, 28px targets | One `ConfirmButton` across all 11: two deliberate clicks, disarming on timer, blur and Escape, one DOM node so focus never moves, and a hit area past 44px without changing row height |
| H-6 | No postal address in any email, and no field that could hold one | `OrgComplianceSettings` holds it, Settings → Organisation sets it, the footer renders it in both the text and HTML parts, and a send is refused without it |
| H-7 | PostHog and Sentry undisclosed | Both in the privacy page's sub-processor table, with what each receives, read off the adapter |

**Medium and low**

| # | Now |
|---|---|
| MED-1 | README corrected — 19 destinations not "eleven of seventeen unbuilt", sending and inviting do work, and it now says plainly that nothing has ever been charged |
| MED-2 | The landing CTA reads the `PUBLIC_RESEARCH_ENABLED` flag and changes its promise, routing straight to signup when the anonymous read is off |
| MED-3 | The HTML part of an email carries the same footer, escaped |
| MED-5/6 | `NOTICE` records the OFL fonts, Lucide, the FSL and LGPL build-time dependencies, and states plainly that the brand assets' provenance is **not** recorded |
| LOW-1 | Brand images carry intrinsic dimensions |
| LOW-2 | `IcpQualityCard` no longer wears the AI sparkle on a deterministic number |
| LOW-3 | An Open Graph card, generated at the edge so it cannot become a 404 |
| AX-3 | `e2e/a11y.spec.ts` — axe over 5 layouts × 2 viewports × both themes. **It immediately found the contrast failures described above, and a keyboard trap: nine scroll containers no keyboard could reach** |

**Found while fixing, not in the original audit**

| Finding | Evidence |
|---|---|
| **The org voice profile has never reached a single outreach message.** `advance-enrollments.ts` read `organizations` through `scope.select()`, which filters on `org_id` — a column that table does not have. The query 400s, the error is discarded, and every message was composed in the default voice no matter what the customer configured. `sync_hubspot` lost its slug the same way | Both fixed via a named `scope.organization()` accessor |
| **Light theme contrast was never measured.** Six AA failures including every primary button label | See *Accessibility Findings* |
| **Nine scroll containers had no keyboard access** — including `DataTable`, which has a 720px minimum width | `ScrollRegion`, plus `DataTable` made focusable and labelled |
| **Three pre-existing test failures**, unrelated to this work: `routing.spec.ts` still asserted `/` redirects to `/login` after the landing page replaced it, and `smoke.spec.ts` listed `/welcome/product`, a route that no longer exists | Both corrected; the smoke list also gained the new routes |

**Not done, and why**

| # | Why not |
|---|---|
| SX-1 — enforce the CSP | Your call, and you chose to leave it report-only. The suite passes under `CSP_ENFORCE=true`; flipping it is a decision to make against a deploy you can watch, because a CSP that blocks a real script fails silently — pages render and never hydrate |
| SX-2 / SX-3 — load-test the rate limiter, run each AI task against the real API | Both need credentials and infrastructure this session does not have. They remain the two things in the product that have never executed |

---

## Recommended Changes

**Before any public launch — blocking:**

1. **Commission a Privacy Policy, Terms of Service, Acceptable Use Policy and customer-facing DPA** from a qualified practitioner. Hand them the facts listed in *Legal/Policy Findings*. Link them from the footer, signup, outreach, and settings. **Do not generate these.**
2. **Resolve the two false data-handling claims (CR-2)** by choosing, per claim: build the control, or delete the sentence.
   - *Retention:* add `contact_retention_days` to the org settings form. The backend is done; this is one field, one action, one validation rule (`>= 30`, nullable).
   - *Erasure:* add a "delete this person's data" control that enqueues `purge_contact_data`. The handler is done and tested; this is a button and an enqueue.
3. **Fix the pricing claim (H-1).** Either enforce `opportunities` and `emails` — `emails` is the smaller job, since `check_quota` already exists and `send_message` already increments it, so it needs a check before the send — or reword the sentence to name only what is enforced.
4. **Remove the paid tiers or ship checkout (CR-3).** Until Stripe is wired, a "Contact us" button on the paid tiers is honest and a "Start on Growth" button is not.
5. **Add account and workspace deletion, and a data export (H-4).** `organizations.deleted_at` already exists and is already respected by every query.
6. **Add a sender postal address (H-6):** a field on `organizations`, required before the first send, rendered into `withFooter`.

**Before launch — important:**

7. Enforce the CSP (SX-1). The suite already passes under `CSP_ENFORCE=true`.
8. Extend the UX-14 undo to the other ten destructive actions, and add a true confirm to `removeMember` and `disconnectHubspot` (H-5). Raise icon-only destructive buttons to `size="md"` (32px) or add padding to reach 44px on touch (AX-1).
9. Load-test the rate limiter over HTTP (SX-2) and run each AI task once against the real API in a staging workspace (SX-3).
10. Correct the README (MED-1).
11. Either enable `PUBLIC_RESEARCH_ENABLED` with a budget ceiling or soften the two CTAs that promise it (MED-2).

**Polish:**

12. Apply `withFooter` to the HTML part before any HTML template ships (MED-3).
13. Add a `NOTICE` file covering the OFL fonts and the brand-asset provenance (MED-5, MED-6).
14. Swap `Sparkles` for a non-AI icon on `IcpQualityCard` (LOW-2).
15. Move brand marks to `next/image`, or add explicit dimensions (LOW-1).
16. Add an `axe` pass to the Playwright suite (AX-3).
17. Add an Open Graph image (LOW-3).

---

## Files/Components Affected

**Changed by this audit (3 files, plus 1 test file):**

| File | Change |
|---|---|
| `packages/jobs/src/handlers/send-message.ts` | Refuse a send when no unsubscribe URL can be built, before the allowance is claimed (H-2) |
| `packages/jobs/scripts/verify-jobs.ts` | Set `NEXT_PUBLIC_SITE_URL` for the send fixtures; add 5 checks for the new refusal |
| `apps/web/app/robots.ts` | Allow `/for/` and `/compare/` against the wildcard disallow (H-3) |
| `scripts/audit.mjs` | New `SEO-AGREE` check: every prefix the sitemap submits must be crawlable |

**Named in findings, not changed:**

`apps/web/app/(marketing)/page.tsx` (CR-2, CR-3, H-1, MED-2, MED-4) · `apps/web/app/(auth)/signup/page.tsx` (CR-1) · `apps/web/lib/data/plans.ts`, `apps/web/lib/data/usage.ts` (H-1) · `apps/web/lib/analytics.ts`, `apps/web/instrumentation-client.ts`, `apps/web/sentry.server.config.ts` (H-7) · `apps/web/app/(app)/[org]/settings/OrgSettingsForm.tsx` (CR-2 retention field) · `packages/jobs/src/handlers/purge-contact-data.ts`, `enforce-retention.ts` (CR-2) · the eleven `actions.ts` modules listed in H-5 · `packages/ui/src/components/Button.tsx` (AX-1) · `apps/web/app/(app)/[org]/dashboard/IcpQualityCard.tsx` (LOW-2) · `apps/web/app/(auth)/layout.tsx`, `apps/web/app/(app)/[org]/OrgShell.tsx` (LOW-1) · `packages/providers/src/adapters/zerobounce.ts` (LOW-4) · `README.md` (MED-1) · `apps/web/public/brand/`, `HuntLoop_SVGs/` (MED-5).

---

## Verification Results

Every command below was run against the working tree after the fixes. Nothing here is asserted without having been executed.

| Check | Command | Result |
|---|---|---|
| Typecheck, all 7 workspaces | `npm run typecheck` | **PASS** (exit 0) |
| Lint, whole monorepo incl. `jsx-a11y` | `npm run lint` | **PASS** (exit 0) |
| Migration + RLS suite | `packages/db` | **PASS** — 237/237 (was 236; +1 for `0029`) |
| Identity / canonicalisation | `packages/db` | **PASS** — 59/59 |
| AI task suite | `packages/ai` | **PASS** — 121/121 |
| Service-role confinement | `packages/db` | **PASS** — 221 files in `apps/`, 130 in `packages/`; confined to 5 named files |
| Jobs suite | `packages/jobs` | **PASS** — **225/225** (was 199) |
| Providers suite | `packages/providers` | **PASS** — 81/81 |
| Web unit tests | `apps/web` (vitest) | **PASS** — 22 tests |
| Site audit | `npm run audit:site` | **PASS** — **44 checks, 0 failing, 1 warning** (was 40/0/0) |
| **Browser suite** | `npx playwright test` | **PASS** — **256 passed, 0 failed** (was 68 with 6 failing) |
| Production build | `npm run build` | **PASS** (exit 0) |
| Bundle budget | `npm run audit:bundle` | **PASS** — 245.7 kB of 275 kB |
| **Full gate** | `npm run verify` | **PASS (exit 0)** |

The single remaining warning is `LEGAL-01`: seven facts in `apps/web/lib/legal.ts` are still `PENDING`. It is a warning rather than a failure by design — the pages are gated shut while it stands, and `LEGAL-02` fails the build if that gating ever breaks.

**Checks proven to catch their own bug**, by reverting the fix and confirming failure before restoring:

- `SEO-AGREE` — fails when the sitemap submits a prefix robots.txt disallows.
- `LEGAL-02` — fails when a legal page with PENDING facts becomes linked, and names which of the three gates broke.

**Behaviour verified in a running browser**, not inferred: the two-step confirm arms on first click, keeps the same DOM node (so focus never moves), announces through a live region, disarms on Escape, and reaches the server action on the second click — where demo mode answered with its honest refusal. Console clean.

**Additional verification for this audit:**

- Built `robots.txt` and `sitemap.xml` read from `.next/server/app/*.body` to confirm H-3 empirically rather than from source.
- Every `check_quota` / `check_quota_internal` call site enumerated to establish H-1.
- Every caller of `purge_contact_data` and every reference to `contact_retention_days` enumerated to establish CR-2.
- All 479 resolved packages walked for licence metadata.
- Every contrast ratio in the correction above computed from the WCAG relative-luminance formula, including alpha compositing for the `opacity` and `color-mix` cases.

**Not performed, and not claimed:** no assistive technology was used; no real-device testing; no penetration testing; no load testing; nothing was run against a live Supabase project, so `0029` is proven against PGlite rather than against Postgres-with-RLS-and-real-auth. `delete_own_account` in particular deletes from `auth.users`, a table PGlite's harness stubs — its authorisation logic is reviewed, not executed.

---

## MASTER CHECKLIST

Statuses: `[x]` PASS · `[ ]` FAIL · `[~]` PARTIAL · `[!]` NEEDS REVIEW · `[-]` N/A

### Part 1 — Vibe-code / generic AI design

| ID | Area | Check | Status | Severity | Evidence | Recommended action | Files |
|----|------|-------|--------|----------|----------|--------------------|-------|
| V-01 | Design | Harsh gradients | [x] | — | Zero `gradient` in source | None | — |
| V-02 | Design | Generic icon-library use | [x] | — | Lucide, 71 icons, uniform weight/size, `aria-hidden` discipline | None | — |
| V-03 | Design | Excessive pure white | [x] | — | `#171717` dark canvas; `#f3f1ea` light canvas | None | `tokens.css` |
| V-04 | Design | Rainbow / multi-colour | [x] | — | 5 semantic hues, 6-stop chart ramp, each meaning stated | None | `tokens.css` |
| V-05 | Design | Excessive drop shadows | [x] | — | One shadow token; one usage | None | `HoverPanel.tsx:239` |
| V-06 | Design | Three-feature-card layouts | [x] | — | 3 occurrences, each semantically three | None | `page.tsx:374,770` |
| V-07 | Design | Unnecessary emojis | [x] | — | Unicode scan: zero | None | — |
| V-08 | Design | Glassmorphism | [x] | — | No `backdrop-filter` in source | None | — |
| V-09 | Copy | AI copy patterns / em dashes | [~] | Low | Em dashes frequent; voice is specific and self-critical, not generated | None — intentional | `page.tsx` |
| V-10 | Design | Default AI/SaaS typography | [x] | — | Inter inside a 9-step scale, `.hl-label` signature, Lora display in Light | None | `tokens.css` |
| V-11 | Design | Colored-left-stripe callouts | [x] | — | Full tinted surface + border | None | — |
| V-12 | Credibility | Fake / placeholder testimonials | [x] | — | None; absence argued in code | None | `page.tsx:650` |
| V-13 | Design | Unnecessary bento grids | [x] | — | Uniform grids only | None | — |
| V-14 | Design | Decorative terminal windows | [x] | — | None | None | — |
| V-15 | Copy | "It's not X, it's Y" | [x] | — | One instance, load-bearing | None | `approaches.ts:161` |
| V-16 | Design | Checkmark-heavy lists | [x] | — | One table, 3-state, `aria-label`ed | None | `page.tsx:600` |
| V-17 | Pricing | Default three-tier layout | [x] | — | Three because the catalogue holds three | None (see L-01) | `plans.ts:50` |
| V-18 | Credibility | Real product demonstration | [x] | — | Hero renders the product's own components; caption states figures are invented | None | `page.tsx:205` |
| V-19 | Design | Excessively uniform rounding | [x] | — | 4px / 6px dominant | None | — |
| V-20 | Design | Generic purple/black AI look | [x] | — | Violet reserved for model output; brand is green | None | `tokens.css` |
| V-21 | UX | Missing skeleton/loading states | [x] | — | `LoadingSkeleton` + full state vocabulary | None | `States.tsx` |
| V-22 | Design | Radial gradient orbs | [x] | — | No gradients | None | — |
| V-23 | Design | Dot-grid backgrounds | [x] | — | No `repeating-*` / `bg-[url]` | None | — |
| V-24 | Design | Excessive sparkle icons | [~] | Low | Consistent AI marker, except one non-AI card | Swap the icon | `IcpQualityCard.tsx:63` |
| V-25 | Design | Decorative animated arrows | [x] | — | None | None | — |
| V-26 | Legal | Terms of Service present | [ ] | **Critical** | No route, no file, no link | Commission — do not generate | CR-1 |
| V-27 | Legal | Privacy Policy present | [ ] | **Critical** | No route, no file, no link | Commission — do not generate | CR-1 |
| V-28 | Design | Excessive hover animations | [x] | — | 120/180ms colour only; reduced-motion zeroes at token level | None | `tokens.css` |
| V-29 | Design | Excessive neon | [x] | — | Measured, AA-compliant palette | None | — |
| V-30 | Design | Generic pastel palette | [x] | — | Warm paper + rust, derived from references | None | `tokens.css` |

### Part 2 — Design system

| ID | Area | Check | Status | Severity | Evidence | Recommended action | Files |
|----|------|-------|--------|----------|----------|--------------------|-------|
| D-01 | Design system | Brand consistency | [x] | — | Single token source; theme-swapped marks | None | `tokens.css` |
| D-02 | Design system | Colour system | [x] | — | Per-theme leaves, alias composites, epistemic semantics | None | `tokens.css` |
| D-03 | Design system | Typography hierarchy | [x] | — | 9 steps with stated line-height/weight | None | `tokens.css` |
| D-04 | Design system | Spacing system | [x] | — | 4px base, 10 steps | None | `tokens.css` |
| D-05 | Design system | Radius system | [x] | — | 4 tokens; usage matches | None | `tokens.css` |
| D-06 | Design system | Shadow system | [x] | — | One token, per theme, documented as the only one | None | `tokens.css` |
| D-07 | Design system | Iconography | [~] | Low | Consistent; one semantic mismatch | V-24 | `IcpQualityCard.tsx` |
| D-08 | Design system | Buttons | [~] | Medium | 3 sizes, 4 variants, consistent — icon-only `sm` is 28px | A-01 | `Button.tsx:62` |
| D-09 | Design system | Inputs | [x] | — | Consistent height, focus ring, labels | None | `Form.tsx` |
| D-10 | Design system | Cards | [x] | — | `Card`/`CardHeader`/`CardBody`, `flush` variant | None | `Card.tsx` |
| D-11 | Design system | Navigation | [x] | — | Grouped sidebar, active detection, mobile drawer | None | `Sidebar.tsx`, `OrgShell.tsx` |
| D-12 | Design system | Modals / dialogs | [x] | — | `HoverPanel` with tests; Escape handling | None | `HoverPanel.tsx` |
| D-13 | Design system | Tables | [x] | — | `DataTable` with tests; row focus convention | None | `DataTable.tsx` |
| D-14 | Design system | Charts | [!] | Low | 6-stop ramp defined per theme; no chart component exists yet | Re-check when charts ship | `tokens.css` |
| D-15 | Design system | Empty states | [x] | — | `EmptyState` | None | `States.tsx:78` |
| D-16 | Design system | Loading states | [x] | — | `LoadingSkeleton` + 3 `loading.tsx` | None | `States.tsx:218` |
| D-17 | Design system | Error states | [x] | — | `ErrorState`, `PermissionDenied`, `RateLimited` | None | `States.tsx:105` |
| D-18 | Design system | Success states | [x] | — | `Confirmed`, with undo affordance | None | `States.tsx:290` |
| D-19 | Design system | Responsive layouts | [x] | — | `sm`/`lg` + two named max-widths; mobile Playwright project | None | — |
| D-20 | Design system | Dark/light/system themes | [x] | — | Server-resolved cookie + pre-paint script for "system" | None | `layout.tsx`, `theme.ts` |
| D-21 | Design system | Mobile usability | [~] | Medium | Drawer, tap-to-open panels, tested — 28px destructive targets | A-01 | `Button.tsx` |
| D-22 | Design system | Desktop usability | [x] | — | 44px rows, hover panels, keyboard paths | None | — |

### Part 3 — UX & product quality

| ID | Area | Check | Status | Severity | Evidence | Recommended action | Files |
|----|------|-------|--------|----------|----------|--------------------|-------|
| U-01 | UX | Clear navigation | [x] | — | 19 destinations, all resolving; `NAV-01` | None | `OrgShell.tsx:82` |
| U-02 | UX | Information hierarchy | [x] | — | Consistent heading scale; no orphan `h2` | None | — |
| U-03 | UX | Understandable CTAs | [~] | Medium | Clear, but two promise a disabled path and two promise unbuyable plans | MED-2, CR-3 | `page.tsx` |
| U-04 | UX | Useful onboarding | [x] | — | 6 steps, each consuming the last; progress; skeletons | None | `(onboarding)/welcome/*` |
| U-05 | UX | Form validation | [x] | — | Zod on every action; `SEC-VAL` enforces it | None | `lib/validation.ts` |
| U-06 | UX | Helpful error messages | [x] | — | Written for people, with the next step | None | `send-message.ts:279` |
| U-07 | UX | Loading feedback | [x] | — | `useTransition` + pending states throughout | None | — |
| U-08 | UX | Skeleton loaders | [x] | — | 7 call sites | None | `States.tsx` |
| U-09 | UX | Empty states | [x] | — | `EmptyState` used across screens | None | `States.tsx` |
| U-10 | UX | Confirmation for destructive actions | [ ] | **High** | 11 actions fire on one click; only sources has undo | Extend UX-14 undo; confirm for member/CRM | H-5 |
| U-11 | UX | Undo / recovery | [~] | High | Undo exists in one place; soft deletes are unreachable by users | Add a restore surface | UX-1 |
| U-12 | UX | Responsive behaviour | [x] | — | Desktop + Pixel 7 Playwright projects | None | `playwright.config.ts` |
| U-13 | UX | Touch-friendly controls | [~] | Medium | 44px rows; 28px icon-only destructive buttons | A-01 | `Button.tsx:62` |
| U-14 | UX | Keyboard usability | [x] | — | Skip link, focus convention, Escape on drawer, all tested | None | `e2e/app-shell.spec.ts` |
| U-15 | UX | Logical workflows | [x] | — | Traced marketing→discover→signup→onboarding→product | None | — |
| U-16 | UX | Broken / dead-end flows | [x] | — | `NAV-01`/`NAV-02`/`NAV-03` pass | None | `scripts/audit.mjs` |
| U-17 | UX | Duplicate functionality | [x] | — | None found; priority filter deduplicated and tested | None | `e2e/modules.spec.ts` |
| U-18 | UX | Unnecessary steps | [x] | — | Domain carried from landing through signup | None | `signup/page.tsx` |
| U-19 | UX | Misleading UI | [ ] | **High** | Usage bars for unenforced limits; buy buttons with no checkout | H-1, CR-3 | `usage.ts`, `page.tsx` |
| U-20 | UX | Placeholder content exposed | [x] | — | None; `FEAT-FIXTURE` passes | None | — |
| U-21 | Credibility | Fake data presented as real | [x] | — | `DemoFigures`/`DataSourceBanner`; `FEAT-DEMO` fails the build | None | `DemoFigures.tsx` |
| U-22 | Credibility | Real product demonstration | [x] | — | Hero uses the real components | None | `page.tsx:205` |

### Part 4 — Privacy & data protection

| ID | Area | Check | Status | Severity | Evidence | Recommended action | Files |
|----|------|-------|--------|----------|----------|--------------------|-------|
| P-01 | Privacy | Privacy Policy | [ ] | **Critical** | Does not exist | Commission | CR-1 |
| P-02 | Privacy | Accurate disclosures | [ ] | **Critical** | 2 of 4 public claims false | CR-2 | `page.tsx:730` |
| P-03 | Privacy | Cookie Policy | [ ] | High | Does not exist | Include in the policy | CR-1 |
| P-04 | Privacy | Cookie consent mechanism | [-] | — | Only strictly-necessary cookies; server-side analytics | State the position in the policy | `analytics.ts` |
| P-05 | Privacy | Consent collection | [ ] | **Critical** | No consent at signup | Add on signup once terms exist | `signup/page.tsx` |
| P-06 | Privacy | Consent records | [-] | — | Nothing to record yet | Revisit with P-05 | — |
| P-07 | Privacy | Necessary vs unnecessary collection | [x] | — | Closed analytics union; no advertising | None | `analytics.ts:82` |
| P-08 | Privacy | Data minimisation | [x] | — | Org slug excluded deliberately; PII off in Sentry; IPs hashed | None | `analytics.ts` |
| P-09 | Privacy | Data retention | [~] | **Critical** | Backend built; no user control; claim says otherwise | Add the settings field | CR-2 |
| P-10 | Privacy | Data deletion (prospects) | [ ] | **Critical** | `purge_contact_data` enqueued by nothing | Add a trigger | CR-2 |
| P-11 | Privacy | Account deletion | [ ] | **High** | Does not exist | Build it | H-4 |
| P-12 | Privacy | Data export / access | [ ] | **High** | Does not exist; CSV is import-only | Build it | H-4 |
| P-13 | Privacy | Third-party data sharing | [~] | **High** | Real, defensible, undisclosed | Disclose | H-7 |
| P-14 | Privacy | Analytics tracking | [~] | High | Excellent design, zero disclosure | Disclose | `analytics.ts` |
| P-15 | Privacy | Advertising tracking | [x] | — | None exists | None | — |
| P-16 | Privacy | Authentication data | [x] | — | No passwords; no enumeration oracle | None | `AuthForm.tsx:17` |
| P-17 | Privacy | Sensitive data handling | [x] | — | Tokens encrypted; service-role confined to 5 files | None | — |
| P-18 | Privacy | Children's data | [-] | — | B2B tooling; no child audience | Confirm no minors targeted | — |
| P-19 | Privacy | Age gates | [-] | — | Not applicable to the audience | — | — |
| P-20 | Privacy | Privacy settings | [ ] | Medium | None exist | Add with P-11/P-12 | — |
| P-21 | Privacy | Tracking before consent | [x] | — | Nothing fires before sign-in | None | `analytics.ts:175` |
| P-22 | Privacy | Handling data-subject requests | [ ] | **Critical** | No process, no contact point, no route | Needs both a contact and a mechanism | CR-1, H-4 |

### Part 5 — Terms, policies & business information

| ID | Area | Check | Status | Severity | Evidence | Recommended action | Files |
|----|------|-------|--------|----------|----------|--------------------|-------|
| T-01 | Legal | Terms of Service | [ ] | **Critical** | Absent | Commission | — |
| T-02 | Legal | Privacy Policy | [ ] | **Critical** | Absent | Commission | — |
| T-03 | Legal | Cookie Policy | [~] | Low | Likely unnecessary; the position should still be stated | Include a section | — |
| T-04 | Legal | Refund Policy | [ ] | High | Absent; plans advertised | Blocked on CR-3 | — |
| T-05 | Legal | Cancellation Policy | [ ] | High | Absent | Blocked on CR-3 | — |
| T-06 | Legal | Subscription terms | [ ] | **Critical** | Paid plans shown with no terms | Remove tiers or add terms | CR-3 |
| T-07 | Legal | Billing disclosures | [ ] | High | None | Blocked on CR-3 | — |
| T-08 | Legal | Acceptable Use Policy | [ ] | **Critical** | Absent; the product sends cold outbound | Commission | — |
| T-09 | Legal | Community guidelines | [-] | — | No UGC between users | — | — |
| T-10 | Legal | Copyright / IP notice | [~] | Low | `© {year} Huntloop`; no entity | Add the entity | `page.tsx:940` |
| T-11 | Legal | Contact information | [ ] | **Critical** | None anywhere public | Add | — |
| T-12 | Legal | Business identity | [ ] | **Critical** | None anywhere | Add — **do not invent** | — |
| T-13 | Legal | Policies reachable from the right places | [ ] | **Critical** | Nothing to reach | Footer, signup, outreach, settings | — |

### Part 6 — Consumer protection & dark patterns

| ID | Area | Check | Status | Severity | Evidence | Recommended action | Files |
|----|------|-------|--------|----------|----------|--------------------|-------|
| K-01 | Consumer | Hidden fees | [x] | — | None | None | — |
| K-02 | Consumer | Preselected paid options | [x] | — | No `defaultChecked` anywhere | None | — |
| K-03 | Consumer | Misleading buttons | [ ] | **Critical** | "Start on Growth" starts a Free account | CR-3 | `page.tsx:808` |
| K-04 | Consumer | Confusing cancellation | [-] | — | Nothing to cancel | Revisit with billing | — |
| K-05 | Consumer | Artificial urgency | [x] | — | Scan clean | None | — |
| K-06 | Consumer | Fake scarcity | [x] | — | None | None | — |
| K-07 | Consumer | Fake countdown timers | [x] | — | Only genuine expiries | None | — |
| K-08 | Consumer | Fake activity indicators | [x] | — | None | None | — |
| K-09 | Consumer | Fake reviews | [x] | — | None | None | — |
| K-10 | Consumer | Fake testimonials | [x] | — | Absence argued in code | None | `page.tsx:650` |
| K-11 | Consumer | Fake customer numbers | [x] | — | None | None | — |
| K-12 | Consumer | Unsupported claims | [ ] | **Critical** | CR-2, H-1 | Fix or reword | `page.tsx` |
| K-13 | Consumer | Misleading comparisons | [x] | — | 3-state table; "Sometimes" used honestly | None | `page.tsx:600` |
| K-14 | Consumer | Difficult unsubscribe | [x] | — | RFC 8058, no account needed, workspace-wide suppression | None | `api/unsubscribe` |
| K-15 | Consumer | Difficult account deletion | [ ] | **High** | Impossible, not merely difficult | H-4 | — |
| K-16 | Consumer | Consent manipulation | [-] | — | No consent UI exists | Revisit with P-05 | — |
| K-17 | Consumer | Confirmshaming | [x] | — | None | None | — |
| K-18 | Consumer | Misleading free-trial language | [x] | — | "No card" is accurate | None | — |
| K-19 | Consumer | Subscription traps | [ ] | **Critical** | Inverted — advertised, unbuyable | CR-3 | — |
| K-20 | Consumer | Important info in low-visibility UI | [x] | — | Warning surface + `role="status"` | None | `DemoFigures.tsx` |

### Part 7 — Marketing & claims

| ID | Area | Check | Status | Severity | Evidence | Recommended action | Files |
|----|------|-------|--------|----------|----------|--------------------|-------|
| M-01 | Marketing | Unsupported performance claims | [x] | — | No performance numbers claimed | None | — |
| M-02 | Marketing | Unsupported statistics | [x] | — | No statistics on the page | None | — |
| M-03 | Marketing | Fake social proof | [x] | — | Refused in writing | None | `page.tsx:650` |
| M-04 | Marketing | Fake testimonials | [x] | — | None | None | — |
| M-05 | Marketing | Unverifiable customer logos | [x] | — | No logo wall | None | — |
| M-06 | Marketing | Misleading AI claims | [x] | — | Deliberately not positioned as an AI SDR; autonomy limits accurate | None | `page.tsx:40` |
| M-07 | Marketing | Misleading security claims | [~] | Medium | Isolation claim true; absolute phrasing | Soften | `page.tsx:734` |
| M-08 | Marketing | Misleading privacy claims | [ ] | **Critical** | 2 of 4 false | CR-2 | `page.tsx:743` |
| M-09 | Marketing | Misleading "free" claims | [x] | — | Accurate | None | — |
| M-10 | Marketing | Misleading pricing claims | [ ] | **Critical** | H-1, CR-3 | Fix or reword | `page.tsx:765` |
| M-11 | Marketing | Absolute guarantees | [~] | Low | One absolute ("even if we ship a bug") | Soften | `page.tsx:734` |
| M-12 | Marketing | Placeholder claims shipped | [x] | — | None | None | — |

### Part 8 — Accessibility

| ID | Area | Check | Status | Severity | Evidence | Recommended action | Files |
|----|------|-------|--------|----------|----------|--------------------|-------|
| A-01 | A11y | Image alt text | [x] | — | 3 `<img>`, all with `alt`; hidden twin removed from the tree by `display:none` | None | `(auth)/layout.tsx` |
| A-02 | A11y | Semantic HTML | [x] | — | `nav`/`main`/`section`/`dl`/`table` with `scope` | None | — |
| A-03 | A11y | Heading hierarchy | [x] | — | No page has `h2`/`h3` without `h1` | None | — |
| A-04 | A11y | Form labels | [x] | — | Every control has `<label htmlFor>` or `aria-label` | None | — |
| A-05 | A11y | ARIA usage | [x] | — | Used where native semantics fall short; not layered on top | None | — |
| A-06 | A11y | Keyboard navigation | [x] | — | Skip link tested; unbuilt items kept out of the tab order | None | `e2e/app-shell.spec.ts` |
| A-07 | A11y | Focus indicators | [x] | — | `.hl-focusable` universal; `.hl-focusable-row` for the Safari collapse case | None | `tokens.css` |
| A-08 | A11y | Focus order | [x] | — | Skip link first and it moves focus | None | `OrgShell.tsx:175` |
| A-09 | A11y | Colour contrast | [~] | High | Dark measured and sound. **Light was not** — 3 of 4 ramp colours and the primary button were below AA. Fixed in this audit and now enforced by axe | Done — see AX-5 | `tokens.css`, `ScorePill.tsx`, `ClaimBadge.tsx` |
| A-10 | A11y | Screen-reader compatibility | [!] | Medium | Markup supports it; no AT testing performed | Test with NVDA/VoiceOver | — |
| A-11 | A11y | Accessible modals | [x] | — | `HoverPanel` tested; Escape closes the drawer | None | `HoverPanel.test.tsx` |
| A-12 | A11y | Accessible dropdowns | [x] | — | Native `select` in `Form.tsx` | None | `Form.tsx` |
| A-13 | A11y | Accessible navigation | [x] | — | `aria-label`ed nav landmarks; `aria-current` | None | `Sidebar.tsx` |
| A-14 | A11y | Error identification | [x] | — | Text + icon + surface, never colour alone | None | `States.tsx` |
| A-15 | A11y | Reduced motion | [x] | — | Durations zeroed at the token level | None | `tokens.css:140` |
| A-16 | A11y | Captions / transcripts | [-] | — | No audio or video | — | — |
| A-17 | A11y | Touch target sizes | [~] | Medium | 28px icon-only buttons — clears SC 2.5.8, under 44px | Raise to `md` or pad | `Button.tsx:62` |
| A-18 | A11y | Zoom / text scaling | [!] | Low | `rem`-based scale supports it; not verified in a browser | Verify at 200% | — |
| A-19 | A11y | Information not by colour alone | [x] | — | Product rule; Playwright-tested | None | `e2e/app-shell.spec.ts` |

### Part 9 — Email & communication

| ID | Area | Check | Status | Severity | Evidence | Recommended action | Files |
|----|------|-------|--------|----------|----------|--------------------|-------|
| E-01 | Email | Sender identity | [~] | High | From-address recorded; **no postal address** | H-6 | `send-message.ts:340` |
| E-02 | Email | Unsubscribe mechanism | [x] | — | RFC 8058 + footer; **hardened in this audit** | Done | H-2 |
| E-03 | Email | Marketing consent | [!] | **Critical** | Cold B2B outbound — lawful basis is jurisdiction-dependent | `REQUIRES LEGAL REVIEW` | — |
| E-04 | Email | Transactional vs marketing separation | [x] | — | Magic link is Supabase auth; outreach is a separate path | None | — |
| E-05 | Email | Preference management | [~] | Medium | Recipients can unsubscribe; users have no notification preferences | Add with P-20 | — |
| E-06 | Email | Notification controls | [ ] | Medium | None exist | Add | — |
| E-07 | Email | Accurate email content | [x] | — | Grounded in stored evidence; a person approves every send | None | — |
| E-08 | Email | No deceptive subject lines | [x] | — | Model-drafted, human-approved, no manipulation patterns | None | — |
| E-09 | Email | Required business details | [ ] | **High** | No postal address; no schema field for one | H-6 | — |
| E-10 | Email | Suppression of unsubscribed recipients | [x] | — | Re-checked at send; workspace-wide; domain-level supported | None | `send-message.ts:102` |

### Part 10 — Third-party services & SDKs

| ID | Area | Check | Status | Severity | Evidence | Recommended action | Files |
|----|------|-------|--------|----------|----------|--------------------|-------|
| X-01 | Third-party | Inventory complete | [x] | — | 12 services enumerated with data flows | None | see table |
| X-02 | Third-party | Analytics | [~] | High | Excellent design, undisclosed | H-7 | `analytics.ts` |
| X-03 | Third-party | Authentication | [x] | — | Supabase; keys correctly split | None | — |
| X-04 | Third-party | Payment processors | [-] | — | Stripe declared, zero code | CR-3 | — |
| X-05 | Third-party | Advertising | [x] | — | None | None | — |
| X-06 | Third-party | Tracking technologies | [x] | — | No client-side tracking | None | — |
| X-07 | Third-party | AI APIs | [~] | Medium | Anthropic; server-only; not named on the page | Name in the policy | — |
| X-08 | Third-party | External APIs | [~] | Medium | Apollo/Hunter/ZeroBounce/HubSpot behind one seam (`PRV-CHK`) | Disclose | `packages/providers` |
| X-09 | Third-party | CDNs | [x] | — | None; fonts self-hosted at build time | None | `layout.tsx` |
| X-10 | Third-party | Embedded content | [x] | — | No iframes | None | — |
| X-11 | Third-party | Chat / support tools | [x] | — | None | None | — |
| X-12 | Third-party | Email providers | [x] | — | User's own Gmail/Outlook via OAuth | None | — |
| X-13 | Third-party | Storage providers | [x] | — | Supabase only | None | — |
| X-14 | Third-party | Monitoring | [~] | High | Sentry, client + server, undisclosed | H-7 | — |
| X-15 | Third-party | Social integrations | [x] | — | None | None | — |
| X-16 | Third-party | Unused SDKs | [x] | — | Every dependency is imported | None | — |
| X-17 | Third-party | Secrets handled safely | [x] | — | No non-public secret reachable from the client | None | — |

### Part 11 — Asset & IP licensing

| ID | Area | Check | Status | Severity | Evidence | Recommended action | Files |
|----|------|-------|--------|----------|----------|--------------------|-------|
| L-01 | Licensing | Fonts | [~] | Low | OFL, self-hosted; notice not shipped | Add `NOTICE` | MED-6 |
| L-02 | Licensing | Images | [!] | Medium | 3 brand PNGs, provenance unrecorded | Record authorship | MED-5 |
| L-03 | Licensing | Illustrations | [!] | Medium | 3 untracked SVGs, ~2 MB | Record or remove | `HuntLoop_SVGs/` |
| L-04 | Licensing | Icons | [x] | — | Lucide, ISC | None | — |
| L-05 | Licensing | Video / audio | [-] | — | None | — | — |
| L-06 | Licensing | Stock assets | [x] | — | None used | None | — |
| L-07 | Licensing | Templates / UI kits | [x] | — | Design system is first-party; Supabase/Kima cited as *influence* | None | `tokens.css:5` |
| L-08 | Licensing | Open-source packages | [x] | — | 479 walked; no copyleft reaches the bundle | None | — |
| L-09 | Licensing | Third-party code | [~] | Low | `@sentry/cli` is FSL-1.1-MIT (non-compete); build-time only | Note it | — |
| L-10 | Licensing | Logos / trademarks | [!] | Medium | "Huntloop" unregistered as far as the repo shows | `REQUIRES LEGAL REVIEW` | — |
| L-11 | Licensing | AI-generated assets | [-] | — | None found | — | — |

### Part 12 — Children & age-restricted users

| ID | Area | Check | Status | Severity | Evidence | Recommended action | Files |
|----|------|-------|--------|----------|----------|--------------------|-------|
| C-01 | Minors | Age requirements | [-] | — | B2B sales tooling; no plausible child audience | State a minimum age in the ToS | — |
| C-02 | Minors | DOB collection | [-] | — | None collected — correct | None | — |
| C-03 | Minors | Children's privacy | [-] | — | Not applicable | `REQUIRES CONFIRMATION` | — |
| C-04 | Minors | Parental consent | [-] | — | Not applicable | — | — |
| C-05 | Minors | Age-appropriate notices | [-] | — | Not applicable | — | — |
| C-06 | Minors | Data minimisation for minors | [-] | — | Not applicable | — | — |
| C-07 | Minors | Profiling / tracking of minors | [-] | — | Not applicable | — | — |
| C-08 | Minors | Advertising to minors | [-] | — | No advertising at all | — | — |
| C-09 | Minors | Minor–adult communication | [-] | — | No user-to-user messaging | — | — |
| C-10 | Minors | User-generated content | [-] | — | Content is workspace-private | — | — |
| C-11 | Minors | Reporting / blocking | [-] | — | Not applicable | — | — |
| C-12 | Minors | Moderation | [-] | — | Not applicable | — | — |
| C-13 | Minors | Safety controls | [-] | — | Not applicable | — | — |

### Part 13 — Security-related user safeguards

| ID | Area | Check | Status | Severity | Evidence | Recommended action | Files |
|----|------|-------|--------|----------|----------|--------------------|-------|
| S-01 | Security | Authentication flows | [x] | — | Magic link + OAuth; no enumeration oracle | None | `AuthForm.tsx` |
| S-02 | Security | Authorization boundaries | [x] | — | RLS + membership guard + `canAdmin` per action | None | — |
| S-03 | Security | Password handling | [-] | — | No passwords exist | None | — |
| S-04 | Security | Session handling | [x] | — | Supabase; `auth.getUser()` verified server-side, not cookie-trusted | None | `proxy.ts` |
| S-05 | Security | Secret exposure | [x] | — | No non-public secret reachable from the client | None | — |
| S-06 | Security | Env var exposure | [x] | — | `REPO-02` verifies every read var is declared | None | `.env.example` |
| S-07 | Security | Sensitive info in client code | [x] | — | `server-only` on every data module | None | — |
| S-08 | Security | Sensitive info in logs | [x] | — | `sendDefaultPii: false`; hashed IPs; no PII in analytics | None | — |
| S-09 | Security | Rate limiting | [~] | Medium | Every AI wrapper (`SEC-RATELIMIT`); never load-tested | SX-2 | `rate-limit.ts` |
| S-10 | Security | Abuse prevention | [x] | — | Cache → allowance → budget → breaker; public research off by default | None | `discover/actions.ts` |
| S-11 | Security | File-upload restrictions | [x] | — | CSV only, validated, 21 tests | None | `lib/csv.ts` |
| S-12 | Security | Input validation | [x] | — | Zod on every action; `SEC-VAL` enforces | None | — |
| S-13 | Security | Account recovery | [-] | — | Magic link is the mechanism | State in the ToS | — |
| S-14 | Security | Account deletion | [ ] | **High** | Does not exist | H-4 | — |
| S-15 | Security | Privileged / admin routes | [x] | — | Capability-checked per action | None | — |
| S-16 | Security | Production debug info | [x] | — | Zero `TODO`/`FIXME`; no debug endpoints; `no-console` scoped to scripts | None | — |
| S-17 | Security | User-facing security/privacy settings | [ ] | Medium | None exist | Add with P-20 | — |
| S-18 | Security | CSP enforced | [~] | **High** | Nonce-based, full suite passes under `CSP_ENFORCE=true`, **report-only today** | Enforce before launch | SX-1 |

### Part 14 — Responsive & cross-state

| ID | Area | Check | Status | Severity | Evidence | Recommended action | Files |
|----|------|-------|--------|----------|----------|--------------------|-------|
| R-01 | Responsive | Mobile / tablet / laptop / desktop / wide | [~] | Low | Breakpoints present; Pixel 7 + Desktop Chrome projects exist; **not run in this session** | Run `npx playwright test` | `playwright.config.ts` |
| R-02 | States | Dark / light / system | [x] | — | Server-resolved; pre-paint script for "system" | None | `layout.tsx` |
| R-03 | States | Authenticated / unauthenticated | [x] | — | Guard + redirect; landing redirects a signed-in visitor | None | `proxy.ts` |
| R-04 | States | New / returning user | [x] | — | Onboarding vs `LAST_ORG_COOKIE` destination | None | `destination.ts` |
| R-05 | States | Empty / populated | [x] | — | `EmptyState` throughout; demo vs live distinguished | None | — |
| R-06 | States | Loading | [x] | — | Skeletons + pending states | None | — |
| R-07 | States | Error | [x] | — | `error.tsx`, `global-error.tsx`, `not-found.tsx`, `ErrorState` | None | — |
| R-08 | States | Offline / degraded | [x] | — | Every loader degrades to demo data and says so | None | `lib/data/source.ts` |
| R-09 | States | Permission denied | [x] | — | `PermissionDenied` + `canWrite`/`canAdmin` gating | None | `States.tsx:147` |
| R-10 | Responsive | Overflow / clipping / overlap | [!] | Low | Pipeline board scrolls internally (tested); not visually inspected | Run the browser suite | — |

### Part 15 — Codebase vs UI verification

| ID | Area | Check | Status | Severity | Evidence | Recommended action | Files |
|----|------|-------|--------|----------|----------|--------------------|-------|
| B-01 | Verification | Routes match the UI | [x] | — | 39 pages, 19 nav destinations, all resolving | None | — |
| B-02 | Verification | Components match the design system | [x] | — | One inconsistency (V-24) | — | — |
| B-03 | Verification | Config matches documentation | [ ] | Medium | README wrong on three counts | MED-1 | `README.md` |
| B-04 | Verification | Env usage matches `.env.example` | [x] | — | `REPO-02` passes | None | — |
| B-05 | Verification | Schema matches the UI | [~] | **Critical** | `contact_retention_days` exists with no UI; the page claims one | CR-2 | — |
| B-06 | Verification | APIs match claims | [x] | — | 8 routes, all reachable and purposeful | None | — |
| B-07 | Verification | Middleware matches claims | [x] | — | Guard + nonce; crawler routes excluded (`SEO-MW`) | None | `proxy.ts` |
| B-08 | Verification | Dependencies match usage | [x] | — | No unused SDKs | None | — |
| B-09 | Verification | Integrations match disclosures | [ ] | **High** | PostHog and Sentry undisclosed | H-7 | — |
| B-10 | Verification | Auth matches claims | [x] | — | As described | None | — |
| B-11 | Verification | Analytics match disclosures | [ ] | **High** | No disclosure exists | H-7 | — |
| B-12 | Verification | Billing matches claims | [ ] | **Critical** | Plans priced, no payment path | CR-3 | — |
| B-13 | Verification | Forms match claims | [x] | — | All validated | None | — |
| B-14 | Verification | Emails match claims | [~] | High | Unsubscribe claim now true; no postal address | H-6 | — |
| B-15 | Verification | Assets match licensing | [!] | Medium | Brand provenance unrecorded | MED-5 | — |

---

## Totals

**The master checklist above records the state as found.** It is deliberately not rewritten to show the repaired state — an audit whose findings disappear once they are fixed cannot be re-read later to check whether the fix held. A-09 is the one row edited in place, because it was recorded wrong rather than merely fixed. For current state, read *What was fixed in this audit*.

Counted mechanically from the checklist, not estimated.

| Status | Count |
|---|---|
| **Total checks** | **254** |
| PASS `[x]` | 152 |
| FAIL `[ ]` | 37 |
| PARTIAL `[~]` | 30 |
| NEEDS REVIEW `[!]` | 9 |
| NOT APPLICABLE `[-]` | 26 |

Severity appears only on rows that are not a clean pass.

| Severity | Rows |
|---|---|
| Critical | 23 |
| High | 22 |
| Medium | 19 |
| Low | 12 |
| None / N-A | 178 |

Those Critical and High rows collapse into **9 distinct underlying issues** — most are one root cause surfacing in several parts of the checklist. CR-1 alone accounts for 11 Critical rows across Parts 1, 4 and 5.

| | Count |
|---|---|
| **Issues found** | **9** — 3 Critical, 6 High (H-1…H-7, plus the light-theme contrast failure found later by axe) |
| **Resolved in this session** | **8** — everything except the two that need credentials |
| **Remaining, blocked on you** | **1 input** — the seven business facts in `apps/web/lib/legal.ts`. Nothing else in CR-1 is outstanding |
| **Remaining, blocked on infrastructure** | **2** — SX-2 (load-test the rate limiter) and SX-3 (run each AI task against the real Anthropic API). Both have never executed |
| **Deferred by your decision** | **1** — SX-1, enforcing the CSP |
| **Found while fixing** | **4** — the voice profile that never reached a message, six light-theme contrast failures, nine keyboard-unreachable scroll containers, three stale tests |
| **New regression guards** | **4** — `SEO-AGREE`, `LEGAL-01`/`LEGAL-02`, 26 new job checks, and an axe suite over both themes |
| **Items requiring legal review** | **14** — unchanged. The pages are written; what they say about the law still needs a lawyer, and the `REQUIRES LEGAL REVIEW` markers name each one in place |

**Test movement:** jobs 199 → 225 · migrations 236 → 237 · site audit 40 → 44 · browser 68 (6 failing) → 256 (0 failing).

---

## Closing note

The honest one-line summary is that **Huntloop's problem is not its engineering and not its design — it is that the product's public promises are ahead of its deployment in exactly the way its own thesis says nothing should be.**

The project built `purge_contact_data` and never gave anyone a button. It built `contact_retention_days` and never gave anyone a field. It built a metering system and enforces two of its five limits. Then the landing page describes all of it in the present tense. That is the same failure mode the product spends enormous effort preventing in its treatment of prospects: an inference — *this will work* — quietly presented as a fact.

The fix was correspondingly cheap, and is now done. The retention window is a form field. The erasure path is a button. The pricing sentence is a sentence. What is left is a lawyer and seven facts.

One thing deserves saying plainly, because it undercuts the paragraph above. This report's first version praised the project for measuring its own contrast ratios, and marked accessibility a clean pass on that basis. Then the axe suite — added as a low-priority polish item — found six AA failures in the light theme within seconds of first running, including every primary button label in the product.

The praise was not wrong, it was **scoped wrong**. The measurements are real and they are all in the dark block; light arrived later, from screenshots, and nobody took its numbers. Reading careful documentation and crediting it to code it did not cover is precisely the error this repository's own method exists to prevent — "the code always outranks all three", as the README puts it — and I made it while auditing for exactly that class of mistake.

Which is the argument for the tooling rather than for the care. The care was genuine and it still left the most-clicked element in the light theme at 3.68:1. What closed it was a test that measures instead of reading. There are four such guards now where there were none: `SEO-AGREE`, `LEGAL-02`, the send preconditions, and axe over both themes. Each one exists because something that everybody believed was true turned out not to be, and the belief was reasonable every time.

*This automated audit does not guarantee legal compliance and is not legal advice.*
