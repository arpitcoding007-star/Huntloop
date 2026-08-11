/**
 * Executes every migration in packages/db/migrations against a real Postgres
 * (PGlite — Postgres compiled to WASM), then asserts the invariants the
 * schema is supposed to enforce.
 *
 * This exists because the dangerous failures in this schema are not syntax
 * errors. They are policies that silently match nothing, CHECK constraints
 * that permit the row they were written to forbid, and an enum whose
 * declaration order quietly inverts an authorization test. None of that is
 * visible by reading the file; all of it fails loudly here.
 *
 *   npm run test:migrations --workspace @huntloop/db
 */
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(here, "..", "migrations");

/**
 * Supabase supplies `auth.users` and `auth.uid()`; PGlite does not. These are
 * the minimum stubs the migrations reference. `auth.uid()` reads a GUC so a
 * test can impersonate a user, which is exactly how PostgREST does it.
 */
const SUPABASE_STUBS = `
create schema if not exists auth;

create table if not exists auth.users (
  id    uuid primary key default gen_random_uuid(),
  email text unique
);

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
`;

let failures = 0;
let checks = 0;

function ok(name: string) {
  checks++;
  console.log(`  ✓ ${name}`);
}

function fail(name: string, detail: unknown) {
  checks++;
  failures++;
  console.error(`  ✗ ${name}\n      ${String(detail).split("\n")[0]}`);
}

/** Asserts the statement is rejected — used for every CHECK constraint. */
async function expectReject(db: PGlite, name: string, sql: string, params: unknown[] = []) {
  try {
    await db.query(sql, params);
    fail(name, "statement was ACCEPTED but should have been rejected");
  } catch {
    ok(name);
  }
}

async function expectAccept(db: PGlite, name: string, sql: string, params: unknown[] = []) {
  try {
    await db.query(sql, params);
    ok(name);
  } catch (e) {
    fail(name, e);
  }
}

const db = new PGlite();
await db.exec(SUPABASE_STUBS);

// ── Run the migrations in order ────────────────────────────────────────────
const files = (await readdir(migrationsDir)).filter((f) => f.endsWith(".sql")).sort();
console.log(`\nRunning ${files.length} migrations`);
for (const f of files) {
  const sql = await readFile(path.join(migrationsDir, f), "utf8");
  try {
    await db.exec(sql);
    ok(f);
  } catch (e) {
    fail(f, e);
    console.error("\nMigrations failed; stopping.\n");
    process.exit(1);
  }
}

// ── Fixtures ───────────────────────────────────────────────────────────────
console.log("\nSeeding fixtures");
await db.exec(`
  insert into auth.users (id, email) values
    ('11111111-1111-1111-1111-111111111111', 'owner@a.test'),
    ('22222222-2222-2222-2222-222222222222', 'viewer@a.test'),
    ('33333333-3333-3333-3333-333333333333', 'owner@b.test');

  insert into organizations (id, name, slug) values
    ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Org A', 'org-a'),
    ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Org B', 'org-b');

  insert into memberships (org_id, user_id, role) values
    ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'owner'),
    ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '22222222-2222-2222-2222-222222222222', 'viewer'),
    ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '33333333-3333-3333-3333-333333333333', 'owner');

  insert into companies (id, org_id, canonical_domain, name) values
    ('c0000000-0000-0000-0000-00000000000a', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'alphio.ai', 'Alphio AI'),
    ('c0000000-0000-0000-0000-00000000000b', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'northwind.co', 'Northwind');

  insert into opportunities (id, org_id, company_id, priority, priority_reason) values
    ('0bbbbbbb-0000-0000-0000-00000000000a', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
     'c0000000-0000-0000-0000-00000000000a', 'hot', 'Funding trigger 3 days old.'),
    ('0bbbbbbb-0000-0000-0000-00000000000b', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
     'c0000000-0000-0000-0000-00000000000b', 'warm', 'Hiring signal.');
`);
ok("fixtures");

// ── §7 — fact/inference/unknown, enforced by CHECK ─────────────────────────
console.log("\nMaster context §7 — a fact cannot exist without a source");
const ORG_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const SUBJ = "c0000000-0000-0000-0000-00000000000a";

await expectReject(
  db,
  "fact without source_url is rejected",
  `insert into evidence (org_id, subject_type, subject_id, claim, kind)
   values ($1, 'company', $2, 'They raised a Series A.', 'fact')`,
  [ORG_A, SUBJ],
);

await expectAccept(
  db,
  "fact with source_url is accepted",
  `insert into evidence (org_id, subject_type, subject_id, claim, kind, source_url, confidence)
   values ($1, 'company', $2, 'They raised a Series A.', 'fact', 'https://example.com/a', 'high')`,
  [ORG_A, SUBJ],
);

await expectAccept(
  db,
  "inference without source_url is accepted",
  `insert into evidence (org_id, subject_type, subject_id, claim, kind, confidence)
   values ($1, 'company', $2, 'They will need custody controls.', 'inference', 'medium')`,
  [ORG_A, SUBJ],
);

