/**
 * `profile_company` — facts a page states about itself, without a model (P2-4).
 *
 * A homepage carries checkable facts in its markup: which marketing stack it
 * runs, whether it advertises, whether it takes bookings, whether it sells
 * online. A regex finds each one for free, where asking a model costs a call
 * and returns an inference. Each detection becomes a `first_party` fact citing
 * the page it was read from, so the evidence behind a score gets stronger at
 * near-zero marginal cost.
 *
 * Deliberately conservative: a detector matches a vendor's own script or
 * embed host, never a word on the page, so "we integrate with HubSpot" in a
 * paragraph is not "runs HubSpot".
 */
import { fetchPage } from "../fetch.ts";
import { bareDomain } from "../gate.ts";
import type { JobContext, JobOutcome } from "../registry.ts";

export interface SiteFact {
  key: string;
  claim: string;
  /** `fact` only where the markup cannot mean anything else; `inference` where it can. */
  kind: "fact" | "inference";
}

/* TRUST-101: each claim says only what the markup shows. A vendor script on
   the page is a fact about the page; what the company does with it (takes
   payments, sells online) is not, so those are worded as what was loaded and
   stored as inference. Calendly counts only as an embed, never a link. */
const DETECTORS: { key: string; claim: string; kind: "fact" | "inference"; pattern: RegExp }[] = [
  { key: "hubspot", kind: "fact", claim: "Loads HubSpot tracking or forms on its homepage.", pattern: /js(?:-[a-z0-9]+)?\.hs-scripts\.com|js\.hsforms\.net/i },
  { key: "marketo", kind: "fact", claim: "Loads Marketo tracking on its homepage.", pattern: /munchkin\.marketo\.net/i },
  { key: "pardot", kind: "fact", claim: "Loads Salesforce Pardot tracking on its homepage.", pattern: /pi\.pardot\.com/i },
  { key: "segment", kind: "fact", claim: "Loads Segment analytics on its homepage.", pattern: /cdn\.segment\.com\/analytics\.js/i },
  { key: "intercom", kind: "fact", claim: "Loads an Intercom chat widget on its homepage.", pattern: /widget\.intercom\.io|js\.intercomcdn\.com/i },
  { key: "drift", kind: "fact", claim: "Loads a Drift chat widget on its homepage.", pattern: /js\.driftt\.com/i },
  { key: "google_ads", kind: "fact", claim: "Has a Google Ads conversion tag on its homepage.", pattern: /gtag\([^)]*['"]AW-\d+|googleadservices\.com\/pagead\/conversion/i },
  { key: "meta_pixel", kind: "fact", claim: "Has a Meta (Facebook) pixel on its homepage.", pattern: /connect\.facebook\.net\/[a-z_]+\/fbevents\.js/i },
  { key: "linkedin_insight", kind: "fact", claim: "Has a LinkedIn Insight tag on its homepage.", pattern: /snap\.licdn\.com\/li\.lms-analytics/i },
  { key: "calendly", kind: "fact", claim: "Embeds a Calendly booking widget on its homepage.", pattern: /<(?:script|iframe|link)\b[^>]*\b(?:src|href)=["']https?:\/\/(?:assets\.)?calendly\.com\//i },
  { key: "chilipiper", kind: "fact", claim: "Loads Chili Piper meeting routing on its homepage.", pattern: /js\.chilipiper\.com/i },
  { key: "shopify", kind: "inference", claim: "Its homepage loads Shopify assets, which suggests a Shopify store.", pattern: /cdn\.shopify\.com|myshopify\.com/i },
  { key: "stripe", kind: "inference", claim: "Its homepage loads Stripe.js, used for payments and for fraud checks.", pattern: /js\.stripe\.com\/v3/i },
  { key: "wordpress", kind: "inference", claim: "Its homepage references WordPress paths, which suggests a WordPress site.", pattern: /\/wp-content\/|\/wp-includes\//i },
  { key: "webflow", kind: "fact", claim: "Its homepage is served with Webflow markup.", pattern: /assets(?:-global)?\.website-files\.com|data-wf-site=/i },
];

export function detectSiteFacts(html: string): SiteFact[] {
  return DETECTORS.filter((d) => d.pattern.test(html)).map(({ key, claim, kind }) => ({ key, claim, kind }));
}

type PageFetcher = (url: string) => Promise<{ url: string; status: number; body: string }>;

export async function profileCompany(
  ctx: JobContext,
  fetcher: PageFetcher = (url) => fetchPage(url, { maxBytes: 2 * 1024 * 1024, accept: "text/html" }),
): Promise<JobOutcome> {
  const { scope, payload } = ctx;
  const companyId = String(payload.companyId ?? "");
  if (!companyId) return { ok: false, permanent: true, error: "profile_company: no companyId in payload." };

  const { data: company, error } = await scope
    .select("companies", "id, canonical_domain")
    .eq("id", companyId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) return { ok: false, error: `profile_company: ${error.message}` };
  if (!company?.canonical_domain) return { ok: true, result: { skipped: "no company or no domain" } };

  let page;
  try {
    page = await fetcher(`https://${company.canonical_domain}/`);
  } catch (e) {
    return { ok: true, result: { skipped: `the site could not be read: ${e instanceof Error ? e.message : String(e)}` } };
  }
  if (page.status >= 400) return { ok: true, result: { skipped: `the site answered ${page.status}` } };

  /* A homepage that redirected to another domain describes that domain. */
  const finalHost = bareDomain(page.url);
  const domain = String(company.canonical_domain);
  if (!finalHost || (finalHost !== domain && !finalHost.endsWith(`.${domain}`) && !domain.endsWith(`.${finalHost}`))) {
    return { ok: true, result: { skipped: `the homepage redirected to ${finalHost ?? "an unreadable address"}` } };
  }

  const facts = detectSiteFacts(page.body);
  if (!facts.length) return { ok: true, result: { found: 0 } };

  const observedAt = new Date().toISOString();
  const { error: evidenceError } = await scope.upsert(
    "evidence",
    facts.map((f) => ({
      subject_type: "company",
      subject_id: companyId,
      claim: f.claim,
      kind: f.kind,
      confidence: f.kind === "fact" ? "high" : "medium",
      reliability: f.kind === "fact" ? "first_party" : "inferred",
      source_url: page.url,
      observed_at: observedAt,
      field: `site:${f.key}`,
    })),
    { onConflict: "org_id,subject_type,subject_id,field,live_source_key", ignoreDuplicates: false },
  );
  if (evidenceError) return { ok: false, error: `profile_company evidence: ${evidenceError.message}` };

  return { ok: true, result: { found: facts.length, facts: facts.map((f) => f.key) } };
}
