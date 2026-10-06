import { NextResponse, type NextRequest } from "next/server";
import { disableDigest, verifyDigestUnsubscribeToken } from "@huntloop/jobs";

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

function page(title: string, body: string, form?: string): NextResponse {
  const html =
    `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<meta name="robots" content="noindex"><title>${title}</title>` +
    `<style>body{font:16px/1.6 system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 1rem;color:#1f2937;background:#F7F8FA}` +
    `button{font:inherit;background:#1F58F0;color:#fff;border:0;border-radius:6px;padding:.55rem 1rem;cursor:pointer}` +
    `@media(prefers-color-scheme:dark){body{background:#111111;color:#ECECEA}}</style></head>` +
    `<body><h1>${title}</h1><p>${body}</p>${form ?? ""}</body></html>`;
  return new NextResponse(html, {
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}

function tokenFrom(request: NextRequest): string {
  return request.nextUrl.searchParams.get("token")?.slice(0, 300) ?? "";
}

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
