/**
 * Ad-hoc query runner against the live project, for developing loaders.
 *
 *   node scripts/query.mjs '<table>' '<select>' '[filters json]'
 *
 * Uses the secret key, so it bypasses RLS — it exists to check that a SELECT
 * *shape* is one PostgREST can answer, which is the failure mode the roadmap
 * records as "a query that reads as finished and has never returned a row".
 * It is a development tool and is never imported by the app.
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

for (const line of readFileSync("apps/web/.env.local", "utf8").split(/\r?\n/)) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
  if (m && m[2]) process.env[m[1]] ??= m[2].trim().replace(/^["']|["']$/g, "");
}

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY,
  { auth: { persistSession: false } },
);

const [table, select = "*", filtersJson = "{}"] = process.argv.slice(2);
let q = db.from(table).select(select);
for (const [k, v] of Object.entries(JSON.parse(filtersJson))) {
  if (k === "limit") q = q.limit(v);
  else if (k === "isNull") q = q.is(v, null);
  else q = q.eq(k, v);
}
const { data, error } = await q;
if (error) {
  console.error("ERROR", JSON.stringify(error, null, 2));
  process.exit(1);
}
console.log(JSON.stringify(data, null, 2).slice(0, 4000));
console.log(`\n${data?.length ?? 0} row(s)`);