await expectReject(
  db,
  "unknown carrying a confidence is rejected",
  `insert into evidence (org_id, subject_type, subject_id, claim, kind, confidence)
   values ($1, 'company', $2, 'Their wallet architecture.', 'unknown', 'high')`,
  [ORG_A, SUBJ],
);

// ── §77 Principle 4 — the verdict always carries its reason ────────────────
console.log("\nMaster context §77 — an unexplained verdict cannot be stored");
await expectReject(
  db,
  "opportunity without priority_reason is rejected",
  `insert into opportunities (org_id, company_id, priority)
   values ($1, $2, 'hot')`,
  [ORG_A, SUBJ],
);

console.log("\nMaster context §51 — an unexplained score cannot be stored");
await expectReject(
  db,
  "score without explanation is rejected",
  `insert into opportunity_scores (org_id, opportunity_id, model_version, score)
   values ($1, '0bbbbbbb-0000-0000-0000-00000000000a', 'v1', 91)`,
  [ORG_A],
);

// ── §78 — an unmeasured dimension is UNKNOWN, never 0 ──────────────────────
console.log("\nMaster context §78 — unmeasured dimensions stay NULL");
await expectAccept(
  db,
  "score with NULL dimensions is accepted",
  `insert into opportunity_scores
     (org_id, opportunity_id, model_version, score, icp_fit, buying_likelihood, explanation)
   values ($1, '0bbbbbbb-0000-0000-0000-00000000000a', 'v1', 91, 94, null, 'Series A 3d ago.')`,
  [ORG_A],
);
{
  const r = await db.query<{ buying_likelihood: number | null }>(
    `select buying_likelihood from opportunity_scores limit 1`,
  );
  if (r.rows[0]?.buying_likelihood === null) ok("NULL survives the round trip as NULL, not 0");
  else fail("NULL survives the round trip as NULL, not 0", `got ${r.rows[0]?.buying_likelihood}`);
}

// ── §37 — a scoped memory always names its subject ─────────────────────────
console.log("\nMaster context §37 — scoped memory cannot be subject-less");
await expectReject(
  db,
  "user-scoped memory without scope_id is rejected",
  `insert into memories (org_id, scope, content) values ($1, 'user', 'Prefers short emails.')`,
  [ORG_A],
);
await expectReject(
  db,
  "organization-scoped memory WITH a scope_id is rejected",
  `insert into memories (org_id, scope, scope_id, content)
   values ($1, 'organization', $1, 'We sell to institutions.')`,
  [ORG_A],
);
await expectAccept(
  db,
  "organization-scoped memory without scope_id is accepted",
  `insert into memories (org_id, scope, content)
   values ($1, 'organization', 'We sell to institutions.')`,
  [ORG_A],
);

// ── §78 — a message cannot claim to have been sent without proof ───────────
console.log("\nMaster context §78 — no falsely-sent messages");
await expectReject(
  db,
  "outbound message with sent_at but no provider id is rejected",
  `insert into messages (org_id, direction, sent_at) values ($1, 'outbound', now())`,
  [ORG_A],
);
await expectAccept(
  db,
  "outbound message with sent_at and a provider id is accepted",
  `insert into messages (org_id, direction, sent_at, provider_message_id)
   values ($1, 'outbound', now(), 'msg_123')`,
  [ORG_A],
);

// ── §60 — the same company/ICP pair does not duplicate ─────────────────────
console.log("\nMaster context §60 — opportunities do not duplicate on rescan");
await expectReject(
  db,
  "second opportunity for the same (company, NULL icp) is rejected",
  `insert into opportunities (org_id, company_id, priority, priority_reason)
   values ($1, $2, 'warm', 'Rediscovered on the next scan.')`,
  [ORG_A, SUBJ],
);

// ── Authorization helper: the enum-ordinal comparison ──────────────────────
console.log("\nhas_org_role — enum ordinal direction");
{
  const asUser = async (uid: string, sql: string, params: unknown[] = []) => {
    await db.exec(`set local role none`).catch(() => {});
    await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [uid]);
    return db.query(sql, params);
  };
  // Run inside one transaction so `set_config(..., true)` (local) persists
  // across the statements below.
  await db.exec("begin");
  const owner = "11111111-1111-1111-1111-111111111111";
  const viewer = "22222222-2222-2222-2222-222222222222";

  const r1 = await asUser(owner, `select public.has_org_role($1, 'member') as v`, [ORG_A]);
  if ((r1.rows[0] as { v: boolean }).v) ok("owner satisfies min_role=member");
  else fail("owner satisfies min_role=member", "returned false");

  const r2 = await asUser(viewer, `select public.has_org_role($1, 'member') as v`, [ORG_A]);
  if (!(r2.rows[0] as { v: boolean }).v) ok("viewer does NOT satisfy min_role=member");
  else fail("viewer does NOT satisfy min_role=member", "returned true");

  const r3 = await asUser(viewer, `select public.has_org_role($1, 'viewer') as v`, [ORG_A]);
  if ((r3.rows[0] as { v: boolean }).v) ok("viewer satisfies min_role=viewer");
  else fail("viewer satisfies min_role=viewer", "returned false");

  const r4 = await asUser(owner, `select count(*)::int as n from public.user_org_ids()`, []);
  if ((r4.rows[0] as { n: number }).n === 1) ok("user_org_ids returns exactly the caller's orgs");
  else fail("user_org_ids returns exactly the caller's orgs", `got ${(r4.rows[0] as { n: number }).n}`);

  await db.exec("rollback");
}

