/**
 * Fails if anything under apps/ imports the service-role client, and if
 * anything under packages/ imports it outside the short list that may.
 *
 * Plan D2 specifies an ESLint `no-restricted-imports` rule for this. ESLint is
 * not configured in this repo yet, and the rule is too important to wait for
 * it — a leak here is the one failure mode in the architecture rated Critical
 * with no recovery. This script needs no dependencies and runs in CI today;
 * when ESLint lands, keep both. Two cheap checks on the highest-severity risk
 * is not redundancy worth trimming.
 *
 * ── Why the second check exists ──────────────────────────────────────────
 *
 * The first one greps apps/ for the import. That was sufficient while nothing
 * else in the repo used the client — and it stopped being sufficient the day
 * `@huntloop/jobs` did, because `apps/web` imports that package and the grep
 * does not follow imports.
 *
 * The right answer is not to widen the grep into a module-graph walk. It is to
 * name, in one place, every file that may hold the bypass, and to fail when
 * that list grows without anyone deciding it should. `admin.ts` already states
 * the three legitimate callers; this is that paragraph, enforced.
 *
 *   npm run check:admin-imports --workspace @huntloop/db
 */
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..", "..");
const appsDir = path.join(repoRoot, "apps");

/** Matches `@huntloop/db/admin`, `../db/src/admin`, `createAdminClient`. */
const FORBIDDEN = [
  /@huntloop\/db\/admin/,
  /["'`][^"'`]*\/db\/src\/admin["'`]/,
  /\bcreateAdminClient\b/,
];

/**
 * A type-only import is erased before anything runs.
 *
 * `import type { AdminClient }` names the shape of the client without being
 * able to construct one, so a file that only does that has not reached the
 * bypass. A mixed import — `import { createAdminClient, type AdminClient }` —
 * is a value import and is still caught, because the line does not start with
 * `import type`.
 */
const TYPE_ONLY = /^import\s+type\s/;

const SKIP_DIRS = new Set(["node_modules", ".next", "dist", "build", ".turbo"]);
const CODE = /\.(ts|tsx|js|jsx|mjs|cjs)$/;

/**
 * Every file in packages/ that may reach the service-role client.
 *
 * Matches `admin.ts`'s own list of legitimate callers:
 *
 *   packages/db/src/admin.ts        defines it
 *   packages/db/scripts/seed.ts     a seed, run by hand against one project
 *   packages/db/scripts/doctor.ts   reads schema state, no tenant rows
 *   packages/jobs/src/scope.ts      background jobs — the only runtime use,
 *                                   and it is behind OrgScope, which binds
 *                                   every query to one org id mechanically
 *
 * Adding a path here is a decision about the tenant boundary. It should be
 * hard to do by accident, which is the entire purpose of the list.
 */
const ALLOWED = new Set([
  "packages/db/src/admin.ts",
  "packages/db/scripts/seed.ts",
  "packages/db/scripts/doctor.ts",
  "packages/db/scripts/check-admin-imports.ts",
  "packages/jobs/src/scope.ts",
]);

async function* walk(dir: string): AsyncGenerator<string> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return; // apps/ may not exist yet in a fresh checkout
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) yield* walk(full);
    } else if (CODE.test(e.name)) {
      yield full;
    }
  }
}

const violations: string[] = [];
let scanned = 0;

for await (const file of walk(appsDir)) {
  scanned++;
  const text = await readFile(file, "utf8");
  text.split("\n").forEach((line, i) => {
    // Skip comments — this file's own documentation mentions the symbol, and
    // so will any doc comment explaining the rule.
    const trimmed = line.trim();
    if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) return;
    if (TYPE_ONLY.test(trimmed)) return;
    if (FORBIDDEN.some((re) => re.test(line))) {
      violations.push(`${path.relative(repoRoot, file)}:${i + 1}  ${trimmed}`);
    }
  });
}

/* ── packages/, against the allow-list ─────────────────────────────────── */

const packagesDir = path.join(repoRoot, "packages");
const unlisted: string[] = [];
let packageFiles = 0;

for await (const file of walk(packagesDir)) {
  packageFiles++;
  const rel = path.relative(repoRoot, file).split(path.sep).join("/");
  if (ALLOWED.has(rel)) continue;

  const text = await readFile(file, "utf8");
  text.split("\n").forEach((line, i) => {
    const trimmed = line.trim();
    if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) return;
    if (TYPE_ONLY.test(trimmed)) return;
    if (FORBIDDEN.some((re) => re.test(line))) {
      unlisted.push(`${rel}:${i + 1}  ${trimmed}`);
    }
  });
}

if (violations.length > 0) {
  console.error(
    `\nFAIL — the service-role client is reachable from apps/.\n` +
      `It bypasses RLS, which is the tenant boundary (plan D2).\n\n` +
      violations.map((v) => `  ${v}`).join("\n") +
      `\n\nUse createTenantClient() from @huntloop/db instead. If RLS is\n` +
      `blocking a legitimate read, the policy is the bug — fix the policy.\n`,
  );
  process.exit(1);
}

if (unlisted.length > 0) {
  console.error(
    `\nFAIL — the service-role client is used outside the files allowed to.\n` +
      `Each of these bypasses RLS, which is the tenant boundary (plan D2).\n\n` +
      unlisted.map((v) => `  ${v}`).join("\n") +
      `\n\nIf this use is legitimate — a migration, a webhook with no session,\n` +
      `or a background job that has resolved its tenant — add the path to\n` +
      `ALLOWED in this file, in the same commit, so the decision is reviewed.\n`,
  );
  process.exit(1);
}

console.log(
  `PASS — ${scanned} files in apps/ and ${packageFiles} in packages/ scanned; ` +
    `the service-role client is confined to ${ALLOWED.size} named files`,
);
