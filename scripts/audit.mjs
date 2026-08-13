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

  // Matched against the header *value*, not the file. This config discusses
  // script-src in a comment explaining why it is absent, and a check that
  // reads prose would report the explanation as the implementation.
  const cspValue =
    nextConfig.match(/"Content-Security-Policy",\s*value:\s*"([^"]*)"/)?.[1] ?? "";
  check(
    5,
    "SEC-CSP",
    "A script-src Content-Security-Policy is in place",
    /script-src/.test(cspValue),
    "warn",
    `Current policy: ${cspValue || "none"}. A nonce-based script-src needs middleware work — see BACKLOG SEC-03.`,
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

  const anyValidation = ["zod", "valibot", "yup"].some((lib) =>
    (read("apps/web/package.json") ?? "").includes(`"${lib}"`),
  );
  check(
    5,
    "SEC-VAL",
    "A schema validator guards Server Action inputs",
    anyValidation,
    "warn",
    "Action arguments are currently typed but not validated at runtime.",
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
  const mw = read("apps/web/middleware.ts") ?? "";
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
