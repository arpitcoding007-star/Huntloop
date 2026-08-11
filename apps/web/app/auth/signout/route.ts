import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { createTenantClient } from "@huntloop/db";

/**
 * Sign out.
 *
 * POST only. A GET sign-out can be triggered by any `<img src>` or prefetch on
 * any site, which turns logging the user out into a one-line cross-site
 * annoyance — and any state-changing action reachable by GET is a CSRF waiting
 * to happen.
 */
export async function POST(request: NextRequest) {
  const store = await cookies();
  const supabase = createTenantClient({
    getAll: () => store.getAll().map((c) => ({ name: c.name, value: c.value })),
    setAll: (all) => {
      for (const c of all) store.set(c.name, c.value, c.options);
    },
  });

  await supabase.auth.signOut();
  return NextResponse.redirect(`${request.nextUrl.origin}/login`, { status: 303 });
}
