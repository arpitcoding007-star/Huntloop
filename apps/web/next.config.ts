import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

/**
 * Response headers applied to every route.
 *
 * The full Content-Security-Policy — the one with `script-src` in it — is
 * built per request in `proxy.ts`, because it carries a nonce and a nonce
 * cannot be a static config value. See `lib/csp.ts`.
 *
 * The `frame-ancestors` line below stays here anyway, and the duplication is
 * deliberate: the proxy matcher excludes `_next/static`, `_next/image`
 * and image files, so those responses never see the per-request policy. They
 * are also the responses least likely to matter for clickjacking — but a
 * security header with a hole in it should have the hole documented rather
 * than discovered.
 *
 * The rest is the set that is unambiguous and cannot break a working page:
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

  /**
   * Tree-shake the Sentry features this app does not use.
   *
   * Replay is not "off pending configuration": a replay of the opportunity
   * page records a named prospect's research, and one of the analyze screen
   * records what a customer is prospecting. Enabling it would need a masking
   * policy and a conversation with customers, so its implementation should not
   * be in the bundle meanwhile.
   *
   * ── What replaced what, and what it is actually worth ──────────────────
   *
   * This was a `webpack()` block pushing a `DefinePlugin` that set
   * `__SENTRY_TRACING__` and `__RRWEB_EXCLUDE_REPLAY__`. Next 16 builds with
   * Turbopack, which never calls `webpack()` — so that block became dead code
   * that still read as live. `bundleSizeOptimizations` is the SDK's
   * bundler-agnostic equivalent and also replaces the deprecated
   * `disableLogger`.
   *
   * **Measured on upgrade, and the honest answer is that it changes nothing
   * today.** Two clean builds, `.next` deleted between them, with and without
   * this block: 1013.9 kB of client chunks either way, and zero occurrences of
   * `rrweb`, `replayIntegration` or `ReplayContainer` in both. The reason is
   * `instrumentation-client.ts` — it never adds the Replay or BrowserTracing
   * integrations, so on SDK v10 that code is not in the module graph at all
   * and there is nothing left for a flag to strip. The 49 kB the audit
   * recorded was real when it was measured, against an older SDK.
   *
   * Kept anyway, because it costs nothing and the condition it depends on is
   * one line in another file: the day someone adds `Sentry.replayIntegration()`
   * to that init, this is what stops the implementation shipping to every
   * visitor. Recorded here so nobody re-derives the measurement.
   */
  bundleSizeOptimizations: {
    excludeDebugStatements: true,
    excludeTracing: true,
    excludeReplayShadowDom: true,
    excludeReplayIframe: true,
    excludeReplayWorker: true,
  },

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
