import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { randomBytes } from "node:crypto";
import { isEncryptionConfigured } from "@huntloop/db";
import { isProviderConfigured, providerFor, type ProviderId } from "@huntloop/jobs";
import { currentViewer, canWrite } from "../../../../../lib/data/membership";
import {
  callbackUrl,
  isProviderId,
  providerLabel,
  stateCookieName,
  stateCookieOptions,
} from "../shared";

/**
 * Step one of connecting a mailbox: send the browser to the provider.
 *
 * ── Why every refusal happens here rather than at the callback ───────────
 *
 * Because the callback is the wrong place to discover that this deployment
 * cannot store what it is about to receive. By then the user has already read
 * a consent screen, granted access to their mail, and been redirected back —
 * and the only honest thing left to do is throw the grant away and ask them to
 * do it again. So the two conditions that make the whole flow pointless are
 * checked before the redirect:
 *
 *   · the provider has no client credentials on this deployment, and
 *   · `MAILBOX_ENCRYPTION_KEY` is unset, so the tokens could only be stored in
 *     plain text.
 *
 * The second is the one worth being strict about. A refresh token is a
 * standing grant to read and send a person's mail; storing it unencrypted
 * because a variable was missing is the kind of decision nobody makes on
 * purpose and everybody makes by default.
 *
 * ── The state parameter, and why the cookie holds everything ─────────────
 *
 * `state` carries a nonce and nothing else. Everything the callback needs to
 * act — which org, which provider, where to return the user — is in an
 * httpOnly cookie that only this deployment can write. An attacker can put any
 * value they like in a query string; they cannot put one in this cookie. So
 * the callback never trusts a URL for anything except the code it is there to
 * exchange.
 *
 * `sameSite: "lax"` rather than `"strict"`, because the callback arrives as a
 * top-level navigation from the provider's origin and `strict` would withhold
 * the cookie exactly when it is needed. Ten minutes, because a consent screen
 * left open for an hour is more likely to be abandoned than resumed.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ provider: string }> },
) {
  const { provider: raw } = await context.params;
  const { origin } = request.nextUrl;
  const org = request.nextUrl.searchParams.get("org")?.trim() ?? "";

  if (!org) return refuse(origin, "/", "That link is missing which workspace to connect to.");

  const back = `/${encodeURIComponent(org)}/outreach`;

  if (!isProviderId(raw)) {
    return refuse(origin, back, `${raw} is not a mailbox provider this product connects to.`);
  }
  const provider: ProviderId = raw;

  /* Membership first, and the same three-way answer the server actions give:
     demo mode has nothing to connect to, a non-member should never have got a
     link to this org, and the read-only role cannot change anything. */
  const viewer = await currentViewer(org);
  if (!viewer) {
    return refuse(origin, "/", "That workspace does not exist, or you are not a member of it.");
  }
  if (viewer.kind === "demo") {
    return refuse(
      origin,
      back,
      "This deployment has no database connected, so there is nowhere to store a mailbox connection.",
    );
  }
  if (!canWrite(viewer)) {
    return refuse(origin, back, "Your role is read-only, so you cannot connect a mailbox.");
  }

  if (!isProviderConfigured(provider)) {
    return refuse(
      origin,
      back,
      `This deployment has no ${providerLabel(provider)} OAuth credentials ` +
        `configured, so it cannot ask for access to a mailbox. See .env.example.`,
    );
  }

  if (!isEncryptionConfigured()) {
    return refuse(
      origin,
      back,
      "MAILBOX_ENCRYPTION_KEY is not set on this deployment, so the access tokens " +
        "could only be stored in plain text. Connecting is refused until it is.",
    );
  }

  const nonce = randomBytes(32).toString("base64url");
  const store = await cookies();
  store.set(
    stateCookieName(origin),
    JSON.stringify({ nonce, org, provider }),
    stateCookieOptions(origin),
  );

  const url = providerFor(provider).authorizeUrl(nonce, callbackUrl(origin, provider));
  return NextResponse.redirect(url);
}

/** Back where they came from, with something a person can act on. */
function refuse(origin: string, path: string, message: string) {
  const url = new URL(path, origin);
  url.searchParams.set("mailbox_error", message);
  return NextResponse.redirect(url);
}
