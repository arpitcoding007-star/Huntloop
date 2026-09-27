Yes. I’d make it **project-agnostic**, so you can drop the same Markdown command into Claude/Codex for HuntLoop, Nightwing, TruChat, or basically any website/app.

# Universal Project Design, UX & Compliance Audit

Perform a **complete audit of the current project** covering:

1. Design originality and visual quality
2. AI/vibe-coded design patterns
3. UX and interaction quality
4. Product credibility
5. Accessibility
6. Privacy and data handling
7. Legal/compliance readiness
8. Consumer protection
9. Marketing and claims
10. Third-party dependencies and licensing
11. Security-related user-facing safeguards
12. Overall production readiness

This is a **general audit command**. First inspect and understand the existing project, its architecture, product type, target users, existing design system, functionality, data flows, dependencies, and business model.

Do **not** blindly change things just because they appear on this checklist.

For every item:

* determine whether it applies
* inspect the actual implementation
* mark its status
* explain the evidence
* identify the affected files/components/routes
* distinguish genuine problems from intentional design decisions
* recommend the appropriate action
* fix safe and clearly justified implementation issues where appropriate
* do not fabricate compliance or claim something is legally compliant without sufficient evidence

Use these statuses:

* [x] PASS
* [ ] FAIL
* [~] PARTIAL
* [!] NEEDS REVIEW
* [-] NOT APPLICABLE

---

# PART 1 — VIBE-CODE / GENERIC AI DESIGN AUDIT

Audit the project for overuse, unnecessary use, or generic implementation of:

* [ ] Harsh gradients
* [ ] Generic Lucide/icon-library usage without customization
* [ ] Excessive pure-white backgrounds
* [ ] Rainbow/multi-color styling without purpose
* [ ] Excessive or generic drop shadows
* [ ] Repetitive three-feature-card layouts
* [ ] Unnecessary emojis in professional/product UI
* [ ] Excessive liquid-glass/glassmorphism
* [ ] AI-style copy patterns and unnecessary em dashes
* [ ] Default AI/SaaS typography such as Inter, Geist, or Space Grotesk used without a deliberate typography system
* [ ] Generic colored-left-stripe cards/callouts
* [ ] Fake or placeholder testimonials
* [ ] Unnecessary bento grids
* [ ] Decorative terminal windows with no product purpose
* [ ] Repetitive “It’s not X, it’s Y” copywriting
* [ ] Generic checkmark-heavy feature lists
* [ ] Default three-tier pricing layouts without product justification
* [ ] Lack of real product screenshots/demos
* [ ] Excessively uniform soft rounded corners
* [ ] Generic purple/black AI-SaaS aesthetic
* [ ] Missing skeleton/loading states
* [ ] Decorative radial gradient orbs
* [ ] Generic dot-grid backgrounds
* [ ] Excessive sparkle/AI icons
* [ ] Decorative animated arrows
* [ ] Missing Terms of Service where applicable
* [ ] Missing Privacy Policy where applicable
* [ ] Excessive/unnecessary hover animations
* [ ] Excessive neon colors
* [ ] Generic pastel palettes

Do not treat these as banned patterns.

Determine whether each pattern is:

**intentional, useful, brand-appropriate, overused, generic, or unnecessary.**

The goal is not to strip personality from the interface. The goal is to make the project feel **purpose-built rather than generated from a generic AI/SaaS template**.

---

# PART 2 — DESIGN SYSTEM AUDIT

Inspect:

* [ ] Brand consistency
* [ ] Color system
* [ ] Typography hierarchy
* [ ] Spacing system
* [ ] Border radius system
* [ ] Shadow system
* [ ] Iconography
* [ ] Buttons
* [ ] Inputs
* [ ] Cards
* [ ] Navigation
* [ ] Modals/dialogs
* [ ] Tables
* [ ] Charts
* [ ] Empty states
* [ ] Loading states
* [ ] Error states
* [ ] Success states
* [ ] Responsive layouts
* [ ] Dark/light/system themes where applicable
* [ ] Mobile usability
* [ ] Desktop usability

Identify inconsistencies, duplicated styles, one-off components, visual clutter, weak hierarchy, unnecessary decoration, and areas that don't match the project's established design language.

Prefer extending the existing design system over replacing it.

---

