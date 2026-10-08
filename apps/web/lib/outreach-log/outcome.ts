import { isQuiet } from "@huntloop/db/needs-you";

/**
 * What became of a reach-out — the outreach log's one judgement (§8.1b).
 *
 * Derived from the activity ledger and nothing else, so the log, Needs you's
 * "gone quiet" and Performance's reply rate all describe the same facts:
 *
 *   · **Replied** — the account answered after this touch, on any channel. A
 *     LinkedIn message answered by email was still answered.
 *   · **No response** — no answer, and the workspace's quiet period (business
 *     days, the "Gone quiet" setting) has passed since this touch.
 *   · **Waiting** — no answer yet, inside the quiet period.
 *
 * Nobody types an outcome in. A hand-set "no response" would be a second
 * opinion beside the ledger that nothing keeps true once they do reply.
 */

export type ReachOutcome = "replied" | "waiting" | "no-response";

export interface OutboundTouch {
  opportunityId: string;
  occurredAt: string;
}

/**
 * `inbound` maps an opportunity id to the times of its inbound touches. Only
 * an answer strictly after the touch counts: one that arrived first is what
 * the touch was replying to.
 */
export function outcomeOf(
  touch: OutboundTouch,
  inbound: ReadonlyMap<string, readonly string[]>,
  now: Date,
  quietAfterBusinessDays: number,
): ReachOutcome {
  const sent = Date.parse(touch.occurredAt);
  const answers = inbound.get(touch.opportunityId) ?? [];
  if (answers.some((at) => Date.parse(at) > sent)) return "replied";
  return isQuiet(touch.occurredAt, now, quietAfterBusinessDays) ? "no-response" : "waiting";
}

export const OUTCOME_LABEL: Record<ReachOutcome, string> = {
  replied: "Replied",
  waiting: "Waiting",
  "no-response": "No response",
};
