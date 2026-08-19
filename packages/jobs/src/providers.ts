/**
 * Third-party enrichment and email verification.
 *
 * ── What this file is, and is not ────────────────────────────────────────
 *
 * It is the contract, plus adapters for the two providers whose APIs this
 * product's `.env.example` has always named a key for. It is **not** a
 * provider abstraction framework, and it does not pretend a vendor is
 * configured when none is.
 *
 * `enrichmentProvider()` returns null when `ENRICHMENT_API_KEY` is unset, and
 * every caller is written around that returning null. That is the honest
 * shape: contact discovery is a paid third-party service, "no provider" is a
 * normal deployment state, and the failure mode to avoid is a product that
 * guesses `first.last@company.com` and presents it as a finding. A guessed
 * address is a plausible string with no evidence behind it — §7 has no
 * exception for "everybody does it", and the bounce lands on the customer's
 * sending domain rather than on ours.
 *
 * ── Choosing a vendor by the shape of its key ────────────────────────────
 *
 * There is deliberately no `ENRICHMENT_PROVIDER` variable. One key means one
 * provider, and a second variable that has to agree with the first is a
 * misconfiguration waiting to happen — the failure being a live deployment
 * sending Hunter's key to Apollo's endpoint and reporting "no results" rather
 * than "wrong credentials". The prefix is unambiguous for both vendors here,
 * and an unrecognised key names itself in the error.
 */

export type ContactKind = "email" | "phone" | "linkedin";

export interface ContactCandidate {
  kind: ContactKind;
  value: string;
  /** A word, never a percentage. §16. */
  confidence: "high" | "medium" | "low";
  provider: string;
  costCents: number;
  raw?: Record<string, unknown>;
}

export interface ContactQuery {
  firstName: string | null;
  lastName: string | null;
  title: string | null;
  companyDomain: string;
  companyName: string;
}

export type VerificationStatus =
  | "deliverable"
  | "undeliverable"
  | "risky"
  /** The verifier ran and could not tell. Different from not having asked. */
  | "unknown";

export interface Verification {
  status: VerificationStatus;
  provider: string | null;
}

/** Which provider is configured, or null. */
export function enrichmentProvider(): string | null {
  const key = process.env.ENRICHMENT_API_KEY?.trim();
  if (!key) return null;
  return key.startsWith("hunter_") || key.length === 40 ? "hunter" : "apollo";
}

export function verificationProvider(): string | null {
  const key = process.env.EMAIL_VERIFICATION_API_KEY?.trim();
  if (!key) return null;
  return "zerobounce";
}

/**
 * Candidate contact points for one person.
 *
 * Returns an empty array rather than throwing when the provider says it has
 * nothing — "we looked and found nothing" is an answer, and the caller records
 * it as one so the same question is not paid for twice.
 *
 * A provider *error* does throw. A vendor outage that returned an empty list
 * would be indistinguishable from a person who genuinely has no findable
 * address, and the second gets cached.
 */
export async function findContacts(query: ContactQuery): Promise<ContactCandidate[]> {
  const provider = enrichmentProvider();
  const key = process.env.ENRICHMENT_API_KEY?.trim();
  if (!provider || !key) return [];

  if (provider === "hunter") return hunterFind(query, key);
  return apolloFind(query, key);
}

/**
 * Hunter's email-finder.
 *
 * `score` is a 0–100 confidence, which is exactly the fake precision §16
 * objects to when it is *shown*. It is stored raw in `enrichment_records.raw`
 * — where it is a provider's number, correctly attributed — and banded into a
 * word for `contact_points.confidence`, which is what the interface renders.
 */
