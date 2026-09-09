"use server";

import { headers } from "next/headers";
import {
  anonymousAllowance,
  hashIp,
  lookupPublicResearch,
  publicResearchEnabled,
  recordPublicResearch,
} from "@huntloop/jobs";
import {
  isAiConfigured,
  InvalidUrlError,
  ModelRefusalError,
  normalizeUrl,
  nullRecorder,
  researchCompany,
  runTask,
  type CompanyUnderstanding,
} from "@huntloop/ai";
import { canonicalizeDomain } from "@huntloop/db/identity";
import { parseInput, urlInputSchema } from "../../../lib/validation";

/**
 * Reading a company's site for somebody who has no account.
 *
 * ── The order of the checks is the whole design ──────────────────────────
 *
 * Cache, then allowance, then spend. Every one of them is *before* the model
 * call, because the calls that go wrong are the slow expensive ones and a
 * limit checked afterwards has already paid for what it was meant to prevent.
 *
 * The cache goes first rather than the allowance, deliberately: a cached
 * answer costs nothing, so serving it to a rate-limited visitor is free and is
 * a better experience than refusing them. The limits exist to bound *spend*,
 * not to ration answers we already have.
 *
 * ── Why this is off by default ───────────────────────────────────────────
 *
 * An unauthenticated endpoint that calls Opus with web fetching is the single
 * most expensive misconfiguration available in this codebase. It ships behind
 * `PUBLIC_RESEARCH_ENABLED`, so turning it on is a deliberate act taken by
 * somebody who has also set a daily ceiling, rather than something that starts
 * spending the moment the code deploys.
 */

export interface DiscoverState {
  understanding?: CompanyUnderstanding;
  domain?: string;
  /** True when a model actually read the site, rather than a worked example. */
  isLive?: boolean;
  /** True when this came from the cache — shown, because freshness is a claim. */
  cached?: boolean;
  researchedAt?: string;
  error?: string;
  /** A refusal the visitor can act on, as opposed to a failure. */
  refused?: "disabled" | "rate_limited" | "over_budget";
}

export async function discoverAction(input: string): Promise<DiscoverState> {
  const parsed = parseInput(urlInputSchema, input, "address");
  if (!parsed.ok) return { error: parsed.error };

  let domain: string | null;
  let url: string;
  try {
    const normalized = normalizeUrl(parsed.value);
    url = normalized.url;
    domain = canonicalizeDomain(normalized.canonicalDomain);
  } catch (error) {
    if (error instanceof InvalidUrlError) {
      return { error: "That doesn't look like a website address." };
    }
    throw error;
  }

  if (!domain) return { error: "That doesn't look like a website address." };

  /* Free-mail and disposable domains are refused before anything is spent.
     `gmail.com` is not a company, and reading it would produce a profile of
     Google's mail product for somebody who meant to type their employer. */
  if (FREE_MAIL.has(domain)) {
    return {
      error:
        "That's an email provider rather than a company site. Try your " +
        "company's own domain.",
    };
  }

  /*
   * The feature flag is checked before anything touches the database.
   *
   * Order matters here in a way that is easy to get wrong. Serving the cache
   * first reads better — a cached answer is free, so giving it to a
   * rate-limited visitor is generous — and that argument is about the *rate
   * limit*, not about the flag. The flag means "this deployment does not do
   * anonymous research", and a deployment that answers from a cache it built
   * earlier is still doing it.
   *
   * It is also the practical fix for a crash: `lookupPublicResearch` needs the
   * service-role client, and a deployment with no database (a fresh checkout,
   * a preview) has no service key for it to construct. Checking the flag first
   * means the commonest configuration never reaches that call.
   */
  if (!publicResearchEnabled()) {
    return {
      refused: "disabled",
      domain,
      error:
        "Reading sites without an account isn't switched on here. Create a " +
        "free account and we'll read yours right away.",
    };
  }

  // Cache next: free, and better than refusing a rate-limited visitor.
  const cached = await lookupPublicResearch(domain).catch(() => null);
  if (cached) {
    return {
      understanding: cached.understanding as CompanyUnderstanding,
      domain,
      isLive: cached.isLive,
      cached: true,
      researchedAt: cached.researchedAt,
    };
  }

  const ipHash = await hashIp(await callerIp());
  const allowance = await anonymousAllowance(ipHash);
  if (!allowance.allowed) {
    return { refused: allowance.reason, domain, error: allowance.message };
  }

  /* No key configured. The worked example is returned and labelled — the same
     three-state honesty every onboarding screen already applies, extended to
     the one screen an anonymous visitor sees. It is deliberately not cached:
     a stored example would be served as a real reading to the next visitor
     after a key is added. */
  if (!isAiConfigured()) {
    return {
      understanding: exampleFor(url, domain),
      domain,
      isLive: false,
    };
  }

  try {
    /* `nullRecorder` and a sentinel org, because there is no tenant to bill.
       That is exactly the case `resolveRecorder` refuses for authenticated
       calls — an unattributable run — and the difference here is that the
       spend is bounded by the allowance above rather than by a tenant's quota.
       The two mechanisms are doing the same job for different callers. */
    const { output } = await runTask(
      researchCompany,
      { url },
      { orgId: "public", recorder: nullRecorder },
    );

    await recordPublicResearch(domain, output, true, ipHash);
    return { understanding: output, domain, isLive: true };
  } catch (error) {
    if (error instanceof ModelRefusalError) {
      return {
        domain,
        error:
          "The model declined to read that site. That's an answer about the " +
          "request rather than an outage — try a different address.",
      };
    }
    return {
      domain,
      error: "We couldn't read that site just now. Try again in a moment.",
    };
  }
}

