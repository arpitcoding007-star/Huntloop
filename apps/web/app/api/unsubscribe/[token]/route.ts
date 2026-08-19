import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "../../../../lib/data/org";
import { uuidSchema } from "../../../../lib/validation";

/**
 * RFC 8058 one-click unsubscribe — the address in `List-Unsubscribe`.
 *
 * ── Why this endpoint has to exist ───────────────────────────────────────
 *
 * Every message this product sends already carries `List-Unsubscribe` and
 * `List-Unsubscribe-Post: List-Unsubscribe=One-Click`, and a footer line
 * offering the same. Until now they pointed at nothing: the route was never
 * built, so every recipient who pressed unsubscribe got a 404.
 *
 * That is the worst version of this bug rather than a cosmetic one. Gmail and
 * Yahoo require working one-click unsubscribe from bulk senders, and
 * `provider.ts` already says what a dead link costs — it converts somebody who
 * wanted to leave quietly into somebody pressing "report spam", which is
 * charged to the sending domain and to every other campaign running from it.
 *
 * ── Why POST acts and GET does not ───────────────────────────────────────
 *
 * The one-click POST comes from the mail client, not from a person: Gmail
 * shows its own Unsubscribe button and sends `List-Unsubscribe=One-Click` when
 * it is pressed. That is an explicit action and is honoured immediately.
 *
 * A GET is not. Mail clients and security scanners prefetch links in messages,
 * and a GET that unsubscribed would quietly remove people who never clicked
 * anything — a mutation on a safe method, punished by exactly the software
 * that is trying to protect the recipient. So GET redirects to a page with a
 * button, and the button posts.
 *
 * ── Why it needs no session ──────────────────────────────────────────────
 *
 * The person clicking is a prospect, not a user, and must not need an account
 * to stop being emailed. `record_unsubscribe` in `0008` is `SECURITY DEFINER`
 * for that reason and takes only the token: with it, it can suppress that one
 * address and record why, and nothing else.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ token: string }> },
) {
  const { token } = await context.params;
  const parsed = uuidSchema.safeParse(token);
  if (!parsed.success) {
    return new NextResponse("That unsubscribe link is not valid.", { status: 400 });
  }

  const db = await getDb();
  if (!db) {
    /* No database, so nothing can be suppressed. 503 rather than 200: a mail
       client that reads success here would show the recipient "unsubscribed"
       for something that did not happen, and they would find out by receiving
       the next message. */
    return new NextResponse(
      "This deployment has no database connected, so the request could not be recorded.",
      { status: 503 },
    );
  }

  const { error } = await db.rpc("record_unsubscribe", {
    p_token: parsed.data,
    p_reason: "One-click unsubscribe from the email client",
  });

  if (error) {
    /* The function raises when the token matches no message. Answering 404
       rather than 500 keeps a scanner probing tokens from learning the
       difference between "wrong token" and "broken server". */
    return new NextResponse("That unsubscribe link is not valid.", { status: 404 });
  }

  return new NextResponse("You have been unsubscribed and will not be emailed again.", {
    status: 200,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });
}

/**
 * A person following the header link in a client that does not one-click.
 *
 * Sent to the confirmation page rather than actioned, for the prefetch reason
 * above. 303 so the browser issues a GET for the destination.
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ token: string }> },
) {
  const { token } = await context.params;
  return NextResponse.redirect(new URL(`/unsubscribe/${token}`, request.nextUrl.origin), 303);
}
