import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { timingSafeEqual } from "node:crypto";
import { revalidatePath } from "next/cache";
import { encryptSecret } from "@huntloop/db";
import { providerFor, type ProviderId } from "@huntloop/jobs";
import { currentViewer, canWrite } from "../../../../../lib/data/membership";
import { getDb } from "../../../../../lib/data/source";
import {
  callbackUrl,
  isProviderId,
  providerLabel,
  stateCookieName,
  stateCookieOptions,
} from "../shared";

/**
 * Step two: the provider sends the browser back with a code.
 *
 * ── Nothing in this URL is trusted except the code ───────────────────────
 *
 * Which org this mailbox belongs to, and which provider issued the grant, come
 * from the httpOnly cookie set before the redirect — not from the query string
 * and not from the path segment. The path segment is still *checked* against
 * the cookie, because a mismatch means the flow was tampered with and the
 * right response to that is to stop rather than to guess which one is real.
 *
 * The `state` nonce is compared in constant time. It is short-lived and
 * unguessable, so a timing attack against it is close to theoretical; the
 * comparison is four lines and the alternative argument is the sort that stops
 * being true when somebody changes how state is generated.
 *
 * ── Why the membership check runs again ──────────────────────────────────
 *
 * The cookie proves this browser started the flow. It does not prove the
 * session is still the same one, still signed in, or still a member of that
 * org — a grant can arrive minutes later, after a sign-out or a role change.
 * RLS would refuse the insert anyway; checking here is what turns that into a
 * sentence rather than a Postgres policy error.
 *
 * ── One row per address, deliberately ────────────────────────────────────
 *
 * `mailboxes` is unique on `(org_id, email)`, so reconnecting an address
 * updates the existing row rather than creating a second one — which matters
 * because the enrollments, threads and messages already pointing at that row
 * are the history of everything sent from it. A "reconnect" that orphaned them
 * would look like a working button and lose a campaign's conversation.
 *
 * Google omits the refresh token on a re-consent that reuses an existing
 * grant, so a null one leaves the stored token alone instead of overwriting a
 * working credential with nothing.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ provider: string }> },
) {
  const { provider: fromPath } = await context.params;
  const { origin, searchParams } = request.nextUrl;

  const store = await cookies();
  const cookieName = stateCookieName(origin);
  const raw = store.get(cookieName)?.value;

  /* Cleared on every path out of here, success or failure. A state cookie that
     outlives its flow is a replayable one. */
  const clear = () => store.set(cookieName, "", { ...stateCookieOptions(origin), maxAge: 0 });

  const flow = parseFlow(raw);
  if (!flow) {
    clear();
    return refuse(
      origin,
      "/",
      "That mailbox connection could not be matched to a request from this browser. " +
        "It may have taken too long — start it again from Outreach.",
    );
  }

  const back = `/${encodeURIComponent(flow.org)}/outreach`;

  if (!isProviderId(fromPath) || fromPath !== flow.provider) {
    clear();
    return refuse(origin, back, "That mailbox connection came back for a different provider than it started with.");
  }
  const provider: ProviderId = flow.provider;

  const presented = searchParams.get("state") ?? "";
  if (!sameSecret(presented, flow.nonce)) {
    clear();
    return refuse(origin, back, "That mailbox connection could not be verified, so nothing was saved.");
  }

  /* The user declining is a normal outcome, not an error worth a stack trace.
     Providers send `error=access_denied`. */
  const declined = searchParams.get("error");
  if (declined) {
    clear();
    return refuse(
      origin,
      back,
      declined === "access_denied"
        ? `Access was not granted, so no mailbox was connected.`
        : `${providerLabel(provider)} refused the connection: ${declined}.`,
    );
  }

  const code = searchParams.get("code");
  if (!code) {
    clear();
    return refuse(origin, back, "That mailbox connection came back without an authorisation code.");
  }

  const viewer = await currentViewer(flow.org);
  const db = await getDb();
  if (!viewer || viewer.kind !== "member" || !canWrite(viewer) || !db) {
    clear();
    return refuse(origin, back, "You are no longer signed in as someone who can connect a mailbox here.");
  }

  let tokens;
  try {
    tokens = await providerFor(provider).exchangeCode(code, callbackUrl(origin, provider));
  } catch (e) {
    clear();
    return refuse(
      origin,
      back,
      `${providerLabel(provider)} would not exchange that authorisation: ` +
        `${e instanceof Error ? e.message : "the exchange failed"}.`,
    );
  }

  /* Encrypted before it is anywhere near the query. `encryptSecret` throws
     when the key is missing, which the start route already refused on — this
     catch is for the case where the variable was removed mid-flow, and it
     fails closed rather than storing a plain token. */
  let row: Record<string, unknown>;
  try {
    row = {
      org_id: viewer.orgId,
      provider,
      email: tokens.email,
      oauth_token_enc: encryptSecret(tokens.accessToken),
      token_expires_at: tokens.expiresAt.toISOString(),
      status: "connected",
      last_error: null,
      ...(tokens.refreshToken
        ? { refresh_token_enc: encryptSecret(tokens.refreshToken) }
        : {}),
    };
  } catch (e) {
    clear();
    return refuse(origin, back, e instanceof Error ? e.message : "Those tokens could not be encrypted.");
  }

  const { error } = await db
    .from("mailboxes")
    .upsert(row, { onConflict: "org_id,email" });

  clear();

  if (error) {
    return refuse(origin, back, `That mailbox could not be saved: ${error.message}`);
  }

  revalidatePath(back);

  const url = new URL(back, origin);
  url.searchParams.set("mailbox_connected", tokens.email);
  return NextResponse.redirect(url);
}

interface Flow {
  nonce: string;
  org: string;
  provider: ProviderId;
}

function parseFlow(raw: string | undefined): Flow | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const { nonce, org, provider } = parsed as Record<string, unknown>;
    if (typeof nonce !== "string" || !nonce) return null;
    if (typeof org !== "string" || !org) return null;
    if (typeof provider !== "string" || !isProviderId(provider)) return null;
    return { nonce, org, provider };
  } catch {
    return null;
  }
}

function sameSecret(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

function refuse(origin: string, path: string, message: string) {
  const url = new URL(path, origin);
  url.searchParams.set("mailbox_error", message);
  return NextResponse.redirect(url);
}