# PART 3 — UX & PRODUCT QUALITY

Check for:

* [ ] Clear navigation
* [ ] Clear information hierarchy
* [ ] Understandable CTAs
* [ ] Useful onboarding
* [ ] Form validation
* [ ] Helpful error messages
* [ ] Loading feedback
* [ ] Skeleton loaders where useful
* [ ] Empty states
* [ ] Confirmation for destructive actions
* [ ] Undo/recovery where appropriate
* [ ] Responsive behavior
* [ ] Touch-friendly controls
* [ ] Keyboard usability
* [ ] Logical workflows
* [ ] Broken/dead-end flows
* [ ] Duplicate functionality
* [ ] Unnecessary steps
* [ ] Misleading UI
* [ ] Placeholder content exposed to users
* [ ] Fake data presented as real data
* [ ] Real product demonstrations where appropriate

Trace important workflows from beginning to end instead of auditing isolated screens only.

---

# PART 4 — PRIVACY & DATA PROTECTION

Determine what personal data the application actually collects, stores, processes, shares, or derives.

Audit:

* [ ] Privacy Policy
* [ ] Accurate privacy disclosures
* [ ] Cookie Policy where applicable
* [ ] Cookie consent mechanism where legally required
* [ ] Consent collection
* [ ] Consent records where required
* [ ] Necessary vs unnecessary data collection
* [ ] Data minimization
* [ ] Data retention
* [ ] Data deletion
* [ ] Account deletion
* [ ] Data export/access where applicable
* [ ] Third-party data sharing
* [ ] Analytics tracking
* [ ] Advertising tracking
* [ ] Authentication data
* [ ] Sensitive data handling
* [ ] Children's/minors' data where applicable
* [ ] Age gates/parental consent where applicable
* [ ] Privacy settings
* [ ] Tracking before consent where prohibited
* [ ] User requests concerning personal data

Do not assume adding a privacy-policy page makes the application compliant.

Verify that disclosures match actual implementation.

---

# PART 5 — TERMS, POLICIES & BUSINESS INFORMATION

Check whether the project requires:

* [ ] Terms of Service / Terms & Conditions
* [ ] Privacy Policy
* [ ] Cookie Policy
* [ ] Refund Policy
* [ ] Cancellation Policy
* [ ] Subscription terms
* [ ] Billing disclosures
* [ ] Acceptable Use Policy
* [ ] Community Guidelines
* [ ] Copyright/IP notices
* [ ] Contact information
* [ ] Business identity/details
* [ ] Required legal disclosures

Check that policies are accessible from appropriate locations such as:

* footer
* signup
* checkout
* account settings
* consent flows

Do not generate fake company addresses, registration numbers, legal identities, or jurisdiction-specific claims.

Flag missing information instead.

---

# PART 6 — CONSUMER PROTECTION & DARK PATTERNS

Audit the product for:

* [ ] Hidden fees
* [ ] Preselected paid options
* [ ] Misleading buttons
* [ ] Confusing cancellation
* [ ] Artificial urgency
* [ ] Fake scarcity
* [ ] Fake countdown timers
* [ ] Fake activity indicators
* [ ] Fake reviews
* [ ] Fake testimonials
* [ ] Fake customer numbers
* [ ] Unsupported claims
* [ ] Misleading comparisons
* [ ] Difficult unsubscribe flows
* [ ] Difficult account deletion
* [ ] Consent manipulation
* [ ] Confirmshaming
* [ ] Misleading free-trial language
* [ ] Subscription traps
* [ ] Important information hidden in low-visibility UI

Flag anything that could cause users to misunderstand what they are agreeing to, buying, sharing, or subscribing to.

---

# PART 7 — MARKETING & CLAIMS

Review landing pages, onboarding, pricing pages, ads, metadata, and product copy for:

* [ ] Unsupported performance claims
* [ ] Unsupported statistics
* [ ] Fake social proof
* [ ] Fake testimonials
* [ ] Unverifiable customer logos
* [ ] Misleading AI claims
* [ ] Misleading security claims
* [ ] Misleading privacy claims
* [ ] Misleading “free” claims
* [ ] Misleading pricing claims
* [ ] Absolute guarantees without evidence
* [ ] Placeholder claims accidentally shipped

Identify claims requiring evidence.

Do not invent evidence.

---

