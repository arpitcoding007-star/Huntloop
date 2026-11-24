import { NextResponse, type NextRequest } from "next/server";
import { disableExchangeEmails, verifyExchangeUnsubscribeToken } from "@huntloop/jobs";

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
