import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { createTenantClient } from "@huntloop/db";
import { safeNextPath } from "../../../lib/safe-next";

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

  /* An optional same-origin path to sign back in to — the invite page uses it
     so somebody signed in as the wrong address lands back on the invitation
     (M-16). Validated like every other `next`. */
  const form = await request.formData().catch(() => null);
  const raw = form?.get("next");
  const next = safeNextPath(typeof raw === "string" ? raw : null);
  // An invitee usually has no account yet; /signup signs in either way.
  const login = new URL(next.startsWith("/invite/") ? "/signup" : "/login", request.nextUrl.origin);
  if (next !== "/") login.searchParams.set("next", next);
  return NextResponse.redirect(login, { status: 303 });
}
