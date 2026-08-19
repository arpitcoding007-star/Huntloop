#!/usr/bin/env node
/**
 * The mechanizable half of the Huntloop audit (see audit/README.md).
 *
 * The point of this file is that an audit which only exists as a document is
 * accurate on the day it is written and wrong a fortnight later. Anything a
 * script can check, a script should check — so that "12 nav links 404" is a
 * failing build step rather than a paragraph somebody has to remember to
 * re-read.
 *
 * Scope, deliberately: this covers the findings that are *decidable* from the
 * repository. Judgement calls — is the visual hierarchy right, is the ICP
 * model correct, is this the right roadmap — stay in audit/FINDINGS.md where
 * a human owns them. A script that pretended to score those would be the
 * §7 failure this codebase is otherwise careful about.
 *
 *   node scripts/audit.mjs           # report, exit 0 unless a gate fails
 *   node scripts/audit.mjs --json    # machine-readable, for CI annotations
 *   node scripts/audit.mjs --strict  # warnings become failures too
 *
 * Exit code is 1 when any check at severity `fail` trips.
 */
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const args = new Set(process.argv.slice(2));
const AS_JSON = args.has("--json");
const STRICT = args.has("--strict");

/* ── tiny helpers ───────────────────────────────────────────────────────── */

const read = (p) => {
  try {
    return readFileSync(join(ROOT, p), "utf8");
  } catch {
    return null;
  }
};
const has = (p) => existsSync(join(ROOT, p));

/** Every file under `dir`, recursively, skipping build and dependency output. */
function walk(dir, out = []) {
  const abs = join(ROOT, dir);
  if (!existsSync(abs)) return out;
  for (const entry of readdirSync(abs)) {
    if (entry === "node_modules" || entry === ".next" || entry === "dist") continue;
    const rel = `${dir}/${entry}`;
    if (statSync(join(ROOT, rel)).isDirectory()) walk(rel, out);
    else out.push(rel);
  }
  return out;
}

/**
 * Source with comments removed, for checks that grep for a code pattern.
 *
 * This codebase documents its decisions in prose, which means a file very
 * often *discusses* the exact string a check is looking for — SEC-CSP already
 * carries a note about this, and NAV-02 was written twice for the same reason:
 * the first version reported every comment explaining why a placeholder href
 * had been removed as a placeholder href.
 *
 * Line comments are only stripped when `//` starts the line. Stripping them
 * anywhere would eat the rest of any line containing `https://`, which is how
 * a comment-stripper quietly starts hiding real matches.
 */
const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/**
 * The request-interception file, under whichever name it currently has.
 *
 * Next 16 deprecated `middleware.ts` in favour of `proxy.ts`. Two checks here
 * read that file, and both would have gone on "passing" against an empty
 * string after the rename — a check that reads nothing and reports success is
 * worse than no check, because it is credited in the summary. Throwing when
 * neither exists is the point: this file is load-bearing for the auth guard,
 * the crawler exclusions and the CSP nonce, so its absence is never routine.
 */
function proxySource() {
  const source = read("apps/web/proxy.ts") ?? read("apps/web/middleware.ts");
  if (source === null) {
    throw new Error(
      "Neither apps/web/proxy.ts nor apps/web/middleware.ts exists. " +
        "The auth guard, the crawler-route exclusions and the CSP nonce all " +
        "live there — this is not a check that should be skipped.",
    );
  }
  return source;
}

const results = [];
/**
 * @param phase  Which audit phase this belongs to (audit/README.md).
 * @param id     Stable identifier, so a finding can be referenced and waived.
 * @param ok     True when the check passes.
 * @param sev    "fail" gates the build; "warn" reports only.
 */
function check(phase, id, title, ok, sev, detail) {
  results.push({ phase, id, title, ok, severity: sev, detail: detail ?? null });
}

/* ── Phase 1 — Repository & infrastructure ──────────────────────────────── */

