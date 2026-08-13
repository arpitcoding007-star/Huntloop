import type { NextConfig } from "next";

/**
 * Response headers applied to every route.
 *
 * Deliberately *not* including a Content-Security-Policy. A useful CSP for
 * this app needs a per-request nonce (Next injects inline bootstrap scripts,
 * and `unsafe-inline` in a script-src is a CSP that certifies nothing), which
 * means generating it in middleware and threading it through — a real change
 * with a real chance of breaking the app silently in production. It is in the
 * backlog as its own task rather than half-done here. See the audit's security
 * section.
 *
 * What is here is the set that is unambiguous and cannot break a working page:
 *
 *   HSTS                      Browsers remember to use TLS. `preload` is
 *                             omitted on purpose — submitting to the preload
 *                             list is close to irreversible and is a decision
 *                             for whoever owns the apex domain, not a default.
 *   X-Content-Type-Options    Stops MIME sniffing turning an uploaded file
 *                             into an executable script.
 *   X-Frame-Options / frame-ancestors
 *                             Clickjacking. The app has approve/send actions
 *                             behind single clicks, which is exactly the shape
 *                             of thing framing attacks target.
 *   Referrer-Policy           Org slugs and opportunity ids are in the path.
 *                             Full-URL referers would leak them to every
 *                             external link a user follows off an opportunity
 *                             page — and those links point at prospect
 *                             websites, i.e. third parties.
 *   Permissions-Policy        Nothing here needs camera, microphone or
 *                             geolocation. Denying up front means a future
 *                             dependency cannot quietly start asking.
 */
const securityHeaders = [
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains",
  },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // @huntloop/ui ships TypeScript source, not a build artifact.
  transpilePackages: ["@huntloop/ui"],

  // The version header names the framework and its major version to anyone who
  // asks. It buys nothing and shortens the list of exploits worth trying.
  poweredByHeader: false,

  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
