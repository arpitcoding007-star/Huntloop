/**
 * Security review of the Exchange's visibility functions, as a test (build
 * plan Phase 4).
 *
 *   npm run test:exchange-security -w @huntloop/db   (part of `npm test`)
 *
 * verify-migrations.ts asserts each rule where it was written. This asks the
 * opposite question, of everything at once and from the catalogue rather than
 * a list: as a signed-out caller, and as a member of an unrelated workspace,
 * what can be reached? A function or table added later is covered without
 * anybody remembering to add it here.
 *
 * The roles exist before the migrations and get Supabase's default grants, so
 * a missing REVOKE is an exposure here exactly as it is in production.
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const migrationsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "migrations");
const db = new PGlite();
await db.exec(`
  create schema if not exists auth;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text unique, email_confirmed_at timestamptz default now());
  create or replace function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  grant usage on schema public, auth to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
`);
for (const f of (await readdir(migrationsDir)).filter((f) => /^\d{4}_.+\.sql$/.test(f)).sort()) {
  await db.exec(await readFile(path.join(migrationsDir, f), "utf8"));
}

let failures = 0;
const check = (name: string, bad: string[]) => {
  if (bad.length) failures += 1;
  console.log(`  ${bad.length ? "FAIL" : "ok  "} ${name}${bad.length ? `\n         ${bad.join("\n         ")}` : ""}`);
};

const BUYER_ORG = "aaaaaaaa-0000-4000-8000-00000000000a";
const SUPPLIER_ORG = "bbbbbbbb-0000-4000-8000-00000000000b";
const STRANGER_ORG = "cccccccc-0000-4000-8000-00000000000c";
const BUYER = "a0000000-0000-4000-8000-000000000001";
const SUPPLIER = "b0000000-0000-4000-8000-000000000001";
const STRANGER = "c0000000-0000-4000-8000-000000000001";
const SECRET = "SECRET-BUYER-WORDS";

const cat = (await db.query<{ id: string }>(`select id from exchange_categories where slug = 'gpus-accelerators'`)).rows[0]!.id;
const one = async (sql: string, args: unknown[]) => (await db.query<{ id: string }>(sql, args)).rows[0]!.id;
await db.exec(`
  insert into auth.users (id, email) values ('${BUYER}', 'buyer@buyer.test'), ('${SUPPLIER}', 's@supplier.test'), ('${STRANGER}', 'x@stranger.test');
  insert into organizations (id, name, slug) values ('${BUYER_ORG}', 'SECRET-BUYER-NAME', 'buyer'), ('${SUPPLIER_ORG}', 'Supplier', 'supplier'), ('${STRANGER_ORG}', 'Stranger', 'stranger');
  insert into memberships (org_id, user_id, role) values ('${BUYER_ORG}', '${BUYER}', 'owner'), ('${SUPPLIER_ORG}', '${SUPPLIER}', 'owner'), ('${STRANGER_ORG}', '${STRANGER}', 'owner');
`);
const need = await one(`insert into exchange_needs (org_id, created_by, category_id, summary, visibility, quantity, requirement) values ($1, $2, $3, $4, 2, 918273645, $5) returning id`, [BUYER_ORG, BUYER, cat, SECRET, JSON.stringify({ must_haves: { value: SECRET, kind: "fact" } })]);
const provider = await one(`insert into exchange_provider_profiles (org_id, name, claimed_at) values ($1, 'Supplier', now()) returning id`, [SUPPLIER_ORG]);
const offering = await one(`insert into exchange_offerings (provider_id, category_id, title, status) values ($1, $2, 'Cards', 'active') returning id`, [provider, cat]);
const match = await one(`insert into exchange_matches (need_id, offering_id, score) values ($1, $2, 80) returning id`, [need, offering]);
const intro = await one(`insert into exchange_intros (need_id, offering_id, buyer_org_id, provider_org_id, direction, state) values ($1, $2, $3, $4, 'provider', 'requested') returning id`, [need, offering, BUYER_ORG, SUPPLIER_ORG]);
await db.query(`insert into exchange_messages (intro_id, sender_org_id, sender_side, body) values ($1, $2, 'buyer', $3)`, [intro, BUYER_ORG, SECRET]);
const session = await one(`insert into exchange_intake_sessions (org_id, user_id, direction, status) values ($1, $2, 'buy', 'active') returning id`, [BUYER_ORG, BUYER]);
await db.query(`select public.exchange_queue_notifications()`);

const as = async (role: "anon" | "authenticated", user: string) => {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${user}', false); set role ${role}`);
};
const reset = () => db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false)`);

/* ── Who may call what ─────────────────────────────────────────────────── */

type Fn = { oid: string; name: string; sig: string; anon: boolean; authed: boolean; secdef: boolean; args: string[]; names: string[] | null; trig: boolean };
const fns = (
  await db.query<Fn>(`
    select p.oid::text, p.proname as name, p.oid::regprocedure::text as sig, p.prosecdef as secdef,
           has_function_privilege('anon', p.oid, 'execute') as anon,
           has_function_privilege('authenticated', p.oid, 'execute') as authed,
           p.prorettype = 'trigger'::regtype as trig,
           array(select format_type(t, null) from unnest(p.proargtypes) t) as args, p.proargnames as names
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace and p.proname like 'exchange\\_%'`)
).rows;

