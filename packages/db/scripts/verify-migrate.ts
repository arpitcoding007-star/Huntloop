/**
 * The migrator's ledger, against a real Postgres (PGlite).
 *
 * What matters: a migration runs once; a failing one leaves no ledger row and
 * nothing half-applied; a hand-migrated database is refused until it is
 * baselined, and baselined migrations are recorded without being run.
 */
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { BaselineRequired, migrate, type Executor } from "./migrate.ts";

let checks = 0;
let failures = 0;
function expect(name: string, condition: boolean, detail: unknown = "expected true") {
  checks++;
  if (condition) console.log(`  ✓ ${name}`);
  else {
    failures++;
    console.log(`  ✗ ${name}\n      ${typeof detail === "string" ? detail : JSON.stringify(detail)}`);
  }
}

function pglite(db: PGlite): Executor {
  return {
    async column(sql) {
      const r = await db.query<Record<string, unknown>>(sql);
      return r.rows.map((row) => String(Object.values(row)[0] ?? "")).filter((v) => v !== "" && v !== "null");
    },
    async apply(file, sql) {
      await db.transaction(async (tx) => {
        await tx.exec(sql);
        await tx.query(`insert into public.schema_migrations (filename) values ($1)`, [file]);
      });
    },
  };
}

const dir = await mkdtemp(path.join(tmpdir(), "huntloop-migrate-"));
await writeFile(path.join(dir, "0001_orgs.sql"), "create table public.organizations (id int primary key);");
await writeFile(path.join(dir, "0002_widgets.sql"), "create table public.widgets (id int primary key);");
await writeFile(path.join(dir, "README.md"), "not a migration");
const quiet = () => {};

console.log("\nmigrate — a fresh database");
{
  const db = new PGlite();
  const first = await migrate(pglite(db), dir, null, quiet);
  expect("applies every migration, in order", JSON.stringify(first) === JSON.stringify(["0001_orgs.sql", "0002_widgets.sql"]), first);
  const again = await migrate(pglite(db), dir, null, quiet);
  expect("and on the second run applies nothing", again.length === 0, again);

  await writeFile(path.join(dir, "0003_broken.sql"), "create table public.gadgets (id int primary key); select * from nowhere;");
  let threw = false;
  try {
    await migrate(pglite(db), dir, null, quiet);
  } catch {
    threw = true;
  }
  expect("a failing migration stops the run", threw);
  const ledger = await db.query<{ filename: string }>(`select filename from public.schema_migrations where filename like '0003%'`);
  expect("and leaves no ledger row, so it is retried", ledger.rows.length === 0);
  const half = await db.query<{ t: string | null }>(`select to_regclass('public.gadgets')::text as t`);
  expect("and nothing half-applied", half.rows[0]?.t === null, half.rows[0]);

  await writeFile(path.join(dir, "0003_broken.sql"), "create table public.gadgets (id int primary key);");
  const fixed = await migrate(pglite(db), dir, null, quiet);
  expect("once fixed, it applies", JSON.stringify(fixed) === JSON.stringify(["0003_broken.sql"]), fixed);
}

console.log("\nmigrate — a database migrated by hand");
{
  const db = new PGlite();
  await db.exec("create table public.organizations (id int primary key); create table public.widgets (id int primary key);");

  let refused = false;
  try {
    await migrate(pglite(db), dir, null, quiet);
  } catch (e) {
    refused = e instanceof BaselineRequired;
  }
  expect("is refused without a baseline rather than re-run from 0001", refused);

  const applied = await migrate(pglite(db), dir, 2, quiet);
  expect("with MIGRATIONS_BASELINE=2, only 0003 runs", JSON.stringify(applied) === JSON.stringify(["0003_broken.sql"]), applied);
  const recorded = await db.query<{ n: number }>(`select count(*)::int as n from public.schema_migrations`);
  expect("and 0001–0002 are recorded without being run", recorded.rows[0]?.n === 3, recorded.rows[0]);
}

console.log(`\n${failures === 0 ? "PASS" : "FAIL"} — ${checks - failures}/${checks} checks passed\n`);
process.exit(failures === 0 ? 0 : 1);