# PART 8 — ACCESSIBILITY

Audit against relevant modern accessibility practices, including WCAG where applicable.

Check:

* [ ] Image alt text
* [ ] Semantic HTML
* [ ] Heading hierarchy
* [ ] Form labels
* [ ] ARIA usage
* [ ] Keyboard navigation
* [ ] Focus indicators
* [ ] Focus order
* [ ] Color contrast
* [ ] Screen-reader compatibility
* [ ] Accessible modals
* [ ] Accessible dropdowns
* [ ] Accessible navigation
* [ ] Error identification
* [ ] Reduced-motion preferences
* [ ] Captions/transcripts where applicable
* [ ] Touch target sizes
* [ ] Zoom/text scaling
* [ ] Information not conveyed by color alone

Do not add ARIA unnecessarily when native semantic HTML already provides the correct behavior.

---

# PART 9 — EMAIL & COMMUNICATION

If the project sends emails, notifications, SMS, or marketing communications, check:

* [ ] Sender identity
* [ ] Unsubscribe mechanisms
* [ ] Marketing consent where required
* [ ] Transactional vs marketing separation
* [ ] Preference management
* [ ] Notification controls
* [ ] Accurate email content
* [ ] No deceptive subject lines
* [ ] Required business/contact details
* [ ] Suppression of unsubscribed recipients

---

# PART 10 — THIRD-PARTY SERVICES & SDKs

Create an inventory of relevant:

* analytics
* authentication
* payment processors
* advertising systems
* tracking technologies
* AI APIs
* external APIs
* CDNs
* embedded content
* chat/support tools
* email providers
* storage providers
* monitoring services
* social integrations

For each applicable integration determine:

* what data is sent
* why it is sent
* whether it is necessary
* when it loads
* whether consent may be required
* whether the privacy disclosures mention it
* whether secrets are handled safely

Flag unused SDKs and unnecessary trackers.

---

# PART 11 — ASSET & IP LICENSING

Audit:

* [ ] Fonts
* [ ] Images
* [ ] Illustrations
* [ ] Icons
* [ ] Videos
* [ ] Audio
* [ ] Stock assets
* [ ] Templates
* [ ] UI kits
* [ ] Open-source packages
* [ ] Third-party code
* [ ] Logos/trademarks
* [ ] AI-generated assets where provenance matters

Determine whether licensing information can actually be verified.

Do not assume an asset is licensed simply because it exists in the repository.

---

# PART 12 — CHILDREN & AGE-RESTRICTED USERS

If minors can reasonably use the product, inspect:

* [ ] Age requirements
* [ ] Date-of-birth collection
* [ ] Children's privacy
* [ ] Parental/guardian consent where required
* [ ] Age-appropriate privacy notices
* [ ] Data minimization
* [ ] Profiling/tracking
* [ ] Advertising
* [ ] Communication between minors and adults
* [ ] User-generated content
* [ ] Reporting/blocking systems
* [ ] Moderation
* [ ] Safety controls

Do not assume one country's requirements apply globally.

Flag jurisdiction-dependent requirements for legal review.

---

# PART 13 — SECURITY-RELATED USER SAFEGUARDS

Without claiming that this is a complete cybersecurity audit, inspect obvious application-level issues including:

* [ ] Authentication flows
* [ ] Authorization boundaries
* [ ] Password handling
* [ ] Session handling
* [ ] Secret exposure
* [ ] Environment variable exposure
* [ ] Sensitive information in client code
* [ ] Sensitive information in logs
* [ ] Rate limiting where appropriate
* [ ] Abuse prevention
* [ ] File-upload restrictions
* [ ] Input validation
* [ ] Account recovery
* [ ] Account deletion
* [ ] Privileged/admin routes
* [ ] Production debug information
* [ ] User-facing security/privacy settings

Never expose, print, commit, or copy actual secrets during the audit.

---

# PART 14 — RESPONSIVE & CROSS-STATE TESTING

Inspect important pages at representative:

* mobile
* tablet
* laptop
* desktop
* wide desktop

states.

Also verify applicable:

* dark mode
* light mode
* system mode
* authenticated state
* unauthenticated state
* new user
* returning user
* empty state
* populated state
* loading state
* error state
* offline/degraded state
* permission denied state

Look specifically for:

