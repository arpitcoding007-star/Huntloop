/**
 * Hunter — email finding.
 *
 * ── Why this is here at all ──────────────────────────────────────────────
 *
 * It was already working, in `packages/jobs/src/providers.ts`, and the
 * temptation was to leave it there and put only Apollo behind the new
 * contract. That would have been a mistake: an interface designed against one
 * implementation is a description of that implementation. Migrating Hunter in
 * the same change is what proves the contract is a contract — and it found
 * one thing immediately, which is that a `person.match` result has no
 * `providerId` from Hunter at all.
 *
 * That absence is honest and is now representable: the id is synthesised from
 * the address, which is stable, unique per person per domain, and obviously
 * not a Hunter record id to anyone reading it.
 */
import {
  ProviderError,
  type Capability,
  type PersonMatchQuery,
  type ProviderAdapter,
  type ProviderPerson,
  type RawCall,
} from "../contract.ts";

const NAME = "hunter";

/** Hunter bills per request, not per result. */
const CREDITS = { match: 1 } as const;

export function hunterAdapter(apiKey: string): ProviderAdapter {
  const capabilities: Capability[] = ["person.match"];

  async function get<T>(path: string, params: Record<string, string | null>): Promise<{ body: T; status: number }> {
    const url = new URL(`https://api.hunter.io/v2${path}`);
    for (const [key, value] of Object.entries(params)) {
      if (value) url.searchParams.set(key, value);
    }
    url.searchParams.set("api_key", apiKey);

    let response: Response;
    try {
      response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    } catch (e) {
      throw new ProviderError(NAME, e instanceof Error ? e.message : String(e), { retryable: true });
    }

    /* 404 is "we looked and have nothing", which is an answer rather than a
       failure — and the distinction is the reason it is handled here and not
       thrown. An outage that returned an empty list would be
       indistinguishable from a person with no findable address, and the
       second one gets cached. */
    if (response.status === 404) {
      return { body: {} as T, status: 404 };
    }

    if (response.status === 429) {
      throw new ProviderError(NAME, "Hunter rate limit reached.", {
        httpStatus: 429,
        rateLimited: true,
      });
    }

    if (response.status === 401) {
      throw new ProviderError(NAME, "Hunter rejected the API key.", {
        httpStatus: 401,
        retryable: false,
      });
    }

    if (response.status >= 500) {
      throw new ProviderError(NAME, `Hunter returned ${response.status}.`, {
        httpStatus: response.status,
        retryable: true,
      });
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new ProviderError(NAME, `Hunter returned ${response.status}: ${detail.slice(0, 200)}`, {
        httpStatus: response.status,
        retryable: false,
      });
    }

    return { body: (await response.json()) as T, status: response.status };
  }

  return {
    name: NAME,
    capabilities,

    /**
     * Hunter's account endpoint. Free, and the reason `PRV-01` is workable:
     * a wrong key produces "Hunter rejected the API key" at configuration
     * time rather than "no results" forever.
     */
    async verifyCredentials() {
      try {
        await get<{ data?: unknown }>("/account", {});
        return { ok: true, detail: "Hunter accepted the API key." };
      } catch (e) {
        return { ok: false, detail: e instanceof Error ? e.message : String(e) };
      }
    },

    async matchPerson(query: PersonMatchQuery): Promise<RawCall<ProviderPerson | null>> {
      const { body, status } = await get<{
        data?: { email?: string; score?: number; sources?: unknown[] };
      }>("/email-finder", {
        domain: query.companyDomain,
        first_name: query.firstName,
        last_name: query.lastName,
      });

      const email = body.data?.email;
      if (!email) return { data: null, credits: CREDITS.match, httpStatus: status };

      /* Hunter's `score` is a 0–100 confidence, which is exactly the fake
         precision §16 objects to when it is *shown*. It is banded into a word
         here — which is what the interface renders — and the raw number is
         kept in `raw`, where it is a provider's number, correctly attributed. */
      const score = Number(body.data?.score ?? 0);

      return {
        data: {
          /* Hunter returns no record id. Synthesised from the address, which
             is stable and unique per person per domain — and is obviously not
             a Hunter id to anyone reading it, which matters because it lands
             in `external_ids` beside real ones. */
          providerId: `email:${email.toLowerCase()}`,
          firstName: query.firstName,
          lastName: query.lastName,
          title: query.title,
          seniority: null,
          department: null,
          linkedinUrl: null,
          city: null,
          country: null,
          contacts: [
            {
              kind: "email",
              value: email.toLowerCase(),
              confidence: score >= 90 ? "high" : score >= 70 ? "medium" : "low",
              /* Hunter's score is a confidence in a *derivation*, not an
                 observation that the mailbox exists. Never `verified`; that
                 word is reserved for something a verifier asserted. */
              verified: false,
            },
          ],
          raw: { score, sources: body.data?.sources?.length ?? 0 },
        },
        credits: CREDITS.match,
        httpStatus: status,
      };
    },
  };
}
