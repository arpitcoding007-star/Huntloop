/**
 * How ready a buyer is to act (build plan DN-51). Computed in the database
 * (`exchange_score_intent`, 0066) from what the buyer confirmed, and not here:
 * suppliers are alerted on it, so a session that could write it could mark its
 * own request hot. Only the labels live in the app.
 */

export type IntentBand = "hot" | "warm" | "cool";

export const INTENT_LABEL: Record<IntentBand, string> = {
  hot: "Ready to buy",
  warm: "Actively looking",
  cool: "Early stage",
};
