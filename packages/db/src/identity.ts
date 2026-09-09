/**
 * Company identity — the deterministic half.
 *
 * ── What lives here and what lives in SQL ────────────────────────────────
 *
 * `0012` has `resolve_company()`, which does exact lookups: this domain, or
 * this provider id. That belongs in the database because it is a join on the
 * hot path of every discovery result and must be one round trip.
 *
 * This file is everything that decides *what to look up*, and everything that
 * decides whether two things that are not exactly equal might nevertheless be
 * the same company. None of it touches a database, all of it is a pure
 * function of its arguments, and that is why it can be exhaustively tested
 * against a table of cases — which is not something SQL is good at.
 *
 * ── The rule that shapes every function below ────────────────────────────
 *
 * **Resolving is exact. Matching only ever proposes.**
 *
 * `canonicalizeDomain` produces the key that `resolve_company` looks up, and
 * a wrong answer there merges two companies silently. `similarity` produces a
 * confidence that becomes a `merge_candidates` row, and a wrong answer there
 * costs somebody ten seconds of review.
 *
 * So the domain code is conservative to the point of being boring, and the
 * fuzzy code is allowed to be clever. Nothing here merges anything.
 */

/* ── Domains ───────────────────────────────────────────────────────────── */

/**
 * Hosts that are never a company's identity.
 *
 * A provider returning `linkedin.com/company/acme` as a company's website —
 * which they do — must not create a company whose canonical domain is
 * `linkedin.com`, because the second one would resolve to the first and every
 * company on LinkedIn would merge into one row. That failure is silent,
 * immediate, and destroys the table.
 *
 * The list is short and deliberately covers only what has actually been seen
 * in provider output. A long speculative list would eventually exclude a real
 * customer's domain.
 */
const NON_IDENTITY_HOSTS = new Set([
  "linkedin.com",
  "www.linkedin.com",
  "facebook.com",
  "twitter.com",
  "x.com",
  "instagram.com",
  "youtube.com",
  "crunchbase.com",
  "github.com",
  "medium.com",
  "wordpress.com",
  "blogspot.com",
  "wixsite.com",
  "squarespace.com",
  "google.com",
  "sites.google.com",
  "notion.so",
  "substack.com",
  "gmail.com",
  "yahoo.com",
  "hotmail.com",
  "outlook.com",
  "example.com",
  "localhost",
]);

export class InvalidDomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidDomainError";
  }
}

/**
 * A URL, host, or email to the one string this system keys companies on.
 *
 * Returns null rather than throwing for anything unusable, because the caller
 * is almost always processing a provider's list and one bad row must not stop
 * the other ninety-nine. `discovery_results.outcome = 'invalid'` is where the
 * bad ones are counted, which is also how "this provider returns 30% junk"
 * becomes a measurable fact about the provider.
 *
 * What it does:
 *   · strips a scheme, credentials, port, path, query and fragment
 *   · takes the domain part of an email address
 *   · lowercases, and strips a trailing dot (the DNS root)
 *   · strips a leading `www.` — and nothing else, deliberately: `mail.acme.com`
 *     and `acme.com` are different hosts and treating a subdomain as the
 *     parent would merge a customer's staging site into their production one
 *   · rejects IP addresses, single labels, and the hosts above
 */
