/**
 * `src/types.ts` against the schema the migrations build (debt #14).
 *
 * The row types are hand-written so this package typechecks offline, and
 * nothing compared them to the SQL. A column renamed or dropped in a migration
 * left a field the type promised and the database no longer had, and the
 * first sign was a runtime `undefined`. This applies every migration to PGlite
 * (the harness `schema-reference.ts` uses) and checks, for each interface:
 *
 *   · it maps to a table that exists;
 *   · every field is a column of that table;
 *   · a field typed `| null` is a nullable column, and one that is not is
 *     NOT NULL (or the type is lying about what a reader can receive).
 *
 * The types stay deliberately thin: a column the type leaves out is fine.
 *
 *   node --experimental-strip-types packages/db/scripts/check-types.ts
 */
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(here, "..", "migrations");
const typesFile = path.join(here, "..", "src", "types.ts");

/** Interface → table. An interface missing from here fails the check, so a new one has to be mapped. */
const TABLES: Record<string, string> = {
  Organization: "organizations",
  Membership: "memberships",
  Profile: "profiles",
  Invitation: "invitations",
  Company: "companies",
  Evidence: "evidence",
  Opportunity: "opportunities",
  OpportunityScore: "opportunity_scores",
  Source: "sources",
  CompanyTrigger: "company_triggers",
  Memory: "memories",
};

const STUBS = `
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key default gen_random_uuid(), email text unique, email_confirmed_at timestamptz default now());
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
`;

const db = new PGlite();
await db.exec(STUBS);
const files = (await readdir(migrationsDir)).filter((f) => /^\d{4}_.+\.sql$/.test(f)).sort();
for (const f of files) await db.exec(await readFile(path.join(migrationsDir, f), "utf8"));

const columns = new Map<string, Map<string, boolean>>();
const rows = (await db.query(`
  select table_name, column_name, is_nullable = 'YES' as nullable
  from information_schema.columns where table_schema = 'public'`)).rows as Array<{ table_name: string; column_name: string; nullable: boolean }>;
for (const r of rows) {
  if (!columns.has(r.table_name)) columns.set(r.table_name, new Map());
  columns.get(r.table_name)!.set(r.column_name, r.nullable);
}

const source = (await readFile(typesFile, "utf8")).replace(/\r\n/g, "\n");
/* Comments out first, so a `/** NULL for … *\/` line is not read as a field. */
const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

const problems: string[] = [];
let fields = 0;

for (const match of code.matchAll(/export interface (\w+) \{([\s\S]*?)\n\}/g)) {
  const name = match[1] ?? "";
  const body = match[2] ?? "";
  const table = TABLES[name];
  if (!table) {
    problems.push(`${name}: not mapped to a table in check-types.ts`);
    continue;
  }
  const cols = columns.get(table);
  if (!cols) {
    problems.push(`${name}: table ${table} does not exist`);
    continue;
  }
  for (const line of body.split("\n")) {
    const field = line.match(/^\s+"?(\w+)"?(\?)?:\s*(.+);\s*$/);
    if (!field) continue;
    const column = field[1] ?? "";
    const optional = field[2];
    const type = field[3] ?? "";
    fields++;
    if (!cols.has(column)) {
      problems.push(`${name}.${column}: ${table} has no such column`);
      continue;
    }
    const typedNullable = /\|\s*null\b|\bnull\s*\|/.test(type) || optional === "?";
    const dbNullable = cols.get(column)!;
    if (typedNullable !== dbNullable) {
      problems.push(
        `${name}.${column}: typed ${typedNullable ? "nullable" : "non-null"}, but ${table}.${column} is ${dbNullable ? "nullable" : "NOT NULL"}`,
      );
    }
  }
}

for (const name of Object.keys(TABLES)) {
  if (!new RegExp(`export interface ${name} \\{`).test(code)) problems.push(`${name}: mapped but no longer in types.ts`);
}

if (problems.length) {
  console.error(`FAIL — src/types.ts disagrees with the migrations:\n  ${problems.join("\n  ")}`);
  process.exit(1);
}
console.log(`PASS — ${Object.keys(TABLES).length} row types, ${fields} fields, all match the migrated schema`);