console.log("\nReach of the Exchange's functions");
check("every definer function pins its search_path",
  (await db.query<{ sig: string }>(`select p.oid::regprocedure::text as sig from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosecdef and p.proname like 'exchange\\_%' and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')`)).rows.map((r) => r.sig));

const callArgs = (f: Fn, org: string) =>
  f.args.map((t, i) => {
    const n = f.names?.[i] ?? "";
    if (t === "uuid") {
      if (/org/.test(n)) return org;
      if (/offering/.test(n)) return offering;
      if (/intro/.test(n)) return intro;
      if (/match/.test(n)) return match;
      if (/session/.test(n)) return session;
      if (/subject|need/.test(n)) return need;
      return need;
    }
    if (/int|numeric/.test(t)) return 1;
    if (t === "boolean") return true;
    if (/uuid\[\]|text\[\]/.test(t)) return "{}";
    if (t === "jsonb") return "{}";
    if (/timestamp|date/.test(t)) return new Date().toISOString();
    return "x";
  });

/** Does anything a caller gets back, or any row it changed, touch the buyer's data? */
const snapshot = async () => {
  await reset();
  return JSON.stringify((await db.query(`
    select (select row_to_json(n) from exchange_needs n where id = $1) as need,
           (select row_to_json(i) from exchange_intros i where id = $2) as intro,
           (select row_to_json(m) from exchange_matches m where id = $3) as match,
           (select row_to_json(o) from exchange_offerings o where id = $4) as offering,
           (select count(*) from exchange_messages) as messages,
           (select count(*) from exchange_outcomes) as outcomes`, [need, intro, match, offering])).rows);
};
const baseline = await snapshot();

async function probe(role: "anon" | "authenticated", user: string, org: string, revealed: (text: string) => boolean) {
  const leaks: string[] = [];
  for (const f of fns) {
    if (f.trig || !(role === "anon" ? f.anon : f.authed)) continue;
    if (f.args.some((t) => /exchange_|record|anyelement|tsvector/.test(t))) continue;
    await as(role, user);
    const holes = f.args.map((t, i) => `$${i + 1}::${t}`).join(", ");
    try {
      const rows = (await db.query(`select * from public.${f.name}(${holes})`, callArgs(f, org))).rows;
      if (revealed(JSON.stringify(rows))) leaks.push(`${f.sig} returned ${JSON.stringify(rows).slice(0, 160)}`);
    } catch {
      // Refused, which is the answer wanted.
    }
    if ((await snapshot()) !== baseline) {
      leaks.push(`${f.sig} changed somebody else's data`);
      break;
    }
  }
  await reset();
  return leaks;
}
const secret = (t: string) => /SECRET|918273645|buyer@buyer/.test(t);

check("signed out: nothing returns or changes a request", await probe("anon", "", BUYER_ORG, secret));
check("an unrelated workspace, naming the buyer's: nothing", await probe("authenticated", STRANGER, BUYER_ORG, secret));
check("an unrelated workspace, naming its own: nothing", await probe("authenticated", STRANGER, STRANGER_ORG, secret));

await as("authenticated", SUPPLIER);
const cards = (await db.query<Record<string, unknown>>(`select * from public.exchange_matched_cards($1)`, [SUPPLIER_ORG])).rows;
await reset();
check("the matched supplier gets a card", cards.length === 1 ? [] : [`${cards.length} cards`]);
check("with no name, no exact amount and no words below level 3", secret(JSON.stringify(cards).replaceAll(need, "").replaceAll(match, "").replaceAll(offering, "").replaceAll(cat, "")) ? [JSON.stringify(cards)] : []);
check("and no column that names the buyer", Object.keys(cards[0] ?? {}).filter((k) => /buyer|org|email|created_by/.test(k)));

/* ── Who may read which rows ───────────────────────────────────────────── */

console.log("\nReach of the Exchange's tables");
const tables = (await db.query<{ t: string; rls: boolean }>(`select c.relname as t, c.relrowsecurity as rls from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and c.relname like 'exchange\\_%'`)).rows;
check("row level security is on for all of them", tables.filter((t) => !t.rls).map((t) => t.t));

/** Meant to be public: the taxonomy, and what suppliers list. */
const PUBLIC = new Set(["exchange_categories", "exchange_provider_profiles", "exchange_offerings", "exchange_offering_evidence"]);
for (const [who, role, user] of [["signed out", "anon", ""], ["an unrelated workspace", "authenticated", STRANGER], ["the supplier, unintroduced", "authenticated", SUPPLIER]] as const) {
  const read: string[] = [];
  for (const { t } of tables) {
    if (PUBLIC.has(t)) continue;
    await as(role, user);
    try {
      const rows = (await db.query(`select * from public.${t}`)).rows;
      if (secret(JSON.stringify(rows))) read.push(t);
    } catch {
      // No grant.
    }
  }
  await reset();
  check(`${who}: no request, name or message in any table`, read);
}

console.log(failures ? `\n${failures} exposures` : "\nNo exposure");
process.exit(failures ? 1 : 0);
