/**
 * Apply the repository's migrations to a database, once each, in order (P1-6).
 *
 *   DATABASE_URL=postgres://… node --experimental-strip-types scripts/migrate.ts
 *
 * Migrations were applied by hand in the Supabase SQL editor, which is how
 * production ended up two migrations behind the code that needed them. This
 * keeps a ledger, `public.schema_migrations`, and applies only what is not in
 * it — each file and its ledger row in one transaction, so a failed migration
 * leaves no row and is retried next time, and a passed one is never re-run.
 *
 * ── An existing database ─────────────────────────────────────────────────
 *
 * A database migrated by hand has tables and no ledger. Applying from 0001 to
 * it would fail on the first `create table`, so the first run refuses until
 * `MIGRATIONS_BASELINE=NNNN` says which migrations it already has; those are
 * recorded without being run. `npm run db:doctor` reports the right number.
 *
 * Runs `psql`, which every CI runner has, rather than adding a driver.
 */
import { execFileSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface Executor {
  /** Run SQL and return the first column of each row, as text. */
  column(sql: string): Promise<string[]>;
  /** Run one migration file and record it, in a single transaction. */
  apply(file: string, sql: string): Promise<void>;
}

const MIGRATION_FILE = /^\d{4}_.+\.sql$/;
const LEDGER = `create table if not exists public.schema_migrations (
  filename   text primary key,
  applied_at timestamptz not null default now()
)`;

export async function listMigrations(dir: string): Promise<string[]> {
  return (await readdir(dir)).filter((f) => MIGRATION_FILE.test(f)).sort();
}

export class BaselineRequired extends Error {}

export async function plan(exec: Executor, files: string[], baseline: number | null): Promise<string[]> {
  const hadTables = (await exec.column(`select to_regclass('public.organizations')::text`))[0];
  await exec.column(LEDGER);
  let applied = new Set(await exec.column(`select filename from public.schema_migrations`));

  if (applied.size === 0 && hadTables) {
    if (baseline === null) {
      throw new BaselineRequired(
        "This database has tables and no migration ledger: it was migrated by hand. " +
          "Set MIGRATIONS_BASELINE to the last migration it already has (npm run db:doctor reports it).",
      );
    }
    const known = files.filter((f) => Number(f.slice(0, 4)) <= baseline);
    for (const f of known) {
      await exec.column(`insert into public.schema_migrations (filename) values (${literal(f)}) on conflict do nothing`);
    }
    applied = new Set(known);
  }

  return files.filter((f) => !applied.has(f));
}

export async function migrate(
  exec: Executor,
  dir: string,
  baseline: number | null,
  log: (line: string) => void = console.log,
): Promise<string[]> {
  const todo = await plan(exec, await listMigrations(dir), baseline);
  for (const file of todo) {
    log(`applying ${file}`);
    await exec.apply(file, await readFile(path.join(dir, file), "utf8"));
  }
  log(todo.length ? `applied ${todo.length}` : "up to date");
  return todo;
}

export function literal(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function psql(url: string, dir: string): Executor {
  const run = (args: string[]) =>
    execFileSync("psql", [url, "-X", "-q", "-v", "ON_ERROR_STOP=1", ...args], { encoding: "utf8" });
  return {
    async column(sql) {
      return run(["-At", "-c", sql]).split("\n").filter((l) => l.length > 0);
    },
    async apply(file) {
      run([
        "--single-transaction",
        "-f", path.join(dir, file),
        "-c", `insert into public.schema_migrations (filename) values (${literal(file)})`,
      ]);
    },
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    console.error("DATABASE_URL is not set.");
    process.exit(1);
  }
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "migrations");
  const raw = process.env.MIGRATIONS_BASELINE?.trim();
  try {
    await migrate(psql(url, dir), dir, raw ? Number(raw) : null);
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  }
}
