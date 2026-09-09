/**
 * ZeroBounce — email verification.
 *
 * ── The one thing this adapter must never do ─────────────────────────────
 *
 * Report `deliverable` for anything it did not observe.
 *
 * `unknown` is a real status and means "the verifier ran and could not tell",
 * which is different from "we did not ask" — and both are different from
 * "yes". The outreach screen renders all three differently, and a deployment
 * with no verifier shows "unverified" everywhere rather than a green tick it
 * did not earn.
 *
 * The mapping below is therefore deliberately pessimistic: every status
 * ZeroBounce has that is not an unambiguous yes maps to `risky` or `unknown`,
 * and only `valid` maps to `deliverable`.
 */
import {
  ProviderError,
  type Capability,
  type ProviderAdapter,
  type RawCall,
  type VerificationStatus,
} from "../contract.ts";

const NAME = "zerobounce";
const CREDITS = { verify: 1 } as const;

export function zerobounceAdapter(apiKey: string): ProviderAdapter {
  const capabilities: Capability[] = ["email.verify"];

  async function get<T>(path: string, params: Record<string, string>): Promise<{ body: T; status: number }> {
    const url = new URL(`https://api.zerobounce.net/v2${path}`);
    url.searchParams.set("api_key", apiKey);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

    let response: Response;
    try {
      response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    } catch (e) {
      throw new ProviderError(NAME, e instanceof Error ? e.message : String(e), { retryable: true });
    }

    if (response.status === 429) {
      throw new ProviderError(NAME, "ZeroBounce rate limit reached.", {
        httpStatus: 429,
        rateLimited: true,
      });
    }

    if (response.status >= 500) {
      throw new ProviderError(NAME, `ZeroBounce returned ${response.status}.`, {
        httpStatus: response.status,
        retryable: true,
      });
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new ProviderError(NAME, `ZeroBounce returned ${response.status}: ${detail.slice(0, 200)}`, {
        httpStatus: response.status,
        retryable: false,
      });
    }

    return { body: (await response.json()) as T, status: response.status };
  }

  return {
    name: NAME,
    capabilities,

    async verifyCredentials() {
      try {
        /* The credit-balance endpoint: free, authenticated, and it answers a
           second useful question at the same time. A key with zero credits is
           technically valid and practically not, and the detail says so. */
        const { body } = await get<{ Credits?: string }>("/getcredits", {});
        const credits = Number(body.Credits ?? -1);
        if (credits < 0) {
          return { ok: false, detail: "ZeroBounce rejected the API key." };
        }
        return { ok: true, detail: `ZeroBounce accepted the API key. ${credits} credits remain.` };
      } catch (e) {
        return { ok: false, detail: e instanceof Error ? e.message : String(e) };
      }
    },

    async verifyEmail(email: string): Promise<RawCall<VerificationStatus>> {
      const { body, status: httpStatus } = await get<{ status?: string; sub_status?: string }>(
        "/validate",
        { email },
      );

      return {
        data: mapStatus(body.status),
        credits: CREDITS.verify,
        httpStatus,
      };
    },
  };
}

/**
 * ZeroBounce's vocabulary to ours.
 *
 * Four of ours, nine of theirs, and every ambiguous case rounds down.
 *
 *   valid           → deliverable   the only unambiguous yes
 *   invalid         → undeliverable an unambiguous no
 *   catch-all       → risky         the domain accepts everything, so the
 *                                   mailbox may not exist. Sending is a
 *                                   gamble with the customer's reputation
 *   spamtrap        → undeliverable technically deliverable, and sending to
 *                                   one is how a domain gets blocklisted. The
 *                                   only place this mapping deliberately
 *                                   contradicts the literal answer, because
 *                                   the question being asked is "should we
 *                                   send", not "will it arrive"
 *   abuse           → risky         a known complainer
 *   do_not_mail     → undeliverable role addresses, suppression lists
 *   unknown         → unknown       the verifier tried and could not tell
 *   anything else   → unknown       a status we have not seen is not a yes
 */
function mapStatus(status: string | undefined): VerificationStatus {
  switch ((status ?? "").toLowerCase()) {
    case "valid":
      return "deliverable";
    case "invalid":
    case "spamtrap":
    case "do_not_mail":
      return "undeliverable";
    case "catch-all":
    case "catchall":
    case "abuse":
      return "risky";
    default:
      return "unknown";
  }
}
