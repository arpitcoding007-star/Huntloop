import type { AssistantRecord } from "@huntloop/ai";
import type { MatchedCard } from "../data/exchange";
import { TIMELINE_LABEL } from "./requirement";

/** A question about what buyers are asking for. Reading cards is logged to the
    buyer as a view, so they are read only when the question is about them. */
export function asksAboutRequests(question: string): boolean {
  return /\b(requests?|buyers?|exchange|open needs?|needs? (that )?match|match(es|ed|ing)? (us|our)|looking to buy)\b/i.test(question);
}

/**
 * Anonymous cards as assistant records (DN-47). Bands only: never the buyer's
 * own words, which a level 3 card shows, because an answer is saved with the
 * conversation and would outlive the buyer withdrawing them.
 */
export function requestRecords(cards: readonly MatchedCard[], limit = 10): AssistantRecord[] {
  return cards.slice(0, limit).map((c) => ({
    ref: `request:${c.matchId}`,
    type: "request" as const,
    title: `Anonymous buyer request: ${c.categoryPath ?? "uncategorised"}`,
    facts: [
      `matched to our offering: ${c.offeringTitle}`,
      c.score === null ? "fit: too little is known to score" : `fit ${c.score}/100`,
      c.quantityBand ? `quantity band ${c.quantityBand}` : "quantity not stated",
      c.budgetBand ? `budget band ${c.budgetBand}` : "budget not stated",
      c.place ? `place ${c.place}` : "place not stated",
      c.timeline ? `timing: ${TIMELINE_LABEL[c.timeline]}` : "timing not stated",
      "the buyer is anonymous until they accept an introduction",
    ],
  }));
}
