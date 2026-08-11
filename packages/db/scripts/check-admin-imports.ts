/**
 * Fails if anything under apps/ imports the service-role client.
 *
 * Plan D2 specifies an ESLint `no-restricted-imports` rule for this. ESLint is
 * not configured in this repo yet, and the rule is too important to wait for
 * it — a leak here is the one failure mode in the architecture rated Critical
 * with no recovery. This script needs no dependencies and runs in CI today;
 * when ESLint lands, keep both. Two cheap checks on the highest-severity risk
 * is not redundancy worth trimming.
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

const SKIP_DIRS = new Set(["node_modules", ".next", "dist", "build", ".turbo"]);
const CODE = /\.(ts|tsx|js|jsx|mjs|cjs)$/;

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
    if (FORBIDDEN.some((re) => re.test(line))) {
      violations.push(`${path.relative(repoRoot, file)}:${i + 1}  ${trimmed}`);
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

console.log(`PASS — ${scanned} files scanned, no admin-client imports in apps/`);
