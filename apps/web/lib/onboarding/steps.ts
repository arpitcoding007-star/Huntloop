/**
 * The onboarding vocabulary, in one place.
 *
 * ── Why this is its own module ───────────────────────────────────────────
 *
 * Three kinds of code need these sets and they cannot all import the same
 * file:
 *
 *   · `lib/data/onboarding.ts` is `server-only` — it holds the writes.
 *   · `lib/validation.ts` is imported by Server Actions, which is fine, but
 *     also has to stay importable without dragging a database module in.
 *   · the step screens are client components, and a `server-only` import in
 *     one of those is a build error.
 *
 * So the words live here, with no dependencies at all, and every layer derives
 * its own thing from them. The alternative — retyping the union in the Zod
 * schema — is the failure `lib/validation.ts`'s own header warns about: a
 * literal union copied by hand drifts the first time a member is added, and it
 * drifts silently, in the direction where the new value is rejected as
 * invalid input.
 *
 * Every set here also has a CHECK constraint in `0024` saying the same thing.
 * That duplication is deliberate and is the correct kind: the database is the
 * last line and cannot be bypassed, this is the first line and produces a
 * sentence a person can read.
 */

/* ── Steps ───────────────────────────────────────────────────────────────── */

/** In order, matching `0024`'s CHECK exactly. */
export const ONBOARDING_STEPS = [
  "you",
  "company",
  "goals",
  "icp",
  "sources",
  "building",
  "review",
  "done",
] as const;

export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

/**
 * The five steps a person is actually asked to *do*, for the progress bar.
 *
 * `building`, `review` and `done` are excluded on purpose. Building is a
 * progress screen, review is the payoff, and neither is work the user has to
 * get through — showing "step 6 of 8" on the screen that hands them their
 * first three companies would frame the reward as more homework.
 */
export const VISIBLE_STEPS = [
  { step: "you", label: "You", href: "/welcome" },
  { step: "company", label: "Your company", href: "/welcome/company" },
  { step: "goals", label: "Your goals", href: "/welcome/goals" },
  { step: "icp", label: "Ideal customer", href: "/welcome/icp" },
  { step: "sources", label: "Sources", href: "/welcome/sources" },
] as const satisfies readonly { step: OnboardingStep; label: string; href: string }[];

export function nextStep(step: OnboardingStep): OnboardingStep {
  const i = ONBOARDING_STEPS.indexOf(step);
  return ONBOARDING_STEPS[Math.min(i + 1, ONBOARDING_STEPS.length - 1)]!;
}

/** True when `a` comes strictly before `b`. */
export function isBefore(a: OnboardingStep, b: OnboardingStep): boolean {
  return ONBOARDING_STEPS.indexOf(a) < ONBOARDING_STEPS.indexOf(b);
}

export function isOnboardingStep(v: unknown): v is OnboardingStep {
  return typeof v === "string" && (ONBOARDING_STEPS as readonly string[]).includes(v);
}

/* ── Roles ───────────────────────────────────────────────────────────────── */

export const USER_ROLES = [
  "founder",
  "sales",
  "sdr",
  "gtm_generalist",
  "revops",
  "marketing",
  "agency",
] as const;

export type UserRole = (typeof USER_ROLES)[number];

/**
 * What each role is called and what choosing it changes.
 *
 * The second sentence is shown to the user. A role picker that does not say
 * what the choice *does* is a personality quiz — people pick the flattering
 * option rather than the accurate one, and the layout they get is wrong.
 */
export const ROLE_OPTIONS: readonly {
  value: UserRole;
  label: string;
  description: string;
}[] = [
  {
    value: "founder",
    label: "Founder or CEO",
    description: "You lead the company and sell alongside everything else.",
  },
  {
    value: "gtm_generalist",
    label: "Founder-led sales / GTM",
    description: "You own the whole funnel end to end.",
  },
  {
    value: "sales",
    label: "Sales / Account Executive",
    description: "You work a named list and close it.",
  },
  {
    value: "sdr",
    label: "SDR / BDR",
    description: "You work a daily outreach queue.",
  },
  {
    value: "revops",
    label: "RevOps / Growth",
    description: "You build the system the team sells with.",
  },
  {
    value: "marketing",
    label: "Marketing",
    description: "You track segments, signals and competitors.",
  },
  {
    value: "agency",
    label: "Agency or consultant",
    description: "You sell on behalf of clients, each with their own market.",
  },
];

export function isUserRole(v: unknown): v is UserRole {
  return typeof v === "string" && (USER_ROLES as readonly string[]).includes(v);
}

/* ── Goals ───────────────────────────────────────────────────────────────── */

/**
 * Named as the loop stages, minus `track`.
 *
 * The same six words the nav, the landing page and the docs use — one
 * vocabulary everywhere is the cheapest defence against the marketing site and
 * the product drifting into two descriptions of one system. `track` is absent
 * because it is not something a person opts into; it happens to every
 * opportunity regardless.
 */
export const GOALS = ["discover", "qualify", "enrich", "reach_out", "learn"] as const;

