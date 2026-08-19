import { NextResponse, type NextRequest } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { buildCsp, createNonce } from "./lib/csp";

/**
 * Session refresh, route guard, and the per-request CSP nonce.
 *
 * ── The file name ────────────────────────────────────────────────────────
 *
 * This was `middleware.ts` until the Next 16 upgrade, which deprecated that
 * convention in favour of `proxy.ts` and warns on every build until you move.
 * Renamed by hand rather than by codemod, because the codemod also rewrites
 * the comments and this file's comments are the reason it is readable. The
 * matcher config and the semantics are unchanged; only the file name and the
 * exported function name are different.
 *
 * Three jobs, in this order:
 *
 *   1. Refresh the Supabase session. Server Components cannot set cookies, so
 *      if this doesn't do it, tokens expire mid-session and the user is
 *      silently logged out on a page navigation.
 *   2. Bounce anonymous visitors off `/[org]/*`.
 *   3. Mint a CSP nonce and put it on both the request and the response. It
 *      has to be here because it must be per-request, and this is the only
 *      place that runs before the document is rendered. See lib/csp.ts.
 *
 * The guard here is a *convenience*, not the security boundary. The boundary
 * is Row Level Security in Postgres (plan D2) — middleware can be bypassed by
 * a bug, a matcher mistake, or a direct API call, and RLS cannot. Anything
 * that relies on this file alone to keep tenants apart is wrong.
 *
 * When Supabase is unconfigured the app runs on fixtures, and this passes
 * everything through — otherwise the demo mode would be unreachable.
 */

/**
 * Route groups are a Next.js folder convention, not URL segments.
 *
 * `/api/csp-report` is public of necessity: a browser sends a violation report
 * on its own initiative, often for a visitor who has no session and sometimes
 * for a page that failed before any session could be read. Behind the guard it
 * would be answered with a 307 to /login, and the report stream — the entire
 * point of shipping the policy report-only first — would be silently empty.
 * The endpoint is written for that exposure; see the route file.
 *
 * Listed as the exact path rather than `/api`, so a future authenticated API
 * route does not inherit this by accident.
 */
const PUBLIC_PREFIXES = [
  "/login",
  "/signup",
  "/auth",
  "/kitchen-sink",
  "/api/csp-report",
  /* Both halves of unsubscribe. The person following that link is a prospect
     with no account, and requiring one in order to stop being emailed is not
     something this product may do. RFC 8058 aside, a redirect to /login is a
     dead unsubscribe, and a dead unsubscribe is a spam report. */
  "/unsubscribe",
  "/api/unsubscribe",
];

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

/**
 * Per-request CSP plumbing.
 *
 * The nonce goes on the **request** headers as well as the response, because
 * that is how Next learns it: it reads the incoming
 * `Content-Security-Policy` header, finds the nonce, and stamps it onto the
 * inline bootstrap scripts it injects. Setting it only on the response would
 * produce a policy that blocks the framework's own scripts — which is exactly
 * the silent half-broken page that made SEC-03 a task of its own.
 *
 * Applied to every branch below, including the demo-mode early returns. A
 * security header that is present only on the fully-configured path is a
 * header that is absent from every preview deployment.
 */
function withCsp(request: NextRequest, nonce: string) {
  const headers = new Headers(request.headers);
  headers.set("x-nonce", nonce);

  const { header, policy } = buildCsp(nonce);
  // Next looks for the enforcing name specifically when deciding whether to
  // nonce its scripts, so it is always set on the *request* — the response is
  // where report-only versus enforcing is decided.
  headers.set("Content-Security-Policy", policy);

  return { requestHeaders: headers, responseHeader: header, policy };
}

/** Copies the policy onto whatever response the guard produced. */
function sealCsp<T extends NextResponse>(
  response: T,
  responseHeader: string,
  policy: string,
): T {
  response.headers.set(responseHeader, policy);
  response.headers.set(
    "Reporting-Endpoints",
    'csp-endpoint="/api/csp-report"',
  );
  return response;
}

export async function proxy(request: NextRequest) {
  const nonce = createNonce();
  const { requestHeaders, responseHeader, policy } = withCsp(request, nonce);
  const pass = () =>
    sealCsp(
      NextResponse.next({ request: { headers: requestHeaders } }),
      responseHeader,
      policy,
    );

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Not configured → demo mode. Guarding here would lock everyone out of an
  // app that has no way to log in yet.
  if (!url || !key) return pass();

  // Configured but not migrated → also demo mode. See isSchemaApplied.
  if (!(await isSchemaApplied(url, key))) return pass();

  let response = NextResponse.next({ request: { headers: requestHeaders } });

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (all: { name: string; value: string; options?: CookieOptions }[]) => {
        for (const { name, value } of all) request.cookies.set(name, value);
        // Rebuilt with the same request headers: dropping them here would
        // lose the nonce for exactly the requests that refresh a session,
        // which is most of them.
        response = NextResponse.next({ request: { headers: requestHeaders } });
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
    // `lib/safe-next.ts` is the other half, where the value is consumed.
    login.searchParams.set("next", path);
    return sealCsp(NextResponse.redirect(login), responseHeader, policy);
  }

  return sealCsp(response, responseHeader, policy);
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
