/**
 * Generates docs/spec/generated/schema-reference.md from the migrations.
 *
 * Applies every NNNN_*.sql migration to an in-memory Postgres (PGlite — the
 * same harness `verify-migrations.ts` uses) and introspects the result, so the
 * reference reflects what the migrations actually build rather than what a
 * document says they build. Read-only with respect to the repository apart
 * from the one output file.
 *
 *   node --experimental-strip-types packages/db/scripts/schema-reference.ts
 *
 * With `--check` it writes nothing and exits 1 when the committed file no
 * longer matches the migrations — the CI half (`check:schema-reference` in
 * packages/db, part of its `test`), so a migration that changes the schema has
 * to regenerate the reference in the same change.
 */
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(here, "..", "migrations");
const outFile = path.join(here, "..", "..", "..", "docs", "spec", "generated", "schema-reference.md");

const STUBS = `
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key default gen_random_uuid(), email text unique, email_confirmed_at timestamptz default now());
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
`;

const db = new PGlite();
await db.exec(STUBS);

const files = (await readdir(migrationsDir)).filter((f) => /^\d{4}_.+\.sql$/.test(f)).sort();
for (const f of files) {
  await db.exec(await readFile(path.join(migrationsDir, f), "utf8"));
}

type Row = Record<string, unknown>;
const q = async (sql: string): Promise<Row[]> => (await db.query(sql)).rows as Row[];

const tables = await q(`
  select c.relname as name, c.relrowsecurity as rls, c.relforcerowsecurity as forced, c.relkind as kind,
         obj_description(c.oid) as comment
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r','p','v','m')
  order by c.relkind, c.relname`);

const columns = await q(`
  select c.relname as tbl, a.attname as col, format_type(a.atttypid, a.atttypmod) as type,
         a.attnotnull as notnull, pg_get_expr(d.adbin, d.adrelid) as dflt, a.attnum
  from pg_attribute a
  join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
  left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
  where n.nspname = 'public' and c.relkind in ('r','p') and a.attnum > 0 and not a.attisdropped
  order by c.relname, a.attnum`);

const constraints = await q(`
  select c.relname as tbl, con.conname as name, con.contype as type, pg_get_constraintdef(con.oid) as def
  from pg_constraint con join pg_class c on c.oid = con.conrelid join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' order by c.relname, con.contype, con.conname`);

const indexes = await q(`
  select tablename as tbl, indexname as name, indexdef as def from pg_indexes
  where schemaname = 'public' order by tablename, indexname`);

const policies = await q(`
  select tablename as tbl, policyname as name, cmd, roles::text as roles, qual, with_check
  from pg_policies where schemaname = 'public' order by tablename, policyname`);

const triggers = await q(`
  select c.relname as tbl, t.tgname as name, pg_get_triggerdef(t.oid) as def
  from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and not t.tgisinternal order by c.relname, t.tgname`);

const enums = await q(`
  select t.typname as name, string_agg(e.enumlabel, ', ' order by e.enumsortorder) as labels
  from pg_type t join pg_enum e on e.enumtypid = t.oid join pg_namespace n on n.oid = t.typnamespace
  where n.nspname = 'public' group by t.typname order by t.typname`);

const functions = await q(`
  select p.proname as name, pg_get_function_identity_arguments(p.oid) as args,
         pg_get_function_result(p.oid) as result, p.prosecdef as definer, p.provolatile as vol
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prokind = 'f' order by p.proname, args`);

const views = tables.filter((t) => t.kind === "v" || t.kind === "m");
const base = tables.filter((t) => t.kind === "r" || t.kind === "p");