export type Goal = (typeof GOALS)[number];

/** At most two. See `0024` — the answer's only job is to rank the dashboard. */
export const MAX_GOALS = 2;

export const GOAL_OPTIONS: readonly {
  value: Goal;
  label: string;
  description: string;
  stage: string;
}[] = [
  {
    value: "discover",
    label: "Find companies I don't know about",
    description: "Search the market for companies that match your profile.",
    stage: "Discover",
  },
  {
    value: "qualify",
    label: "Tell me which of my accounts are ready now",
    description: "Bring your own list; we watch it for buying signals.",
    stage: "Qualify",
  },
  {
    value: "enrich",
    label: "Find the right person and their contact details",
    description: "Work out who to talk to at each company, and how to reach them.",
    stage: "Enrich",
  },
  {
    value: "reach_out",
    label: "Write and send the outreach",
    description: "Draft messages grounded in why each company is a fit.",
    stage: "Reach out",
  },
  {
    value: "learn",
    label: "Tell me what's working",
    description: "Measure which triggers and messages actually convert.",
    stage: "Learn",
  },
];

export function isGoal(v: unknown): v is Goal {
  return typeof v === "string" && (GOALS as readonly string[]).includes(v);
}

/* ── Outreach channel ────────────────────────────────────────────────────── */

export const OUTREACH_CHANNELS = ["email", "manual", "export", "undecided"] as const;

export type OutreachChannel = (typeof OUTREACH_CHANNELS)[number];

export const CHANNEL_OPTIONS: readonly {
  value: OutreachChannel;
  label: string;
  description: string;
}[] = [
  {
    value: "email",
    label: "My work email",
    description: "Connect Gmail or Outlook. You approve every message before it sends.",
  },
  {
    value: "manual",
    label: "LinkedIn, or by hand",
    description: "Just tell me who to contact and why. I'll send it myself.",
  },
  {
    value: "export",
    label: "Export to my CRM or sequencer",
    description: "Hand off the list and the reasoning; I'll send from there.",
  },
  {
    value: "undecided",
    label: "Not sure yet",
    description: "Decide later. Nothing is sent without your say-so either way.",
  },
];

/* ── Size bands ──────────────────────────────────────────────────────────── */

/**
 * The bands the ICP screen offers.
 *
 * These exact strings are what `bandsToRange()` in `packages/db/src/icp.ts`
 * parses into the numeric `employeeRange` a provider filter takes, so the
 * en-dashes are load-bearing rather than typography. Changing one here without
 * changing the parser produces a size filter that silently matches nothing.
 */
export const SIZE_BANDS = [
  "1–10",
  "11–50",
  "51–200",
  "201–1000",
  "1001–5000",
  "5000+",
] as const;

/** Regions, as `translateIcp` expects to receive them. */
export const REGION_OPTIONS = [
  "North America",
  "Europe",
  "United Kingdom",
  "APAC",
  "Latin America",
  "Middle East",
  "Africa",
  "Global",
] as const;

/* ── First run ───────────────────────────────────────────────────────────── */

/**
 * The stages `@huntloop/jobs` runs, in order.
 *
 * Mirrors `FIRST_RUN_STAGES` in that package, and is deliberately a second
 * copy rather than a re-export. It reaches the service-role client through
 * `scope.ts`, so importing it here — a module the client step screens and
 * `lib/validation.ts` both pull in — would put the admin client's module graph
 * in a browser bundle.
 *
 * The copy is kept honest at the one place that has both: the building
 * screen's action indexes a `Record<EngineStage, …>` by a value parsed against
 * this list, so a stage in one and not the other is a type error rather than a
 * runtime surprise.
 */
export const ENGINE_STAGES = [
  "discover",
  "enrich",
  "score",
  "contacts",
  "explain",
] as const;

export type EngineStage = (typeof ENGINE_STAGES)[number];

/**
 * Everything the "building your workspace" screen runs, in order.
 *
 * `rules` is not an engine stage and is deliberately outside `ENGINE_STAGES`.
 * The other five drive job handlers through an `OrgScope`; this one is a model
 * call that belongs in `apps/web`, where the rate limiter and the monthly
 * budget live. Putting it in the jobs package to make the lists match would
 * move a metered call away from the two things that meter it.
 *
 * It runs last because nothing downstream depends on it: drafted rules land
 * **inactive** by design, so they cannot change the scores the earlier stages
 * just produced. Running it first would imply they did.
 */
export const FIRST_RUN_STAGES = [...ENGINE_STAGES, "rules"] as const;

export type FirstRunStage = (typeof FIRST_RUN_STAGES)[number];

/** What each stage says while it is running. */
export const STAGE_LABELS: Record<FirstRunStage, string> = {
  discover: "Finding companies that match your profile",
  enrich: "Filling in what we know about each one",
  score: "Judging them against your profile",
  contacts: "Working out who to talk to",
  explain: "Working out why each one matters now",
  rules: "Drafting scoring rules from your triggers",
};