/**
 * The caller's address, as far as the platform will say.
 *
 * `x-forwarded-for` is set by Vercel's edge and is the first hop we can
 * believe; a header a client can forge is only ever a hint, which is why this
 * is a *rate-limit* input and never an authorization one. The fallback string
 * groups every unidentifiable caller together, so an unknown source is limited
 * as if it were one visitor rather than being exempt.
 */
async function callerIp(): Promise<string> {
  const store = await headers();
  const forwarded = store.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return store.get("x-real-ip") ?? "unknown";
}

/**
 * Domains that are mailboxes rather than companies.
 *
 * Short and unapologetically incomplete. The cost of missing one is a wasted
 * lookup; the cost of a long list maintained by hand is that somebody
 * eventually adds a real customer's domain to it.
 */
const FREE_MAIL = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com",
  "yahoo.com", "icloud.com", "me.com", "aol.com", "proton.me", "protonmail.com",
  "gmx.com", "mail.com", "yandex.com", "zoho.com", "fastmail.com",
]);

/**
 * The worked example, when no model is configured.
 *
 * Identical in shape and in discipline to the one in `lib/ai/research.ts`:
 * facts carry sources, inferences carry confidence, and the business model is
 * genuinely unknown. A demo that cheats on the §7 rules teaches everyone who
 * reads it that the rules are decorative — and this is the first screen a
 * stranger sees.
 */
function exampleFor(url: string, domain: string): CompanyUnderstanding {
  return {
    url,
    canonicalDomain: domain,
    companyName: "Example Co",
    findings: [
      {
        field: "sells",
        label: "What you sell",
        kind: "fact",
        value:
          "Policy and permissioning infrastructure for autonomous agents that hold or move funds.",
        sourceUrl: "https://example.com/product",
        confidence: "high",
      },
      {
        field: "buyers",
        label: "Who you sell to",
        kind: "inference",
        value: "Crypto trading desks, funds, and AI infrastructure companies.",
        sourceUrl: null,
        confidence: "medium",
      },
      {
        field: "business_model",
        label: "Business model",
        kind: "unknown",
        value: "No pricing is published anywhere on the site.",
        sourceUrl: null,
        confidence: null,
      },
      {
        field: "problem",
        label: "The problem you solve",
        kind: "fact",
        value:
          "Institutions will not let software hold unconstrained signing authority over capital.",
        sourceUrl: "https://example.com/",
        confidence: "high",
      },
      {
        field: "trigger",
        label: "Likely buying trigger",
        kind: "inference",
        value:
          "Shipping an autonomous agent that touches real funds, especially just after raising.",
        sourceUrl: null,
        confidence: "low",
      },
    ],
  };
}
