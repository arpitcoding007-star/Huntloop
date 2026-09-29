import { NextResponse, type NextRequest } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { buildCsp, createNonce } from "./lib/csp";
import { isProtectedRoute } from "./lib/protected-routes";
import {
  isProductionDeployment,
  probeSchema,
  supabaseEnv,
  type SchemaState,
} from "./lib/schema";

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
 * everything through — otherwise the demo mode would be unreachable. The
 * exception is the production deployment, which answers 503 instead of
 * showing fixtures at the real domain (see SERVED_WHILE_NOT_READY).
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
  /* The top of the funnel. A visitor who has typed their domain into the
     landing page has not signed in yet by construction — bouncing them to
     /login here would put the sign-up wall back in front of the value, which
     is precisely what the domain-first funnel exists to move. */
  "/discover",
  /* The use-case pages. Marketing content, submitted in the sitemap, and
     therefore reached by people and crawlers with no session — a guard here
     would answer every one of them with a 307 to /login and make the pages
     invisible to exactly the audience they were written for. */
  "/for",
  "/compare",
  /* The legal pages. Every outreach footer, the sign-up form and the
     landing page link to them, and the people following those links are by
     definition not signed in: a privacy policy behind a login is, for them,
     no privacy policy at all. They were missing from this list, so on a
     migrated deployment all three answered a 307 to /login. */
  "/privacy",
  "/terms",
  "/acceptable-use",
  /* Generated images, which have no file extension and so are not excluded
     by the matcher below. Scrapers fetching the Open Graph card are never
     signed in; before this, every shared link previewed as a login redirect. */
  "/opengraph-image",
  "/apple-icon",
  /* Machine callers that authenticate themselves. The job tick is called by a
     scheduler with `Authorization: Bearer $CRON_SECRET` and the Inngest route
     checks an HMAC signature — neither carries a session, so behind the guard
     both were answered with a 307 to /login and the engine never ran, on
     every configured deployment, whatever the scheduler was. Each route
     refuses unauthenticated callers itself (404 / 401), which is where that
     check belongs. */
  "/api/jobs/tick",
  "/api/inngest",
  /* Booleans about configuration, never values. See the route. */
  "/api/health",
];

/**
 * What a *production* deployment may serve while its database is not ready.
 *
 * Everything else answers 503. Before this, production with no Supabase
 * variables — or with a half-migrated schema — ran the demo: fixture
 * companies, a fake workspace, no login, at the real domain. A visitor could
 * not tell it from the product, and a customer who had signed up the day
 * before would find their data "gone". Previews and local builds keep the
 * demo; production says it is unavailable, which is true.
 *
 * `/` stays up because the landing page is static and renders without a
 * database. The machine routes stay up so a health check and the scheduler
 * report the real failure instead of a maintenance page.
 */
const SERVED_WHILE_NOT_READY = [
  "/privacy",
  "/terms",
  "/acceptable-use",
  "/for",
  "/compare",
  "/opengraph-image",
  "/apple-icon",
  "/api/csp-report",
  "/api/health",
  "/api/jobs/tick",
  "/api/inngest",
];

/** Development-only pages. They are fixtures by design and have no place on the real domain. */
const HIDDEN_IN_PRODUCTION = ["/kitchen-sink"];

function matches(path: string, prefixes: string[]): boolean {
  return prefixes.some((p) => path === p || path.startsWith(`${p}/`));
}

/**
 * Cached answer to "have the migrations been applied?".
 *
 * The guard exists to protect real tenant data. Before the schema is applied
 * there is no tenant data — every screen is fixtures — so demanding a login to
 * view a demo is friction with nothing behind it. Once the tables exist the
 * guard turns itself on.
 *
 * `complete` is cached per worker for good — it only ever changes forward.
 * The other two are re-probed every 30 seconds, so applying the migrations
 * takes effect without a redeploy. See lib/schema.ts for the three states.
 */
let schemaState: { value: SchemaState; at: number } | null = null;
const RETRY_MS = 30_000;