export function canonicalizeDomain(input: string | null | undefined): string | null {
  if (!input) return null;
  let value = String(input).trim().toLowerCase();
  if (!value) return null;

  /* An email: everything after the last @. Done before URL parsing because
     `mailto:` and a bare address both arrive here from provider payloads. */
  value = value.replace(/^mailto:/, "");
  if (value.includes("@")) {
    value = value.slice(value.lastIndexOf("@") + 1);
  }

  /* Scheme and everything after the host. Written as string surgery rather
     than `new URL()` because the input is frequently a bare host, and
     `new URL("acme.com")` throws while `new URL("//acme.com")` is a relative
     reference whose behaviour depends on a base. Both are ways to get this
     subtly wrong on inputs that are perfectly readable. */
  value = value.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  value = value.split(/[/?#]/)[0] ?? "";
  /* Credentials, then port. */
  const at = value.lastIndexOf("@");
  if (at >= 0) value = value.slice(at + 1);
  /* IPv6 literals are bracketed; they are not a company identity either way. */
  if (value.startsWith("[")) return null;
  value = value.split(":")[0] ?? "";

  value = value.replace(/\.+$/, "");
  if (value.startsWith("www.")) value = value.slice(4);

  if (!value) return null;
  /* A single label is a hostname on a local network, not a company. */
  if (!value.includes(".")) return null;
  /* Bare IPv4. */
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(value)) return null;
  /* Anything with a character that cannot appear in a hostname. Punycode is
     already ASCII; a Unicode domain arrives as UTF-8 and is left alone rather
     than mangled, because `URL` is the only correct punycoder and it is not
     reachable here for the reason above. Such a domain still round-trips
     consistently, which is what the unique index needs. */
  if (/[\s/\\<>"'`]/.test(value)) return null;
  if (value.length > 253) return null;

  if (NON_IDENTITY_HOSTS.has(value)) return null;

  return value;
}

/**
 * The registrable-ish part, for grouping only.
 *
 * Explicitly NOT a public-suffix implementation. It handles the two-label
 * suffixes that actually appear (`co.uk`, `com.au`, …) and is used for one
 * thing: deciding that `acme.com` and `acme.co.uk` are worth *proposing* as
 * the same company. It is never used as a key, because a wrong answer would
 * merge two unrelated companies — and a real PSL is a 15,000-entry list that
 * needs updating, which is a dependency this package does not want for a
 * heuristic that only feeds a review queue.
 */
const TWO_LABEL_SUFFIXES = new Set([
  "co.uk", "org.uk", "ac.uk", "gov.uk", "me.uk", "net.uk",
  "com.au", "net.au", "org.au", "edu.au", "gov.au",
  "co.nz", "co.za", "co.jp", "co.kr", "co.in", "co.il",
  "com.br", "com.mx", "com.sg", "com.tr", "com.cn", "com.hk",
  "com.ar", "com.co", "com.pl", "com.tw", "com.ua", "com.vn",
]);

export function rootLabel(domain: string): string | null {
  const canonical = canonicalizeDomain(domain);
  if (!canonical) return null;
  const parts = canonical.split(".");
  if (parts.length < 2) return null;
  const lastTwo = parts.slice(-2).join(".");
  if (TWO_LABEL_SUFFIXES.has(lastTwo) && parts.length >= 3) return parts[parts.length - 3] ?? null;
  return parts[parts.length - 2] ?? null;
}

/* ── Names ─────────────────────────────────────────────────────────────── */

/**
 * Legal-form and decoration words that carry no identity.
 *
 * "Acme Inc." and "Acme" are the same company; "Acme" and "Acme Digital" may
 * not be. So this list is only the suffixes that are legally or
 * typographically noise, and nothing that could be a real distinguishing
 * word. `Group`, `Digital`, `Labs`, `Studio` are deliberately absent: they
 * distinguish companies far more often than they decorate one.
 */
const NAME_NOISE = new Set([
  "inc", "inc.", "incorporated",
  "llc", "l.l.c", "llp", "lp",
  "ltd", "ltd.", "limited",
  "plc", "corp", "corp.", "corporation",
  "co", "co.", "company",
  "gmbh", "ag", "kg", "mbh",
  "bv", "b.v", "nv", "n.v",
  "sa", "s.a", "sas", "sarl", "srl", "spa", "s.p.a",
  "ab", "as", "a.s", "oy", "oyj", "aps",
  "pty", "pte", "sdn", "bhd",
  "the",
]);

/**
 * A name reduced to what identifies it.
 *
 * Lowercased, accents folded, punctuation removed, legal forms dropped,
 * whitespace collapsed. Used for similarity and for a last-resort exact match
 * — but only ever alongside a second signal, because two companies genuinely
 * called "Apex" in different countries are not the same company.
 */
export function normalizeName(input: string | null | undefined): string {
  if (!input) return "";
  return String(input)
    .normalize("NFKD")
    /* Combining marks: "Zürich" and "Zurich" are the same name typed twice. */
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    /* `&` before punctuation stripping, so "R&D" does not become "rd". */
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word && !NAME_NOISE.has(word))
    .join(" ")
    .trim();
}

/**
 * Levenshtein distance, bounded.
 *
 * Bounded because the only question ever asked is "is this within a few
 * edits", and an unbounded computation over two 200-character strings from a
 * provider payload is work nobody wanted. Returns `max + 1` when it exceeds
 * the bound, which is enough for every comparison below.
 */
export function editDistance(a: string, b: string, max = 8): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  /* One row rather than a full matrix: the recurrence only reaches one row
     back and one column left, so the previous row's diagonal is the only cell
     that needs carrying. A 200×200 matrix per comparison, over a page of
     provider results, is memory nobody asked for.

     The `?? 0` below are unreachable — `row` is densely filled before the loop
     starts and every write is in range — and they are written rather than
     asserted because `noUncheckedIndexedAccess` is on for this workspace and
     a non-null assertion is a claim the compiler cannot check either. Four
     coalesces in a hot loop cost nothing measurable. */
  const row: number[] = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) row[j] = j;

  for (let i = 1; i <= a.length; i++) {
    /* row[i-1][j-1], carried across the assignment that overwrites it. */
    let diagonal = row[0] ?? 0;
    row[0] = i;
    let rowMin = i;

    for (let j = 1; j <= b.length; j++) {
      const above = row[j] ?? 0;
      const left = row[j - 1] ?? 0;
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const value = Math.min(left + 1, above + 1, diagonal + cost);
      row[j] = value;
      diagonal = above;
      if (value < rowMin) rowMin = value;
    }

    /* Every cell in this row already exceeds the bound, and distance is
       non-decreasing down the matrix, so the answer cannot come back under it. */
    if (rowMin > max) return max + 1;
  }

  return row[b.length] ?? 0;
}

