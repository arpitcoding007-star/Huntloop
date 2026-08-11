/**
 * Turning what a user typed into something a fetcher can be pointed at.
 *
 * People type `acme.co`, `www.acme.co/`, `https://acme.co/about?utm_source=x`.
 * All four are the same company, and §59/§60 make that equivalence a first-class
 * concern rather than a formatting nicety — the canonical domain is the dedupe
 * key for `companies`, so a normaliser that disagrees with itself creates
 * duplicate companies that no later step can merge.
 */

export interface NormalizedUrl {
  /** The URL to hand the model. */
  url: string;
  /** Hostname as given, lowercased. */
  host: string;
  /** `www.` stripped — the `companies.canonical_domain` value. */
  canonicalDomain: string;
  /** Hosts a fetch may touch for this company. */
  fetchDomains: string[];
}

export class InvalidUrlError extends Error {
  constructor(input: string) {
    super(`${JSON.stringify(input)} is not a website address.`);
    this.name = "InvalidUrlError";
  }
}

export function normalizeUrl(input: string): NormalizedUrl {
  const trimmed = input.trim();
  if (!trimmed) throw new InvalidUrlError(input);

  // Default to https rather than http: a company that only serves plaintext is
  // rare, and guessing http first means a redirect on every single fetch.
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    throw new InvalidUrlError(input);
  }

  const host = parsed.hostname.toLowerCase();
  // A hostname with no dot is a local name, not a company. Rejecting here keeps
  // `localhost` and typos out of the fetch allow-list.
  if (!host.includes(".") || host.endsWith(".")) throw new InvalidUrlError(input);

  const canonicalDomain = host.replace(/^www\./, "");
  return {
    url: parsed.toString(),
    host,
    canonicalDomain,
    fetchDomains: [canonicalDomain, `www.${canonicalDomain}`],
  };
}