{
  const pkg = JSON.parse(read("package.json"));
  const engines = pkg.engines?.node ?? "";
  const readme = read("README.md") ?? "";
  const engineMajor = engines.match(/(\d+(?:\.\d+)?)/)?.[1];
  const readmeMajor = readme.match(/Requires Node (\d+(?:\.\d+)?)/)?.[1];

  check(
    1,
    "REPO-01",
    "README's Node floor matches package.json engines",
    Boolean(engineMajor && readmeMajor && engineMajor === readmeMajor),
    "warn",
    `engines=${engines || "unset"} README=${readmeMajor ?? "unstated"}`,
  );

  // The CI workflow is the only thing that runs the tenant-isolation suite on
  // every change. Its absence is not a style problem.
  const ci = read(".github/workflows/ci.yml") ?? "";
  for (const step of ["typecheck", "lint", "npm test", "build"]) {
    check(
      1,
      `REPO-CI-${step.replace(/\W+/g, "-")}`,
      `CI runs ${step}`,
      ci.includes(step),
      "fail",
    );
  }

  // Every env var the code reads should be discoverable without reading code.
  const envExample = read(".env.example") ?? "";
  const referenced = new Set();
  for (const f of [...walk("apps/web"), ...walk("packages")]) {
    if (!/\.(ts|tsx|mjs)$/.test(f)) continue;
    for (const m of (read(f) ?? "").matchAll(/process\.env\.([A-Z0-9_]+)/g)) {
      referenced.add(m[1]);
    }
  }
  // Set by the platform or the framework, not by an operator — listing these
  // in .env.example would imply they are ours to configure.
  const PROVIDED = new Set([
    "NODE_ENV",
    "CI",
    "NEXT_RUNTIME",
    "VERCEL_ENV",
    "NEXT_PUBLIC_VERCEL_ENV",
    "VERCEL_URL",
    "VERCEL_REGION",
    "VERCEL_PROJECT_PRODUCTION_URL",
  ]);
  const undocumented = [...referenced].filter(
    (v) => !PROVIDED.has(v) && !envExample.includes(v),
  );
  check(
    1,
    "REPO-02",
    "Every env var the code reads appears in .env.example",
    undocumented.length === 0,
    "warn",
    undocumented.join(", "),
  );
}

/* ── Phase 2/3 — Frontend & features: does the nav point at real pages? ─── */

