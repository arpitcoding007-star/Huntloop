module.exports = [
"[externals]/crypto [external] (crypto, cjs)", ((__turbopack_context__, module, exports) => {

var mod = __turbopack_context__.x("crypto", () => require("crypto"));

module.exports = mod;
}),
"[externals]/next/dist/build/adapter/setup-node-env.external.js [external] (next/dist/build/adapter/setup-node-env.external.js, cjs)", ((__turbopack_context__, module, exports) => {

var mod = __turbopack_context__.x("next/dist/build/adapter/setup-node-env.external.js", () => require("next/dist/build/adapter/setup-node-env.external.js"));

module.exports = mod;
}),
"[externals]/next/dist/compiled/next-server/app-page-turbo.runtime.dev.js [external] (next/dist/compiled/next-server/app-page-turbo.runtime.dev.js, cjs)", ((__turbopack_context__, module, exports) => {

var mod = __turbopack_context__.x("next/dist/compiled/next-server/app-page-turbo.runtime.dev.js", () => require("next/dist/compiled/next-server/app-page-turbo.runtime.dev.js"));

module.exports = mod;
}),
"[externals]/next/dist/server/app-render/action-async-storage.external.js [external] (next/dist/server/app-render/action-async-storage.external.js, cjs)", ((__turbopack_context__, module, exports) => {

var mod = __turbopack_context__.x("next/dist/server/app-render/action-async-storage.external.js", () => require("next/dist/server/app-render/action-async-storage.external.js"));

module.exports = mod;
}),
"[externals]/next/dist/server/app-render/after-task-async-storage.external.js [external] (next/dist/server/app-render/after-task-async-storage.external.js, cjs)", ((__turbopack_context__, module, exports) => {

var mod = __turbopack_context__.x("next/dist/server/app-render/after-task-async-storage.external.js", () => require("next/dist/server/app-render/after-task-async-storage.external.js"));

module.exports = mod;
}),
"[externals]/next/dist/server/app-render/work-async-storage.external.js [external] (next/dist/server/app-render/work-async-storage.external.js, cjs)", ((__turbopack_context__, module, exports) => {

var mod = __turbopack_context__.x("next/dist/server/app-render/work-async-storage.external.js", () => require("next/dist/server/app-render/work-async-storage.external.js"));

module.exports = mod;
}),
"[externals]/next/dist/server/app-render/work-unit-async-storage.external.js [external] (next/dist/server/app-render/work-unit-async-storage.external.js, cjs)", ((__turbopack_context__, module, exports) => {

var mod = __turbopack_context__.x("next/dist/server/app-render/work-unit-async-storage.external.js", () => require("next/dist/server/app-render/work-unit-async-storage.external.js"));

module.exports = mod;
}),
"[externals]/next/dist/server/lib/incremental-cache/memory-cache.external.js [external] (next/dist/server/lib/incremental-cache/memory-cache.external.js, cjs)", ((__turbopack_context__, module, exports) => {

var mod = __turbopack_context__.x("next/dist/server/lib/incremental-cache/memory-cache.external.js", () => require("next/dist/server/lib/incremental-cache/memory-cache.external.js"));

module.exports = mod;
}),
"[externals]/next/dist/server/lib/incremental-cache/shared-cache-controls.external.js [external] (next/dist/server/lib/incremental-cache/shared-cache-controls.external.js, cjs)", ((__turbopack_context__, module, exports) => {

var mod = __turbopack_context__.x("next/dist/server/lib/incremental-cache/shared-cache-controls.external.js", () => require("next/dist/server/lib/incremental-cache/shared-cache-controls.external.js"));

module.exports = mod;
}),
"[externals]/next/dist/server/lib/incremental-cache/tags-manifest.external.js [external] (next/dist/server/lib/incremental-cache/tags-manifest.external.js, cjs)", ((__turbopack_context__, module, exports) => {

var mod = __turbopack_context__.x("next/dist/server/lib/incremental-cache/tags-manifest.external.js", () => require("next/dist/server/lib/incremental-cache/tags-manifest.external.js"));

module.exports = mod;
}),
"[externals]/next/dist/server/lib/router-utils/instrumentation-globals.external.js [external] (next/dist/server/lib/router-utils/instrumentation-globals.external.js, cjs)", ((__turbopack_context__, module, exports) => {

var mod = __turbopack_context__.x("next/dist/server/lib/router-utils/instrumentation-globals.external.js", () => require("next/dist/server/lib/router-utils/instrumentation-globals.external.js"));

module.exports = mod;
}),
"[externals]/next/dist/server/runtime-reacts.external.js [external] (next/dist/server/runtime-reacts.external.js, cjs)", ((__turbopack_context__, module, exports) => {

var mod = __turbopack_context__.x("next/dist/server/runtime-reacts.external.js", () => require("next/dist/server/runtime-reacts.external.js"));

module.exports = mod;
}),
"[externals]/node:async_hooks [external] (node:async_hooks, cjs)", ((__turbopack_context__, module, exports) => {

var mod = __turbopack_context__.x("node:async_hooks", () => require("node:async_hooks"));

module.exports = mod;
}),
"[externals]/node:path [external] (node:path, cjs)", ((__turbopack_context__, module, exports) => {

var mod = __turbopack_context__.x("node:path", () => require("node:path"));

module.exports = mod;
}),
"[externals]/node:stream [external] (node:stream, cjs)", ((__turbopack_context__, module, exports) => {

var mod = __turbopack_context__.x("node:stream", () => require("node:stream"));

module.exports = mod;
}),
"[externals]/path [external] (path, cjs)", ((__turbopack_context__, module, exports) => {

var mod = __turbopack_context__.x("path", () => require("path"));

module.exports = mod;
}),
"[project]/apps/web/lib/csp.ts [middleware] (ecmascript)", ((__turbopack_context__) => {
"use strict";

/**
 * Content-Security-Policy, with a per-request nonce.
 *
 * SEC-03, the last P0 in the audit backlog. Until now the only CSP was
 * `frame-ancestors 'none'` in `next.config.ts` — genuinely useful against
 * clickjacking, and silent on the thing a CSP is mostly for. This adds
 * `script-src`.
 *
 * ── Why a nonce, and why this could not be a static header ────────────────
 *
 * Next injects inline bootstrap scripts into every document — the flight data
 * that hydrates the App Router. A static policy therefore has exactly two
 * options: `'unsafe-inline'`, which permits every inline script including an
 * injected one and so certifies nothing, or hashes, which change on every
 * build and cannot be written down ahead of time. A nonce is the third
 * option: a fresh random value per response, attached to the scripts we
 * emitted and to no others.
 *
 * `'strict-dynamic'` then says: anything those scripts load is trusted too.
 * That is what makes the policy survive Next's chunk loading without an
 * allow-list of URLs that goes stale.
 *
 * ── Why report-only by default ───────────────────────────────────────────
 *
 * A wrong CSP does not fail loudly. It blocks one script on one route and the
 * page half-works, which is the worst failure mode available and the reason
 * this was deferred rather than dropped into the audit. So it ships observing:
 * `Content-Security-Policy-Report-Only` sends violations to `/api/csp-report`
 * and blocks nothing. Set `CSP_ENFORCE=true` once the report stream is quiet
 * for a week — see SETUP.md.
 */ __turbopack_context__.s([
    "buildCsp",
    ()=>buildCsp,
    "createNonce",
    ()=>createNonce,
    "cspIsEnforced",
    ()=>cspIsEnforced
]);
function cspIsEnforced() {
    return process.env.CSP_ENFORCE === "true";
}
function createNonce() {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return btoa(String.fromCharCode(...bytes));
}
function buildCsp(nonce) {
    const isDev = ("TURBOPACK compile-time value", "development") !== "production";
    /*
   * Where the browser is allowed to talk to.
   *
   * Derived from the configured Supabase URL rather than a wildcard over
   * `*.supabase.co`: the wildcard would permit every Supabase project on the
   * internet, which is a meaningful difference for a policy whose job is to
   * limit where an injected script can send data.
   */ const connect = new Set([
        "'self'"
    ]);
    const supabase = ("TURBOPACK compile-time value", "");
    if ("TURBOPACK compile-time falsy", 0) //TURBOPACK unreachable
    ;
    const sentryDsn = ("TURBOPACK compile-time value", "");
    if ("TURBOPACK compile-time falsy", 0) //TURBOPACK unreachable
    ;
    const directives = {
        "default-src": [
            "'self'"
        ],
        /*
     * `'unsafe-eval'` in development only. Next's dev server compiles and
     * evaluates modules in the browser for fast refresh, so without it the dev
     * experience breaks entirely — and a policy that has to be turned off to
     * work locally is a policy that gets turned off everywhere.
     */ "script-src": [
            "'self'",
            `'nonce-${nonce}'`,
            "'strict-dynamic'",
            ...("TURBOPACK compile-time truthy", 1) ? [
                "'unsafe-eval'"
            ] : "TURBOPACK unreachable"
        ],
        /*
     * `style-src` keeps `'unsafe-inline'`, and this is the one real compromise
     * in the policy — recorded rather than glossed.
     *
     * Next injects inline <style> for `next/font` and for the CSS it inlines
     * during hydration, and it does not nonce all of them. Tailwind's output is
     * a stylesheet and would be fine; the framework's own injections are not.
     * The exposure is CSS injection, which is real (data exfiltration via
     * attribute selectors and background-image URLs) but requires an injection
     * point that would already be a worse problem for script-src.
     *
     * Revisit if Next's style nonce support becomes complete.
     */ "style-src": [
            "'self'",
            "'unsafe-inline'"
        ],
        // `data:` for the inline SVG icons; `blob:` for anything generated client
        // side. No remote image hosts — the app renders no third-party imagery.
        "img-src": [
            "'self'",
            "data:",
            "blob:"
        ],
        // Self only. next/font self-hosts, which is half the reason it was chosen.
        "font-src": [
            "'self'"
        ],
        "connect-src": [
            ...connect
        ],
        // No plugins, ever. `object-src 'none'` is the single highest-value
        // directive after script-src and has no downside here.
        "object-src": [
            "'none'"
        ],
        // Stops an injected <base> re-pointing every relative URL on the page.
        "base-uri": [
            "'self'"
        ],
        // A form that posts somewhere else is a credential-harvesting primitive,
        // and this app's forms are all same-origin Server Actions.
        "form-action": [
            "'self'"
        ],
        // Duplicated from next.config.ts on purpose — see the note there. Static
        // assets are excluded from the middleware matcher, so that header covers
        // what this one cannot.
        "frame-ancestors": [
            "'none'"
        ],
        "frame-src": [
            "'none'"
        ]
    };
    const parts = Object.entries(directives).map(([name, values])=>`${name} ${values.join(" ")}`);
    /*
   * Only in production, and only when enforcing.
   *
   * Production, because on http://localhost this rewrites every request to
   * https and breaks local development outright.
   *
   * Enforcing, because the directive does nothing in a report-only policy —
   * and browsers say so, out loud, in the console: "'upgrade-insecure-requests'
   * is ignored when delivered in a report-only policy." Shipping it anyway
   * would print a warning on every page load for every user during exactly the
   * observation period when the console needs to be readable. Found by the
   * Playwright suite, which counted it among the violations.
   */ if (!isDev && cspIsEnforced()) //TURBOPACK unreachable
    ;
    parts.push("report-uri /api/csp-report");
    // `report-to` is the replacement and needs a Reporting-Endpoints header;
    // `report-uri` is deprecated and is what actually has support today. Both
    // are cheap, so both are sent — browsers use whichever they implement.
    parts.push("report-to csp-endpoint");
    return {
        nonce,
        header: cspIsEnforced() ? "Content-Security-Policy" : "Content-Security-Policy-Report-Only",
        policy: parts.join("; ")
    };
}
}),
"[project]/apps/web/lib/schema.ts [middleware] (ecmascript)", ((__turbopack_context__) => {
"use strict";

/**
 * "Is the database this deployment points at actually ready?"
 *
 * Three answers rather than two, because the dangerous state is the middle
 * one. A project with `0001` applied and nothing after it has an
 * `organizations` table — which is all the old check looked for — so it was
 * reported as migrated, the guard switched on, and then onboarding, discovery,
 * providers and CRM failed one screen at a time against tables that did not
 * exist. `partial` names that state so it can be refused instead.
 *
 *   none      `organizations` (0001) is missing — nothing is applied.
 *   partial   0001 is there, the newest migration's table is not.
 *   complete  both are there.
 *
 * Probed through PostgREST with the publishable key, the same way the browser
 * talks to Supabase: no service key is needed to ask whether a table exists.
 * 404 means the table is not in the schema cache. 200 (RLS returns no rows to
 * an anonymous caller) and 401/403 both mean it exists and RLS is working.
 *
 * Shared by `proxy.ts` and `/api/health` so the two cannot disagree.
 */ __turbopack_context__.s([
    "BASE_TABLE",
    ()=>BASE_TABLE,
    "LATEST_TABLE",
    ()=>LATEST_TABLE,
    "isProductionDeployment",
    ()=>isProductionDeployment,
    "probeSchema",
    ()=>probeSchema,
    "supabaseEnv",
    ()=>supabaseEnv
]);
const BASE_TABLE = "organizations";
const LATEST_TABLE = "hubspot_connections";
async function tableExists(url, key, table) {
    const res = await fetch(`${url}/rest/v1/${table}?select=*&limit=1`, {
        headers: {
            apikey: key,
            Authorization: `Bearer ${key}`
        },
        cache: "no-store"
    });
    if (res.status === 404) return false;
    if (res.ok || res.status === 401 || res.status === 403) return true;
    throw new Error(`Schema probe for ${table} answered HTTP ${res.status}`);
}
async function probeSchema(url, key) {
    const [base, latest] = await Promise.all([
        tableExists(url, key, BASE_TABLE),
        tableExists(url, key, LATEST_TABLE)
    ]);
    if (!base) return "none";
    return latest ? "complete" : "partial";
}
function supabaseEnv() {
    const url = ("TURBOPACK compile-time value", "");
    const key = ("TURBOPACK compile-time value", "") ?? ("TURBOPACK compile-time value", "");
    return ("TURBOPACK compile-time falsy", 0) ? "TURBOPACK unreachable" : null;
}
function isProductionDeployment() {
    return process.env.VERCEL_ENV === "production";
}
}),
"[project]/apps/web/proxy.ts [middleware] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "config",
    ()=>config,
    "proxy",
    ()=>proxy
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$middleware$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/server.js [middleware] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$supabase$2f$ssr$2f$dist$2f$module$2f$index$2e$js__$5b$middleware$5d$__$28$ecmascript$29$__$3c$locals$3e$__ = __turbopack_context__.i("[project]/node_modules/@supabase/ssr/dist/module/index.js [middleware] (ecmascript) <locals>");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$supabase$2f$ssr$2f$dist$2f$module$2f$createServerClient$2e$js__$5b$middleware$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/@supabase/ssr/dist/module/createServerClient.js [middleware] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$lib$2f$csp$2e$ts__$5b$middleware$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/apps/web/lib/csp.ts [middleware] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$lib$2f$schema$2e$ts__$5b$middleware$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/apps/web/lib/schema.ts [middleware] (ecmascript)");
;
;
;
;
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
 */ /**
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
 */ const PUBLIC_PREFIXES = [
    "/login",
    "/signup",
    "/auth",
    "/kitchen-sink",
    "/api/csp-report",
    /* Both halves of unsubscribe. The person following that link is a prospect
     with no account, and requiring one in order to stop being emailed is not
     something this product may do. RFC 8058 aside, a redirect to /login is a
     dead unsubscribe, and a dead unsubscribe is a spam report. */ "/unsubscribe",
    "/api/unsubscribe",
    /* The top of the funnel. A visitor who has typed their domain into the
     landing page has not signed in yet by construction — bouncing them to
     /login here would put the sign-up wall back in front of the value, which
     is precisely what the domain-first funnel exists to move. */ "/discover",
    /* The use-case pages. Marketing content, submitted in the sitemap, and
     therefore reached by people and crawlers with no session — a guard here
     would answer every one of them with a 307 to /login and make the pages
     invisible to exactly the audience they were written for. */ "/for",
    "/compare",
    /* The legal pages. Every outreach footer, the sign-up form and the
     landing page link to them, and the people following those links are by
     definition not signed in: a privacy policy behind a login is, for them,
     no privacy policy at all. They were missing from this list, so on a
     migrated deployment all three answered a 307 to /login. */ "/privacy",
    "/terms",
    "/acceptable-use",
    /* Generated images, which have no file extension and so are not excluded
     by the matcher below. Scrapers fetching the Open Graph card are never
     signed in; before this, every shared link previewed as a login redirect. */ "/opengraph-image",
    "/apple-icon",
    /* Machine callers that authenticate themselves. The job tick is called by a
     scheduler with `Authorization: Bearer $CRON_SECRET` and the Inngest route
     checks an HMAC signature — neither carries a session, so behind the guard
     both were answered with a 307 to /login and the engine never ran, on
     every configured deployment, whatever the scheduler was. Each route
     refuses unauthenticated callers itself (404 / 401), which is where that
     check belongs. */ "/api/jobs/tick",
    "/api/inngest",
    /* Booleans about configuration, never values. See the route. */ "/api/health"
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
 */ const SERVED_WHILE_NOT_READY = [
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
    "/api/inngest"
];
/** Development-only pages. They are fixtures by design and have no place on the real domain. */ const HIDDEN_IN_PRODUCTION = [
    "/kitchen-sink"
];
function matches(path, prefixes) {
    return prefixes.some((p)=>path === p || path.startsWith(`${p}/`));
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
 */ let schemaState = null;
const RETRY_MS = 30_000;
async function currentSchema(url, key) {
    if (schemaState && (schemaState.value === "complete" || Date.now() - schemaState.at < RETRY_MS)) {
        return schemaState.value;
    }
    try {
        const value = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$lib$2f$schema$2e$ts__$5b$middleware$5d$__$28$ecmascript$29$__["probeSchema"])(url, key);
        schemaState = {
            value,
            at: Date.now()
        };
        return value;
    } catch  {
        // Network trouble is not evidence of a missing schema. Fail closed: keep
        // the guard on rather than opening the app because a probe timed out.
        // Not cached, so the next request asks again.
        return "complete";
    }
}
/**
 * The page a production deployment serves instead of the demo. Plain HTML,
 * no framework, because the thing it reports is that the app cannot run.
 */ function unavailable(reason) {
    const body = `<!doctype html><html lang="en"><head><meta charset="utf-8">` + `<meta name="viewport" content="width=device-width,initial-scale=1">` + `<meta name="robots" content="noindex"><title>Huntloop is unavailable</title>` + `<style>body{font:16px/1.6 system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 1rem;color:#1f2937}` + `@media(prefers-color-scheme:dark){body{background:#0b0d12;color:#e5e7eb}}</style></head>` + `<body><h1>Huntloop is temporarily unavailable</h1>` + `<p>We're finishing setting this deployment up. Please try again shortly.</p>` + `<p><a href="/">Back to the home page</a></p></body></html>`;
    return new __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$middleware$5d$__$28$ecmascript$29$__["NextResponse"](body, {
        status: 503,
        headers: {
            "content-type": "text/html; charset=utf-8",
            "cache-control": "no-store",
            "retry-after": "300",
            // For whoever is debugging it. Names the missing piece, never a value.
            "x-huntloop-unavailable": reason
        }
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
 */ function withCsp(request, nonce) {
    const headers = new Headers(request.headers);
    headers.set("x-nonce", nonce);
    const { header, policy } = (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$lib$2f$csp$2e$ts__$5b$middleware$5d$__$28$ecmascript$29$__["buildCsp"])(nonce);
    // Next looks for the enforcing name specifically when deciding whether to
    // nonce its scripts, so it is always set on the *request* — the response is
    // where report-only versus enforcing is decided.
    headers.set("Content-Security-Policy", policy);
    return {
        requestHeaders: headers,
        responseHeader: header,
        policy
    };
}
/** Copies the policy onto whatever response the guard produced. */ function sealCsp(response, responseHeader, policy) {
    response.headers.set(responseHeader, policy);
    response.headers.set("Reporting-Endpoints", 'csp-endpoint="/api/csp-report"');
    return response;
}
async function proxy(request) {
    const nonce = (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$lib$2f$csp$2e$ts__$5b$middleware$5d$__$28$ecmascript$29$__["createNonce"])();
    const { requestHeaders, responseHeader, policy } = withCsp(request, nonce);
    const pass = ()=>sealCsp(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$middleware$5d$__$28$ecmascript$29$__["NextResponse"].next({
            request: {
                headers: requestHeaders
            }
        }), responseHeader, policy);
    const path = request.nextUrl.pathname;
    const production = (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$lib$2f$schema$2e$ts__$5b$middleware$5d$__$28$ecmascript$29$__["isProductionDeployment"])();
    if (production && matches(path, HIDDEN_IN_PRODUCTION)) {
        return sealCsp(new __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$middleware$5d$__$28$ecmascript$29$__["NextResponse"]("Not found", {
            status: 404
        }), responseHeader, policy);
    }
    /* Production refuses to run the demo. Everywhere else the two branches
     below are the demo mode they always were. */ const notReady = (reason)=>production && path !== "/" && !matches(path, SERVED_WHILE_NOT_READY) ? sealCsp(unavailable(reason), responseHeader, policy) : pass();
    const env = (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$lib$2f$schema$2e$ts__$5b$middleware$5d$__$28$ecmascript$29$__["supabaseEnv"])();
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
    let response = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$middleware$5d$__$28$ecmascript$29$__["NextResponse"].next({
        request: {
            headers: requestHeaders
        }
    });
    const supabase = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$supabase$2f$ssr$2f$dist$2f$module$2f$createServerClient$2e$js__$5b$middleware$5d$__$28$ecmascript$29$__["createServerClient"])(url, key, {
        cookies: {
            getAll: ()=>request.cookies.getAll(),
            setAll: (all)=>{
                for (const { name, value } of all)request.cookies.set(name, value);
                // Rebuilt with the same request headers: dropping them here would
                // lose the nonce for exactly the requests that refresh a session,
                // which is most of them.
                response = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$middleware$5d$__$28$ecmascript$29$__["NextResponse"].next({
                    request: {
                        headers: requestHeaders
                    }
                });
                for (const { name, value, options } of all){
                    response.cookies.set(name, value, options);
                }
            }
        }
    });
    // getUser(), not getSession(): getSession reads the cookie without verifying
    // it against the auth server, so a forged cookie would satisfy it. This is
    // the one call in the file that must not be "optimised" into the cheaper one.
    const { data: { user } } = await supabase.auth.getUser();
    const isPublic = matches(path, PUBLIC_PREFIXES);
    if (!user && !isPublic && path !== "/") {
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
     */ login.pathname = path.startsWith("/invite/") ? "/signup" : "/login";
        // Send them back where they were headed after signing in — but only the
        // path, never the full URL, so this cannot be turned into an open redirect.
        // `lib/safe-next.ts` is the other half, where the value is consumed.
        login.searchParams.set("next", path);
        return sealCsp(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$middleware$5d$__$28$ecmascript$29$__["NextResponse"].redirect(login), responseHeader, policy);
    }
    return sealCsp(response, responseHeader, policy);
}
const config = {
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
     */ "/((?!_next/static|_next/image|favicon.ico|robots\\.txt|humans\\.txt|sitemap\\.xml|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"
    ]
};
}),
];

//# sourceMappingURL=%5Broot-of-the-server%5D__16q_h9l._.js.map