// ── Cross-tenant isolation, exercised as a non-superuser ───────────────────
// PGlite connects as a superuser, and RLS does not apply to superusers or to
// a table's owner. Without this role switch the isolation test below would
// pass vacuously — which is the single most dangerous false green in the
// whole suite (plan D2 calls the isolation test non-negotiable).
console.log("\nTenant isolation — org A cannot read org B");
await db.exec(`
  create role authenticated nologin;
  grant usage on schema public to authenticated;
  grant select, insert, update, delete on all tables in schema public to authenticated;
  grant execute on all functions in schema public to authenticated;
  grant usage on schema auth to authenticated;
  grant select on auth.users to authenticated;
`);
{
  await db.exec("begin");
  await db.exec("set local role authenticated");
  await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [
    "11111111-1111-1111-1111-111111111111",
  ]);

  const seen = await db.query<{ slug: string }>(`select slug from organizations`);
  const slugs = seen.rows.map((r) => r.slug);
  if (slugs.length === 1 && slugs[0] === "org-a") ok("org A member sees only org A");
  else fail("org A member sees only org A", `saw ${JSON.stringify(slugs)}`);

  const comps = await db.query<{ name: string }>(`select name from companies`);
  if (comps.rows.length === 1 && comps.rows[0]!.name === "Alphio AI")
    ok("org A member sees only org A's companies");
  else fail("org A member sees only org A's companies", JSON.stringify(comps.rows));

  const opps = await db.query<{ id: string }>(`select id from opportunities`);
  if (opps.rows.length === 1) ok("org A member sees only org A's opportunities");
  else fail("org A member sees only org A's opportunities", `saw ${opps.rows.length}`);

  // The write path: RLS must also stop a member writing INTO another tenant.
  try {
    await db.query(
      `insert into companies (org_id, canonical_domain, name)
       values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'evil.test', 'Evil')`,
    );
    fail("org A member cannot insert into org B", "insert was ACCEPTED");
  } catch {
    ok("org A member cannot insert into org B");
  }

  await db.exec("rollback");
}

// A viewer is read-only — the has_org_role half of the policy, not the
// user_org_ids half. These two failure modes look identical from the UI and
// completely different in the policy, so they are tested apart.
console.log("\nRole enforcement — viewer is read-only");
{
  await db.exec("begin");
  await db.exec("set local role authenticated");
  await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [
    "22222222-2222-2222-2222-222222222222",
  ]);

  const r = await db.query<{ n: number }>(`select count(*)::int as n from companies`);
  if (r.rows[0]!.n === 1) ok("viewer can read their org's companies");
  else fail("viewer can read their org's companies", `saw ${r.rows[0]!.n}`);

  try {
    await db.query(
      `insert into companies (org_id, canonical_domain, name) values ($1, 'x.test', 'X')`,
      [ORG_A],
    );
    fail("viewer cannot write", "insert was ACCEPTED");
  } catch {
    ok("viewer cannot write");
  }
  await db.exec("rollback");
}

// ── Every tenant table actually has RLS on ─────────────────────────────────
// A table added later without `enable row level security` is readable by any
// authenticated user in any tenant. That is the leak D2 exists to prevent, so
// it is asserted structurally rather than trusted to review.
console.log("\nStructural — no tenant table is left without RLS");
{
  const r = await db.query<{ tablename: string }>(`
    select c.relname as tablename
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join information_schema.columns col
      on col.table_name = c.relname and col.table_schema = 'public'
    where n.nspname = 'public'
      and c.relkind = 'r'
      and col.column_name = 'org_id'
      and c.relrowsecurity = false
    group by c.relname
  `);
  if (r.rows.length === 0) ok("every table with an org_id has RLS enabled");
  else fail("every table with an org_id has RLS enabled", r.rows.map((x) => x.tablename).join(", "));
}
{
  const r = await db.query<{ tablename: string }>(`
    select c.relname as tablename
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join information_schema.columns col
      on col.table_name = c.relname and col.table_schema = 'public'
    where n.nspname = 'public' and c.relkind = 'r' and col.column_name = 'org_id'
      and not exists (select 1 from pg_policies p
                      where p.schemaname = 'public' and p.tablename = c.relname)
    group by c.relname
  `);
  if (r.rows.length === 0) ok("every table with an org_id has at least one policy");
  else fail("every table with an org_id has at least one policy", r.rows.map((x) => x.tablename).join(", "));
}

console.log(
  `\n${failures === 0 ? "PASS" : "FAIL"} — ${checks - failures}/${checks} checks passed\n`,
);
process.exit(failures === 0 ? 0 : 1);
