"use client";

import type { IcpSummary } from "@huntloop/ai";

/**
 * The in-progress onboarding profile, carried between steps.
 *
 * §68 makes onboarding a pipeline — the site read produces what you sell, that
 * produces the ICP, and the ICP produces the sources. Each step needs what the
 * one before it established, and until the schema is applied there is nowhere
 * durable to put it. Two options short of that:
 *
 *   · Ask the sources step to recommend from an ICP it does not have. It would
 *     have to use a fixed one, while the screen says "based on your ICP" — the
 *     exact class of quiet dishonesty `lib/data/source.ts` exists to prevent.
 *   · Keep the draft on the client for the length of the sitting.
 *
 * This is the second. It is deliberately a module rather than props threaded
 * through a query string, because that is what makes it a seam: when
 * `packages/db` is live, these three functions become reads and writes against
 * `products` and `icps`, and no caller changes.
 *
 * sessionStorage, not localStorage. Onboarding is one sitting, and a draft that
 * outlives the tab comes back on a shared machine as somebody else's
 * half-finished company profile.
 */

const KEY = "huntloop.onboarding.draft";

export interface OnboardingDraft {
  companyName?: string;
  website?: string;
  /** From `research_company`'s `sells` finding, as the user left it. */
  sells?: string;
  segments?: string[];
  sizes?: string[];
  regions?: string[];
  triggers?: string[];
  exclusions?: string[];
}

export function readDraft(): OnboardingDraft {
  // Server render and the pre-hydration pass both land here. An empty draft is
  // the honest answer in both, and the steps already handle it.
  if (typeof window === "undefined") return {};
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as OnboardingDraft) : {};
  } catch {
    // Storage can be unavailable (private mode, a blocked third-party context)
    // and the stored value can be from an older shape. Neither is worth
    // interrupting onboarding for: the step behaves as if nothing was saved.
    return {};
  }
}

export function mergeDraft(patch: OnboardingDraft): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify({ ...readDraft(), ...patch }));
  } catch {
    // Same reasoning. Losing the draft degrades the next step; throwing here
    // would lose the step the user just finished.
  }
}

export function clearDraft(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(KEY);
  } catch {
    /* nothing to do */
  }
}

/**
 * The draft as an ICP, or null when there is not enough of one to recommend
 * from.
 *
 * Null is the case where the user deep-linked to a later step, and the step
 * that receives it says so and offers the way back. Returning a mostly-empty
 * profile instead would produce recommendations justified by nothing, which is
 * precisely what `recommend_sources` refuses to do.
 */
export function draftIcp(draft: OnboardingDraft): IcpSummary | null {
  const icp: IcpSummary = {
    sells: draft.sells?.trim() ?? "",
    segments: draft.segments ?? [],
    sizes: draft.sizes ?? [],
    regions: draft.regions ?? [],
    triggers: draft.triggers ?? [],
    exclusions: draft.exclusions ?? [],
  };
  const hasSomething =
    Boolean(icp.sells) ||
    icp.segments.length > 0 ||
    icp.sizes.length > 0 ||
    icp.regions.length > 0 ||
    icp.triggers.length > 0;
  return hasSomething ? icp : null;
}
