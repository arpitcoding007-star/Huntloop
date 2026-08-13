import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

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

  /**
   * Tree-shake the Sentry features this app does not use.
   *
   * The SDK ships tracing and Session Replay in the client bundle and gates
   * them on these flags at build time. Setting sampleRate to 0 in
   * `instrumentation-client.ts` disables the *behaviour* but does not remove
   * the *code* — the first measured build after adding Sentry took shared
   * First Load JS from 103 kB to 185 kB, which is a large regression to
   * accept for features deliberately switched off.
   *
   * Replay in particular is not "off pending configuration": a replay of the
   * opportunity page records a named prospect's research, so it needs a
   * masking policy and a customer conversation before it could ever be
   * enabled. Shipping its implementation to every visitor meanwhile is pure
   * cost.
   */
  webpack(config, { webpack }) {
    config.plugins.push(
      new webpack.DefinePlugin({
        __SENTRY_DEBUG__: false,
        __SENTRY_TRACING__: false,
        __RRWEB_EXCLUDE_REPLAY__: true,
      }),
    );
    return config;
  },
};

/**
 * Source maps are uploaded only when there is a token to upload them with.
 *
 * Without this guard the plugin warns on every build that has no
 * `SENTRY_AUTH_TOKEN` — which is every local build and every CI build, since
 * CI deliberately builds with empty credentials to prove nothing reads them.
 * A warning that fires on every correct build is noise that hides the one that
 * matters.
 */
const uploadsSourceMaps = Boolean(
  process.env.SENTRY_AUTH_TOKEN && process.env.SENTRY_ORG && process.env.SENTRY_PROJECT,
);

export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,

  // Quiet locally, verbose in CI where the output is the only record.
  silent: !process.env.CI,

  sourcemaps: { disable: !uploadsSourceMaps },

  // Strips the SDK's own debug logging from the production bundle.
  disableLogger: true,

  /*
   * Deliberately NOT setting `tunnelRoute`.
   *
   * It proxies events through the app's own domain to get past ad blockers,
   * at the cost of a route that accepts arbitrary payloads and forwards them
   * to a third party — an open relay with our origin on it. Not worth adding
   * to close a reporting gap that mostly affects developers, who are the
   * people most likely to be blocking it on purpose.
   */
});
