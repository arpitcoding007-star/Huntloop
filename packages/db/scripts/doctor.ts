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
import { readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(here, "..", "migrations");
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
 *
 * When a new migration adds a table the app cannot run without, also bump
 * `LATEST_TABLE` in apps/web/lib/schema.ts: that is what a production
 * deployment checks before it agrees to serve the app instead of a 503.
 */
const MIGRATIONS: { file: string; probe: string; kind: "table" | "rpc" }[] = [
  { file: "0001_identity.sql", probe: "audit_logs", kind: "table" },
  { file: "0002_icp_sources_evidence.sql", probe: "source_events", kind: "table" },
  { file: "0003_companies_opportunities.sql", probe: "opportunity_scores", kind: "table" },
  { file: "0004_outreach_memory_learning.sql", probe: "outcomes", kind: "table" },
  { file: "0005_rate_limits.sql", probe: "consume_rate_limit", kind: "rpc" },
  { file: "0007_profiles_invites_accounting.sql", probe: "invitations", kind: "table" },
  { file: "0008_engine_columns.sql", probe: "requeue_stalled_jobs", kind: "rpc" },
  { file: "0009_service_role_surface.sql", probe: "check_quota_internal", kind: "rpc" },
  { file: "0010_learning_loop.sql", probe: "learning_findings", kind: "table" },
  { file: "0011_providers.sql", probe: "provider_breakers", kind: "table" },
  { file: "0012_entity_identity.sql", probe: "merge_candidates", kind: "table" },
  { file: "0013_icp_v2.sql", probe: "icp_versions", kind: "table" },
  { file: "0014_discovery.sql", probe: "discovery_results", kind: "table" },
  { file: "0015_competitors.sql", probe: "company_competitor_signals", kind: "table" },
  { file: "0016_contacts_scoring_v2.sql", probe: "human_overrides", kind: "table" },
  { file: "0017_outreach_safety.sql", probe: "contact_frequency", kind: "table" },
  { file: "0018_learning_targets.sql", probe: "persona_performance", kind: "table" },
  { file: "0019_ops_views.sql", probe: "queue_pressure", kind: "table" },
  { file: "0020_evidence_v2.sql", probe: "flag_contradictions", kind: "rpc" },
  { file: "0022_evidence_dedupe.sql", probe: "evidence_citations", kind: "table" },
  { file: "0023_score_recompute.sql", probe: "score_recompute_requests", kind: "table" },
  { file: "0024_onboarding.sql", probe: "advance_onboarding", kind: "rpc" },
  { file: "0025_anonymous_research.sql", probe: "public_research", kind: "table" },
  { file: "0027_org_directory.sql", probe: "join_requests", kind: "table" },
  { file: "0028_signals_and_crm.sql", probe: "hubspot_connections", kind: "table" },
  { file: "0029_data_rights.sql", probe: "delete_own_account", kind: "rpc" },
  { file: "0030_create_organization.sql", probe: "create_organization", kind: "rpc" },
  { file: "0031_tenant_write_hardening.sql", probe: "migration_0031_applied", kind: "rpc" },
  { file: "0032_evidence_keys_and_provenance.sql", probe: "migration_0032_applied", kind: "rpc" },
  { file: "0033_send_claim_and_provider_ceiling.sql", probe: "migration_0033_applied", kind: "rpc" },
  { file: "0034_followup_requests.sql", probe: "migration_0034_applied", kind: "rpc" },
  { file: "0035_one_message_per_step.sql", probe: "migration_0035_applied", kind: "rpc" },
  { file: "0036_research_requests.sql", probe: "migration_0036_applied", kind: "rpc" },
  { file: "0037_daily_loop.sql", probe: "migration_0037_applied", kind: "rpc" },
  { file: "0038_discovery_backpressure.sql", probe: "migration_0038_applied", kind: "rpc" },
  { file: "0039_competitor_requests.sql", probe: "migration_0039_applied", kind: "rpc" },
  { file: "0040_brief_value_notifications.sql", probe: "notification_preferences", kind: "table" },
  { file: "0041_workspace_assistant.sql", probe: "migration_0041_applied", kind: "rpc" },
  { file: "0042_demand_intelligence.sql", probe: "demand_themes", kind: "table" },
  { file: "0043_learning_competitors_demand.sql", probe: "migration_0043_applied", kind: "rpc" },
];

/**
 * The list above must cover every file in `migrations/`, minus the ones that
 * create nothing PostgREST can see.
 *
 * Checked rather than trusted, because the failure is silent and this script
 * exists to prevent exactly that class of thing. For most of this project's
 * life the list stopped at `0005` while `0006`–`0010` existed, so
 * `db:doctor` printed "All 5 migrations applied" against a database missing
 * half its schema — a green tick asserting something nobody had checked, which
 * is the §7 failure this tool is supposed to catch in others.
 */
const UNPROBEABLE = new Set([
  "0006_prune_schedule.sql",
  "0021_competitor_evidence.sql",
  "0026_product_research.sql",
  "COMBINED-0024-0027.sql",
]);

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
/* Printed in file order rather than list order, so a reader comparing this
   output against the directory sees the same sequence. */
for (const m of [...MIGRATIONS].sort((a, b) => a.file.localeCompare(b.file))) {
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

/*
 * A migration on disk with no entry above would be invisible here — reported
 * as neither applied nor missing, which is the worst of the three answers.
 */
const onDisk = (await readdir(migrationsDir)).filter((f) => f.endsWith(".sql"));
const covered = new Set([...MIGRATIONS.map((m) => m.file), ...UNPROBEABLE]);
const unlisted = onDisk.filter((f) => !covered.has(f));
if (unlisted.length) {
  console.log(
    `\n✗ ${unlisted.length} migration${unlisted.length === 1 ? "" : "s"} on disk ` +
      `that this script does not check: ${unlisted.join(", ")}.\n` +
      `  Add an entry to MIGRATIONS in packages/db/scripts/doctor.ts, naming\n` +
      `  the last object the file creates. A tool that reports "all applied"\n` +
      `  while ignoring half the directory is worse than no tool.\n`,
  );
  process.exitCode = 1;
}

if (missing > 0) {
  console.log(
    `\n${missing} migration${missing === 1 ? "" : "s"} not applied.\n\n` +
      `Apply the missing files in order, in the Supabase SQL editor —\n` +
      `SETUP.md step 3. Until 0005 is applied every model call refuses, and\n` +
      `says so as a limit rather than a failure.\n`,
  );
  if (process.argv.includes("--bundle")) await writeBundle();
  else console.log(`Run \`npm run db:doctor -- --bundle\` to get them as one paste.\n`);
  process.exitCode = 1;
} else {
  console.log(`\nAll ${MIGRATIONS.length} migrations applied.\n`);
}

/**
 * `--bundle`: every migration from the first missing one to the last, as one
 * file, in one transaction — so applying the backlog is one paste into the
 * SQL editor instead of seventeen, and cannot stop halfway.
 *
 * From the first *missing* file onward rather than only the missing ones:
 * the unprobeable files (0021, 0026) sit between probeable ones and depend on
 * them, and a file after a gap is not safely "applied" just because its probe
 * object exists. Every migration here is additive and was written to be
 * re-runnable against the state before it, which `test:migrations` checks.
 *
 * Written to `packages/db/pending-migrations.sql`, which is gitignored: it is
 * a snapshot of one database's state, not part of the schema.
 */
async function writeBundle(): Promise<void> {
  const { writeFile } = await import("node:fs/promises");
  const ordered = onDisk.filter((f) => /^\d{4}_.+\.sql$/.test(f)).sort();
  const firstMissing = [...MIGRATIONS]
    .sort((a, b) => a.file.localeCompare(b.file))
    .find((m) => !exposed.has(m.probe))?.file;
  if (!firstMissing) return;
  const files = ordered.slice(ordered.indexOf(firstMissing));

  const parts = files.map(
    (f) =>
      `\n-- ${"=".repeat(74)}\n-- ${f}\n-- ${"=".repeat(74)}\n\n` +
      readFileSync(path.join(migrationsDir, f), "utf8").trim() +
      "\n",
  );
  const out = path.join(here, "..", "pending-migrations.sql");
  await writeFile(
    out,
    `-- Huntloop — pending migrations for ${new URL(url!).host}\n` +
      `-- ${files[0]} through ${files[files.length - 1]} (${files.length} files).\n` +
      `-- Generated by \`npm run db:doctor -- --bundle\`. Paste into the Supabase\n` +
      `-- SQL editor and run once. One transaction: it applies completely or not\n` +
      `-- at all. Then run \`npm run db:doctor\` again to confirm.\n\n` +
      `begin;\n${parts.join("")}\ncommit;\n`,
  );
  console.log(`Wrote ${path.relative(repoRoot, out)} — ${files.length} files, ${files[0]} onward.\n`);
}
