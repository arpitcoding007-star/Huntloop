/**
 * The legal surface, and the facts it is missing.
 *
 * ── Why this file exists rather than three Markdown pages ────────────────
 *
 * The design audit found no Privacy Policy, no Terms, no Acceptable Use
 * Policy, no contact address and no business identity anywhere in the
 * product — while the application stores names, email addresses, phone
 * numbers and employers for people who are not its users, acquired from a
 * data broker, and emails them. That is GDPR Article 14 processing, which
 * carries an affirmative duty to inform, and there was no document that
 * could have discharged it.
 *
 * Most of what those documents have to say is *knowable from this
 * repository*: which processors receive what, exactly which fields are
 * stored, how retention works, how erasure works, which cookies exist. That
 * part is written here and is true, checked against the code.
 *
 * The rest is not knowable from here and must not be guessed. A policy
 * naming an invented company, address or jurisdiction would be worse than no
 * policy: it would be a false statement of fact on a page whose entire
 * purpose is to make true ones.
 *
 * ── The mechanism ───────────────────────────────────────────────────────
 *
 * Every unknown is a `PENDING` entry rather than a plausible string. The
 * pages render each one as a visible `REQUIRES LEGAL REVIEW` block instead of
 * prose, `legalIsComplete()` reports whether any remain, and two things key
 * off it:
 *
 *   · `app/robots.ts` keeps the pages out of the index while incomplete.
 *   · The marketing footer links to them only once they are complete.
 *
 * So the pages are reviewable and testable today and cannot be quietly
 * published half-written. `LEGAL-LINK` in `scripts/audit.mjs` fails the build
 * if that relationship is ever broken the other way — pages linked or indexed
 * while placeholders remain.
 *
 * Filling these in is the whole job: replace the `PENDING` values, and the
 * pages become indexable and linked with no other change.
 */

/** A fact only the business can supply. Rendered as a visible gap. */
export const PENDING = null;

export interface LegalIdentity {
  /** Registered company name, e.g. "Huntloop Ltd". */
  entityName: string | null;
  /** Registered office address, as it appears on the register. */
  registeredAddress: string | null;
  /** Company/registration number, if the jurisdiction issues one. */
  registrationNumber: string | null;
  /** Country or state whose law governs the terms. */
  jurisdiction: string | null;
  /** Where a person sends a data-protection request. */
  privacyContactEmail: string | null;
  /** General contact, for the footer and for CAN-SPAM identification. */
  contactEmail: string | null;
  /**
   * EU/UK representative under GDPR Art. 27, where required.
   * Null is a legitimate final answer here — not every controller needs one —
   * so this one is excluded from the completeness check and carries its own
   * explicit `art27Required` decision instead.
   */
  euRepresentative: string | null;
  /** Whether Art. 27 was assessed. Null means nobody has decided yet. */
  art27Required: boolean | null;
  /**
   * The lawful basis relied on for prospect data. Almost always legitimate
   * interests, which requires a documented balancing test — so this records
   * the decision, not a guess at it.
   */
  prospectLawfulBasis: string | null;
}

export const IDENTITY: LegalIdentity = {
  entityName: PENDING,
  registeredAddress: PENDING,
  registrationNumber: PENDING,
  jurisdiction: PENDING,
  privacyContactEmail: PENDING,
  contactEmail: PENDING,
  euRepresentative: PENDING,
  art27Required: PENDING,
  prospectLawfulBasis: PENDING,
};

/**
 * The fields that must be filled before anything is published.
 *
 * `euRepresentative` is not here on purpose — see its comment.
 * `art27Required` is, because "we have not decided" is not a publishable
 * state even though "no representative needed" is.
 */
const REQUIRED: (keyof LegalIdentity)[] = [
  "entityName",
  "registeredAddress",
  "jurisdiction",
  "privacyContactEmail",
  "contactEmail",
  "art27Required",
  "prospectLawfulBasis",
];

/** Which required facts are still missing. Empty means ready to publish. */
export function missingLegalFacts(): (keyof LegalIdentity)[] {
  return REQUIRED.filter((key) => IDENTITY[key] === null || IDENTITY[key] === undefined);
}

export function legalIsComplete(): boolean {
  return missingLegalFacts().length === 0;
}

/* ── What the code actually does, which is the checkable half ───────────── */

export interface Processor {
  name: string;
  purpose: string;
  /** What leaves this system. Written from the adapter, not from a brochure. */
  data: string;
  /** Where in the repository this can be verified. */
  evidence: string;
  /** Whether it is always active or only when a customer connects it. */
  when: "always" | "optional" | "customer-connected";
}

