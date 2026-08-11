import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { createTenantClient } from "@huntloop/db";

/**
 * Where the magic link and the OAuth redirect land.
 *
 * Exchanges the one-time code for a session, sets the cookies, then forwards
 * the user on.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const next = searchParams.get("next");

  /**
   * Only same-origin *paths* are honoured.
   *
   * `next` arrives from a URL the user clicked, which means an attacker can
   * set it. Without this check, `?next=https://evil.example` turns the sign-in
   * flow into an open redirect on a trusted domain — the classic way a
   * phishing link gets a legitimate-looking hop. A leading `//` is rejected
   * too, because browsers read `//evil.example` as protocol-relative and it is
   * a path only by appearance.
   */
  const safeNext =
    next && next.startsWith("/") && !next.startsWith("//") ? next : "/";

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=missing_code`);
  }

  const store = await cookies();
  const supabase = createTenantClient({
    getAll: () => store.getAll().map((c) => ({ name: c.name, value: c.value })),
    setAll: (all) => {
      for (const c of all) store.set(c.name, c.value, c.options);
    },
  });

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    // No detail in the URL: the reason a code failed is not something to hand
    // to whoever loaded the page.
    return NextResponse.redirect(`${origin}/login?error=invalid_link`);
  }

  return NextResponse.redirect(`${origin}${safeNext}`);
}