{
  const shell = read("apps/web/app/(app)/[org]/OrgShell.tsx") ?? "";

  // Each nav entry is an object literal; find its href and whether it carries
  // the `unbuilt` flag that marks it as a non-link.
  const entries = [...shell.matchAll(/\{[^{}]*?href:\s*`\/\$\{org\}([^`]*)`[^{}]*?\}/gs)].map(
    (m) => ({ path: m[1], unbuilt: /unbuilt:\s*true/.test(m[0]) }),
  );

  const pages = new Set(
    walk("apps/web/app")
      .filter((f) => f.endsWith("/page.tsx"))
      .map((f) =>
        f
          .replace("apps/web/app", "")
          .replace("/page.tsx", "")
          // Route groups are folders, not URL segments.
          .replace(/\/\([^)]+\)/g, "")
          // The [org] segment is supplied by the nav's own template literal.
          .replace("/[org]", ""),
      ),
  );

  const linkedButMissing = entries
    .filter((e) => !e.unbuilt && !pages.has(e.path))
    .map((e) => e.path);

  check(
    3,
    "NAV-01",
    "No nav item links to a route that does not exist",
    linkedButMissing.length === 0,
    "fail",
    linkedButMissing.length
      ? `Linked but 404: ${linkedButMissing.join(", ")}`
      : `${entries.filter((e) => e.unbuilt).length} of ${entries.length} marked unbuilt`,
  );

  /*
   * Dead hrefs — `href="#"` and `href=""`.
   *
   * NAV-01 above only inspects the sidebar, and PERF-01 below only matches
   * hrefs beginning with `/`. Between them sat eight StatCards on the
   * Command Center and eight more in the gallery, each rendering as a link
   * that announced as a link, displayed "Click to view →", and moved focus
   * nowhere when activated.
   *
   * `eslint-plugin-jsx-a11y` misses them too, and the reason is worth
   * recording: `anchor-is-valid` inspects literal `<a>` elements, and these
   * were `<StatCard href="#">` — a prop on a component that renders an anchor
   * three files away. A lint rule cannot see through that; a grep for the
   * string can.
   *
   * `#main`-style fragments are fine and are not matched — the skip link is
   * one, and it points at a real element.
   */
  const deadHrefs = [];
  for (const f of walk("apps/web/app")) {
    if (!f.endsWith(".tsx")) continue;
    const src = stripComments(read(f) ?? "");
    const hits = [...src.matchAll(/href=(?:"#"|""|\{""\}|\{`#`\}|\{`{2}\})/g)].length;
    if (hits) deadHrefs.push(`${relative(".", f).split(sep).join("/")}(${hits})`);
  }
  check(
    3,
    "NAV-02",
    "No component is handed a placeholder href",
    deadHrefs.length === 0,
    "fail",
    deadHrefs.length ? `Placeholder hrefs: ${deadHrefs.join(" ")}` : null,
  );

  /*
   * Buttons that do nothing when pressed.
   *
   * NAV-02 above is the same defect, and it could never have caught these:
   * it greps for placeholder hrefs, and a <Button> has no href to inspect.
   * That blind spot left twenty-one controls across six screens rendering as
   * live primary and secondary actions with full focus rings and no behaviour
   * at all — Export, New hunt, Draft outreach, Assign, Scan now, Add a source,
   * Add to campaign, four Refreshes, and every button in the rail headed
   * "Needs you" (audit UX-01).
   *
   * A button is answerable if it does exactly one of:
   *   onClick   it acts
   *   type=     it submits or resets a form
   *   href      it navigates
   *   pending   it says why it cannot act yet, and refuses the click
   *
   * `disabled` alone is deliberately NOT sufficient. A greyed-out control with
   * no reason is the question this check exists to stop shipping, and it also
   * leaves the tab order — so the users who most need the explanation are the
   * ones who cannot reach it. Use `pending`.
   *
   * Scoped to apps/web/app, so packages/ui may still define a Button whose
   * handler its caller supplies. The kitchen sink is exempt: it is the
   * component gallery, and its buttons exist to be looked at.
   */
  const inertButtons = [];
  for (const f of walk("apps/web/app")) {
    if (!f.endsWith(".tsx")) continue;
    const rel = relative(".", f).split(sep).join("/");
    if (rel.includes("/kitchen-sink/")) continue;
    const src = stripComments(read(f) ?? "");
    // Each `<Button …>` up to the closing `>` of its opening tag. `[^>]` would
    // stop at the first `>` inside an arrow function in a prop, so this walks
    // attributes instead and tolerates `=>` within them.
    let inert = 0;
    for (const m of src.matchAll(/<Button\b((?:[^>]|=>)*?)\/?>/g)) {
      const attrs = m[1] ?? "";
      if (/\b(onClick|type|href|pending)[=\s]/.test(attrs)) continue;
      inert++;
    }
    if (inert) inertButtons.push(`${rel}(${inert})`);
  }
  check(
    3,
    "NAV-03",
    "Every button either acts, navigates, submits, or says why it cannot",
    inertButtons.length === 0,
    "fail",
    inertButtons.length
      ? `Buttons with no behaviour: ${inertButtons.join(" ")}`
      : null,
  );

  // Route-level safety nets. `notFound()` is called deliberately by the org
  // layout as a security decision, so the 404 page is not optional cosmetics.
  for (const [file, id] of [
    ["apps/web/app/not-found.tsx", "UX-404"],
    ["apps/web/app/error.tsx", "UX-ERR"],
    ["apps/web/app/global-error.tsx", "UX-GERR"],
  ]) {
    check(2, id, `${file} exists`, has(file), "fail");
  }

  // Client-side navigation. Raw <a> for an internal route discards the App
  // Router and reloads the document.
  let rawInternal = 0;
  const offenders = [];
  for (const f of walk("apps/web/app")) {
    if (!f.endsWith(".tsx")) continue;
    const src = read(f) ?? "";
    const hits = [...src.matchAll(/<a\s[^>]*href=[{"]`?\/(?!\/)/g)].length;
    if (hits) {
      rawInternal += hits;
      offenders.push(`${relative(".", f).split(sep).join("/")}(${hits})`);
    }
  }
  check(
    6,
    "PERF-01",
    "Internal links use next/link rather than raw <a>",
    rawInternal === 0,
    "warn",
    rawInternal ? `${rawInternal} raw internal links: ${offenders.join(" ")}` : null,
  );
}

/* ── Phase 5 — Security ─────────────────────────────────────────────────── */

{
  const nextConfig = read("apps/web/next.config.ts") ?? "";
  for (const header of [
    "Strict-Transport-Security",
    "X-Content-Type-Options",
    "X-Frame-Options",
    "Referrer-Policy",
    "Permissions-Policy",
  ]) {
    check(5, `SEC-H-${header}`, `${header} is set`, nextConfig.includes(header), "fail");
  }

  /*
   * The real policy is built per request in lib/csp.ts, because it carries a
   * nonce — so this reads that module rather than next.config.ts, which now
   * only carries the static `frame-ancestors` line.
   *
   * Comments are stripped first, and that is not incidental here: csp.ts
   * discusses `'unsafe-inline'` at length in prose explaining why script-src
   * does *not* have it. A check reading the raw file would find the word and
   * fail on the explanation — the same trap NAV-02 fell into, and the reason
   * `stripComments` exists.
   */
  const csp = stripComments(read("apps/web/lib/csp.ts") ?? "");
  const middleware = stripComments(proxySource());

  const hasScriptSrc = /"script-src"/.test(csp);
  const hasNonce = /nonce-\$\{nonce\}/.test(csp) && /createNonce/.test(middleware);
  // The two directives that make a script-src worth having. Without
  // object-src a plugin is still a code-execution path, and without base-uri
  // an injected <base> re-points every relative script URL on the page.
  const hasHardening = /"object-src"/.test(csp) && /"base-uri"/.test(csp);
  // `'unsafe-inline'` inside script-src would make the nonce decorative.
  const scriptSrcBlock = csp.match(/"script-src":\s*\[([^\]]*)\]/s)?.[1] ?? "";
  const nonceIsMeaningful = !/unsafe-inline/.test(scriptSrcBlock);

  check(
    5,
    "SEC-CSP",
    "A nonce-based script-src Content-Security-Policy is in place",
    hasScriptSrc && hasNonce && hasHardening && nonceIsMeaningful,
    "fail",
    hasScriptSrc && hasNonce && hasHardening && nonceIsMeaningful
      ? null
      : [
          !hasScriptSrc && "no script-src directive",
          !hasNonce && "no per-request nonce threaded through middleware",
          !hasHardening && "missing object-src or base-uri",
          !nonceIsMeaningful && "script-src allows 'unsafe-inline', which voids the nonce",
        ]
          .filter(Boolean)
          .join("; "),
  );

  // Report-only is the correct *default*, so this reports rather than gates.
  // It exists to stop the policy sitting in observation mode forever, which is
  // the usual fate of a CSP that ships report-only.
  const enforced = /CSP_ENFORCE === "true"/.test(csp);
  check(
    5,
    "SEC-CSP-MODE",
    "The CSP has a documented path from report-only to enforcing",
    enforced && /csp-report/.test(csp),
    "warn",
    "Set CSP_ENFORCE=true once the report stream is quiet — see SETUP.md.",
  );

  // The one Critical risk in plan D2. `packages/db/scripts/check-admin-imports`
  // is the authority; this is a cheap second look that runs in the same pass.
  //
  // Import statements only. Several files legitimately *mention* admin.ts in a
  // comment saying why they don't use it, and flagging those would train
  // whoever reads this output to ignore the one check that must never be noise.
  const ADMIN_IMPORT =
    /(?:^|\n)\s*(?:import[^;\n]*from\s*|export[^;\n]*from\s*)["'][^"']*(?:@huntloop\/db\/admin|db\/src\/admin)[^"']*["']|require\(["'][^"']*db\/(?:src\/)?admin/;
  const adminImports = walk("apps/web").filter(
    (f) => /\.(ts|tsx)$/.test(f) && ADMIN_IMPORT.test(read(f) ?? ""),
  );
  check(
    5,
    "SEC-ADMIN",
    "apps/ never imports the service-role client",
    adminImports.length === 0,
    "fail",
    adminImports.join(", "),
  );

  /*
   * Server Actions are public POST endpoints. Any wrapper that can reach a
   * paid model must resolve the caller's org first and refuse when it cannot —
   * RLS protects rows, and the Anthropic bill is not a row.
   */
  const spendPaths = ["research", "sources", "qualify", "why-now"];
  const unguarded = spendPaths.filter((name) => {
    const src = read(`apps/web/lib/ai/${name}.ts`) ?? "";
    if (!src.includes("runTask")) return false;
    return !(src.includes("resolveRecorder") && /if\s*\(!resolved\.ok\)/.test(src));
  });
  check(
    5,
    "SEC-SPEND",
    "Every model-calling wrapper refuses an unresolvable org",
    unguarded.length === 0,
    "fail",
    unguarded.length ? `Unguarded: ${unguarded.join(", ")}` : null,
  );

  /*
   * The other half of SEC-SPEND. That one stops a non-member spending the
   * budget; this one bounds how fast a member can. Both are `fail`, because a
   * wrapper silently losing its limiter looks exactly like one that never had
   * it — and the symptom is a bill, which arrives a month late.
   */
  const unlimited = spendPaths.filter((name) => {
    const src = read(`apps/web/lib/ai/${name}.ts`) ?? "";
    if (!src.includes("runTask")) return false;
    return !(src.includes("consumeRateLimit") && /if\s*\(!budget\.allowed\)/.test(src));
  });
  check(
    5,
    "SEC-RATELIMIT",
    "Every model-calling wrapper consumes a rate-limit budget",
    unlimited.length === 0,
    "fail",
    unlimited.length ? `Unlimited: ${unlimited.join(", ")}` : null,
  );

  // The counters must be unwritable by the party they constrain.
  const rateLimitSql = read("packages/db/migrations/0005_rate_limits.sql") ?? "";
  check(
    5,
    "SEC-RATELIMIT-RLS",
    "rate_limits grants read only — no tenant write policy",
    rateLimitSql.includes("for select using") &&
      !/create policy[^;]*for (all|insert|update)[^;]*on (public\.)?rate_limits/i.test(
        rateLimitSql,
      ),
    "fail",
  );

  /*
   * Not "is zod installed" — that only proves someone ran npm install. Every
   * "use server" module is a public POST endpoint, so the check is that each
   * one actually parses what it is handed.
   *
   * Matching on the call rather than on the import, because an unused import
   * satisfies a grep and validates nothing.
   *
   * `parseForm` joined the list when the module forms arrived. It is the
   * same guarantee as `parseInput` — both call `safeParse` and neither
   * returns a value the caller can use without checking `ok` — and it differs
   * only in reporting *which field* failed, which a nine-field form needs and
   * a single scalar does not. Leaving it out would have made every form
   * action look unvalidated, and the usual response to a check that fails on
   * correct code is to stop believing the check.
   */
  const actionFiles = walk("apps/web/app").filter(
    (f) => /\.ts$/.test(f) && /^["']use server["']/.test((read(f) ?? "").trimStart()),
  );
  const unvalidated = actionFiles.filter(
    (f) => !/parseInput\(|parseForm\(|safeParse\(/.test(read(f) ?? ""),
  );
  check(
    5,
    "SEC-VAL",
    "Every Server Action validates its inputs at runtime",
    actionFiles.length > 0 && unvalidated.length === 0,
    "fail",
    actionFiles.length === 0
      ? "No action modules found — the detector is probably wrong."
      : `Unvalidated: ${unvalidated.join(", ")}`,
  );
}

/* ── Phase 8 — SEO ──────────────────────────────────────────────────────── */

{
  for (const [file, id] of [
    ["apps/web/app/robots.ts", "SEO-ROBOTS"],
    ["apps/web/app/sitemap.ts", "SEO-SITEMAP"],
  ]) {
    check(8, id, `${file} exists`, has(file), "fail");
  }

  const layout = read("apps/web/app/layout.tsx") ?? "";
  check(8, "SEO-BASE", "metadataBase is set", layout.includes("metadataBase"), "fail");
  check(8, "SEO-OG", "Open Graph tags are set", layout.includes("openGraph"), "warn");

  // A crawler route behind the auth guard is a policy nothing can read.
  const mw = proxySource();
  check(
    8,
    "SEO-MW",
    "robots.txt and sitemap.xml are excluded from the auth matcher",
    /robots\\?\.txt/.test(mw) && /sitemap\\?\.xml/.test(mw),
    "fail",
  );

  check(
    8,
    "SEO-ICON",
    "A favicon / app icon exists",
    has("apps/web/app/icon.svg") ||
      has("apps/web/app/icon.png") ||
      has("apps/web/app/favicon.ico"),
    "warn",
    "No icon route; browsers request /favicon.ico and get the app's 404.",
  );
}

/* ── Phase 9 — Testing ──────────────────────────────────────────────────── */

{
  for (const ws of ["apps/web", "packages/ui", "packages/ai", "packages/db"]) {
    const pkg = JSON.parse(read(`${ws}/package.json`) ?? "{}");
    check(
      9,
      `TEST-${ws.split("/")[1]}`,
      `${ws} has a test script`,
      Boolean(pkg.scripts?.test),
      "warn",
    );
  }

  const hasE2E =
    has("playwright.config.ts") || has("cypress.config.ts") || has("e2e");
  check(9, "TEST-E2E", "An end-to-end suite exists", hasE2E, "warn", "No browser-level test covers sign-in or onboarding.");
}

/* ── Phase 3 — Fixture-backed screens ───────────────────────────────────── */

{
  const fixtureScreens = walk("apps/web/app")
    .filter((f) => f.endsWith("page.tsx"))
    .filter((f) => /lib\/fixtures|not implemented/.test(read(f) ?? ""));
  check(
    3,
    "FEAT-FIXTURE",
    "No screen is still backed by fixtures",
    fixtureScreens.length === 0,
    "warn",
    fixtureScreens.map((f) => f.replace("apps/web/app", "")).join(", "),
  );

  /*
   * FEAT-DEMO — the check that FEAT-FIXTURE could not make.
   *
   * FEAT-FIXTURE greps for an import of `lib/fixtures`. The Command Center
   * never had one: its numbers were `value={12}` written inline, so it passed
   * that check while rendering invented pipeline figures. That was tolerable
   * only while `DataSourceBanner` was on every page saying "demo data" —
   * which it stops doing the moment a database is connected, exactly when the
   * surrounding screens start showing real rows and the invented ones become
   * indistinguishable from them.
   *
   * So: a screen under /[org] must either read through `lib/data` — where
   * every loader carries its own `DataSource` — or render `DemoFigures`,
   * which has no quiet state. Failing rather than warning, because §7 aimed
   * at ourselves is the product's central claim and this is the one check
   * standing behind it.
   */
  const unmarked = walk("apps/web/app/(app)")
    .filter((f) => f.endsWith("page.tsx"))
    .filter((f) => {
      const src = read(f) ?? "";
      return !/lib\/data\//.test(src) && !/DemoFigures/.test(src);
    });
  check(
    3,
    "FEAT-DEMO",
    "Every /[org] screen either reads lib/data or says its figures are demo",
    unmarked.length === 0,
    "fail",
    unmarked.map((f) => f.replace("apps/web/app", "")).join(", "),
  );
}

/* ── Report ─────────────────────────────────────────────────────────────── */

const failed = results.filter((r) => !r.ok && r.severity === "fail");
const warned = results.filter((r) => !r.ok && r.severity === "warn");

if (AS_JSON) {
  console.log(JSON.stringify({ results, failed: failed.length, warned: warned.length }, null, 2));
} else {
  const byPhase = new Map();
  for (const r of results) {
    if (!byPhase.has(r.phase)) byPhase.set(r.phase, []);
    byPhase.get(r.phase).push(r);
  }
  for (const phase of [...byPhase.keys()].sort((a, b) => a - b)) {
    console.log(`\n── Phase ${phase} ${"─".repeat(56)}`);
    for (const r of byPhase.get(phase)) {
      const mark = r.ok ? " ok " : r.severity === "fail" ? "FAIL" : "warn";
      console.log(`  [${mark}] ${r.id.padEnd(22)} ${r.title}`);
      if (!r.ok && r.detail) console.log(`         ${r.detail}`);
    }
  }
  console.log(
    `\n${results.length} checks · ${failed.length} failing · ${warned.length} warning\n`,
  );
}

process.exit(failed.length > 0 || (STRICT && warned.length > 0) ? 1 : 0);