/**
 * The sub-processor list.
 *
 * Each row was read off the integration rather than off a vendor page, and
 * `evidence` names the file so a reviewer can check the claim rather than
 * trust it. Two of these — PostHog and Sentry — were running in production
 * and disclosed nowhere, which is the finding this list closes.
 */
export const PROCESSORS: Processor[] = [
  {
    name: "Supabase",
    purpose: "Database, authentication and file storage",
    data: "All application data, and your email address as your sign-in identity",
    evidence: "packages/db",
    when: "always",
  },
  {
    name: "Vercel",
    purpose: "Application hosting",
    data: "All request traffic, including IP addresses in server logs",
    evidence: "apps/web/vercel.json",
    when: "always",
  },
  {
    name: "Anthropic",
    purpose: "The AI tasks: qualification, research, why-now, drafting",
    data: "Company websites and public pages, your ICP and product descriptions, and the context a draft is written from",
    evidence: "packages/ai/src/client.ts",
    when: "always",
  },
  {
    name: "PostHog",
    purpose: "Product analytics, limited to the onboarding funnel",
    data: "An opaque user id, an opaque workspace id, which onboarding step, how long it took, and why something was refused. No email addresses, no company names, no URLs you pasted, no ICP text — the property set is a closed type",
    evidence: "apps/web/lib/analytics.ts",
    when: "optional",
  },
  {
    name: "Sentry",
    purpose: "Error monitoring",
    data: "Exception messages and stack traces. Personally identifying data is switched off (`sendDefaultPii: false`) and Session Replay is disabled",
    evidence: "apps/web/sentry.server.config.ts",
    when: "optional",
  },
  {
    name: "Apollo",
    purpose: "Company and contact search and enrichment",
    data: "Your search criteria. Returns third-party personal data into your workspace",
    evidence: "packages/providers/src/adapters/apollo.ts",
    when: "optional",
  },
  {
    name: "Hunter",
    purpose: "Email address discovery",
    data: "A company domain and a person's name",
    evidence: "packages/providers/src/adapters/hunter.ts",
    when: "optional",
  },
  {
    name: "ZeroBounce",
    purpose: "Email address verification",
    data: "One email address per check",
    evidence: "packages/providers/src/adapters/zerobounce.ts",
    when: "optional",
  },
  {
    name: "Google (Gmail) / Microsoft (Outlook)",
    purpose: "Sending your outreach and syncing replies",
    data: "Message content and recipient addresses, through your own mailbox, under OAuth you grant and can revoke",
    evidence: "packages/jobs/src/mailbox",
    when: "customer-connected",
  },
  {
    name: "HubSpot",
    purpose: "CRM sync",
    data: "Company name, domain, industry, headcount; contact email and name; three custom deal properties",
    evidence: "packages/crm/src/hubspot.ts",
    when: "customer-connected",
  },
  {
    name: "Inngest",
    purpose: "Driving the job queue, where Vercel Cron is not used",
    data: "Job identifiers only. The queue itself is in your Postgres",
    evidence: "apps/web/app/api/inngest/route.ts",
    when: "optional",
  },
];

export interface CookieRow {
  name: string;
  purpose: string;
  duration: string;
}

/**
 * Every cookie the application sets.
 *
 * All four are strictly necessary, which is the whole reason this product
 * needs no consent banner — there is no analytics or advertising storage on
 * the device at all. PostHog runs server-side and Sentry sets no cookies.
 * That is an unusually clean position and it is worth stating rather than
 * leaving a reader to assume the usual.
 */
export const COOKIES: CookieRow[] = [
  {
    name: "Supabase auth session",
    purpose: "Keeps you signed in. Without it there is no way to be logged in at all",
    duration: "Until you sign out or it expires",
  },
  {
    name: "hl-theme",
    purpose: "Remembers light, dark or system, so the page does not flash the wrong one",
    duration: "Persistent, until changed",
  },
  {
    name: "hl-last-org",
    purpose: "Sends you back to the workspace you used last instead of a chooser",
    duration: "Persistent, until changed",
  },
  {
    name: "__Host-hl_mailbox_oauth",
    purpose: "A one-time value that stops a forged mailbox-connection callback",
    duration: "Minutes — deleted as soon as the connection completes",
  },
];

/**
 * The personal data this product holds about people who are not its users.
 *
 * Read off `0003_companies_opportunities.sql` and the contact tables. This is
 * the list an Article 14 notice has to contain, and the reason a generic
 * SaaS privacy policy would not have served.
 */
export const PROSPECT_FIELDS: string[] = [
  "Name",
  "Job title and seniority",
  "Employer, and that company's public attributes",
  "Business email address, with the provider's own confidence in it",
  "Business phone number, where a provider returned one",
  "Public evidence about their employer, each item stored with the URL it was read from",
  "Inferences Huntloop drew — a fit score and a reason — each labelled as an inference rather than as a fact",
];