/* ── Matching ──────────────────────────────────────────────────────────── */

export type MatchSignal =
  | "provider_id"
  | "domain"
  | "redirect"
  | "normalized_name"
  | "name_and_country";

export type MatchConfidence = "low" | "medium" | "high";

export interface MatchCandidate {
  name: string | null;
  domain: string | null;
  country: string | null;
  providerIds?: Record<string, string>;
}

export interface MatchResult {
  matched: boolean;
  signal: MatchSignal | null;
  confidence: MatchConfidence;
  /** The sentence a reviewer reads. Never a score on its own. */
  detail: string;
}

const NO_MATCH: MatchResult = {
  matched: false,
  signal: null,
  confidence: "low",
  detail: "No shared identifier.",
};

/**
 * Might these two rows be the same company?
 *
 * The output feeds `merge_candidates`, never a merge. Only `high` confidence
 * is ever auto-merged, and only by the caller — which restricts itself to
 * `provider_id` and `domain`, the two signals that are facts rather than
 * resemblances.
 *
 * ── Why country is required for a name match ─────────────────────────────
 *
 * Because names collide constantly and the collisions are not random: the
 * same word is a company name in a dozen countries. "Apex" in Germany and
 * "Apex" in Brazil are two companies, and a system that proposed merging them
 * would produce a review queue nobody trusts — which is worse than a review
 * queue that is empty, because a queue nobody trusts gets approved in bulk.
 */
