import { NextResponse, type NextRequest } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";

/**
 * Session refresh and route guard.
 *
 * Two jobs, in this order:
 *
 *   1. Refresh the Supabase session. Server Components cannot set cookies, so
 *      if middleware doesn't do this, tokens expire mid-session and the user
 *      is silently logged out on a page navigation.
 *   2. Bounce anonymous visitors off `/[org]/*`.
 *
 * The guard here is a *convenience*, not the security boundary. The boundary
 * is Row Level Security in Postgres (plan D2) — middleware can be bypassed by
 * a bug, a matcher mistake, or a direct API call, and RLS cannot. Anything
 * that relies on this file alone to keep tenants apart is wrong.
 *
 * When Supabase is unconfigured the app runs on fixtures, and this passes
 * everything through — otherwise the demo mode would be unreachable.
 */

/** Route groups are a Next.js folder convention, not URL segments. */
const PUBLIC_PREFIXES = ["/login", "/signup", "/auth", "/kitchen-sink"];

/**
 * Cached answer to "have the migrations been applied?".
 *
 * The guard exists to protect real tenant data. Before the schema is applied
 * there is no tenant data — every screen is fixtures — so demanding a login to
 * view a demo is friction with nothing behind it. Once the tables exist the
 * guard turns itself on.
 *
 * Cached per worker because the answer changes exactly once. A deploy or
 * restart re-probes, which is part of running a migration anyway.
 */
let schemaApplied: boolean | null = null;

async function isSchemaApplied(url: string, key: string): Promise<boolean> {
  if (schemaApplied !== null) return schemaApplied;
  try {
    const res = await fetch(`${url}/rest/v1/organizations?select=id&limit=1`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      cache: "no-store",
    });
    // 404 with PGRST205 means the table isn't in PostgREST's schema cache.
    // 401/403 mean the table exists and RLS is doing its job — which is a
    // *yes*, not a no.
    schemaApplied = res.status !== 404;
  } catch {
    // Network trouble is not evidence of a missing schema. Fail closed: keep
    // the guard on rather than opening the app because a probe timed out.
    return true;
  }
  return schemaApplied;
}

export async function middleware(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Not configured → demo mode. Guarding here would lock everyone out of an
  // app that has no way to log in yet.
  if (!url || !key) return NextResponse.next();

  // Configured but not migrated → also demo mode. See isSchemaApplied.
  if (!(await isSchemaApplied(url, key))) return NextResponse.next();

  let response = NextResponse.next({ request });

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (all: { name: string; value: string; options?: CookieOptions }[]) => {
        for (const { name, value } of all) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of all) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // getUser(), not getSession(): getSession reads the cookie without verifying
  // it against the auth server, so a forged cookie would satisfy it. This is
  // the one call in the file that must not be "optimised" into the cheaper one.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isPublic = PUBLIC_PREFIXES.some(
    (p) => path === p || path.startsWith(`${p}/`),
  );

  if (!user && !isPublic && path !== "/") {
    const login = request.nextUrl.clone();
    login.pathname = "/login";
    // Send them back where they were headed after signing in — but only the
    // path, never the full URL, so this cannot be turned into an open redirect.
    login.searchParams.set("next", path);
    return NextResponse.redirect(login);
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Everything except static assets and image files. Written as an exclusion
     * because the alternative — listing protected routes — fails open: a new
     * route added later would be unguarded by default, and nobody would notice
     * until it mattered.
     *
     * `robots.txt` and `sitemap.xml` are excluded explicitly. They are routes
     * (app/robots.ts, app/sitemap.ts), not files, so without this they fall
     * through to the guard below and a crawler is answered with a 307 to
     * /login — which makes a robots policy that nothing can read. They are
     * safe to exclude because neither is generated from a session: see the
     * files themselves, which list only public paths.
     */
    "/((?!_next/static|_next/image|favicon.ico|robots\\.txt|sitemap\\.xml|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
