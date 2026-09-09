import "server-only";
import type { Goal, UserRole } from "../onboarding/steps";

/**
 * What differs by role and goal.
 *
 * ── The rule this file exists to hold ────────────────────────────────────
 *
 * **Personalization changes order and defaults. It never changes capability.**
 *
 * No role gets a smaller product. An SDR can open the analytics screen and a
 * RevOps lead can work the outreach queue; the nav is identical for both. What
 * differs is what the dashboard leads with and what the default filter is —
 * which is the difference between a screen somebody has to interpret and a
 * screen that is already about their work.
 *
 * The distinction matters because the other kind of personalization is a trap.
 * Hiding features by role produces support tickets that read "where did X go",
 * makes the product feel different in every seat, and means a user who picked
 * the wrong option in onboarding is quietly locked out of something. Ordering
 * is recoverable by scrolling.
 *
 * ── Why this is a table and not a model call ─────────────────────────────
 *
 * Because it is a mapping with a correct answer. Seven roles times five goals
 * is a lookup, and a model asked to lay out a dashboard would produce a
 * different arrangement each session — which would be worse than any fixed one,
 * because a screen that moves is a screen nobody learns.
 */

/** The dashboard's sections, in the order the generic layout renders them. */
export const DASHBOARD_SECTIONS = [
  "whyNow",
  "counts",
  "loop",
  "capacity",
  "signals",
] as const;

export type DashboardSection = (typeof DASHBOARD_SECTIONS)[number];

export interface Personalization {
  /** Sections, most relevant first. Every section always appears. */
  order: DashboardSection[];
  /** The opportunity filter this person's list defaults to. */
  defaultFilter: "hot" | "hot-warm" | "assigned" | "ready" | "all";
  /** One sentence naming what this layout leads with, shown under the title. */
  lead: string;
  /** The single next action offered on an otherwise-empty workspace. */
  firstAction: { label: string; href: string };
}

const ROLE_DEFAULTS: Record<UserRole, Omit<Personalization, "firstAction">> = {
  founder: {
    order: ["whyNow", "counts", "loop", "signals", "capacity"],
    defaultFilter: "hot-warm",
    lead: "What changed in your market, and who is worth your next hour.",
  },
  gtm_generalist: {
    order: ["whyNow", "counts", "loop", "capacity", "signals"],
    defaultFilter: "hot",
    lead: "The whole loop, with whatever needs a person first.",
  },
  sales: {
    order: ["counts", "whyNow", "loop", "capacity", "signals"],
    defaultFilter: "assigned",
    lead: "Your accounts, and what has moved on them.",
  },
  sdr: {
    order: ["capacity", "counts", "whyNow", "loop", "signals"],
    defaultFilter: "ready",
    lead: "Today's queue: who to reach, and what to say.",
  },
  revops: {
    order: ["loop", "signals", "counts", "capacity", "whyNow"],
    defaultFilter: "all",
    lead: "How the engine is performing, and where it is losing.",
  },
  marketing: {
    order: ["whyNow", "signals", "loop", "counts", "capacity"],
    defaultFilter: "all",
    lead: "Signals in your market, and what they are telling you.",
  },
  agency: {
    order: ["counts", "whyNow", "loop", "capacity", "signals"],
    defaultFilter: "hot",
    lead: "This client's pipeline, and what needs you.",
  },
};

/**
 * The goal's override, applied on top of the role.
 *
 * Only the *first* goal is used. Two goals are collected because the answer
 * ranks rather than selects, and a layout built from both would have to
 * interleave two orderings — which produces an arrangement that is nobody's
 * first choice. The second goal earns its keep elsewhere: it decides which
 * jobs are scheduled.
 */
const GOAL_LEAD: Partial<Record<Goal, { section: DashboardSection; lead: string }>> = {
  discover: { section: "whyNow", lead: "New companies matching your profile, and why each one now." },
  qualify: { section: "counts", lead: "Which of your accounts just became worth a conversation." },
  enrich: { section: "counts", lead: "Companies with people worth reaching, and who they are." },
  reach_out: { section: "capacity", lead: "What is ready to send, and what is waiting on you." },
  learn: { section: "loop", lead: "What is working, and what your profile should say next." },
};

export function personalize(
  role: UserRole | null,
  goals: Goal[],
  orgSlug: string,
): Personalization {
  /* `gtm_generalist` is the fallback rather than a bare default object, so
     there is one definition of "the balanced layout" and an unrecognised role
     gets a real arrangement rather than an accidental one. */
  const base = ROLE_DEFAULTS[role ?? "gtm_generalist"] ?? ROLE_DEFAULTS.gtm_generalist;

  const goal = goals[0];
  const override = goal ? GOAL_LEAD[goal] : undefined;

  const order = override
    ? [override.section, ...base.order.filter((s) => s !== override.section)]
    : [...base.order];

  return {
    order,
    defaultFilter: base.defaultFilter,
    lead: override?.lead ?? base.lead,
    firstAction: firstAction(role, goals, orgSlug),
  };
}

/**
 * The one thing to offer somebody whose workspace is still empty.
 *
 * One, not four. A person who has just answered five onboarding questions has
 * spent their decision budget, and an empty state offering a menu puts the
 * choice straight back on them.
 */
function firstAction(
  role: UserRole | null,
  goals: Goal[],
  org: string,
): { label: string; href: string } {
  if (goals.includes("reach_out")) {
    return { label: "Connect a mailbox", href: `/${org}/settings` };
  }
  if (goals.includes("qualify")) {
    return { label: "Import your accounts", href: `/${org}/imports` };
  }
  if (goals.includes("learn") || role === "revops") {
    return { label: "Tune your scoring rules", href: `/${org}/settings/scoring` };
  }
  if (role === "agency") {
    return { label: "Set up another client", href: "/welcome?new=1" };
  }
  return { label: "Add a source to watch", href: `/${org}/sources` };
}
