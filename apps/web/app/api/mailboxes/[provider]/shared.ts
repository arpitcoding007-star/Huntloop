import type { ProviderId } from "@huntloop/jobs";

/**
 * The name of the one-flow cookie, shared by the two halves of the dance.
 *
 * `__Host-` where the origin allows it, which is deliberately keyed to the
 * origin rather than to `NODE_ENV`. Browsers refuse that prefix unless the
 * cookie is `Secure`, carries no `Domain`, and is scoped to `Path=/` — which
 * turns "no subdomain of ours can forge this" into a rule the browser enforces
 * rather than a set of attributes we remembered to pass. Over plain http the
 * prefix is not allowed at all, so a local development server, where
 * `NODE_ENV` may well be `production` behind a build, gets the plain name and
 * still works.
 */
export function stateCookieName(origin: string): string {
  return origin.startsWith("https://") ? "__Host-hl_mailbox_oauth" : "hl_mailbox_oauth";
}

/**
 * The attributes that go with it.
 *
 * `Path=/` because `__Host-` requires it — a narrower path would be a better
 * fit for a cookie only two routes read, and it is not available with the
 * prefix. `sameSite: "lax"` because the callback arrives as a top-level
 * navigation from the provider's origin, and `strict` would withhold the
 * cookie at exactly the moment it is needed. Ten minutes, because a consent
 * screen left open for an hour is more likely to have been abandoned than
 * resumed.
 */
export function stateCookieOptions(origin: string) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: origin.startsWith("https://"),
    path: "/",
    maxAge: 600,
  };
}

export function isProviderId(value: string): value is ProviderId {
  return value === "gmail" || value === "outlook";
}

/** What the provider is called on its own consent screen. */
export function providerLabel(provider: ProviderId): string {
  return provider === "gmail" ? "Google" : "Microsoft";
}

/**
 * The redirect URI, built identically in both halves.
 *
 * OAuth compares this string exactly: the authorize call and the token
 * exchange must send the same one, and it must match what is registered with
 * the provider. Deriving it in one function is what keeps a trailing slash
 * from becoming a `redirect_uri_mismatch` that reads like a credentials
 * problem and is not one.
 */
export function callbackUrl(origin: string, provider: ProviderId): string {
  return new URL(`/api/mailboxes/${provider}/callback`, origin).toString();
}
