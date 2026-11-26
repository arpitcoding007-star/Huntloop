import type { NextRequest } from "next/server";
import { disableExchangeEmails, verifyExchangeUnsubscribeToken } from "@huntloop/jobs";
import { unsubscribePage as page, unsubscribeToken as tokenFrom } from "../../../../lib/unsubscribe-page";

/**
 * Turning Exchange emails off from the email itself (build plan DN-81). The
 * same shape as the digest route beside it, with its own token, so neither
 * link can switch off the other.
 *
 * POST does it — that is both RFC 8058's one-click (`List-Unsubscribe-Post`,
 * sent by the mail client) and the button on the page below. GET only shows
 * the page: link scanners and prefetchers follow GET links, and a digest that
 * silently turned itself off because a security product scanned the email
 * would be a worse bug than one extra click.
 *
 * The token is the authority (see `exchange-token.ts`), so no session is needed,
 * and all it can ever do is turn one person's Exchange emails off.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const token = tokenFrom(request);
  if (!verifyExchangeUnsubscribeToken(token)) {
    return page("That link isn't valid", "Turn Exchange emails off from Exchange → Notifications in your workspace instead.");
  }
  const action = `/api/notifications/exchange-unsubscribe?token=${encodeURIComponent(token)}`;
  return page(
    "Stop Exchange emails?",
    "You will no longer get Exchange alerts, introduction or message emails for this workspace. Everything still appears in the app, and you can turn emails back on under Exchange → Notifications.",
    `<form method="post" action="${action}"><button type="submit">Stop Exchange emails</button></form>`,
  );
}

export async function POST(request: NextRequest) {
  const ids = verifyExchangeUnsubscribeToken(tokenFrom(request));
  if (!ids) {
    return page("That link isn't valid", "Turn Exchange emails off from Exchange → Notifications in your workspace instead.");
  }
  const done = await disableExchangeEmails(ids.orgId, ids.userId);
  return done
    ? page("Done", "You won't get Exchange emails for this workspace any more. Updates still appear in the app.")
    : page("That didn't work", "Please try again, or turn Exchange emails off under Exchange → Notifications.");
}
