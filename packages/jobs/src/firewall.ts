/**
 * The declared/enriched firewall, job side (Exchange spec §6; migration 0059).
 *
 * A person, opportunity or company with `origin = 'exchange'` came from someone who
 * told us what they need, with consent for one purpose: an introduction they
 * accepted. The seller engine's job is the opposite — enrich people who never
 * signed up and put them in cold sequences — so the two must never meet.
 *
 * 0059's triggers refuse the writes (enrollment, enrichment record,
 * provider-sourced contact point), and 0066's the company's: a company behind
 * an Exchange opportunity is itself Exchange. These guards refuse earlier, before a
 * provider is paid or a draft is written, so a refused row costs nothing.
 * `scripts/audit.mjs` FW-01 fails the build when a guarded handler stops
 * calling `refusesExchange`.
 *
 * A refusal is a correct outcome, not an error: the job succeeds with a
 * `skipped` reason so it is neither retried nor alerted on.
 */
import type { JobOutcome } from "./registry.ts";

export const EXCHANGE_ORIGIN = "exchange";

/** True when a row loaded with its `origin` column came from Exchange. */
export function isExchangeOrigin(row: unknown): boolean {
  return (
    typeof row === "object" &&
    row !== null &&
    (row as { origin?: unknown }).origin === EXCHANGE_ORIGIN
  );
}

/**
 * The outcome for a job that must not touch an Exchange row, or null when the
 * row is not one and the job may continue.
 */
export function refusesExchange(
  job: string,
  row: unknown,
  what: "person" | "opportunity" | "company",
): JobOutcome | null {
  if (!isExchangeOrigin(row)) return null;
  return {
    ok: true,
    result: {
      skipped:
        `firewall: this ${what} came from Exchange, so ${job} does not run for it. ` +
        "Declared data is never enriched, sequenced or synced as a lead.",
      firewall: true,
    },
  };
}
