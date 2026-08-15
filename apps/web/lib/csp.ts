/**
 * Content-Security-Policy, with a per-request nonce.
 *
 * SEC-03, the last P0 in the audit backlog. Until now the only CSP was
 * `frame-ancestors 'none'` in `next.config.ts` — genuinely useful against
 * clickjacking, and silent on the thing a CSP is mostly for. This adds
 * `script-src`.
 *
 * ── Why a nonce, and why this could not be a static header ────────────────
 *
 * Next injects inline bootstrap scripts into every document — the flight data
 * that hydrates the App Router. A static policy therefore has exactly two
 * options: `'unsafe-inline'`, which permits every inline script including an
 * injected one and so certifies nothing, or hashes, which change on every
 * build and cannot be written down ahead of time. A nonce is the third
 * option: a fresh random value per response, attached to the scripts we
 * emitted and to no others.
 *
 * `'strict-dynamic'` then says: anything those scripts load is trusted too.
 * That is what makes the policy survive Next's chunk loading without an
 * allow-list of URLs that goes stale.
 *
 * ── Why report-only by default ───────────────────────────────────────────
 *
 * A wrong CSP does not fail loudly. It blocks one script on one route and the
 * page half-works, which is the worst failure mode available and the reason
 * this was deferred rather than dropped into the audit. So it ships observing:
 * `Content-Security-Policy-Report-Only` sends violations to `/api/csp-report`
 * and blocks nothing. Set `CSP_ENFORCE=true` once the report stream is quiet
 * for a week — see SETUP.md.
 */

export interface CspResult {
  nonce: string;
  /** The header name to set — enforcing or observing. */
  header: "Content-Security-Policy" | "Content-Security-Policy-Report-Only";
  policy: string;
}

/** True when violations should block rather than merely be reported. */
export function cspIsEnforced(): boolean {
  return process.env.CSP_ENFORCE === "true";
}

/**
 * A fresh nonce.
 *
 * `crypto.getRandomValues` rather than `Math.random` or a uuid: a nonce whose
 * next value can be predicted from previous ones is not a nonce, and this runs
 * on the edge runtime where `node:crypto` is not available.
 *
 * 16 bytes, base64. The spec asks for at least 128 bits of entropy.
 */
export function createNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

export function buildCsp(nonce: string): CspResult {
  const isDev = process.env.NODE_ENV !== "production";

  /*
   * Where the browser is allowed to talk to.
   *
   * Derived from the configured Supabase URL rather than a wildcard over
   * `*.supabase.co`: the wildcard would permit every Supabase project on the
   * internet, which is a meaningful difference for a policy whose job is to
   * limit where an injected script can send data.
   */
  const connect = new Set(["'self'"]);

  const supabase = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (supabase) {
    try {
      connect.add(new URL(supabase).origin);
      // Realtime, if it is ever used, is the same host over websockets.
      connect.add(`wss://${new URL(supabase).host}`);
    } catch {
      // A malformed URL is a configuration problem, not a reason to widen the
      // policy. Leaving it out fails closed and shows up as a report.
    }
  }

  const sentryDsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (sentryDsn) {
    try {
      connect.add(new URL(sentryDsn).origin);
    } catch {
      /* as above */
    }
  }

  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],

    /*
     * `'unsafe-eval'` in development only. Next's dev server compiles and
     * evaluates modules in the browser for fast refresh, so without it the dev
     * experience breaks entirely — and a policy that has to be turned off to
     * work locally is a policy that gets turned off everywhere.
     */
    "script-src": [
      "'self'",
      `'nonce-${nonce}'`,
      "'strict-dynamic'",
      ...(isDev ? ["'unsafe-eval'"] : []),
    ],

    /*
     * `style-src` keeps `'unsafe-inline'`, and this is the one real compromise
     * in the policy — recorded rather than glossed.
     *
     * Next injects inline <style> for `next/font` and for the CSS it inlines
     * during hydration, and it does not nonce all of them. Tailwind's output is
     * a stylesheet and would be fine; the framework's own injections are not.
     * The exposure is CSS injection, which is real (data exfiltration via
     * attribute selectors and background-image URLs) but requires an injection
     * point that would already be a worse problem for script-src.
     *
     * Revisit if Next's style nonce support becomes complete.
     */
    "style-src": ["'self'", "'unsafe-inline'"],

    // `data:` for the inline SVG icons; `blob:` for anything generated client
    // side. No remote image hosts — the app renders no third-party imagery.
    "img-src": ["'self'", "data:", "blob:"],

    // Self only. next/font self-hosts, which is half the reason it was chosen.
    "font-src": ["'self'"],

    "connect-src": [...connect],

    // No plugins, ever. `object-src 'none'` is the single highest-value
    // directive after script-src and has no downside here.
    "object-src": ["'none'"],

    // Stops an injected <base> re-pointing every relative URL on the page.
    "base-uri": ["'self'"],

    // A form that posts somewhere else is a credential-harvesting primitive,
    // and this app's forms are all same-origin Server Actions.
    "form-action": ["'self'"],

    // Duplicated from next.config.ts on purpose — see the note there. Static
    // assets are excluded from the middleware matcher, so that header covers
    // what this one cannot.
    "frame-ancestors": ["'none'"],

    "frame-src": ["'none'"],
  };

  const parts = Object.entries(directives).map(
    ([name, values]) => `${name} ${values.join(" ")}`,
  );

  /*
   * Only in production, and only when enforcing.
   *
   * Production, because on http://localhost this rewrites every request to
   * https and breaks local development outright.
   *
   * Enforcing, because the directive does nothing in a report-only policy —
   * and browsers say so, out loud, in the console: "'upgrade-insecure-requests'
   * is ignored when delivered in a report-only policy." Shipping it anyway
   * would print a warning on every page load for every user during exactly the
   * observation period when the console needs to be readable. Found by the
   * Playwright suite, which counted it among the violations.
   */
  if (!isDev && cspIsEnforced()) parts.push("upgrade-insecure-requests");

  parts.push("report-uri /api/csp-report");
  // `report-to` is the replacement and needs a Reporting-Endpoints header;
  // `report-uri` is deprecated and is what actually has support today. Both
  // are cheap, so both are sent — browsers use whichever they implement.
  parts.push("report-to csp-endpoint");

  return {
    nonce,
    header: cspIsEnforced()
      ? "Content-Security-Policy"
      : "Content-Security-Policy-Report-Only",
    policy: parts.join("; "),
  };
}
