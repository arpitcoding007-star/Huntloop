/**
 * Exchange load test (build plan Phase 4): matching recall, supplier cards,
 * alert fan-out and market demand at a size well past launch, on PGlite.
 *
 *   npm run load:exchange -w @huntloop/db
 *
 * PGlite is single-threaded WASM, several times slower than Postgres, so the
 * ceilings below are generous and catch a query that stopped scaling rather
 * than one that got a little slower. It measures SQL; it says nothing about
 * connection limits or the model.
 */
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(here, "..", "migrations");

const SUPABASE_STUBS = `
create schema if not exists auth;

create table if not exists auth.users (
  id                 uuid primary key default gen_random_uuid(),
  email              text unique,
  -- Supabase sets this once the address is proven (magic link, OAuth). A
  -- fixture user is a confirmed one unless a test says otherwise.
  email_confirmed_at timestamptz default now()
);

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
`;

const db = new PGlite();
await db.exec(SUPABASE_STUBS);

const files = (await readdir(migrationsDir)).filter((f) => /^\d{4}_.+\.sql$/.test(f)).sort();
for (const f of files) {
  await db.exec(await readFile(path.join(migrationsDir, f), "utf8"));
}
// What PostgREST runs as. Functions keep their default PUBLIC EXECUTE, as on
// Supabase, so a migration's REVOKE is what decides who may call them.
await db.exec(`
  create role authenticated nologin;
  create role anon nologin;
  grant usage on schema public to authenticated, anon;
  grant select, insert, update, delete on all tables in schema public to authenticated;
  grant usage on schema auth to authenticated, anon;
  grant select on auth.users to authenticated;
`);


const NEEDS = 5_000;
const OFFERINGS = 5_000;
const SUPPLIERS = 250;
const HOT_CARDS = 2_000;

await db.exec(`
  update plans set limits = limits || '{"seats": 1000}'::jsonb where id = 'free';
  insert into auth.users (id, email) select ('00000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid, 'u' || i || '@load.test' from generate_series(0, ${SUPPLIERS}) i;
  insert into organizations (id, name, slug) select ('10000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid, 'Org ' || i, 'load-' || i from generate_series(0, ${SUPPLIERS}) i;
  insert into memberships (org_id, user_id, role) select ('10000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid, ('00000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid, 'owner' from generate_series(0, ${SUPPLIERS}) i;
  insert into exchange_provider_profiles (id, org_id, name, claimed_at) select ('20000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid, ('10000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid, 'Supplier ' || i, now() from generate_series(1, ${SUPPLIERS}) i;
`);
const cat = (await db.query<{ id: string }>(`select id from exchange_categories where slug = 'gpus-accelerators'`)).rows[0]!.id;
await db.exec(`
  insert into exchange_offerings (provider_id, category_id, title, description, status, serves_global)
    select ('20000000-0000-4000-8000-' || lpad((1 + i % ${SUPPLIERS})::text, 12, '0'))::uuid, '${cat}', 'H' || (i % 90) || ' accelerator cards', 'Data centre accelerators, batch ' || i, 'active', true from generate_series(1, ${OFFERINGS}) i;
  insert into exchange_needs (org_id, created_by, category_id, summary, visibility, country, quantity, intent_band)
    select '10000000-0000-4000-8000-000000000000', '00000000-0000-4000-8000-000000000000', '${cat}', 'H' || (i % 90) || ' accelerator cards for training ' || i, 2 + i % 2, (array['DE','IN','US','FR','JP'])[1 + i % 5], 1 + i % 500, 'warm' from generate_series(1, ${NEEDS}) i;
  insert into exchange_matches (need_id, offering_id, score)
    select n.id, o.id, 60 from (select id, row_number() over (order by id) r from exchange_needs) n
      join (select id, row_number() over (order by id) r from exchange_offerings where provider_id = '20000000-0000-4000-8000-000000000001') o on o.r = 1 where n.r <= ${HOT_CARDS};
  insert into exchange_matches (need_id, offering_id, score)
    select n.id, o.id, 70 from (select id, row_number() over (order by id) r from exchange_needs) n
      join (select id, row_number() over (order by id) r from exchange_offerings where provider_id <> '20000000-0000-4000-8000-000000000001') o on o.r = n.r
    on conflict do nothing;
  analyze;
`);

let failed = 0;
async function timed(name: string, ceilingMs: number, run: () => Promise<number>) {
  const t = performance.now();
  const rows = await run();
  const ms = Math.round(performance.now() - t);
  const good = ms <= ceilingMs;
  if (!good) failed += 1;
  console.log(`  ${good ? "ok" : "FAIL"}   ${name}: ${ms} ms, ${rows} rows (ceiling ${ceilingMs} ms)`);
}
const rows = async (sql: string, args: unknown[] = []) => (await db.query(sql, args)).rows.length;
await db.query(`update exchange_categories set matching_enabled = true where id = $1`, [cat]);
await timed("which requests to match next", 4_000, () => rows(`select * from public.exchange_needs_due(200)`));
const need = (await db.query<{ id: string }>(`select id from exchange_needs limit 1`)).rows[0]!.id;
await timed("recall for one request, 5,000 offerings", 2_000, () => rows(`select * from public.exchange_recall_offerings($1, 500)`, [need]));
await timed("alert fan-out, first run", 20_000, () => rows(`select * from public.exchange_queue_notifications()`));
await timed("alert fan-out, nothing new", 10_000, () => rows(`select * from public.exchange_queue_notifications()`));
await db.exec(`set role authenticated`);
await db.query(`select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000001', false)`);
await timed("supplier cards, 2,000 matches", 3_000, () => rows(`select * from public.exchange_matched_cards('10000000-0000-4000-8000-000000000001')`));
await timed("supplier cards, read again", 3_000, () => rows(`select * from public.exchange_matched_cards('10000000-0000-4000-8000-000000000001')`));
await db.exec(`reset role`);
console.log(failed ? `\n${failed} over the ceiling` : "\nWithin every ceiling");
process.exit(failed ? 1 : 0);