const by = <T extends Row>(rows: T[], key = "tbl") => {
  const m = new Map<string, T[]>();
  for (const r of rows) {
    const k = String(r[key]);
    (m.get(k) ?? m.set(k, []).get(k)!).push(r);
  }
  return m;
};
const colsBy = by(columns), conBy = by(constraints), idxBy = by(indexes), polBy = by(policies), trgBy = by(triggers);
const esc = (s: unknown) => String(s ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
const CT: Record<string, string> = { p: "PK", f: "FK", u: "UNIQUE", c: "CHECK", x: "EXCLUDE" };

const out: string[] = [];
out.push(`---
description: Generated column-level schema reference, introspected from the migrations. Do not edit by hand.
---

# Schema reference (generated)

> **Generated** by \`packages/db/scripts/schema-reference.ts\` by applying all ${files.length} migrations
> (\`${files[0]}\` … \`${files.at(-1)}\`) to an in-memory Postgres (PGlite) and reading the catalog.
> It is evidence for [05-backend-database-schema.md](../05-backend-database-schema.md); that document
> carries the interpretation. Re-generate rather than editing.

**Totals:** ${base.length} tables · ${views.length} views · ${functions.length} public functions · ${enums.length} enum types · ${policies.length} RLS policies · ${indexes.length} indexes · ${triggers.length} triggers.

**RLS enabled on:** ${base.filter((t) => t.rls).length} of ${base.length} tables.
${base.filter((t) => !t.rls).length ? `**RLS NOT enabled on:** ${base.filter((t) => !t.rls).map((t) => "`" + t.name + "`").join(", ")}\n` : ""}
## Contents

${base.map((t) => `[\`${t.name}\`](#${t.name})`).join(" · ")}

---
`);

for (const t of base) {
  const name = String(t.name);
  out.push(`## ${name}\n`);
  out.push(`RLS: **${t.rls ? "enabled" : "NOT enabled"}**${t.forced ? " (forced)" : ""}\n`);
  out.push(`| Column | Type | Null | Default |\n|---|---|---|---|`);
  for (const c of colsBy.get(name) ?? []) {
    out.push(`| \`${c.col}\` | ${esc(c.type)} | ${c.notnull ? "NOT NULL" : "null"} | ${c.dflt ? "`" + esc(c.dflt) + "`" : ""} |`);
  }
  const cons = conBy.get(name) ?? [];
  if (cons.length) {
    out.push(`\n**Constraints**\n`);
    for (const k of cons) out.push(`- ${CT[String(k.type)] ?? k.type} \`${k.name}\` — \`${esc(k.def)}\``);
  }
  const ix = (idxBy.get(name) ?? []).filter((i) => !cons.some((k) => k.name === i.name));
  if (ix.length) {
    out.push(`\n**Indexes**\n`);
    for (const i of ix) out.push(`- \`${i.name}\` — \`${esc(i.def).replace(/^CREATE (UNIQUE )?INDEX \S+ ON public\./, (m, u) => (u ? "UNIQUE " : "") + "")}\``);
  }
  const pol = polBy.get(name) ?? [];
  if (pol.length) {
    out.push(`\n**Policies**\n`);
    for (const p of pol) {
      out.push(`- \`${p.name}\` — ${p.cmd}${p.qual ? ` USING \`${esc(p.qual)}\`` : ""}${p.with_check ? ` WITH CHECK \`${esc(p.with_check)}\`` : ""}`);
    }
  }
  const tr = trgBy.get(name) ?? [];
  if (tr.length) {
    out.push(`\n**Triggers**\n`);
    for (const g of tr) out.push(`- \`${g.name}\``);
  }
  out.push("");
}

out.push(`## Views\n`);
for (const v of views) out.push(`- \`${v.name}\`${v.kind === "m" ? " (materialized)" : ""}`);
out.push(`\n## Enum types\n`);
out.push(enums.length ? enums.map((e) => `- \`${e.name}\`: ${e.labels}`).join("\n") : "_None — the schema uses CHECK constraints on text columns instead of Postgres enums._");
out.push(`\n## Functions (public schema)\n\n| Function | Arguments | Returns | SECURITY DEFINER |\n|---|---|---|---|`);
for (const f of functions) out.push(`| \`${f.name}\` | ${esc(f.args) ? "`" + esc(f.args) + "`" : ""} | ${esc(f.result)} | ${f.definer ? "yes" : ""} |`);
out.push("");

const rendered = out.join("\n");
if (process.argv.includes("--check")) {
  const committed = await readFile(outFile, "utf8").catch(() => "");
  // Line endings are the checkout's business, not the schema's.
  if (committed.replace(/\r\n/g, "\n") !== rendered) {
    console.error(
      `${path.relative(process.cwd(), outFile)} is out of date with the migrations. Regenerate it:\n` +
        "  node --experimental-strip-types packages/db/scripts/schema-reference.ts",
    );
    process.exit(1);
  }
  console.log(`schema reference is current: ${base.length} tables, ${views.length} views, ${functions.length} functions`);
  process.exit(0);
}

await mkdir(path.dirname(outFile), { recursive: true });
await writeFile(outFile, rendered);
console.log(`wrote ${outFile}: ${base.length} tables, ${views.length} views, ${functions.length} functions, ${policies.length} policies`);
