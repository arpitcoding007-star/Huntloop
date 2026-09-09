import {
  draftBases,
  draftIcp,
  isAiConfigured,
  ModelRefusalError,
  runTask,
  type IcpDraft,
  type IcpDraftInput,
} from "@huntloop/ai";
import { resolveRecorder } from "./recorder";
import { consumeRateLimit, refusal } from "../rate-limit";
import { budgetRefusal, countAiRun, withinAiBudget } from "./budget";
import type { AiFailure } from "./outcome";

/**
 * `draft_icp`, wrapped for the onboarding step that calls it.
 *
 * The same two states as `research.ts` and `sources.ts`, and — as there — no
 * third "it failed, so here is a demo" state.
 *
 * What a fabricated answer costs here is worth stating, because it is the
 * worst of the three. A made-up company profile is visibly about the user's own
 * company and they will notice. A made-up source list looks right and fails
 * silently weeks later. A made-up *ICP* is worse than both: it is the input to
 * every discovery search, every qualification, every score and every drafted
 * message, and it is presented on a screen that says "we drafted this from your
 * website". A user who accepts it has told Huntloop to go and spend money
 * hunting for somebody else's customers.
 *
 * Which is exactly what the previous hardcoded screen did. See
 * `packages/ai/src/tasks/draft-icp.ts`.
 */

export type AiSource = "live" | "unconfigured";

export interface IcpDraftResult {
  source: AiSource;
  /** True when a live run was also written to `ai_runs`. */
  metered: boolean;
  draft: IcpDraft;
}

export type IcpDraftOutcome = { ok: true; result: IcpDraftResult } | AiFailure;

export async function draft(
  orgSlug: string,
  input: IcpDraftInput,
): Promise<IcpDraftOutcome> {
  if (!draftBases(input).length) {
    return {
      ok: false,
      error:
        "The research didn't establish enough about your company to draft a " +
        "profile from. Go back a step and fill in what you sell.",
    };
  }

  if (!isAiConfigured()) {
    return {
      ok: true,
      result: { source: "unconfigured", metered: false, draft: example(input) },
    };
  }

  const resolved = await resolveRecorder(orgSlug);
  if (!resolved.ok) return { ok: false, error: resolved.error };
  const { recorder, orgId, recorded, db } = resolved;

  /* The monthly ceiling before the rate limit: reading it costs nothing, and
     consuming a rate-limit unit for a request that is over quota charges
     somebody for being refused. */
  if (db) {
    const allowance = await withinAiBudget(db, orgId);
    if (!allowance.allowed) return budgetRefusal(allowance);
  }

  const budget = await consumeRateLimit(orgId, "draft_icp");
  if (!budget.allowed) return refusal(budget);

  try {
    const { output } = await runTask(draftIcp, input, { orgId, recorder });
    if (db) await countAiRun(db, orgId);
    return { ok: true, result: { source: "live", metered: recorded, draft: output } };
  } catch (error) {
    if (error instanceof ModelRefusalError) {
      return {
        ok: false,
        error:
          "The model declined to draft a profile from that research. That is " +
          "an answer about the request, not an outage — you can build the " +
          "profile yourself below.",
      };
    }
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Drafting the profile failed.",
    };
  }
}

/**
 * The worked example shown when no key is configured.
 *
 * Built from the research actually in front of the user rather than from a
 * fixed fictional company, so it obeys the rule the real task enforces: every
 * `basis` here is a sentence this user's own site produced.
 *
 * That constraint is what makes the example safe to show. The previous
 * hardcoded ICP screen failed precisely because its defaults described a
 * *different* company, and a worked example that reintroduced them would be
 * re-committing the defect under a warning banner.
 *
 * It deliberately fills only the two fields that can be derived from a sentence
 * without knowing anything: nothing here is a guess about size, geography or
 * technology, because those are the fields where a plausible default does real
 * damage.
 */
function example(input: IcpDraftInput): IcpDraft {
  const bases = draftBases(input);
  const first = bases[0]!;
  const buyers = input.buyers.trim() || first;
  const problem = input.problem.trim() || first;
  const trigger = input.trigger.trim() || first;

  return {
    segments: {
      // Echoed back rather than invented. The example's job is to show the
      // *shape* of an answer, and a segment lifted from the user's own
      // "who buys it" sentence does that without asserting anything new.
      values: [firstClause(buyers)],
      basis: buyers,
      confidence: "low",
    },
    industries: null,
    sizes: null,
    regions: null,
    triggers: {
      values: [firstClause(trigger)],
      basis: trigger,
      confidence: "low",
    },
    technologies: null,
    businessModels: null,
    painPoints: {
      values: [firstClause(problem)],
      basis: problem,
      confidence: "low",
    },
    useCases: null,
    exclusions: null,
    persona: null,
  };
}

/**
 * The first clause of a sentence, as a chip-sized label.
 *
 * Crude on purpose. This runs only in the no-key path, where the banner above
 * it says in plain words that no model produced any of this — a cleverer
 * extraction would make the example look more like a real answer, which is the
 * opposite of what is wanted.
 */
function firstClause(sentence: string): string {
  const clause = sentence.split(/[,.;]/)[0]?.trim() ?? sentence;
  return clause.length > 80 ? `${clause.slice(0, 77)}…` : clause;
}