async function currentSchema(url: string, key: string): Promise<SchemaState> {
  if (
    schemaState &&
    (schemaState.value === "complete" || Date.now() - schemaState.at < RETRY_MS)
  ) {
    return schemaState.value;
  }
  try {
    const value = await probeSchema(url, key);
    schemaState = { value, at: Date.now() };
    return value;
  } catch {
    // Network trouble is not evidence of a missing schema. Fail closed: keep
    // the guard on rather than opening the app because a probe timed out.
    // Not cached, so the next request asks again.
    return "complete";
  }
}

/**
 * The page a production deployment serves instead of the demo. Plain HTML,
 * no framework, because the thing it reports is that the app cannot run.
 */
function unavailable(reason: string): NextResponse {
  const body =
    `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<meta name="robots" content="noindex"><title>Huntloop is unavailable</title>` +
    `<style>body{font:16px/1.6 system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 1rem;color:#1f2937}` +
    `@media(prefers-color-scheme:dark){body{background:#0b0d12;color:#e5e7eb}}</style></head>` +
    `<body><h1>Huntloop is temporarily unavailable</h1>` +
    `<p>We're finishing setting this deployment up. Please try again shortly.</p>` +
    `<p><a href="/">Back to the home page</a></p></body></html>`;
  return new NextResponse(body, {
    status: 503,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "retry-after": "300",
      // For whoever is debugging it. Names the missing piece, never a value.
      "x-huntloop-unavailable": reason,
    },
  });
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

  const path = request.nextUrl.pathname;
  const production = isProductionDeployment();

  if (production && matches(path, HIDDEN_IN_PRODUCTION)) {
    return sealCsp(new NextResponse("Not found", { status: 404 }), responseHeader, policy);
  }

  /* Production refuses to run the demo. Everywhere else the two branches
     below are the demo mode they always were. */
  const notReady = (reason: string) =>
    production && path !== "/" && !matches(path, SERVED_WHILE_NOT_READY)
      ? sealCsp(unavailable(reason), responseHeader, policy)
      : pass();

  const env = supabaseEnv();

  // Not configured → demo mode. Guarding here would lock everyone out of an
  // app that has no way to log in yet.
  if (!env) return notReady("supabase-not-configured");
  const { url, key } = env;

  // Configured but not migrated → also demo mode.
  const schema = await currentSchema(url, key);
  if (schema === "none") return notReady("schema-not-applied");

  // Half-migrated. Outside production this stays live with the guard on, as
  // before — a developer mid-migration wants to see which screens break.
  // In production it is an outage with a name, not a product with holes.
  if (schema === "partial" && production) return notReady("migrations-pending");

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

  const isPublic = matches(path, PUBLIC_PREFIXES);

  if (!user && !isPublic && path !== "/") {
    /* A URL that is no page at all gets the not-found page, not a sign-in
       wall in front of a 404. Rewritten to a path no route serves, so Next
       renders `app/not-found.tsx` with a real 404 status — and the requested
       path itself is never rendered for an anonymous visitor. */
    if (!isProtectedRoute(path)) {
      const missing = request.nextUrl.clone();
      missing.pathname = "/__not-found";
      missing.search = "";
      return sealCsp(
        NextResponse.rewrite(missing, { request: { headers: requestHeaders }, status: 404 }),
        responseHeader,
        policy,
      );
    }

    const login = request.nextUrl.clone();
    /*
     * An invitee is sent to *sign up*, not to sign in.
     *
     * They were invited by email address and, in the common case, have no
     * account at all. `/login` sends a magic link with `shouldCreateUser:
     * false`, so it refuses for exactly the person the link was written for —
     * and refuses with the deliberately vague enumeration-safe message, which
     * makes it unexplainable. `/signup` creates the account if it is needed
     * and signs in the address if it is not.
     */
    login.pathname = path.startsWith("/invite/") ? "/signup" : "/login";
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
    "/((?!_next/static|_next/image|favicon.ico|robots\\.txt|humans\\.txt|sitemap\\.xml|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