async function hunterFind(query: ContactQuery, key: string): Promise<ContactCandidate[]> {
  const url = new URL("https://api.hunter.io/v2/email-finder");
  url.searchParams.set("domain", query.companyDomain);
  url.searchParams.set("api_key", key);
  if (query.firstName) url.searchParams.set("first_name", query.firstName);
  if (query.lastName) url.searchParams.set("last_name", query.lastName);

  const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (response.status === 404) return [];
  if (!response.ok) {
    throw new Error(`hunter: ${response.status} ${await response.text().catch(() => "")}`.trim());
  }

  const body = (await response.json()) as {
    data?: { email?: string; score?: number; sources?: unknown[] };
  };
  const email = body.data?.email;
  if (!email) return [];

  const score = Number(body.data?.score ?? 0);
  return [
    {
      kind: "email",
      value: email.toLowerCase(),
      confidence: score >= 90 ? "high" : score >= 70 ? "medium" : "low",
      provider: "hunter",
      // Hunter bills per request, not per result: this is the list price of
      // the smallest paid plan divided by its request allowance.
      costCents: 1,
      raw: { score, sources: body.data?.sources?.length ?? 0 },
    },
  ];
}

async function apolloFind(query: ContactQuery, key: string): Promise<ContactCandidate[]> {
  const response = await fetch("https://api.apollo.io/api/v1/people/match", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": key,
    },
    body: JSON.stringify({
      first_name: query.firstName,
      last_name: query.lastName,
      domain: query.companyDomain,
      organization_name: query.companyName,
      reveal_personal_emails: false,
    }),
    signal: AbortSignal.timeout(15_000),
  });

  if (response.status === 404) return [];
  if (!response.ok) {
    throw new Error(`apollo: ${response.status} ${await response.text().catch(() => "")}`.trim());
  }

  const body = (await response.json()) as {
    person?: { email?: string; email_status?: string; linkedin_url?: string };
  };
  const out: ContactCandidate[] = [];

  if (body.person?.email) {
    out.push({
      kind: "email",
      value: body.person.email.toLowerCase(),
      /* Apollo's own status, mapped rather than assumed. "guessed" is the one
         that matters: it means the address was constructed from a pattern, and
         calling that medium confidence would be laundering a guess into a
         finding. */
      confidence: body.person.email_status === "verified" ? "high" : "low",
      provider: "apollo",
      costCents: 2,
      raw: { email_status: body.person.email_status ?? null },
    });
  }

  if (body.person?.linkedin_url) {
    out.push({
      kind: "linkedin",
      value: body.person.linkedin_url,
      confidence: "high",
      provider: "apollo",
      costCents: 0,
    });
  }

  return out;
}

/**
 * Whether an address will accept mail.
 *
 * With no verifier configured this returns `unknown` rather than assuming
 * deliverable. The distinction is load-bearing at send time: `contact_points`
 * carries `verification_status`, the outreach screen shows it, and a
 * deployment with no verifier should show "unverified" everywhere rather than
 * a green tick it did not earn.
 */
export async function verifyEmail(email: string): Promise<Verification> {
  const key = process.env.EMAIL_VERIFICATION_API_KEY?.trim();
  if (!key) return { status: "unknown", provider: null };

  const url = new URL("https://api.zerobounce.net/v2/validate");
  url.searchParams.set("api_key", key);
  url.searchParams.set("email", email);

  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) return { status: "unknown", provider: "zerobounce" };

    const body = (await response.json()) as { status?: string };
    return { status: mapZeroBounce(body.status), provider: "zerobounce" };
  } catch {
    /* A verifier that is down does not block the enrichment. The address is
       stored unverified, which is true, and the next run can verify it —
       whereas failing the job would lose the address we just paid for. */
    return { status: "unknown", provider: "zerobounce" };
  }
}

function mapZeroBounce(status: string | undefined): VerificationStatus {
  switch (status) {
    case "valid":
      return "deliverable";
    case "invalid":
      return "undeliverable";
    case "catch-all":
    case "do_not_mail":
    case "spamtrap":
      /* Not "undeliverable": mail to a catch-all domain arrives. It is risky
         because it arrives whether or not the mailbox exists, so a bounce
         cannot tell you that you were wrong — and `do_not_mail` and
         `spamtrap` are addresses that will accept mail and punish you for
         sending it. The send path treats risky as do-not-send. */
      return "risky";
    default:
      return "unknown";
  }
}