export function compareCompanies(a: MatchCandidate, b: MatchCandidate): MatchResult {
  /* 1. A shared provider id is the provider asserting they are the same row.
        The strongest available signal, and the only one that needs no
        corroboration. */
  if (a.providerIds && b.providerIds) {
    for (const [provider, id] of Object.entries(a.providerIds)) {
      if (id && b.providerIds[provider] === id) {
        return {
          matched: true,
          signal: "provider_id",
          confidence: "high",
          detail: `Both carry ${provider} id ${id}.`,
        };
      }
    }
  }

  const domainA = canonicalizeDomain(a.domain);
  const domainB = canonicalizeDomain(b.domain);

  /* 2. The same domain is the same company, by this system's definition. */
  if (domainA && domainB && domainA === domainB) {
    return {
      matched: true,
      signal: "domain",
      confidence: "high",
      detail: `Both resolve to ${domainA}.`,
    };
  }

  const nameA = normalizeName(a.name);
  const nameB = normalizeName(b.name);

  /* 3. Different TLDs on the same root, with the same name. A country site
        and a global one — a genuine duplicate, and common in provider data.
        `medium` because the root label is a heuristic rather than a public
        suffix lookup. */
  if (domainA && domainB && nameA && nameA === nameB) {
    const rootA = rootLabel(domainA);
    const rootB = rootLabel(domainB);
    if (rootA && rootA === rootB) {
      return {
        matched: true,
        signal: "domain",
        confidence: "medium",
        detail: `Same name, and both domains share the root "${rootA}".`,
      };
    }
  }

  /* 4. Different domains entirely. Names alone, and only with a country. */
  if (!nameA || !nameB) return NO_MATCH;

  const bothKnown = !!a.country && !!b.country;
  const sameCountry =
    bothKnown && a.country!.trim().toLowerCase() === b.country!.trim().toLowerCase();
  /* Two known and *different* countries is evidence AGAINST, not merely
     absent evidence for. That distinction is the whole reason this branch
     exists separately from "country unknown": "Apex" in Germany and "Apex" in
     Brazil are two companies, and proposing them as duplicates produces a
     review queue people stop reading and start approving in bulk. */
  const differentCountry = bothKnown && !sameCountry;

  if (nameA === nameB) {
    if (sameCountry) {
      return {
        matched: true,
        signal: "name_and_country",
        confidence: "medium",
        detail: `Both are "${nameA}" in ${a.country}.`,
      };
    }
    if (differentCountry) {
      return {
        matched: false,
        signal: null,
        confidence: "low",
        detail: `Both are called "${nameA}", but one is in ${a.country} and the other in ${b.country}.`,
      };
    }
    /* A name match with no country is worth a look and nothing more. Reported
       as `low`, which the caller must not auto-merge. */
    return {
      matched: true,
      signal: "normalized_name",
      confidence: "low",
      detail: `Both normalize to "${nameA}", but the country is unknown on at least one.`,
    };
  }

  /* 5. Near-identical names in the same country — a typo, or a provider's
        transliteration. The length guard matters: two edits between "acme"
        and "acne" is most of the string, while two edits in a
        thirty-character name is a spelling difference. */
  if (sameCountry) {
    const shorter = Math.min(nameA.length, nameB.length);
    const allowed = shorter >= 12 ? 2 : shorter >= 7 ? 1 : 0;
    if (allowed > 0 && editDistance(nameA, nameB, allowed) <= allowed) {
      return {
        matched: true,
        signal: "name_and_country",
        confidence: "low",
        detail: `"${nameA}" and "${nameB}" differ by a character or two, both in ${a.country}.`,
      };
    }
  }

  return NO_MATCH;
}

/**
 * Order a pair so `(A,B)` and `(B,A)` are the same row.
 *
 * `merge_candidates` is unique on `(org, a, b)`, and without a canonical
 * order the same proposal appears twice — once from each side's discovery
 * run — and a reviewer rejects one and approves the other.
 */
export function orderPair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}
