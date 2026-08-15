import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { createTenantClient } from "@huntloop/db";
import { safeNextPath } from "../../../lib/safe-next";

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
   * Only same-origin *paths* are honoured — see `lib/safe-next.ts` for which
   * shapes are rejected and why each clause is there.
   *
   * It was inlined here, and moved out for one reason: this is a security
   * control, it was the only implementation, and it had no test. It now has
   * both a name and a suite (`lib/__tests__/safe-next.test.ts`).
   */
  const safeNext = safeNextPath(next);

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
