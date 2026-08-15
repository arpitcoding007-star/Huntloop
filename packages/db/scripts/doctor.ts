/**
 * Report which migrations a live Supabase project has actually had applied.
 *
 *   node --experimental-strip-types packages/db/scripts/doctor.ts
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 *
 * `isSchemaApplied()` in the app probes one table — `organizations` — and that
 * is the right check for the question it asks ("is this a fresh project or a
 * migrated one?"). It is the wrong check for "is the schema complete", and the
 * difference is not hypothetical: this project was found with 0001–0004
 * applied and 0005 missing, which reports as fully live on every screen while
 * every model call refuses, because `consume_rate_limit()` does not exist.
 *
 * Migrations here are applied by hand in the Supabase SQL editor (SETUP.md
 * step 3), so there is no `schema_migrations` table to consult. This infers
 * the state from what each file creates, which is less precise than a ledger
 * and needs no privileges the app does not already have.
 *
 * Exit code is 1 when anything is missing, so it can gate a deploy script.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..", "..");

function loadEnvLocal(): void {
  try {
    const text = readFileSync(
      path.join(repoRoot, "apps", "web", ".env.local"),
      "utf8",
    );
    for (const line of text.split(/\r?\n/)) {
      const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
      if (!match?.[1]) continue;
      const value = (match[2] ?? "").trim().replace(/^["']|["']$/g, "");
      if (value && process.env[match[1]] === undefined) process.env[match[1]] = value;
    }
  } catch {
    // Absent is fine — the variables may already be exported.
  }
}

loadEnvLocal();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key =
  process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error(
    "\n✗ No Supabase credentials.\n" +
      "  Fill in NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY at\n" +
      "  apps/web/.env.local — see SETUP.md step 2.\n",
  );
  process.exit(1);
}

/**
 * One representative object per migration — the last thing each file creates,
 * so a half-run file reports as missing rather than as applied.
 */
const MIGRATIONS: { file: string; probe: string; kind: "table" | "rpc" }[] = [
  { file: "0001_identity.sql", probe: "audit_logs", kind: "table" },
  { file: "0002_icp_sources_evidence.sql", probe: "source_events", kind: "table" },
  { file: "0003_companies_opportunities.sql", probe: "opportunity_scores", kind: "table" },
  { file: "0004_outreach_memory_learning.sql", probe: "outcomes", kind: "table" },
  { file: "0005_rate_limits.sql", probe: "consume_rate_limit", kind: "rpc" },
];

/**
 * PostgREST publishes an OpenAPI document listing every table and function it
 * can see. One request answers the whole question, and it needs no rows.
 */
const response = await fetch(`${url}/rest/v1/`, {
  headers: { apikey: key, Authorization: `Bearer ${key}` },
});

/*
 * `process.exitCode` rather than `process.exit()` from here on. Node's HTTP
 * pool still holds a keep-alive socket at this point, and forcing exit on
 * Windows aborts inside libuv with an assertion instead of returning a status.
 * Setting the code and letting the script end does the same job calmly.
 */
if (!response.ok) {
  console.error(`\n✗ Could not reach the project: HTTP ${response.status}\n`);
  process.exitCode = 1;
}

const doc = response.ok
  ? ((await response.json()) as { paths?: Record<string, unknown> })
  : { paths: {} };

const exposed = new Set(
  Object.keys(doc.paths ?? {})
    .filter((p) => p !== "/")
    .map((p) => p.replace(/^\/(rpc\/)?/, "")),
);

console.log(`\nProject: ${new URL(url).host}\n`);

let missing = 0;
for (const m of MIGRATIONS) {
  const applied = exposed.has(m.probe);
  if (!applied) missing++;
  console.log(
    `  [${(applied ? "ok" : "MISSING").padEnd(7)}] ${m.file.padEnd(34)} ` +
      `${m.kind === "rpc" ? "function" : "table"} ${m.probe}`,
  );
}

/*
 * 0006 is not in the list above, and cannot be. It creates no table and no
 * function of its own — it schedules `prune_rate_limits()` with pg_cron, and
 * `cron.job` is not reachable through PostgREST. `select * from cron.job` in
 * the SQL editor is the check; see the migration's own header.
 */
console.log(
  `  [${"?".padEnd(7)}] ${"0006_prune_schedule.sql".padEnd(34)} not visible here — run\n` +
    `            "select * from cron.job" in the SQL editor to confirm`,
);

if (missing > 0) {
  console.log(
    `\n${missing} migration${missing === 1 ? "" : "s"} not applied.\n\n` +
      `Apply the missing files in order, in the Supabase SQL editor —\n` +
      `SETUP.md step 3. Until 0005 is applied every model call refuses, and\n` +
      `says so as a limit rather than a failure.\n`,
  );
  process.exitCode = 1;
} else {
  console.log(`\nAll ${MIGRATIONS.length} migrations applied.\n`);
}
