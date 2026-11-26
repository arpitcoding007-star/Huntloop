import type { NextRequest } from "next/server";
import { disableDigest, verifyDigestUnsubscribeToken } from "@huntloop/jobs";
import { unsubscribePage as page, unsubscribeToken as tokenFrom } from "../../../../lib/unsubscribe-page";

/**
 * Turning the daily digest off from the email itself.
 *
 * POST does it — that is both RFC 8058's one-click (`List-Unsubscribe-Post`,
 * sent by the mail client) and the button on the page below. GET only shows
 * the page: link scanners and prefetchers follow GET links, and a digest that
 * silently turned itself off because a security product scanned the email
 * would be a worse bug than one extra click.
 *
 * The token is the authority (see `digest-token.ts`), so no session is needed,
 * and all it can ever do is turn one person's digest off.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const token = tokenFrom(request);
  if (!verifyDigestUnsubscribeToken(token)) {
    return page("That link isn't valid", "Turn the daily email off from Settings in your workspace instead.");
  }
  const action = `/api/notifications/unsubscribe?token=${encodeURIComponent(token)}`;
  return page(
    "Stop the daily email?",
    "You will no longer get the daily “Needs you” summary for this workspace. You can turn it back on in Settings.",
    `<form method="post" action="${action}"><button type="submit">Stop the daily email</button></form>`,
  );
}

export async function POST(request: NextRequest) {
  const ids = verifyDigestUnsubscribeToken(tokenFrom(request));
  if (!ids) {
    return page("That link isn't valid", "Turn the daily email off from Settings in your workspace instead.");
  }
  const done = await disableDigest(ids.orgId, ids.userId);
  return done
    ? page("Done", "You won't get the daily summary for this workspace any more. You can turn it back on in Settings.")
    : page("That didn't work", "Please try again, or turn the daily email off from Settings.");
}