* overflow
* clipping
* overlapping elements
* broken grids
* unreadable text
* inaccessible controls
* layout shifts
* inconsistent spacing
* missing states

---

# PART 15 — CODEBASE VS UI VERIFICATION

Do not judge the project from screenshots alone.

Inspect the actual:

* routes
* pages
* components
* styles
* configuration
* environment-variable usage
* database schema where relevant
* APIs
* middleware
* dependencies
* third-party integrations
* authentication
* analytics
* billing
* forms
* tracking
* emails
* assets

Compare what the code actually does against what the interface and policies claim it does.

---

# REQUIRED AUDIT REPORT

Create:

`PROJECT_AUDIT.md`

Use the following structure:

## Executive Summary

Briefly describe the project's current condition.

## Critical Issues

Issues requiring immediate attention.

## High Priority

Important production, privacy, accessibility, UX, or credibility problems.

## Medium Priority

Meaningful improvements that are not immediate blockers.

## Low Priority

Polish and optimization opportunities.

## Vibe-Code / Design Findings

Document which generic patterns exist and whether they should actually be changed.

## UX Findings

Document workflow and usability issues.

## Accessibility Findings

Document accessibility problems and affected areas.

## Privacy & Data Findings

Document observed data handling and privacy gaps.

## Legal/Policy Findings

Document missing or potentially inaccurate policies/disclosures.

Clearly mark anything requiring qualified legal review.

## Third-Party Services

List detected third-party services and their apparent purposes.

## Licensing/IP Findings

List assets or dependencies whose licensing requires verification.

## Security-Related Findings

Document obvious application-level security concerns without claiming this is a full security assessment.

## Recommended Changes

Provide concrete implementation recommendations.

## Files/Components Affected

Identify relevant files, routes, components, schemas, or services.

## Verification Results

Record the checks/tests/builds actually performed and their results.

---

# MASTER CHECKLIST

At the end of `PROJECT_AUDIT.md`, create a consolidated table:

| ID | Area | Check | Status | Severity | Evidence | Recommended Action | Files |
| -- | ---- | ----- | ------ | -------- | -------- | ------------------ | ----- |

Every applicable checklist item from this audit must appear in this table.

Do not silently skip items.

---

# IMPLEMENTATION RULES

Do **not** redesign the entire project simply because some common patterns are present.

Do **not**:

* blindly remove gradients
* blindly replace fonts
* blindly remove rounded corners
* blindly remove animations
* blindly replace icon libraries
* blindly rewrite the entire UI
* fabricate testimonials
* fabricate legal/business information
* fabricate licenses
* fabricate compliance
* fabricate test results

Preserve intentional brand decisions that work.

When fixing something, reuse the project's existing components, tokens, patterns, architecture, and design language wherever possible.

Before making a significant visual or architectural change, determine whether it solves an actual problem identified by the audit.

---

# LEGAL SCOPE

Treat the legal/compliance section as a **technical and product compliance review, not legal advice**.

Determine applicable requirements based on whatever can actually be established about:

* product type
* business model
* target users
* user locations
* business location
* data collected
* payment model
* age groups
* third-party services

Where jurisdiction or facts cannot be established, write:

`REQUIRES LEGAL/JURISDICTION REVIEW`

rather than guessing.

---

# FINAL VERIFICATION

After completing safe fixes:

1. Run the project's existing lint checks.
2. Run type checking where available.
3. Run tests where available.
4. Run the production build.
5. Check important routes.
6. Check console/runtime errors.
7. Check responsive behavior.
8. Check loading/error/empty states.
9. Re-run relevant audit checks.
10. Update `PROJECT_AUDIT.md` with the final status.

Do not mark an item PASS unless it was actually inspected or verified.

At completion, report:

* total checks
* passed
* failed
* partial
* needs review
* not applicable
* critical issues remaining
* high-priority issues remaining
* fixes completed
* items requiring manual action
* items requiring legal review

The objective is to leave the project **more original, coherent, accessible, trustworthy, privacy-aware, legally prepared, and production-ready**, without blindly homogenizing its design or pretending that an automated audit guarantees legal compliance.

This version is intentionally **generic rather than HuntLoop/Nightwing-specific**, so you can save it as something like `UNIVERSAL_PROJECT_AUDIT.md` and reuse the exact same command across projects.
