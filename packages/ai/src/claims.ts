/**
 * The fact / inference / unknown rule (master context §7), enforced at the
 * boundary where a model's output becomes Huntloop's data.
 *
 * The database already refuses these rows — packages/db/migrations/0002 has the
 * CHECK constraints and packages/db's suite proves they fire. This is not a
 * duplicate of that check; it is the same rule applied one step earlier, and
 * the two catch different failures:
 *
 *   · The database protects stored data. It cannot protect a claim that is
 *     rendered on screen and never stored — which is exactly what the analyze
 *     screen and the onboarding review step do.
 *   · This protects the moment of generation, so an invalid claim is
 *     attributable to a task and a prompt version rather than surfacing later
 *     as a constraint violation with no context.
 *
 * §7 calls silent promotion of an inference into a fact one of the most
 * important rules in the engine. A rule that important is worth checking twice.
 */

export type ClaimKind = "fact" | "inference" | "unknown";
export type Confidence = "high" | "medium" | "low";

export interface Claim {
  kind: ClaimKind;
  /** What is being asserted, or — for `unknown` — what could not be established. */
  claim: string;
  /** Required on a fact. A fact is a thing observed somewhere, or it isn't one. */
  sourceUrl?: string | null;
  /** Word-valued, never a fabricated percentage (§16). Absent on `unknown`. */
  confidence?: Confidence | null;
  excerpt?: string | null;
  observedAt?: string | null;
  eventDate?: string | null;
}

export class ClaimValidationError extends Error {
  /** The claim as the model produced it, for the run's error record. */
  claim: Claim;

  constructor(message: string, claim: Claim) {
    super(message);
    this.name = "ClaimValidationError";
    this.claim = claim;
  }
}

const KINDS: ClaimKind[] = ["fact", "inference", "unknown"];
const CONFIDENCES: Confidence[] = ["high", "medium", "low"];

/**
 * Rejects a claim that violates §7, rather than softening it.
 *
 * Softening is the tempting option and it is the wrong one: downgrading an
 * unsourced `fact` to an `inference` would silently rewrite the model's own
 * assertion about how sure it is, which is the §7 failure running backwards.
 * Better to fail the task and see it in `ai_runs.error`.
 */
export function assertValidClaim(claim: Claim): void {
  const reject = (why: string): never => {
    throw new ClaimValidationError(why, claim);
  };

  if (!KINDS.includes(claim.kind)) {
    reject(`Unknown claim kind ${JSON.stringify(claim.kind)}.`);
  }
  if (!claim.claim || !claim.claim.trim()) {
    // An `unknown` still has to say what is unknown. §78: "nothing is
    // established" is a finding, and a finding needs words.
    reject("A claim carries no text.");
  }

  if (claim.kind === "fact") {
    if (!claim.sourceUrl || !claim.sourceUrl.trim()) {
      reject(
        "A fact needs a source URL (§7). If the source cannot be named, the " +
          "claim is an inference and must say so.",
      );
    }
  }

  if (claim.kind === "unknown") {
    if (claim.confidence) {
      reject(
        "An unknown cannot carry a confidence (§16). Being confident about " +
          "not knowing something is fake precision.",
      );
    }
    if (claim.sourceUrl) {
      reject("An unknown cannot cite a source — nothing was observed.");
    }
  } else if (claim.confidence && !CONFIDENCES.includes(claim.confidence)) {
    reject(`Confidence must be a word, not ${JSON.stringify(claim.confidence)}.`);
  }
}

export function assertValidClaims(claims: readonly Claim[]): void {
  for (const claim of claims) assertValidClaim(claim);
}
