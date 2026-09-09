import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { createTenantClient } from "@huntloop/db";
import { safeNextPath } from "../../../lib/safe-next";
import { resolveDestination } from "../../../lib/data/destination";

/**
 * Where the magic link and the OAuth redirect land.
 *
 * Exchanges the one-time code for a session, sets the cookies, then forwards
 * the user on.
 *
 * ── The forwarding used to be the bug ────────────────────────────────────
 *
 * `NAV-01`. This route forwarded to `safeNextPath(next)`, which returns `"/"`
 * when there is no `next` — and `app/page.tsx` redirected `"/"` to `/login`.
 * So the last step of a successful sign-up was a redirect back to the sign-in
 * page. Nothing was broken in the session handling; the destination simply did
 * not exist, because no code anywhere answered "which organisation does this
 * person belong to".
 *
 * An explicit `next` still wins — it is how an invitation link survives a
 * round trip through email, and how a deep link a user bookmarked comes back
 * to them. It is only the *absent* case that now resolves properly instead of
 * bouncing.
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

  /*
   * An explicit destination is honoured as-is. `safeNextPath` returns "/" for
   * both "no next was given" and "the next given was unsafe", and those must
   * not be told apart here — treating a rejected path as a request to resolve
   * is how an open-redirect attempt turns into a successful login somewhere
   * unexpected. Both fall through to the resolver, which only ever returns
   * paths this app owns.
   */
  if (safeNext !== "/") {
    return NextResponse.redirect(`${origin}${safeNext}`);
  }

  const destination = await resolveDestination();
  return NextResponse.redirect(`${origin}${destination.path}`);
}
