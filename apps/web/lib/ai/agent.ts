import {
  MAX_HISTORY,
  MAX_QUESTION_CHARS,
  citableClaims,
  isAiConfigured,
  ModelRefusalError,
  runTask,
  salesAgent,
  type AgentAnswer,
  type AgentInput,
  type AgentTurn,
  type Priority,
  type QualificationEvidence,
} from "@huntloop/ai";
import { getActiveIcp } from "../data/icp";
import { resolveRecorder } from "./recorder";
import { consumeRateLimit, refusal } from "../rate-limit";
import type { AiFailure } from "./outcome";

/**
 * `sales_agent`, wrapped for the opportunity page — master context §19.
 *
 * The same shape as `why-now.ts`: resolve the recorder, load the ICP from the
 * database rather than accepting one from the client, refuse before spending
 * when there is nothing to reason from, and fall back to a worked example when
 * no key is configured.
 *
 * ── Why the worked example is not a canned paragraph ─────────────────────
 *
 * It is built from the evidence actually on the page, and it cites what it
 * uses. A demo answer that cited a claim nobody gathered would model the exact
 * failure this task exists to refuse, on the screen where a reviewer is most
 * likely to be forming an opinion about whether the product invents things.
 */

export type AiSource = "live" | "unconfigured";

export interface AgentResult {
  source: AiSource;
  metered: boolean;
  answer: AgentAnswer;
}

export type AgentOutcome = { ok: true; result: AgentResult } | AiFailure;

export interface AgentRequest {
  companyName: string;
  canonicalDomain: string;
  priority: Priority;
  priorityReason: string;
  narrative: AgentInput["narrative"];
  evidence: QualificationEvidence[];
  history: AgentTurn[];
  question: string;
}

export async function ask(orgSlug: string, request: AgentRequest): Promise<AgentOutcome> {
  const resolved = await resolveRecorder(orgSlug);
  if (!resolved.ok) return { ok: false, error: resolved.error };
  const { recorder, orgId, recorded } = resolved;

  const { data: icp } = await getActiveIcp(orgId);
  if (!icp) {
    return {
      ok: false,
      error:
        "No ideal customer profile is defined for this organisation yet. The " +
        "agent's answers depend on what you are selling and to whom.",
    };
  }

  const input: AgentInput = {
    ...request,
    icp,
    /* Trimmed here rather than in the task, so the cost of a long conversation
       is bounded at the boundary that pays for it. Newest kept: the last few
       turns are what "a different angle" is relative to. */
    history: request.history.slice(-MAX_HISTORY),
    question: request.question.slice(0, MAX_QUESTION_CHARS),
  };

  if (!isAiConfigured()) {
    return {
      ok: true,
      result: { source: "unconfigured", metered: false, answer: example(input) },
    };
  }

  const budget = await consumeRateLimit(orgId, "sales_agent");
  if (!budget.allowed) return refusal(budget);

  try {
    const { output } = await runTask(salesAgent, input, { orgId, recorder });
    return { ok: true, result: { source: "live", metered: recorded, answer: output } };
  } catch (error) {
    if (error instanceof ModelRefusalError) {
      return { ok: false, error: "The model declined to answer that." };
    }
    return {
      ok: false,
      error: error instanceof Error ? error.message : "The agent could not answer.",
    };
  }
}

/**
 * The worked example shown when no key is configured.
 *
 * Deliberately answers the question it was asked as far as the evidence
 * allows, and says so where it cannot — which is the behaviour being
 * demonstrated. An opportunity with nothing established gets the honest
 * version, because that is the commoner real case and the one worth showing.
 */
function example(input: AgentInput): AgentAnswer {
  const claims = citableClaims(input);

  if (claims.length === 0) {
    return {
      answer:
        "Nothing has been established about this company yet, so there is nothing " +
        "here I could base an answer on. Analyzing their URL, or letting a scan " +
        "run, is what gives this conversation something to work from.",
      citedClaims: [],
      unresolved: ["Everything — no evidence is on file for this opportunity."],
      confidence: null,
    };
  }

  return {
    answer:
      "Open on the problem they have named themselves rather than on your product, " +
      "and ask how they handle it today. That question is answerable by them and " +
      "tells you whether the gap is real before you make a claim about it.",
    citedClaims: claims.slice(0, 1),
    unresolved: [
      "Whether budget is allocated for this.",
      "Who owns the decision.",
    ],
    confidence: "medium",
  };
}
