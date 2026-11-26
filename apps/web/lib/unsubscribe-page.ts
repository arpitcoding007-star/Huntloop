import { NextResponse, type NextRequest } from "next/server";

/**
 * The page behind an unsubscribe link, shared by the daily digest and the
 * Exchange emails. Every string is the caller's own copy, never request input.
 */
export function unsubscribePage(title: string, body: string, form?: string): NextResponse {
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

export function unsubscribeToken(request: NextRequest): string {
  return request.nextUrl.searchParams.get("token")?.slice(0, 300) ?? "";
}
