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

/**
 * The same assertion, inside an open transaction.
 *
 * A raised error aborts the surrounding transaction, so every statement after
 * a plain `expectReject` fails with 25P02 rather than testing anything. That
 * turns one deliberate refusal into a cascade of false failures further down
 * the block. A savepoint scopes the abort to the statement being tested.
 */
async function expectRejectTx(db: PGlite, name: string, sql: string, params: unknown[] = []) {
  await db.exec("savepoint expect_reject");
  try {
    await db.query(sql, params);
    fail(name, "statement was ACCEPTED but should have been rejected");
    await db.exec("release savepoint expect_reject");
  } catch {
    ok(name);
    await db.exec("rollback to savepoint expect_reject");
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

/**
 * A migration is a file named `NNNN_something.sql`. Nothing else is.
 *
 * The pattern is a filter rather than a convention nobody enforces, because
 * the directory now also holds `COMBINED-0024-0027.sql` — one paste of four
 * migrations for the Supabase SQL Editor, which is a deployment convenience
 * and not a fifth migration. Applying it after the four it contains failed
 * with "trigger public_research_touch already exists", which is the correct
 * answer to the wrong question: the file is verified below by checking that
 * it *is* those four, rather than by running it a second time.
 */
const MIGRATION_FILE = /^\d{4}_.+\.sql$/;

// ── Run the migrations in order ────────────────────────────────────────────
const files = (await readdir(migrationsDir)).filter((f) => MIGRATION_FILE.test(f)).sort();
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

/* The shared fixtures put more people in a free workspace than its plan sells
   (0067 enforces that). The 0067 block sets its own limit. */
await db.query(`update plans set limits = limits || '{"seats": 1000}'::jsonb where id = 'free'`);

/* PERF-302's ratchet (asserted in the 0054 block). Counted here, on the
   migrations alone, because later blocks create test tables of their own. */
const unindexedFkAfterMigrations = Number(
  (
    await db.query<{ n: number }>(
      `select count(*)::int as n
         from pg_constraint c
        where c.contype = 'f' and array_length(c.conkey, 1) = 1
          and c.connamespace = 'public'::regnamespace
          and not exists (select 1 from pg_index i
                           where i.indrelid = c.conrelid and i.indkey[0] = c.conkey[1])`,
    )
  ).rows[0]?.n,
);

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
  -- Deliberately NO blanket grant on functions. Postgres gives every function
  -- EXECUTE to PUBLIC on creation, which \`authenticated\` inherits, so the
  -- grant would be redundant — and worse than redundant: it would re-grant
  -- what a migration had just REVOKEd, making 0008's job-queue lockdown
  -- untestable while appearing to hold.
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

// ── Rate limiting (0005) ───────────────────────────────────────────────────
// A rate limit is a security control, and an untested one is a guess. The
// three failures worth catching here are all silent: a counter that resets
// instead of accumulating, a limit another tenant can exhaust on your behalf,
// and a table the tenant can UPDATE — each of which leaves the function
// returning `allowed` forever while looking like it works.
console.log("\nRate limiting — consume_rate_limit");
{
  const OWNER = "11111111-1111-1111-1111-111111111111";

  type Consumed = { allowed: boolean; remaining: number; reset_at: string };
  // Who the caller is comes from the GUC set below, not from an argument —
  // the function reads auth.uid() exactly as PostgREST would.
  const consume = (org: string, action: string, limit: number, perUser = true) =>
    db.query<Consumed>(
      `select * from public.consume_rate_limit($1, $2, $3, 3600, $4)`,
      [org, action, limit, perUser],
    );

  // Per-user counter accumulates and then denies.
  await db.exec("begin");
  await db.exec("set local role authenticated");
  await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [OWNER]);

  const first = await consume(ORG_A, "qualify_opportunity", 2);
  const second = await consume(ORG_A, "qualify_opportunity", 2);
  const third = await consume(ORG_A, "qualify_opportunity", 2);

  if (first.rows[0]!.allowed && second.rows[0]!.allowed && !third.rows[0]!.allowed)
    ok("third call past a limit of 2 is denied");
  else
    fail(
      "third call past a limit of 2 is denied",
      JSON.stringify([first.rows[0], second.rows[0], third.rows[0]]),
    );

  if (first.rows[0]!.remaining === 1 && third.rows[0]!.remaining === 0)
    ok("remaining counts down and floors at zero");
  else fail("remaining counts down and floors at zero", JSON.stringify(third.rows[0]));

  // A denied call must still increment. Otherwise a caller who keeps hammering
  // sits permanently at limit+1 and the window never advances past them.
  const fourth = await consume(ORG_A, "qualify_opportunity", 2);
  const n = await db.query<{ count: number }>(
    `select count from public.rate_limits
      where org_id = $1 and action = 'qualify_opportunity' and user_id is not null`,
    [ORG_A],
  );
  if (!fourth.rows[0]!.allowed && n.rows[0]!.count === 4)
    ok("a denied call still increments the counter");
  else fail("a denied call still increments the counter", JSON.stringify(n.rows[0]));

  // Distinct actions do not share a budget.
  const other = await consume(ORG_A, "research_company", 2);
  if (other.rows[0]!.allowed) ok("a different action has its own window");
  else fail("a different action has its own window", JSON.stringify(other.rows[0]));

  // Org-wide mode uses the other partial index. This is the branch that was
  // wrong first time: a single INSERT naming the `user_id is not null` arbiter
  // never matched a NULL-user row, so every call inserted instead of
  // incrementing and the limit silently did not limit.
  const w1 = await consume(ORG_A, "org_wide_task", 1, false);
  const w2 = await consume(ORG_A, "org_wide_task", 1, false);
  if (w1.rows[0]!.allowed && !w2.rows[0]!.allowed)
    ok("org-wide mode accumulates rather than inserting afresh");
  else fail("org-wide mode accumulates rather than inserting afresh", JSON.stringify([w1.rows[0], w2.rows[0]]));

  await db.exec("rollback");
}
{
  // SECURITY DEFINER bypasses RLS, so the membership check inside the function
  // is the only thing standing between a stranger and another org's quota.
  await db.exec("begin");
  await db.exec("set local role authenticated");
  await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [
    "33333333-3333-3333-3333-333333333333",
  ]);
  try {
    await db.query(
      `select * from public.consume_rate_limit($1, 'qualify_opportunity', 5, 3600, true)`,
      [ORG_A],
    );
    fail("a non-member cannot consume another org's quota", "call was ACCEPTED");
  } catch {
    ok("a non-member cannot consume another org's quota");
  }
  await db.exec("rollback");
}
{
  // A counter the constrained party can edit is not a rate limit.
  await db.exec("begin");
  await db.exec("set local role authenticated");
  await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [
    "11111111-1111-1111-1111-111111111111",
  ]);
  try {
    await db.query(`update public.rate_limits set count = 0`);
    // UPDATE with no matching policy affects zero rows rather than raising,
    // so "did not throw" is not the same as "was allowed". Insert is the
    // unambiguous test.
    await db.query(
      `insert into public.rate_limits (org_id, action, window_start, count)
       values ($1, 'forged', now(), 0)`,
      [ORG_A],
    );
    fail("a member cannot write rate_limits directly", "insert was ACCEPTED");
  } catch {
    ok("a member cannot write rate_limits directly");
  }
  await db.exec("rollback");
}
{
  // The sweep (0005's prune_rate_limits, scheduled by 0006). Two failures
  // worth catching, and both leave a function that looks like it works: one
  // that deletes nothing — the table then grows forever, which is the bug
  // RL-02 was raised for — and one that deletes too much, taking live windows
  // with it and handing every caller a fresh quota.
  //
  // No `set local role`: these inserts are the housekeeping path, not the
  // tenant path, and 0005 deliberately gives tenants no write policy.
  await db.exec("begin");
  await db.query(
    `insert into public.rate_limits (org_id, user_id, action, window_start, count)
     values ($1, null, 'stale_window',  now() - interval '2 days', 7),
            ($1, null, 'live_window',   now(),                     3)`,
    [ORG_A],
  );

  const pruned = await db.query<{ prune_rate_limits: number }>(
    `select public.prune_rate_limits()`,
  );
  const survivors = await db.query<{ action: string }>(
    `select action from public.rate_limits where org_id = $1
      and action in ('stale_window', 'live_window')`,
    [ORG_A],
  );

  if (pruned.rows[0]!.prune_rate_limits === 1)
    ok("prune_rate_limits deletes windows past the retention interval");
  else
    fail(
      "prune_rate_limits deletes windows past the retention interval",
      `reported ${pruned.rows[0]!.prune_rate_limits} deleted, expected 1`,
    );

  if (survivors.rows.length === 1 && survivors.rows[0]!.action === "live_window")
    ok("prune_rate_limits leaves the current window alone");
  else
    fail(
      "prune_rate_limits leaves the current window alone",
      JSON.stringify(survivors.rows),
    );

  await db.exec("rollback");
}

// ── Profiles (0007) ────────────────────────────────────────────────────────
// The point of this table is that a uuid becomes a name *without* the
// service-role client. Two things have to hold for that: the trigger fills it
// in without anyone remembering to, and the read policy stops it becoming a
// directory of every user of the product.
console.log("\nProfiles — a user id resolves to a person, within your orgs");
{
  const OWNER_A = "11111111-1111-1111-1111-111111111111";
  const OWNER_B = "33333333-3333-3333-3333-333333333333";

  const seeded = await db.query<{ count: number }>(
    `select count(*)::int as count from public.profiles`,
  );
  if (seeded.rows[0]!.count === 3) ok("the trigger wrote a profile for every user");
  else fail("the trigger wrote a profile for every user", JSON.stringify(seeded.rows[0]));

  await db.exec("begin");
  await db.exec("set local role authenticated");
  await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [OWNER_A]);

  const visible = await db.query<{ email: string }>(
    `select email from public.profiles order by email`,
  );
  const emails = visible.rows.map((r) => r.email);
  // owner@a.test and viewer@a.test share org A; owner@b.test does not.
  if (emails.length === 2 && !emails.includes("owner@b.test"))
    ok("a member sees co-members' profiles and nobody else's");
  else fail("a member sees co-members' profiles and nobody else's", emails.join(", "));

  // An UPDATE filtered to zero rows by RLS does not raise, so "it threw" is
  // the wrong assertion — the right one is that the row did not change.
  await db.query(`update public.profiles set full_name = 'Renamed' where id = $1`, [
    OWNER_B,
  ]);
  // INSERT is the unambiguous half: there is no insert policy at all, so a
  // member forging a profile row is refused loudly rather than filtered.
  await expectReject(
    db,
    "a member cannot invent a profile row",
    `insert into public.profiles (id, full_name)
       values ('55555555-5555-5555-5555-555555555555', 'Forged')`,
  );
  await db.exec("rollback");

  const untouched = await db.query<{ full_name: string | null }>(
    `select full_name from public.profiles where id = $1`,
    [OWNER_B],
  );
  if (untouched.rows[0]!.full_name === null)
    ok("a member cannot rename another user — the update matched nothing");
  else fail("a member cannot rename another user", JSON.stringify(untouched.rows[0]));
}

// ── Invitations (0007) ─────────────────────────────────────────────────────
// accept_invitation is SECURITY DEFINER and is the only path by which a
// non-member becomes a member. The address check inside it is the entire
// authorization; a leaked token that joins anybody to the org is the whole
// risk of having invitations at all.
console.log("\nInvitations — a token joins the invited address and nobody else");
{
  const OWNER_A = "11111111-1111-1111-1111-111111111111";
  const OUTSIDER = "44444444-4444-4444-4444-444444444444";
  const ORG_B_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

  await db.exec(`
    insert into auth.users (id, email)
      values ('44444444-4444-4444-4444-444444444444', 'newcomer@a.test');
    insert into invitations (id, org_id, email, role, token, expires_at) values
      ('e0000000-0000-0000-0000-000000000001',
       'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'NewComer@a.test', 'member',
       'f0000000-0000-0000-0000-000000000001', now() + interval '1 day'),
      ('e0000000-0000-0000-0000-000000000002',
       'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'someone.else@a.test', 'member',
       'f0000000-0000-0000-0000-000000000002', now() + interval '1 day'),
      -- A different address from the live one above: invitations_pending_idx
      -- treats "not accepted and not revoked" as pending regardless of expiry,
      -- because a partial index predicate cannot call now(). Re-inviting an
      -- address whose invitation lapsed therefore goes through revoke-then-
      -- insert in the application, not through a second live row here.
      ('e0000000-0000-0000-0000-000000000003',
       'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'lapsed@a.test', 'admin',
       'f0000000-0000-0000-0000-000000000003', now() - interval '1 day');
  `);

  await db.exec("begin");
  await db.exec("set local role authenticated");
  await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [OUTSIDER]);

  await expectRejectTx(
    db,
    "a token issued to another address is refused",
    `select * from public.accept_invitation('f0000000-0000-0000-0000-000000000002')`,
  );
  await expectRejectTx(
    db,
    "an expired token is refused",
    `select * from public.accept_invitation('f0000000-0000-0000-0000-000000000003')`,
  );

  const accepted = await db.query<{ joined_org_slug: string; joined_role: string }>(
    `select * from public.accept_invitation('f0000000-0000-0000-0000-000000000001')`,
  );
  if (accepted.rows[0]?.joined_org_slug === "org-a" && accepted.rows[0]?.joined_role === "member")
    ok("the invited address joins, matched case-insensitively");
  else
    fail(
      "the invited address joins, matched case-insensitively",
      JSON.stringify(accepted.rows[0]),
    );

  // And the membership is real, not just a return value: the new member can
  // now see the org's companies, which they could not a statement ago.
  const seen = await db.query<{ count: number }>(
    `select count(*)::int as count from public.companies`,
  );
  if (seen.rows[0]!.count === 1) ok("accepting actually grants read access");
  else fail("accepting actually grants read access", JSON.stringify(seen.rows[0]));

  await expectRejectTx(
    db,
    "a token cannot be redeemed twice",
    `select * from public.accept_invitation('f0000000-0000-0000-0000-000000000001')`,
  );

  // A member of one org must not be able to read another org's invitations —
  // the policy is admin-scoped, and an invitation list is a list of the
  // customer's colleagues' email addresses.
  const foreign = await db.query<{ count: number }>(
    `select count(*)::int as count from public.invitations where org_id = $1`,
    [ORG_B_ID],
  );
  if (foreign.rows[0]!.count === 0) ok("invitations are not readable across orgs");
  else fail("invitations are not readable across orgs", JSON.stringify(foreign.rows[0]));

  await db.exec("rollback");
  void OWNER_A;
}

// ── The audit trail (0007) ─────────────────────────────────────────────────
// 0001 deliberately gave audit_logs no write policy. That is only a coherent
// position if there is a path that *can* write one — otherwise "append-only"
// means "empty". These three assertions are that position, stated.
console.log("\nAudit log — appendable by a member, editable by nobody");
{
  const OWNER_A = "11111111-1111-1111-1111-111111111111";
  const OWNER_B = "33333333-3333-3333-3333-333333333333";
  const ORG_A_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

  await db.exec("begin");
  await db.exec("set local role authenticated");
  await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [OWNER_A]);

  await expectAccept(
    db,
    "a member can append to their own org's audit log",
    `select public.write_audit_log($1, 'opportunity.assigned', 'opportunity',
       '0bbbbbbb-0000-0000-0000-00000000000a', '{"to":"someone"}'::jsonb)`,
    [ORG_A_ID],
  );

  // No write policy exists on audit_logs, so an UPDATE or DELETE matches zero
  // rows and returns quietly. Running them and then counting is the only way
  // to tell "refused" from "succeeded and changed nothing".
  await db.query(`update public.audit_logs set action = 'nothing.happened' where org_id = $1`, [
    ORG_A_ID,
  ]);
  await db.query(`delete from public.audit_logs where org_id = $1`, [ORG_A_ID]);
  const trail = await db.query<{ count: number; action: string }>(
    `select count(*)::int as count, min(action) as action
       from public.audit_logs where org_id = $1`,
    [ORG_A_ID],
  );
  if (trail.rows[0]!.count === 1 && trail.rows[0]!.action === "opportunity.assigned")
    ok("a member can neither edit nor delete what the trail already says");
  else fail("a member can neither edit nor delete the trail", JSON.stringify(trail.rows[0]));

  await expectRejectTx(
    db,
    "a member cannot forge an audit record by inserting directly",
    `insert into public.audit_logs (org_id, action) values ($1, 'forged.entry')`,
    [ORG_A_ID],
  );

  // Cross-tenant: the function is SECURITY DEFINER, so its own membership
  // check is the only thing standing between org B and org A's trail.
  await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [OWNER_B]);
  await expectRejectTx(
    db,
    "a non-member cannot write into another org's audit log",
    `select public.write_audit_log($1, 'forged.entry')`,
    [ORG_A_ID],
  );

  await db.exec("rollback");
}

// ── Usage counters and quota (0007) ────────────────────────────────────────
console.log("\nUsage — metering accumulates, and reports rather than refuses");
{
  const OWNER_A = "11111111-1111-1111-1111-111111111111";
  const OWNER_B = "33333333-3333-3333-3333-333333333333";
  const ORG_A_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

  await db.exec("begin");
  await db.exec("set local role authenticated");
  await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [OWNER_A]);

  type Usage = { used: number; quota: number | null; allowed: boolean };
  // A session meters exactly one thing: one delivered AI run (countAiRun).
  // Org A is on the default plan, `free`, whose ai_runs limit is 100.
  const one = await db.query<Usage>(`select * from public.increment_usage($1, 'ai_runs', 1)`, [ORG_A_ID]);
  const two = await db.query<Usage>(`select * from public.increment_usage($1, 'ai_runs')`, [ORG_A_ID]);
  if (one.rows[0]!.used === 1 && two.rows[0]!.used === 2 && two.rows[0]!.quota === 100)
    ok("a member's AI runs accumulate within the period and resolve the plan's limit");
  else fail("a member's AI runs accumulate within the period", JSON.stringify([one.rows[0], two.rows[0]]));

  // 0047 (audit lead 2): one call used to be able to add any amount to any
  // metric, which locked the whole workspace out until the month ended.
  await expectRejectTx(
    db,
    "a session cannot meter more than one run at a time",
    `select * from public.increment_usage($1, 'ai_runs', 1000000000000)`,
    [ORG_A_ID],
  );
  await expectRejectTx(
    db,
    "a session cannot meter a metric the engine owns",
    `select * from public.increment_usage($1, 'emails', 1)`,
    [ORG_A_ID],
  );
  await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, ["22222222-2222-2222-2222-222222222222"]);
  await expectRejectTx(
    db,
    "a viewer cannot meter at all",
    `select * from public.increment_usage($1, 'ai_runs', 1)`,
    [ORG_A_ID],
  );

  // Everything else is the engine's, through the internal half.
  await db.exec("reset role");
  const three = await db.query<Usage>(
    `select * from public.increment_usage_internal($1, 'opportunities', 3)`,
    [ORG_A_ID],
  );
  const five = await db.query<Usage>(
    `select * from public.increment_usage_internal($1, 'opportunities', 2)`,
    [ORG_A_ID],
  );
  if (three.rows[0]!.used === 3 && five.rows[0]!.used === 5 && five.rows[0]!.quota === 50)
    ok("engine usage accumulates within the period and resolves the plan's limit");
  else fail("engine usage accumulates within the period", JSON.stringify([three.rows[0], five.rows[0]]));

  // `free`'s emails limit is 0, so this is over quota on its first unit —
  // the boundary worth testing.
  const overshoot = await db.query<Usage>(
    `select * from public.increment_usage_internal($1, 'emails', 1)`,
    [ORG_A_ID],
  );
  if (overshoot.rows[0]!.allowed === false && overshoot.rows[0]!.used === 1)
    ok("a metric past its plan limit still counts, and says it is over");
  else fail("a metric past its plan limit still counts", JSON.stringify(overshoot.rows[0]));

  await db.exec("set local role authenticated");
  await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [OWNER_A]);
  const peek = await db.query<Usage>(`select * from public.check_quota($1, 'opportunities')`, [
    ORG_A_ID,
  ]);
  const after = await db.query<Usage>(`select * from public.check_quota($1, 'opportunities')`, [
    ORG_A_ID,
  ]);
  if (peek.rows[0]!.used === 5 && after.rows[0]!.used === 5)
    ok("check_quota reads without consuming");
  else fail("check_quota reads without consuming", JSON.stringify([peek.rows[0], after.rows[0]]));

  await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [OWNER_B]);
  await expectRejectTx(
    db,
    "a non-member cannot spend another org's quota",
    `select * from public.increment_usage($1, 'ai_runs', 1)`,
    [ORG_A_ID],
  );
  const blind = await db.query(`select * from public.check_quota($1, 'opportunities')`, [
    ORG_A_ID,
  ]);
  if (blind.rows.length === 0) ok("check_quota returns nothing to a non-member");
  else fail("check_quota returns nothing to a non-member", JSON.stringify(blind.rows));

  await db.exec("rollback");
}

// ── Suppression and unsubscribe (0008) ─────────────────────────────────────
// 0004's comment on `suppressions` says "checked before EVERY send". That is
// only true if the check understands both kinds — a per-address list cannot
// express "never anyone at this company", which is the request customers
// actually make.
console.log("\nSuppression — the check a send is not allowed to skip");
{
  const ORG_A_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  await db.exec(`
    insert into suppressions (org_id, kind, value, reason) values
      ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'email', 'no@alphio.ai', 'asked'),
      ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'domain', 'blocked.test', 'legal');
  `);

  const cases: [string, boolean][] = [
    ["no@alphio.ai", true],
    ["NO@ALPHIO.AI", true],
    ["yes@alphio.ai", false],
    ["anyone@blocked.test", true],
    ["anyone@allowed.test", false],
  ];
  let allRight = true;
  for (const [email, expected] of cases) {
    const r = await db.query<{ is_suppressed: boolean }>(
      `select public.is_suppressed($1, $2) as is_suppressed`,
      [ORG_A_ID, email],
    );
    if (r.rows[0]!.is_suppressed !== expected) {
      allRight = false;
      fail(`is_suppressed('${email}') is ${expected}`, JSON.stringify(r.rows[0]));
    }
  }
  if (allRight) ok("is_suppressed matches address and domain, case-folded");

  // A suppression is per-org. One customer's do-not-contact list is not
  // another's, and leaking it the other way would be worse than useless.
  const other = await db.query<{ is_suppressed: boolean }>(
    `select public.is_suppressed($1, 'no@alphio.ai') as is_suppressed`,
    ["bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"],
  );
  if (other.rows[0]!.is_suppressed === false) ok("suppressions do not cross tenants");
  else fail("suppressions do not cross tenants", JSON.stringify(other.rows[0]));
}

console.log("\nUnsubscribe — a link that works without being signed in");
{
  const ORG_A_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  await db.exec(`
    insert into messages (id, org_id, direction, to_email, subject)
    values ('d0000000-0000-0000-0000-000000000001',
            'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'outbound', 'Reader@alphio.ai',
            'Hello');
  `);
  // 0047: every outbound message gets a token in a table no session can read.
  const issued = await db.query<{ n: number }>(
    `select count(*)::int as n from message_unsubscribe_tokens
      where message_id = 'd0000000-0000-0000-0000-000000000001'`,
  );
  if (issued.rows[0]!.n === 1) ok("an outbound message is issued an unsubscribe token");
  else fail("an outbound message is issued an unsubscribe token", JSON.stringify(issued.rows[0]));
  await db.exec(`
    update message_unsubscribe_tokens set token = 'a0000000-0000-0000-0000-0000000000ff'
     where message_id = 'd0000000-0000-0000-0000-000000000001';
  `);

  // No role set, no auth.uid(): exactly the context a click from an email has.
  const r = await db.query<{ suppressed_email: string }>(
    `select * from public.record_unsubscribe('a0000000-0000-0000-0000-0000000000ff', 'too many')`,
  );
  const suppressed = await db.query<{ is_suppressed: boolean }>(
    `select public.is_suppressed($1, 'reader@alphio.ai') as is_suppressed`,
    [ORG_A_ID],
  );
  const evented = await db.query<{ count: number }>(
    `select count(*)::int as count from message_events
      where message_id = 'd0000000-0000-0000-0000-000000000001' and kind = 'unsubscribed'`,
  );
  if (
    r.rows[0]!.suppressed_email === "reader@alphio.ai" &&
    suppressed.rows[0]!.is_suppressed &&
    evented.rows[0]!.count === 1
  )
    ok("an unsubscribe suppresses the address and records the event");
  else
    fail(
      "an unsubscribe suppresses the address and records the event",
      JSON.stringify([r.rows[0], suppressed.rows[0], evented.rows[0]]),
    );

  await db.query(`select * from public.record_unsubscribe('a0000000-0000-0000-0000-0000000000ff')`);
  const replayed = await db.query<{ count: number }>(
    `select count(*)::int as count from message_events
      where message_id = 'd0000000-0000-0000-0000-000000000001' and kind = 'unsubscribed'`,
  );
  if (replayed.rows[0]!.count === 1) ok("following the link again records no second event");
  else fail("following the link again records no second event", JSON.stringify(replayed.rows[0]));

  await expectReject(
    db,
    "an invented unsubscribe token does nothing",
    `select * from public.record_unsubscribe('a0000000-0000-0000-0000-00000000dead')`,
  );
}

// ── Mailbox sending limits (0008) ──────────────────────────────────────────
// The failure this prevents is over-sending, which costs a domain's
// reputation and cannot be undone. So the claim happens before the send: a
// crash between the two over-counts, which is the direction to fail in.
console.log("\nMailbox limits — the allowance is claimed before the send, not after");
{
  await db.exec(`
    insert into mailboxes (id, org_id, provider, email, daily_limit) values
      ('11110000-0000-0000-0000-000000000001',
       'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'gmail', 'sender@a.test', 2);
  `);
  const MB = "11110000-0000-0000-0000-000000000001";

  const claims: boolean[] = [];
  for (let i = 0; i < 3; i++) {
    const r = await db.query<{ claim_mailbox_send: boolean }>(
      `select public.claim_mailbox_send($1) as claim_mailbox_send`,
      [MB],
    );
    claims.push(r.rows[0]!.claim_mailbox_send);
  }
  if (claims[0] && claims[1] && claims[2] === false)
    ok("the third claim against a limit of 2 is refused");
  else fail("the third claim against a limit of 2 is refused", JSON.stringify(claims));

  const remaining = await db.query<{ n: number }>(
    `select public.mailbox_remaining_today($1) as n`,
    [MB],
  );
  if (remaining.rows[0]!.n === 0) ok("remaining reports zero rather than going negative");
  else fail("remaining reports zero", JSON.stringify(remaining.rows[0]));

  // Yesterday's count must not consume today's allowance. Written as a stale
  // date rather than by waiting a day, which is the whole reason the column
  // exists instead of a scheduled reset.
  await db.query(`update mailboxes set sent_today_on = current_date - 1 where id = $1`, [MB]);
  const fresh = await db.query<{ n: number }>(
    `select public.mailbox_remaining_today($1) as n`,
    [MB],
  );
  if (fresh.rows[0]!.n === 2) ok("a stale counter reads as zero sent, without a reset job");
  else fail("a stale counter reads as zero sent", JSON.stringify(fresh.rows[0]));

  await db.query(`update mailboxes set status = 'disconnected' where id = $1`, [MB]);
  const refused = await db.query<{ claim_mailbox_send: boolean }>(
    `select public.claim_mailbox_send($1) as claim_mailbox_send`,
    [MB],
  );
  if (refused.rows[0]!.claim_mailbox_send === false)
    ok("a disconnected mailbox cannot be claimed at all");
  else fail("a disconnected mailbox cannot be claimed", JSON.stringify(refused.rows[0]));
}

// ── Warm-up (0048) ─────────────────────────────────────────────────────────
// A mailbox connected today may not send its full limit today.
console.log("\nWarm-up — a new mailbox ramps up instead of sending its full limit on day one");
{
  await db.exec(`
    insert into mailboxes (id, org_id, provider, email, daily_limit) values
      ('11110000-0000-0000-0000-000000000002',
       'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'gmail', 'new@a.test', 50);
  `);
  const MB = "11110000-0000-0000-0000-000000000002";
  const cap = async () =>
    (await db.query<{ n: number }>(`select public.mailbox_daily_cap($1) as n`, [MB])).rows[0]!.n;

  if ((await cap()) === 10) ok("a mailbox connected today may send 10, not its limit of 50");
  else fail("a mailbox connected today may send 10", await cap());

  await db.query(`update mailboxes set warmup_started_at = now() - interval '3 days' where id = $1`, [MB]);
  if ((await cap()) === 25) ok("three days in, the cap is 25");
  else fail("three days in, the cap is 25", await cap());

  await db.query(`update mailboxes set warmup_started_at = now() - interval '30 days' where id = $1`, [MB]);
  if ((await cap()) === 50) ok("once ramped, the configured limit applies");
  else fail("once ramped, the configured limit applies", await cap());

  await db.query(`update mailboxes set warmup_target = 30 where id = $1`, [MB]);
  if ((await cap()) === 30) ok("a warm-up target lower than the limit holds");
  else fail("a warm-up target lower than the limit holds", await cap());

  await db.query(
    `update mailboxes set warmup_target = null, warmup_started_at = now(), sent_today = 0, sent_today_on = null where id = $1`,
    [MB],
  );
  const claims: boolean[] = [];
  for (let i = 0; i < 11; i++) {
    const r = await db.query<{ ok: boolean }>(`select public.claim_mailbox_send($1) as ok`, [MB]);
    claims.push(r.rows[0]!.ok);
  }
  if (claims.slice(0, 10).every(Boolean) && claims[10] === false)
    ok("the 11th claim on day one is refused");
  else fail("the 11th claim on day one is refused", JSON.stringify(claims));

  const remaining = await db.query<{ n: number }>(`select public.mailbox_remaining_today($1) as n`, [MB]);
  if (remaining.rows[0]!.n === 0) ok("and remaining agrees with the ramp");
  else fail("and remaining agrees with the ramp", JSON.stringify(remaining.rows[0]));

  await db.query(`update mailboxes set warmup_started_at = null where id = $1`, [MB]);
  if ((await cap()) === 50) ok("a mailbox with no warm-up date is treated as warm");
  else fail("a mailbox with no warm-up date is treated as warm", await cap());

  await expectReject(
    db,
    "domain_status accepts only pass, warn or fail",
    `update mailboxes set domain_status = 'maybe' where id = '${MB}'`,
  );
}

// ── 0049: soft deletes reach outreach; merges keep evidence ────────────────
console.log("\nRemoval and merge — SEC-101 / FLOW-102 (0049)");
{
  const ORG = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  await db.exec(`
    insert into companies (id, org_id, canonical_domain, name) values
      ('c0000000-0000-0000-0000-0000000049a1', '${ORG}', 'removed-49.test', 'Removed Co'),
      ('c0000000-0000-0000-0000-0000000049a2', '${ORG}', 'winner-49.test', 'Winner Co'),
      ('c0000000-0000-0000-0000-0000000049a3', '${ORG}', 'loser-49.test', 'Loser Co');
    insert into opportunities (id, org_id, company_id, priority, priority_reason) values
      ('0bbbbbbb-0000-0000-0000-0000000049a1', '${ORG}', 'c0000000-0000-0000-0000-0000000049a1', 'hot', 'r');
    insert into campaigns (id, org_id, name, status) values
      ('ca000000-0000-0000-0000-0000000049a1', '${ORG}', 'Seq 49', 'active');
    insert into enrollments (id, org_id, campaign_id, opportunity_id, status) values
      ('e0000000-0000-0000-0000-0000000049a1', '${ORG}', 'ca000000-0000-0000-0000-0000000049a1',
       '0bbbbbbb-0000-0000-0000-0000000049a1', 'active');
    insert into messages (id, org_id, direction, to_email, subject, enrollment_id, opportunity_id, scheduled_at) values
      ('d0000000-0000-0000-0000-0000000049a1', '${ORG}', 'outbound', 'dana@removed-49.test', 'Hi',
       'e0000000-0000-0000-0000-0000000049a1', '0bbbbbbb-0000-0000-0000-0000000049a1', now());
  `);

  await db.query(`update companies set deleted_at = now() where id = 'c0000000-0000-0000-0000-0000000049a1'`);
  const opp = await db.query<{ gone: boolean }>(
    `select deleted_at is not null as gone from opportunities where id = '0bbbbbbb-0000-0000-0000-0000000049a1'`,
  );
  if (opp.rows[0]?.gone) ok("removing a company removes its opportunities");
  else fail("removing a company removes its opportunities", opp.rows[0]);
  const enr = await db.query<{ status: string }>(
    `select status from enrollments where id = 'e0000000-0000-0000-0000-0000000049a1'`,
  );
  if (enr.rows[0]?.status === "stopped") ok("and stops their sequences");
  else fail("and stops their sequences", enr.rows[0]);
  const msg = await db.query<{ scheduled: boolean }>(
    `select scheduled_at is not null as scheduled from messages where id = 'd0000000-0000-0000-0000-0000000049a1'`,
  );
  if (msg.rows[0] && !msg.rows[0].scheduled) ok("and unschedules their approved, unsent emails");
  else fail("and unschedules their approved, unsent emails", msg.rows[0]);

  const W = "c0000000-0000-0000-0000-0000000049a2";
  const L = "c0000000-0000-0000-0000-0000000049a3";
  await db.exec(`
    insert into evidence (org_id, subject_type, subject_id, claim, kind, source_url, field) values
      ('${ORG}', 'company', '${W}', '120 employees', 'fact', 'https://p.test/a', 'employee_count'),
      ('${ORG}', 'company', '${L}', '120 employees', 'fact', 'https://p.test/a', 'employee_count'),
      ('${ORG}', 'company', '${L}', 'Hiring an AE', 'fact', 'https://jobs.test/1', 'hiring_signal:x:1'),
      ('${ORG}', 'company', '${L}', 'Opening a London office', 'fact', 'https://news.test/1', null);
  `);
  await db.query(`update companies set merged_into_id = $1, deleted_at = now() where id = $2`, [W, L]);
  const moved = await db.query<{ n: number }>(
    `select count(*)::int as n from evidence where subject_id = $1 and deleted_at is null`,
    [W],
  );
  if (moved.rows[0]?.n === 3) ok("a merge moves the loser's evidence to the survivor, without duplicating a shared source");
  else fail("a merge moves the loser's evidence to the survivor", moved.rows[0]);
  const left = await db.query<{ n: number }>(
    `select count(*)::int as n from evidence where subject_id = $1 and deleted_at is null`,
    [L],
  );
  if (left.rows[0]?.n === 0) ok("and nothing live is left on the merged-away row");
  else fail("and nothing live is left on the merged-away row", left.rows[0]);
}

console.log("\nQueue history — JOB-011 (0049)");
{
  await db.exec(`
    insert into job_executions (job_name, status, finished_at, updated_at) values
      ('prune_probe', 'succeeded', now() - interval '40 days', now() - interval '40 days'),
      ('prune_probe', 'succeeded', now() - interval '2 days', now() - interval '2 days'),
      ('prune_probe', 'queued', null, now() - interval '40 days');
  `);
  const pruned = await db.query<{ n: number }>(`select public.prune_job_executions() as n`);
  if (pruned.rows[0]?.n === 1) ok("finished jobs older than 30 days are pruned, and nothing else");
  else fail("finished jobs older than 30 days are pruned", pruned.rows[0]);
  const queued = await db.query<{ n: number }>(
    `select count(*)::int as n from job_executions where status = 'queued' and job_name = 'prune_probe'`,
  );
  if ((queued.rows[0]?.n ?? 0) >= 1) ok("a queued job is never pruned, however old");
  else fail("a queued job is never pruned", queued.rows[0]);
  // Leave the queue as the claim tests further down expect to find it.
  await db.exec(`delete from job_executions where job_name = 'prune_probe'`);
}

console.log("\nMailbox safety columns — SEC-103 (0049)");
{
  const MB = "11110000-0000-0000-0000-000000000002";
  await db.exec("begin");
  await db.exec("set local role authenticated");
  await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, ["11111111-1111-1111-1111-111111111111"]);
  await expectReject(db, "a signed-in owner cannot reset the warm-up ramp", `update mailboxes set warmup_started_at = now() - interval '60 days' where id = '${MB}'`);
  await db.exec("rollback");
  await db.exec("begin");
  await db.exec("set local role authenticated");
  await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, ["11111111-1111-1111-1111-111111111111"]);
  await expectReject(db, "or mark a failing domain as passing", `update mailboxes set domain_status = 'pass' where id = '${MB}'`);
  await db.exec("rollback");
  const engine = await db.query(`update mailboxes set domain_status = 'warn' where id = '${MB}' returning id`);
  if (engine.rows.length === 1) ok("the engine still can");
  else fail("the engine still can", engine.rows);
}

console.log("\nMailbox connect after 0049 — DB-203");
{
  /* The harness grants `authenticated` SELECT on every table after the
     migrations run, which silently undoes 0049's column-level revoke on the
     token columns. That is how the upsert the connect callback used to send
     passed here and would have failed on Supabase. So 0049's grant is put
     back for this block, exactly as the migration writes it. */
  const OWNER = "11111111-1111-1111-1111-111111111111";
  const cols = await db.query<{ list: string }>(`
    select string_agg(quote_ident(column_name), ', ' order by ordinal_position) as list
      from information_schema.columns
     where table_schema = 'public' and table_name = 'mailboxes'
       and column_name not in ('oauth_token_enc', 'refresh_token_enc')`);
  await db.exec("begin");
  await db.exec(`revoke select on public.mailboxes from authenticated`);
  await db.exec(`grant select (${cols.rows[0]!.list}) on public.mailboxes to authenticated`);
  await db.exec("set local role authenticated");
  await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [OWNER]);

  await expectRejectTx(
    db,
    "a session cannot read a mailbox's token ciphertext (SEC-102)",
    `select oauth_token_enc from mailboxes limit 1`,
  );
  await expectRejectTx(
    db,
    "an upsert is refused: ON CONFLICT reads excluded token columns (why the callback no longer sends one)",
    `insert into mailboxes (org_id, provider, email, oauth_token_enc, status)
     values ($1, 'gmail', 'upsert-203@huntloop.test', 'enc', 'connected')
     on conflict (org_id, email) do update set oauth_token_enc = excluded.oauth_token_enc`,
    [ORG_A],
  );

  /* The callback's three statements, as `saveMailbox` sends them: look up by
     granted columns, then a plain insert or update with nothing returned. */
  const email = "connect-203@huntloop.test";
  try {
    const before = await db.query(`select id from mailboxes where org_id = $1 and email = $2 limit 1`, [ORG_A, email]);
    await db.query(
      `insert into mailboxes (org_id, provider, email, oauth_token_enc, refresh_token_enc, token_expires_at, status, last_error, deleted_at)
       values ($1, 'gmail', $2, 'enc-access', 'enc-refresh', now() + interval '1 hour', 'connected', null, null)`,
      [ORG_A, email],
    );
    const found = await db.query<{ id: string }>(`select id from mailboxes where org_id = $1 and email = $2 limit 1`, [ORG_A, email]);
    if (before.rows.length === 0 && found.rows.length === 1) ok("a first connect stores the mailbox as authenticated");
    else fail("a first connect stores the mailbox as authenticated", { before: before.rows, found: found.rows });

    await db.query(
      `update mailboxes set oauth_token_enc = 'enc-access-2', token_expires_at = now() + interval '1 hour',
              status = 'connected', last_error = null, deleted_at = null
        where id = $1 and org_id = $2`,
      [found.rows[0]!.id, ORG_A],
    );
    ok("a reconnect refreshes the tokens as authenticated");
  } catch (e) {
    fail("the callback's write shape succeeds as authenticated after 0049", e instanceof Error ? e.message : e);
  }
  await db.exec("rollback");

  const leaked = await db.query(`select count(*)::int as n from mailboxes where email like '%-203@huntloop.test'`);
  if ((leaked.rows[0] as { n: number }).n === 0) ok("and the block leaves nothing behind");
  else fail("and the block leaves nothing behind", leaked.rows);
}

console.log("\nSafety records a member cannot undo — DB-201 (0051)");
{
  const OWNER = "11111111-1111-1111-1111-111111111111"; // owner of org A: every member right
  const OTHER = "33333333-3333-3333-3333-333333333333"; // a user in org B
  const UNSENT = "d0000000-0000-0000-0000-0000000051a1";
  const SENT = "d0000000-0000-0000-0000-0000000051a2";
  const APPROVED = "d0000000-0000-0000-0000-0000000051a3"; // approved by someone else, not sent yet
  await db.exec(`
    insert into suppressions (org_id, kind, value, reason) values
      ('${ORG_A}', 'email', 'optout-51@alphio.ai', 'asked');
    insert into people (id, org_id, company_id, first_name) values
      ('9e000000-0000-0000-0000-0000000051a1', '${ORG_A}', 'c0000000-0000-0000-0000-00000000000a', 'Pat 51');
    insert into campaigns (id, org_id, name, status) values
      ('ca000000-0000-0000-0000-0000000051a1', '${ORG_A}', 'Seq 51', 'active');
    insert into enrollments (id, org_id, campaign_id, opportunity_id, status) values
      ('e0000000-0000-0000-0000-0000000051a1', '${ORG_A}', 'ca000000-0000-0000-0000-0000000051a1',
       '0bbbbbbb-0000-0000-0000-00000000000a', 'active');
    insert into messages (id, org_id, direction, to_email, subject, enrollment_id) values
      ('${UNSENT}', '${ORG_A}', 'outbound', 'dana@alphio.ai', 'Hi', 'e0000000-0000-0000-0000-0000000051a1');
    insert into messages (id, org_id, direction, to_email, subject, enrollment_id, scheduled_at, approved_by) values
      ('${APPROVED}', '${ORG_A}', 'outbound', 'dana@alphio.ai', 'Approved words', 'e0000000-0000-0000-0000-0000000051a1', now(), '${OTHER}');
    insert into messages (id, org_id, direction, to_email, subject, sent_at, provider_message_id, approved_by) values
      ('${SENT}', '${ORG_A}', 'outbound', 'dana@alphio.ai', 'Sent', now(), 'gmail-51', '${OWNER}');
  `);

  await db.exec("begin");
  await db.exec("set local role authenticated");
  await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [OWNER]);

  const count = async (sql: string) => ((await db.query<{ n: number }>(sql)).rows[0]!.n);

  await db.query(`delete from suppressions where value = 'optout-51@alphio.ai'`);
  await db.query(`update suppressions set value = 'someone-else@alphio.ai' where value = 'optout-51@alphio.ai'`);
  if ((await count(`select count(*)::int as n from suppressions where value = 'optout-51@alphio.ai'`)) === 1)
    ok("a member cannot delete or rewrite a suppression, so an unsubscribe stays honoured");
  else fail("a member cannot delete or rewrite a suppression", "the row changed");
  try {
    await db.query(`insert into suppressions (org_id, kind, value, reason) values ($1, 'email', 'added-51@alphio.ai', 'manual')`, [ORG_A]);
    ok("a member can still add one");
  } catch (e) {
    fail("a member can still add one", e instanceof Error ? e.message : e);
  }

  for (const [table, where] of [
    ["opportunities", `id = '0bbbbbbb-0000-0000-0000-00000000000a'`],
    ["enrollments", `id = 'e0000000-0000-0000-0000-0000000051a1'`],
    ["messages", `id = '${UNSENT}'`],
    ["people", `id = '9e000000-0000-0000-0000-0000000051a1'`],
  ] as const) {
    await db.query(`delete from ${table} where ${where}`);
    if ((await count(`select count(*)::int as n from ${table} where ${where}`)) === 1)
      ok(`a member cannot hard-delete ${table} (soft delete only)`);
    else fail(`a member cannot hard-delete ${table}`, "the row is gone");
  }

  await expectRejectTx(db, "approved_by cannot name somebody else", `update messages set approved_by = '${OTHER}' where id = '${UNSENT}'`);
  await expectRejectTx(db, "a session cannot mark a message sent", `update messages set sent_at = now(), provider_message_id = 'forged' where id = '${UNSENT}'`);
  await expectRejectTx(db, "or clear/set the at-most-once send claim", `update messages set send_attempted_at = now() where id = '${UNSENT}'`);
  await expectRejectTx(db, "a sent message is a record a session cannot change", `update messages set subject = 'Edited after the fact' where id = '${SENT}'`);
  await expectRejectTx(db, "including its approver", `update messages set approved_by = null where id = '${SENT}'`);
  await expectRejectTx(db, "a session cannot insert an inbound 'reply'", `insert into messages (org_id, direction, to_email, subject) values ('${ORG_A}', 'inbound', 'dana@alphio.ai', 'Re: Hi')`);
  await expectRejectTx(db, "or a message already marked sent", `insert into messages (org_id, direction, to_email, subject, sent_at, provider_message_id) values ('${ORG_A}', 'outbound', 'x@alphio.ai', 'Hi', now(), 'forged')`);
  await expectRejectTx(db, "or one approved in somebody else's name", `insert into messages (org_id, direction, to_email, subject, approved_by) values ('${ORG_A}', 'outbound', 'x@alphio.ai', 'Hi', '${OTHER}')`);
  await expectRejectTx(db, "an enrollment status must be one the engine knows", `update enrollments set status = 'bogus' where id = 'e0000000-0000-0000-0000-0000000051a1'`);

  /* SEC-301 (pass 17): the approval itself, not only the approver column. */
  await expectRejectTx(db, "a draft cannot be scheduled with nobody named as approver", `update messages set scheduled_at = now() where id = '${UNSENT}'`);
  await expectRejectTx(db, "nor scheduled in somebody else's name", `update messages set scheduled_at = now(), approved_by = '${OTHER}' where id = '${UNSENT}'`);
  await expectRejectTx(db, "a message cannot be inserted ready to send without approving it as yourself", `insert into messages (org_id, direction, to_email, subject, scheduled_at) values ('${ORG_A}', 'outbound', 'x@alphio.ai', 'Hi', now())`);
  await expectRejectTx(db, "an approved message's words cannot be rewritten under that approval", `update messages set body_text = 'Different words' where id = '${APPROVED}'`);
  await expectRejectTx(db, "nor its recipient", `update messages set to_email = 'someone-else@elsewhere.test' where id = '${APPROVED}'`);
  await expectRejectTx(db, "nor rewritten while re-approving it as yourself in one step", `update messages set subject = 'New', approved_by = '${OWNER}' where id = '${APPROVED}'`);
  try {
    await db.query(`update messages set subject = 'Rewritten', scheduled_at = null, approved_by = null, edited_by = $1 where id = '${APPROVED}'`, [OWNER]);
    await db.query(`update messages set scheduled_at = now(), approved_by = $1 where id = '${APPROVED}'`, [OWNER]);
    ok("rewriting it works by withdrawing the approval, then approving again as yourself");
  } catch (e) {
    fail("rewriting it works by withdrawing the approval, then approving again", e instanceof Error ? e.message : e);
  }

  try {
    /* In the order the app does them: edit the unapproved draft, then approve it. */
    await db.query(`update messages set edited_by = $1, subject = 'Edited' where id = '${UNSENT}'`, [OWNER]);
    await db.query(`update messages set approved_by = $1, scheduled_at = now(), error = null where id = '${UNSENT}'`, [OWNER]);
    await db.query(`update messages set error = 'Not sent: the sequence was stopped.' where id = '${UNSENT}'`);
    await db.query(`update messages set deleted_at = now() where id = '${UNSENT}'`);
    await db.query(
      `insert into messages (org_id, direction, to_email, subject, scheduled_at, approved_by) values ($1, 'outbound', 'reply-51@alphio.ai', 'Re: Hi', now(), $2)`,
      [ORG_A, OWNER],
    );
    await db.query(`update enrollments set status = 'stopped' where id = 'e0000000-0000-0000-0000-0000000051a1'`);
    ok("the app's own writes still pass: approve, edit, withdraw, soft delete, reply, stop");
  } catch (e) {
    fail("the app's own writes still pass", e instanceof Error ? e.message : e);
  }
  await db.exec("rollback");

  const engine = await db.query(
    `update messages set send_attempted_at = now() where id = '${UNSENT}' returning id`,
  );
  if (engine.rows.length === 1) ok("the engine can still claim and record a send");
  else fail("the engine can still claim and record a send", engine.rows);
  await expectReject(db, "and even the engine cannot invent an enrollment status", `update enrollments set status = 'bogus' where id = 'e0000000-0000-0000-0000-0000000051a1'`);
}

// ── Source health (0008) ───────────────────────────────────────────────────
console.log("\nSource health — §58's degrade-and-retry, in the database");
{
  await db.exec(`
    insert into sources (id, org_id, kind, name, scan_interval_minutes) values
      ('55550000-0000-0000-0000-000000000001',
       'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'news', 'Flaky feed', 60);
  `);
  const SRC = "55550000-0000-0000-0000-000000000001";

  for (let i = 0; i < 3; i++) {
    await db.query(`select public.record_source_failure($1, 'timeout')`, [SRC]);
  }
  const degraded = await db.query<{ status: string; failure_count: number; next_scan_at: string }>(
    `select status, failure_count, next_scan_at from sources where id = $1`,
    [SRC],
  );
  if (degraded.rows[0]!.status === "degraded" && degraded.rows[0]!.failure_count === 3)
    ok("three consecutive failures degrade a source rather than dropping it");
  else fail("three failures degrade a source", JSON.stringify(degraded.rows[0]));

  for (let i = 0; i < 7; i++) {
    await db.query(`select public.record_source_failure($1, 'timeout')`, [SRC]);
  }
  const dead = await db.query<{ status: string; next_scan_at: string | null }>(
    `select status, next_scan_at from sources where id = $1`,
    [SRC],
  );
  if (dead.rows[0]!.status === "unavailable" && dead.rows[0]!.next_scan_at !== null)
    ok("ten failures mark it unavailable — and it stays scheduled, so it can recover");
  else fail("ten failures mark it unavailable and keep it scheduled", JSON.stringify(dead.rows[0]));

  await db.query(`select public.record_source_success($1)`, [SRC]);
  const healed = await db.query<{ status: string; failure_count: number; last_error: string | null }>(
    `select status, failure_count, last_error from sources where id = $1`,
    [SRC],
  );
  if (
    healed.rows[0]!.status === "ok" &&
    healed.rows[0]!.failure_count === 0 &&
    healed.rows[0]!.last_error === null
  )
    ok("one success clears the failure state completely");
  else fail("one success clears the failure state", JSON.stringify(healed.rows[0]));
}

// ── The job queue (0008) ───────────────────────────────────────────────────
// The bug this is written against is a job claimed twice. PGlite is a single
// connection, so genuine concurrency is not reproducible here — what *is*
// testable is the invariant that makes concurrency safe: a claimed row is no
// longer claimable, and an abandoned one comes back.
console.log("\nJob queue — claim once, and recover from a dead worker");
{
  /* The fixture companies above queued their follow-ups (0050, FLOW-106);
     these checks count the queue, so they start from an empty one. */
  await db.exec(`
    delete from job_executions;
    insert into job_executions (id, org_id, job_name, payload) values
      ('99990000-0000-0000-0000-000000000001',
       'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'scan_source', '{"n":1}'::jsonb),
      ('99990000-0000-0000-0000-000000000002',
       'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'scan_source', '{"n":2}'::jsonb);
  `);

  const first = await db.query<{ id: string }>(
    `select id from public.claim_job_executions(1, 'worker-a')`,
  );
  const second = await db.query<{ id: string }>(
    `select id from public.claim_job_executions(5, 'worker-b')`,
  );
  const claimedTwice =
    first.rows.length === 1 &&
    second.rows.some((r) => r.id === first.rows[0]!.id);
  if (!claimedTwice && second.rows.length === 1)
    ok("a claimed job is not handed to a second worker");
  else
    fail(
      "a claimed job is not handed to a second worker",
      JSON.stringify([first.rows, second.rows]),
    );

  const empty = await db.query(`select id from public.claim_job_executions(5, 'worker-c')`);
  if (empty.rows.length === 0) ok("an empty queue returns nothing rather than blocking");
  else fail("an empty queue returns nothing", JSON.stringify(empty.rows));

  // A worker that died holding a job. Attempt 1 of 3, so it comes back.
  await db.query(
    `update job_executions set locked_at = now() - interval '1 hour' where status = 'running'`,
  );
  const revived = await db.query<{ requeue_stalled_jobs: number }>(
    `select public.requeue_stalled_jobs() as requeue_stalled_jobs`,
  );
  const requeued = await db.query<{ count: number }>(
    `select count(*)::int as count from job_executions where status = 'queued'`,
  );
  if (revived.rows[0]!.requeue_stalled_jobs === 2 && requeued.rows[0]!.count === 2)
    ok("a job whose worker vanished is queued again");
  else
    fail(
      "a job whose worker vanished is queued again",
      JSON.stringify([revived.rows[0], requeued.rows[0]]),
    );

  // …but not forever. Past max_attempts it fails with a stated reason rather
  // than cycling silently, which is how a poison payload takes down a queue.
  await db.query(
    `update job_executions set status = 'running', attempts = max_attempts,
       locked_at = now() - interval '1 hour'`,
  );
  await db.query(`select public.requeue_stalled_jobs()`);
  const dead = await db.query<{ count: number }>(
    `select count(*)::int as count from job_executions
      where status = 'failed' and error is not null`,
  );
  if (dead.rows[0]!.count === 2) ok("past max_attempts it fails with a reason, not a retry loop");
  else fail("past max_attempts it fails with a reason", JSON.stringify(dead.rows[0]));

  // And a tenant session must not be able to reach into the queue at all.
  await db.exec("begin");
  await db.exec("set local role authenticated");
  await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [
    "11111111-1111-1111-1111-111111111111",
  ]);
  await expectReject(
    db,
    "a tenant cannot claim jobs",
    `select * from public.claim_job_executions(5, 'attacker')`,
  );
  await db.exec("rollback");
}

// ── Document deduplication (0008) ──────────────────────────────────────────
console.log("\nDeduplication — §60, on both of the keys a page has");
{
  await db.exec(`
    insert into sources (id, org_id, kind, name) values
      ('55550000-0000-0000-0000-000000000002',
       'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'news', 'Feed');
    insert into source_documents (org_id, source_id, url, canonical_url, content_hash, url_hash)
    values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '55550000-0000-0000-0000-000000000002',
            'https://x.test/a?utm=1', 'https://x.test/a', 'hash-a', md5('https://x.test/a'));
  `);

  await expectReject(
    db,
    "the same content reached twice is one document",
    `insert into source_documents (org_id, source_id, url, content_hash, url_hash)
       values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '55550000-0000-0000-0000-000000000002',
               'https://other.test/mirror', 'hash-a', md5('https://other.test/mirror'))`,
  );
  await expectReject(
    db,
    "the same page re-fetched with different bytes is still one document",
    `insert into source_documents (org_id, source_id, url, canonical_url, content_hash, url_hash)
       values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '55550000-0000-0000-0000-000000000002',
               'https://x.test/a?utm=2', 'https://x.test/a', 'hash-b', md5('https://x.test/a'))`,
  );
}

// ── 0010 — scoring rules have an effect the database can check ─────────────
//
// The CHECK constraints here are what make "a rule that looks configured and
// does nothing" unrepresentable. The evaluator refuses the same shapes with
// better messages (`verify-rules.ts`); these are what hold when a row arrives
// by any other route.
console.log("\n0010 — a scoring rule's effect and its arguments must agree");
{
  await expectReject(
    db,
    "an adjusting rule with no weight is rejected",
    `insert into scoring_rules (org_id, name, expression, effect)
     values ($1, 'No weight', '{}'::jsonb, 'adjust')`,
    [ORG_A],
  );
  await expectReject(
    db,
    "a floor rule with nothing to floor to is rejected",
    `insert into scoring_rules (org_id, name, expression, effect)
     values ($1, 'No floor', '{}'::jsonb, 'floor')`,
    [ORG_A],
  );
  await expectReject(
    db,
    "a veto carrying a weight is rejected",
    `insert into scoring_rules (org_id, name, expression, effect, weight)
     values ($1, 'Confused', '{}'::jsonb, 'veto', 10)`,
    [ORG_A],
  );
  await expectReject(
    db,
    "a weight past ±40 is rejected rather than clamped",
    `insert into scoring_rules (org_id, name, expression, effect, weight)
     values ($1, 'Runaway', '{}'::jsonb, 'adjust', 500)`,
    [ORG_A],
  );
  await expectAccept(
    db,
    "a coherent adjusting rule is accepted",
    `insert into scoring_rules (org_id, name, expression, effect, weight, intent)
     values ($1, 'Fintech', '{"field":"company.industry","op":"equals","value":"fintech"}'::jsonb,
             'adjust', 12, 'boost')`,
    [ORG_A],
  );
  await expectAccept(
    db,
    "and so is a veto with neither",
    `insert into scoring_rules (org_id, name, expression, effect, intent)
     values ($1, 'Too small', '{"field":"company.employee_count","op":"lte","value":9}'::jsonb,
             'veto', 'reject')`,
    [ORG_A],
  );
  await expectReject(
    db,
    "an origin outside user/drafted/learned is rejected",
    `insert into scoring_rules (org_id, name, expression, effect, weight, origin)
     values ($1, 'Mystery', '{}'::jsonb, 'adjust', 5, 'somewhere')`,
    [ORG_A],
  );
}

// ── 0010 — the learning loop ───────────────────────────────────────────────
console.log("\n0010 — learning runs and findings");
{
  await expectReject(
    db,
    "a run whose window ends before it starts is rejected",
    `insert into learning_runs (org_id, window_start, window_end)
     values ($1, now(), now() - interval '1 day')`,
    [ORG_A],
  );
  await expectReject(
    db,
    "a status outside the five the app knows is rejected",
    `insert into learning_runs (org_id, status, window_start, window_end)
     values ($1, 'thinking', now() - interval '90 days', now())`,
    [ORG_A],
  );
  await expectAccept(
    db,
    "a requested run is accepted",
    `insert into learning_runs (id, org_id, window_start, window_end)
     values ('11110000-0000-0000-0000-00000000000a', $1, now() - interval '90 days', now())`,
    [ORG_A],
  );

  /* The rate limit that actually matters for this feature. Two clicks a second
     apart both pass any read-then-write guard, and each one costs an Opus call
     over a few hundred records. */
  await expectReject(
    db,
    "a second open run for the same org is refused — one analysis at a time",
    `insert into learning_runs (org_id, window_start, window_end)
     values ($1, now() - interval '90 days', now())`,
    [ORG_A],
  );
  await expectAccept(
    db,
    "but another org may have its own",
    `insert into learning_runs (org_id, window_start, window_end)
     values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', now() - interval '90 days', now())`,
  );
  await db.exec(
    `update learning_runs set status = 'ready'
       where id = '11110000-0000-0000-0000-00000000000a'`,
  );
  await expectAccept(
    db,
    "and a finished run does not block the next one",
    `insert into learning_runs (org_id, window_start, window_end)
     values ($1, now() - interval '90 days', now())`,
    [ORG_A],
  );

  await expectAccept(
    db,
    "a pending finding is accepted with no decider",
    `insert into learning_findings
       (id, org_id, run_id, kind, headline, detail, recommendation, cited_opportunity_ids)
     values ('22220000-0000-0000-0000-00000000000a', $1,
             '11110000-0000-0000-0000-00000000000a', 'scoring_adjustment',
             'Fresh triggers reply', 'Nine of eleven.', 'Contact sooner.',
             array['0bbbbbbb-0000-0000-0000-00000000000a']::uuid[])`,
    [ORG_A],
  );
  await expectReject(
    db,
    "an approved finding with no decision time is rejected — an approval names when",
    `update learning_findings set status = 'approved'
       where id = '22220000-0000-0000-0000-00000000000a'`,
  );
  await expectReject(
    db,
    "and a pending one carrying a decision time is rejected too",
    `update learning_findings set decided_at = now()
       where id = '22220000-0000-0000-0000-00000000000a'`,
  );
  await expectAccept(
    db,
    "deciding sets both together",
    `update learning_findings set status = 'approved', decided_at = now()
       where id = '22220000-0000-0000-0000-00000000000a'`,
  );
  await expectReject(
    db,
    "a finding kind outside the four is rejected",
    `insert into learning_findings (org_id, run_id, kind, headline, detail, recommendation)
     values ($1, '11110000-0000-0000-0000-00000000000a', 'vibes', 'h', 'd', 'r')`,
    [ORG_A],
  );

  /* Cascade rather than orphan. A finding whose run is gone has no window, no
     counts and no context — it is a sentence with nothing behind it, which is
     the one thing this feature must not produce. */
  await db.exec(`delete from learning_runs where id = '11110000-0000-0000-0000-00000000000a'`);
  const orphans = await db.query<{ n: number }>(
    `select count(*)::int as n from learning_findings
      where run_id = '11110000-0000-0000-0000-00000000000a'`,
  );
  if (orphans.rows[0]?.n === 0) ok("deleting a run takes its findings with it");
  else fail("deleting a run takes its findings with it", `${orphans.rows[0]?.n} left behind`);
}

// ── 0010 — the backlog cap ─────────────────────────────────────────────────
//
// `usage_counters` caps spend per month, which is a flow. This caps standing
// un-worked inventory, which is a level, and the two cannot substitute for
// each other.
console.log("\n0010 — discovery pauses when the backlog is full, per org");
{
  const count = async (org: string) =>
    (
      await db.query<{ n: number }>(`select public.open_opportunity_count($1)::int as n`, [org])
    ).rows[0]?.n ?? -1;

  const before = await count(ORG_A);
  if (before === 1) ok("an un-worked opportunity counts toward the backlog");
  else fail("an un-worked opportunity counts toward the backlog", `got ${before}`);

  await db.exec(
    `update opportunities set status = 'contacted'
       where id = '0bbbbbbb-0000-0000-0000-00000000000a'`,
  );
  const worked = await count(ORG_A);
  if (worked === 0) ok("one somebody is working does not — that is a pipeline, not a backlog");
  else fail("one somebody is working does not", `got ${worked}`);

  /* `ignore` is un-actioned and is still excluded. It is a *decided* verdict —
     the qualifier looked and said no — so counting it would pause discovery
     precisely because discovery was correctly filtering. */
  await db.exec(
    `update opportunities set status = 'discovered', priority = 'ignore'
       where id = '0bbbbbbb-0000-0000-0000-00000000000a'`,
  );
  const ignored = await count(ORG_A);
  if (ignored === 0) ok("nor does one the qualifier decided against");
  else fail("nor does one the qualifier decided against", `got ${ignored}`);

  await db.exec(
    `update opportunities set priority = 'warm'
       where id = '0bbbbbbb-0000-0000-0000-00000000000a'`,
  );

  const cap = async (org: string) =>
    (await db.query<{ n: number }>(`select public.backlog_cap($1)::int as n`, [org])).rows[0]?.n;

  if ((await cap(ORG_A)) === 250) ok("an org that has set nothing gets the default of 250");
  else fail("an org that has set nothing gets the default of 250", await cap(ORG_A));

  await db.query(
    `update organizations set settings = '{"engine":{"backlogCap":1}}'::jsonb where id = $1`,
    [ORG_A],
  );
  if ((await cap(ORG_A)) === 1) ok("and a configured one gets its own");
  else fail("and a configured one gets its own", await cap(ORG_A));

  const saturated = await db.query<{ id: string }>(`select public.saturated_org_ids() as id`);
  const ids = saturated.rows.map((r) => r.id);
  if (ids.includes(ORG_A)) ok("an org at its cap is reported saturated");
  else fail("an org at its cap is reported saturated", JSON.stringify(ids));
  if (!ids.includes("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"))
    ok("and one below its own is not — the cap is per tenant");
  else fail("and one below its own is not", JSON.stringify(ids));

  /* Zero is unlimited, and it has to be distinguishable from "not set". `->>`
     returns SQL NULL for a missing key and for a JSON null alike, which is why
     `serializeOrgProfile` omits the key rather than writing null. */
  await db.query(
    `update organizations set settings = '{"engine":{"backlogCap":0}}'::jsonb where id = $1`,
    [ORG_A],
  );
  const unlimited = await db.query<{ id: string }>(`select public.saturated_org_ids() as id`);
  if (!unlimited.rows.map((r) => r.id).includes(ORG_A))
    ok("a cap of zero means unlimited, not 'stop everything'");
  else fail("a cap of zero means unlimited", "still saturated");

  await db.query(`update organizations set settings = '{}'::jsonb where id = $1`, [ORG_A]);
}

// ── 0010 — memory ingestion metadata ───────────────────────────────────────
console.log("\n0010 — a memory says what it was before it was a memory");
{
  await expectAccept(
    db,
    "an existing memory defaults to text, untruncated, untagged",
    `insert into memories (org_id, scope, content) values ($1, 'organization', 'Never open with a compliment.')`,
    [ORG_A],
  );
  const row = await db.query<{ source_type: string; truncated: boolean; tags: string[] }>(
    `select source_type, truncated, tags from memories where org_id = $1 limit 1`,
    [ORG_A],
  );
  if (row.rows[0]?.source_type === "text" && row.rows[0]?.truncated === false)
    ok("so nothing written before this migration changes meaning");
  else fail("so nothing written before this migration changes meaning", JSON.stringify(row.rows[0]));

  await expectReject(
    db,
    "a source type outside the four is rejected",
    `insert into memories (org_id, scope, content, source_type)
     values ($1, 'organization', 'x', 'telepathy')`,
    [ORG_A],
  );
  await expectAccept(
    db,
    "an ingested document records where it came from and that it is an excerpt",
    `insert into memories (org_id, scope, content, source_type, source_url, source_label, tags, truncated)
     values ($1, 'organization', 'Positioning…', 'url', 'https://example.test/p',
             'Positioning one-pager', array['positioning'], true)`,
    [ORG_A],
  );
}

// ── 0010 — a rating is not an override ─────────────────────────────────────
console.log("\n0010 — rating an AI decision leaves the override alone");
{
  await expectAccept(
    db,
    "a decision can be rated without being corrected",
    `insert into ai_decisions (id, org_id, decision_type, output, quality_rating, rated_at)
     values ('33330000-0000-0000-0000-00000000000a', $1, 'qualify_opportunity',
             '{"score":70}'::jsonb, 'poor', now())`,
    [ORG_A],
  );
  const rated = await db.query<{ human_override: unknown }>(
    `select human_override from ai_decisions where id = '33330000-0000-0000-0000-00000000000a'`,
  );
  if (rated.rows[0]?.human_override === null)
    ok("and `human_override` stays null — the two mean different things");
  else fail("and `human_override` stays null", JSON.stringify(rated.rows[0]));

  await expectReject(
    db,
    "a rating outside the four is rejected",
    `insert into ai_decisions (org_id, decision_type, output, quality_rating)
     values ($1, 'qualify_opportunity', '{}'::jsonb, 'meh')`,
    [ORG_A],
  );
}

// ── 0010 — the score keeps the model's own number ──────────────────────────
console.log("\n0010 — a customer's rule does not overwrite what the model said");
{
  await expectAccept(
    db,
    "a score records the model's number alongside the final one",
    `insert into opportunity_scores
       (org_id, opportunity_id, model_version, score, model_score, explanation, rule_trace)
     values ($1, '0bbbbbbb-0000-0000-0000-00000000000a', 'qualify@2026-06-01', 82, 70,
             'Strong trigger, unclear budget.',
             '[{"ruleId":"r1","name":"Fintech","effect":"adjust","weight":12}]'::jsonb)`,
    [ORG_A],
  );
  await expectReject(
    db,
    "and a model score outside 0–100 is rejected like any other",
    `insert into opportunity_scores (org_id, opportunity_id, model_version, score, model_score, explanation)
     values ($1, '0bbbbbbb-0000-0000-0000-00000000000a', 'v', 50, 500, 'x')`,
    [ORG_A],
  );
}

// ── 0010 — tenant isolation on the new tables ──────────────────────────────
//
// The structural check below asserts RLS is *enabled* with *a* policy. This
// asserts the policy actually separates tenants, which is a different claim: a
// policy of `using (true)` would pass the first and fail this.
console.log("\n0010 — one org cannot read another's findings");
{
  await db.exec("begin");
  await db.exec(`set local role authenticated`).catch(() => {});
  await db.exec(
    `set local request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333'`,
  );

  const seen = await db.query<{ n: number }>(
    `select count(*)::int as n from learning_findings`,
  );
  if (seen.rows[0]?.n === 0) ok("org B sees none of org A's findings");
  else fail("org B sees none of org A's findings", `${seen.rows[0]?.n} visible`);

  const runs = await db.query<{ n: number }>(`select count(*)::int as n from learning_runs`);
  if (runs.rows[0]?.n === 1) ok("and sees exactly its own run");
  else fail("and sees exactly its own run", `${runs.rows[0]?.n} visible`);

  await db.exec("rollback");
}

// ══ 0011–0019 ══════════════════════════════════════════════════════════════
//
// The invariants that only exist because a provider is about to spend money,
// create rows at volume, and send mail on a customer's domain. Each of these
// is a behaviour that would keep *looking* correct if it were removed, which
// is the standard the rest of this suite is held to.

console.log("\n0011 — a provider budget is a control, not a number");
{
  await db.exec("begin");

  // No account limit configured → the plan's enrich allowance, never
  // unlimited. 0011 failed open here, and nothing in the product ever set an
  // account limit, so every workspace could spend without a ceiling (PROV-002,
  // closed by 0033).
  const open = await db.query<{ allowed: boolean; limit: number | null }>(
    `select allowed, "limit" from public.provider_budget_state($1, 'apollo')`,
    [ORG_A],
  );
  if (open.rows[0]?.allowed === true && Number(open.rows[0]?.limit) > 0) {
    ok("with no account limit, the plan's allowance applies — never unlimited");
  } else {
    fail("with no account limit, the plan's allowance applies — never unlimited", JSON.stringify(open.rows[0]));
  }

  await db.query(
    `insert into provider_accounts (org_id, capability, provider, monthly_credit_limit)
     values ($1, 'company.search', 'apollo', 10)`,
    [ORG_A],
  );

  // Nine credits spent against a limit of ten: still allowed.
  await db.query(
    `select public.record_provider_call($1, 'company.search', 'apollo', 'h1', 'ok', 9)`,
    [ORG_A],
  );
  const under = await db.query<{ allowed: boolean; used: number; remaining: number }>(
    `select allowed, used, remaining from public.provider_budget_state($1, 'apollo')`,
    [ORG_A],
  );
  if (under.rows[0]?.allowed === true && Number(under.rows[0]?.remaining) === 1) {
    ok("under the limit, with the remaining credits reported");
  } else {
    fail("under the limit, with the remaining credits reported", JSON.stringify(under.rows[0]));
  }

  await db.query(
    `select public.record_provider_call($1, 'company.search', 'apollo', 'h2', 'ok', 1)`,
    [ORG_A],
  );
  const over = await db.query<{ allowed: boolean }>(
    `select allowed from public.provider_budget_state($1, 'apollo')`,
    [ORG_A],
  );
  if (over.rows[0]?.allowed === false) ok("at the limit, refused");
  else fail("at the limit, refused", JSON.stringify(over.rows[0]));

  // A cache hit costs nothing, and must not consume budget. If it did, a
  // well-cached deployment would exhaust its allowance without making a call.
  await db.query(
    `select public.record_provider_call($1, 'company.search', 'apollo', 'h2', 'cache_hit', 0)`,
    [ORG_A],
  );
  const afterHit = await db.query<{ used: number }>(
    `select used from public.provider_budget_state($1, 'apollo')`,
    [ORG_A],
  );
  if (Number(afterHit.rows[0]?.used) === 10) ok("a cache hit is recorded and costs no budget");
  else fail("a cache hit is recorded and costs no budget", JSON.stringify(afterHit.rows[0]));

  await db.exec("rollback");
}

console.log("\n0050 — the last credit is reserved once (PROV-015)");
{
  await db.exec("begin");
  await db.query(
    `insert into provider_accounts (org_id, capability, provider, monthly_credit_limit)
     values ($1, 'company.search', 'apollo', 10)`,
    [ORG_A],
  );
  await db.query(`select public.record_provider_call($1, 'company.search', 'apollo', 'h1', 'ok', 9)`, [ORG_A]);

  const first = await db.query<{ allowed: boolean }>(
    `select allowed from public.reserve_provider_credit($1, 'apollo')`,
    [ORG_A],
  );
  const second = await db.query<{ allowed: boolean }>(
    `select allowed from public.reserve_provider_credit($1, 'apollo')`,
    [ORG_A],
  );
  if (first.rows[0]?.allowed === true && second.rows[0]?.allowed === false) {
    ok("one credit left: the first reservation holds it, the second is refused");
  } else {
    fail("one credit left: the first reservation holds it, the second is refused", JSON.stringify([first.rows, second.rows]));
  }

  // The call spent 2; the ledger counts it, then the hold is handed back.
  await db.query(`select public.record_provider_call($1, 'company.search', 'apollo', 'h2', 'ok', 2)`, [ORG_A]);
  await db.query(`select public.settle_provider_credit($1, 'apollo', 1)`, [ORG_A]);
  const settled = await db.query<{ used: number }>(
    `select used from public.provider_budget_state($1, 'apollo')`,
    [ORG_A],
  );
  if (Number(settled.rows[0]?.used) === 11) ok("settling leaves the real spend, not the reservation");
  else fail("settling leaves the real spend, not the reservation", JSON.stringify(settled.rows[0]));

  await db.exec("rollback");
}

console.log("\n0052 — the reservation is the call's cost (HL-1605); the inbox has its indexes (PERF-301)");
{
  await db.exec("begin");
  await db.query(
    `insert into provider_accounts (org_id, capability, provider, monthly_credit_limit)
     values ($1, 'person.match', 'apollo', 10)`,
    [ORG_A],
  );
  await db.query(`select public.record_provider_call($1, 'person.match', 'apollo', 'h52', 'ok', 9)`, [ORG_A]);
  const two = await db.query<{ allowed: boolean }>(`select allowed from public.reserve_provider_credit($1, 'apollo', 2)`, [ORG_A]);
  const one = await db.query<{ allowed: boolean }>(`select allowed from public.reserve_provider_credit($1, 'apollo', 1)`, [ORG_A]);
  if (two.rows[0]?.allowed === false && one.rows[0]?.allowed === true) {
    ok("one credit left: a two-credit call is refused, a one-credit call is not");
  } else {
    fail("a two-credit call is refused on the last credit", JSON.stringify([two.rows, one.rows]));
  }
  const used = await db.query<{ used: number }>(`select used from public.provider_budget_state($1, 'apollo')`, [ORG_A]);
  if (Number(used.rows[0]?.used) === 10) ok("and the refused call held nothing");
  else fail("the refused call held nothing", JSON.stringify(used.rows[0]));
  await db.exec("rollback");

  const idx = await db.query<{ indexname: string }>(
    `select indexname from pg_indexes where schemaname = 'public'
       and indexname in ('message_events_message_idx', 'messages_thread_created_idx', 'threads_org_last_message_idx')`,
  );
  if (idx.rows.length === 3) ok("the inbox's three indexes exist (PERF-301)");
  else fail("the inbox's three indexes exist", JSON.stringify(idx.rows));
}

console.log("\n0053 — the kill switch (PROD-207)");
{
  const ORG_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
  await db.exec("begin");
  const none = await db.query<{ r: string | null }>(`select public.platform_paused('sends', $1) as r`, [ORG_A]);
  if (none.rows[0]?.r === null) ok("nothing is paused by default");
  else fail("nothing is paused by default", JSON.stringify(none.rows));

  await db.query(`insert into platform_pauses (scope, org_id, reason) values ('ai', $1, 'Org A spend')`, [ORG_A]);
  const a = await db.query<{ r: string | null }>(`select public.platform_paused('ai', $1) as r`, [ORG_A]);
  const b = await db.query<{ r: string | null }>(`select public.platform_paused('ai', $1) as r`, [ORG_B]);
  const sendsA = await db.query<{ r: string | null }>(`select public.platform_paused('sends', $1) as r`, [ORG_A]);
  if (a.rows[0]?.r === "Org A spend" && b.rows[0]?.r === null && sendsA.rows[0]?.r === null) {
    ok("a per-org pause stops that org's scope only");
  } else {
    fail("a per-org pause stops that org's scope only", JSON.stringify([a.rows, b.rows, sendsA.rows]));
  }

  await db.query(`insert into platform_pauses (scope, reason) values ('sends', 'Bounce spike')`);
  const global = await db.query<{ r: string | null }>(`select public.platform_paused('sends', $1) as r`, [ORG_B]);
  if (global.rows[0]?.r === "Bounce spike") ok("a global pause stops every org");
  else fail("a global pause stops every org", JSON.stringify(global.rows));

  await db.query(`update platform_pauses set lifted_at = now() where scope = 'sends'`);
  const lifted = await db.query<{ r: string | null }>(`select public.platform_paused('sends', $1) as r`, [ORG_B]);
  if (lifted.rows[0]?.r === null) ok("lifting it resumes");
  else fail("lifting it resumes", JSON.stringify(lifted.rows));

  await expectRejectTx(db, "a pause needs a reason", `insert into platform_pauses (scope, reason) values ('ai', '  ')`);

  /* As a session: no direct access, and no peeking at another org's pause.
     The harness creates `authenticated` after the migrations and grants it
     every table, so 0053's revoke and its function grant are re-applied here
     as Supabase would have them. RLS (no policies) is what holds either way. */
  await db.query(`insert into platform_pauses (scope, reason) values ('providers', 'Still paused')`);
  await db.exec(`revoke all on public.platform_pauses from authenticated`);
  await db.exec(`grant execute on function public.platform_paused(text, uuid) to authenticated`);
  await db.exec("set local role authenticated");
  await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, ["33333333-3333-3333-3333-333333333333"]);
  await expectRejectTx(db, "a session cannot read the table", `select * from platform_pauses`);
  await expectRejectTx(db, "or write it (lift a pause)", `update platform_pauses set lifted_at = now()`);
  const own = await db.query<{ r: string | null }>(`select public.platform_paused('providers', $1) as r`, [ORG_B]);
  if (own.rows[0]?.r === "Still paused") ok("a session can ask whether its own work is paused");
  else fail("a session can ask whether its own work is paused", JSON.stringify(own.rows));
  const peek = await db.query<{ r: string | null }>(`select public.platform_paused('ai', $1) as r`, [ORG_A]);
  if (peek.rows[0]?.r === null) ok("and cannot learn another workspace's pause");
  else fail("cannot learn another workspace's pause", JSON.stringify(peek.rows));
  await db.exec("rollback");
}

console.log("\n0054 — hot-path FK indexes (PERF-302), why-now date (TRUST-301), activation (ANL-301)");
{
  const HOT_PATH = [
    "opportunities_company_fk_idx", "opportunity_scores_opportunity_fk_idx", "people_company_fk_idx",
    "contact_points_person_fk_idx", "enrollments_opportunity_fk_idx", "enrollments_campaign_fk_idx",
    "messages_opportunity_fk_idx", "messages_step_fk_idx", "threads_opportunity_fk_idx",
    "activities_opportunity_fk_idx", "activities_company_fk_idx", "company_triggers_company_fk_idx",
    "source_events_company_fk_idx", "source_events_document_fk_idx",
    "conversation_messages_conversation_fk_idx", "sequence_steps_sequence_fk_idx", "outcomes_opportunity_fk_idx",
  ];
  const idx = await db.query<{ indexname: string }>(
    `select indexname from pg_indexes where schemaname = 'public' and indexname = any($1)`,
    [HOT_PATH],
  );
  if (idx.rows.length === HOT_PATH.length) ok(`the ${HOT_PATH.length} hot-path FK indexes exist`);
  else fail("the hot-path FK indexes exist", `${idx.rows.length}/${HOT_PATH.length}`);

  /* A ratchet, not an allow-list of 125 names: a new single-column FK with no
     index leading on it raises the count and fails here. Index it, or raise
     the ceiling in the same change and say why. */
  const UNINDEXED_FK_CEILING = 125;
  const n = unindexedFkAfterMigrations;
  if (n <= UNINDEXED_FK_CEILING) ok(`unindexed single-column FKs: ${n} (ceiling ${UNINDEXED_FK_CEILING})`);
  else fail("no new FK lands without an index", `${n} > ceiling ${UNINDEXED_FK_CEILING}`);

  const col = await db.query(
    `select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'opportunities' and column_name = 'why_now_written_at'`,
  );
  if (col.rows.length === 1) ok("opportunities.why_now_written_at exists");
  else fail("opportunities.why_now_written_at exists", "missing");

  await db.exec("begin");
  await db.query(
    `insert into opportunity_scores (org_id, opportunity_id, model_version, score, confidence, explanation, computed_at)
     values ($1, '0bbbbbbb-0000-0000-0000-00000000000a', 'fixture', 80, 'high', 'fixture', '2026-01-02T00:00:00Z')`,
    [ORG_A],
  );
  const all = await db.query<{ org_id: string; first_warm_at: string | null; sent_30d: number }>(
    `select org_id, first_warm_at, sent_30d from public.org_activation order by slug`,
  );
  const a = all.rows.find((r) => r.org_id === ORG_A);
  /* Earlier blocks leave sent messages behind, so the count is checked
     against the table rather than against a number. */
  const sent = await db.query<{ n: number }>(
    `select count(*)::int as n from messages
      where org_id = $1 and direction = 'outbound' and deleted_at is null
        and sent_at > now() - interval '30 days'`,
    [ORG_A],
  );
  if (all.rows.length === 2 && a?.first_warm_at && Number(a.sent_30d) === Number(sent.rows[0]?.n)) {
    ok("org_activation: one row per workspace, first warm opportunity dated, sends counted");
  } else {
    fail("org_activation reads the loop", JSON.stringify(all.rows));
  }
  await db.exec("set local role authenticated");
  await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, ["33333333-3333-3333-3333-333333333333"]);
  const own = await db.query<{ org_id: string }>(`select org_id from public.org_activation`);
  if (own.rows.length === 1 && own.rows[0]?.org_id === "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb") {
    ok("a session sees only its own workspace's row (security_invoker)");
  } else {
    fail("a session sees only its own workspace's row", JSON.stringify(own.rows));
  }
  await db.exec("rollback");
}

console.log("\n0055 — status columns only hold states the code knows (DB-202)");
{
  const NAMES = [
    "mailboxes_status_check", "job_executions_status_check", "campaigns_status_check",
    "threads_status_check", "threads_classification_check", "ai_runs_status_check",
  ];
  const cons = await db.query<{ conname: string; convalidated: boolean }>(
    `select conname, convalidated from pg_constraint where conname = any($1)`,
    [NAMES],
  );
  if (cons.rows.length === NAMES.length && cons.rows.every((r) => r.convalidated)) {
    ok(`all ${NAMES.length} status CHECKs exist and are validated`);
  } else {
    fail("the status CHECKs exist and are validated", JSON.stringify(cons.rows));
  }

  /* One transaction: expectRejectTx scopes each refusal to a savepoint, and a
     savepoint outside a transaction is itself an error that would read as a
     pass. */
  await db.exec("begin");
  await expectRejectTx(db, "a job status nothing handles ('done') is rejected",
    `insert into job_executions (org_id, job_name, status) values ($1, 'scan_source', 'done')`, [ORG_A]);
  await expectAccept(db, "every job status the queue uses is accepted",
    `insert into job_executions (org_id, job_name, status)
     select $1, 'scan_source', s from unnest(array['queued','running','succeeded','failed','cancelled']) s`, [ORG_A]);
  await expectRejectTx(db, "an AI run status outside started/succeeded/failed is rejected",
    `insert into ai_runs (org_id, task, model, prompt_version, status) values ($1, 'x', 'm', 'v', 'refused')`, [ORG_A]);
  await expectAccept(db, "and the same run as 'started' is accepted (so the refusal above is the CHECK)",
    `insert into ai_runs (org_id, task, model, prompt_version, status) values ($1, 'x', 'm', 'v', 'started')`, [ORG_A]);
  await expectRejectTx(db, "a thread status typo is rejected",
    `insert into threads (org_id, status) values ($1, 'opne')`, [ORG_A]);
  await expectRejectTx(db, "a reply class the classifier cannot produce is rejected",
    `insert into threads (org_id, classification) values ($1, 'maybe')`, [ORG_A]);
  await expectAccept(db, "an unclassified open thread is accepted",
    `insert into threads (org_id, status, classification) values ($1, 'open', null)`, [ORG_A]);
  await db.exec("rollback");
}

console.log("\n0056 — workspaces take turns in the queue (JOB-202)");
{
  const ORG_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
  await db.exec("begin");
  /* Only this block's jobs are due: anything earlier blocks left queued is
     moved out of the way inside the transaction. */
  await db.exec(`update job_executions set status = 'cancelled' where status = 'queued'`);

  // The audit's acceptance case: A holds 1,000 due jobs, all older than B's one.
  await db.query(
    `insert into job_executions (org_id, job_name, payload, run_at)
     select $1, 'profile_company', jsonb_build_object('n', g), now() - interval '2 hours' + (g || ' milliseconds')::interval
       from generate_series(1, 1000) g`,
    [ORG_A],
  );
  await db.query(
    `insert into job_executions (org_id, job_name, payload, run_at)
     values ($1, 'send_message', '{"b":1}'::jsonb, now() - interval '1 minute')`,
    [ORG_B],
  );
  await db.query(
    `insert into job_executions (org_id, job_name, payload, run_at)
     values (null, 'schedule_sends', '{}'::jsonb, now() - interval '30 seconds')`,
  );

  const batch = await db.query<{ org_id: string | null; payload: Record<string, unknown> }>(
    `select org_id, payload from public.claim_job_executions(5, 'fair-1')`,
  );
  const orgs = batch.rows.map((r) => r.org_id);
  if (batch.rows.length === 5 && orgs.includes(ORG_B) && orgs.includes(null)) {
    ok("B's one job and the global sweeper are in the first batch, ahead of A's backlog of 1,000");
  } else {
    fail("B is not starved by A's backlog", JSON.stringify(orgs));
  }
  const aTaken = batch.rows.filter((r) => r.org_id === ORG_A).map((r) => Number(r.payload.n)).sort((x, y) => x - y);
  if (JSON.stringify(aTaken) === JSON.stringify([1, 2, 3])) ok("inside one workspace, oldest still goes first");
  else fail("inside one workspace, oldest still goes first", JSON.stringify(aTaken));

  const again = await db.query<{ org_id: string | null }>(
    `select org_id from public.claim_job_executions(5, 'fair-2')`,
  );
  if (again.rows.length === 5 && again.rows.every((r) => r.org_id === ORG_A)) {
    ok("once the others are served, A's backlog drains at full speed");
  } else {
    fail("A's backlog drains once the others are served", JSON.stringify(again.rows));
  }
  const running = await db.query<{ n: number }>(`select count(*)::int as n from job_executions where status = 'running'`);
  if (Number(running.rows[0]?.n) === 10) ok("no job was claimed twice across the two batches");
  else fail("no job was claimed twice", JSON.stringify(running.rows));

  // The two sweepers, by the same rule.
  await db.query(
    `insert into messages (org_id, direction, scheduled_at)
     select $1, 'outbound', now() - interval '2 hours' + (g || ' seconds')::interval from generate_series(1, 200) g`,
    [ORG_A],
  );
  await db.query(
    `insert into messages (org_id, direction, scheduled_at) values ($1, 'outbound', now() - interval '1 minute')`,
    [ORG_B],
  );
  const sends = await db.query<{ org_id: string }>(`select org_id from public.due_sends_fair(now(), 2)`);
  if (sends.rows.length === 2 && sends.rows.some((r) => r.org_id === ORG_B)) {
    ok("due_sends_fair: B's approved message is picked beside A's 200 older ones");
  } else {
    fail("due_sends_fair takes turns", JSON.stringify(sends.rows));
  }
  await db.query(
    `insert into messages (org_id, direction, scheduled_at, not_before)
     values ($1, 'outbound', now() - interval '3 hours', now() + interval '1 hour')`,
    [ORG_B],
  );
  const deferred = await db.query<{ n: number }>(
    `select count(*)::int as n from public.due_sends_fair(now(), 500) where org_id = $1`,
    [ORG_B],
  );
  if (Number(deferred.rows[0]?.n) === 1) ok("due_sends_fair: a deferred message (not_before) waits");
  else fail("due_sends_fair respects not_before", JSON.stringify(deferred.rows));

  const camp = await db.query<{ id: string }>(
    `insert into campaigns (org_id, name) values ($1, 'Fairness A') returning id`, [ORG_A]);
  const campB = await db.query<{ id: string }>(
    `insert into campaigns (org_id, name) values ($1, 'Fairness B') returning id`, [ORG_B]);
  await db.query(
    `insert into enrollments (org_id, campaign_id, opportunity_id, status, next_action_at)
     select $1, $2, '0bbbbbbb-0000-0000-0000-00000000000a', 'active', now() - interval '1 day'`,
    [ORG_A, camp.rows[0]!.id],
  );
  await db.query(
    `insert into enrollments (org_id, campaign_id, opportunity_id, status, next_action_at)
     values ($1, $2, '0bbbbbbb-0000-0000-0000-00000000000b', 'active', now() - interval '1 minute')`,
    [ORG_B, campB.rows[0]!.id],
  );
  const enr = await db.query<{ org_id: string }>(`select org_id from public.due_enrollments_fair(now(), 2)`);
  if (enr.rows.length === 2 && new Set(enr.rows.map((r) => r.org_id)).size === 2) {
    ok("due_enrollments_fair: one enrollment from each workspace with due work");
  } else {
    fail("due_enrollments_fair takes turns", JSON.stringify(enr.rows));
  }

  /* Sessions cannot call them. The harness grants `authenticated` everything
     after the migrations, so 0056's revoke is re-applied as Supabase has it. */
  await db.exec(`revoke execute on function public.due_sends_fair(timestamptz, integer) from authenticated`);
  await db.exec("set local role authenticated");
  await expectRejectTx(db, "a session cannot call the cross-tenant sweep", `select * from public.due_sends_fair(now(), 5)`);
  await db.exec("rollback");
}

console.log("\n0057 — a removed ICP stops its paid searches (PANEL-401)");
{
  const ORG = "57575757-0057-0057-0057-000000000057";
  const LIVE = "57575757-0057-0057-0057-0000000000a1";
  const GONE = "57575757-0057-0057-0057-0000000000a2";
  await db.exec("begin");
  await db.query(`insert into organizations (id, name, slug) values ($1, 'ICP Co', 'icp-0057')`, [ORG]);
  await db.query(
    `insert into icps (id, org_id, name, criteria, is_active)
     values ($1, $3, 'Live', '{"segments":["Fintech"]}'::jsonb, true),
            ($2, $3, 'Gone', '{"segments":["Retail"]}'::jsonb, false)`,
    [LIVE, GONE, ORG],
  );
  await db.query(`update icps set deleted_at = now() where id = $1`, [GONE]);
  /* Written straight in, enabled, against the already-removed profile: the
     state a raw API write or a pre-0057 database leaves. Only the claim
     stands between it and a paid search. */
  await db.query(
    `insert into discovery_queries (org_id, icp_id, name, filters, filters_hash, is_enabled, next_run_at)
     values ($1, $2, 'q-live', '{}'::jsonb, 'h-57-live', true, now() - interval '1 minute'),
            ($1, $3, 'q-gone', '{}'::jsonb, 'h-57-gone', true, now() - interval '1 minute'),
            ($1, null, 'q-adhoc', '{}'::jsonb, 'h-57-adhoc', true, now() - interval '1 minute')`,
    [ORG, LIVE, GONE],
  );

  const claimed = await db.query<{ name: string }>(
    `select q.name from public.claim_due_discovery_queries(100) c
       join discovery_queries q on q.id = c.id where c.org_id = $1 order by q.name`,
    [ORG],
  );
  const names = claimed.rows.map((r) => r.name);
  if (!names.includes("q-gone")) ok("a search for a removed ICP is never claimed, so no paid search runs");
  else fail("a search for a removed ICP is never claimed", JSON.stringify(names));
  if (names.includes("q-live") && names.includes("q-adhoc")) {
    ok("a live ICP's search and an ad-hoc search (no ICP) are still claimed");
  } else {
    fail("live and ad-hoc searches are still claimed", JSON.stringify(names));
  }

  await db.query(`update icps set deleted_at = now(), is_active = false where id = $1`, [LIVE]);
  const after = await db.query<{ is_enabled: boolean; next_run_at: string | null }>(
    `select is_enabled, next_run_at from discovery_queries where org_id = $1 and name = 'q-live'`,
    [ORG],
  );
  if (after.rows[0]?.is_enabled === false && after.rows[0]?.next_run_at === null) {
    ok("removing an ICP disables its searches, so the rows say what the engine does");
  } else {
    fail("removing an ICP disables its searches", JSON.stringify(after.rows));
  }
  const adhoc = await db.query<{ is_enabled: boolean }>(
    `select is_enabled from discovery_queries where org_id = $1 and name = 'q-adhoc'`,
    [ORG],
  );
  if (adhoc.rows[0]?.is_enabled === true) ok("and a search with no ICP is left alone");
  else fail("a search with no ICP is left alone", JSON.stringify(adhoc.rows));

  const probe = await db.query<{ v: boolean }>(`select public.migration_0057_applied() as v`);
  if (probe.rows[0]?.v === true) ok("migration_0057_applied() exists for db:doctor");
  else fail("migration_0057_applied() exists", JSON.stringify(probe.rows));
  await db.exec("rollback");
}

console.log("\n0058 — activation counts replies, not inbound mail (PANEL-313)");
{
  const ORG = "58585858-0058-0058-0058-000000000058";
  await db.exec("begin");
  await db.query(`insert into organizations (id, name, slug) values ($1, 'Act Co', 'act-0058')`, [ORG]);
  /* Three inbound messages nobody replied with — a newsletter, an
     out-of-office and a bounce — and one real, classified reply. */
  await db.query(
    `insert into messages (org_id, direction, body_text) values
       ($1, 'inbound', 'newsletter'), ($1, 'inbound', 'out of office'), ($1, 'inbound', 'bounce')`,
    [ORG],
  );
  await db.query(`insert into outcomes (org_id, kind) values ($1, 'reply'), ($1, 'won')`, [ORG]);

  const row = await db.query<{ replies_30d: string; first_reply_at: string | null }>(
    `select replies_30d, first_reply_at from public.org_activation where org_id = $1`,
    [ORG],
  );
  if (Number(row.rows[0]?.replies_30d) === 1) {
    ok("replies_30d counts the one reply outcome, not the three inbound messages");
  } else {
    fail("replies_30d counts reply outcomes only", JSON.stringify(row.rows));
  }
  if (row.rows[0]?.first_reply_at) ok("first_reply_at comes from the reply outcome");
  else fail("first_reply_at comes from the reply outcome", JSON.stringify(row.rows));

  const probe = await db.query<{ v: boolean }>(`select public.migration_0058_applied() as v`);
  if (probe.rows[0]?.v === true) ok("migration_0058_applied() exists for db:doctor");
  else fail("migration_0058_applied() exists", JSON.stringify(probe.rows));
  await db.exec("rollback");
}

console.log("\n0059 — the Exchange firewall: declared data is never enriched or sequenced");
{
  const ORG = "59595959-0059-0059-0059-000000000059";
  const CO = "59595959-0059-0059-0059-0000000000c1";
  const BUYER = "59595959-0059-0059-0059-0000000000b1";
  const COLD = "59595959-0059-0059-0059-0000000000b2";
  const OPP_X = "59595959-0059-0059-0059-0000000000d1";
  const CAMP = "59595959-0059-0059-0059-0000000000e1";
  await db.exec("begin");
  await db.query(`insert into organizations (id, name, slug) values ($1, 'FW Co', 'fw-0059')`, [ORG]);
  await db.query(`insert into companies (id, org_id, canonical_domain, name) values ($1, $2, 'buyer.test', 'Buyer')`, [CO, ORG]);
  await db.query(
    `insert into people (id, org_id, company_id, first_name, origin) values
       ($1, $3, $4, 'Bea', 'exchange'), ($2, $3, $4, 'Cole', 'engine')`,
    [BUYER, COLD, ORG, CO],
  );
  await db.query(
    `insert into opportunities (id, org_id, company_id, priority_reason, origin) values ($1, $2, $3, 'Stated need.', 'exchange')`,
    [OPP_X, ORG, CO],
  );
  await db.query(`insert into campaigns (id, org_id, name, status) values ($1, $2, 'C', 'active')`, [CAMP, ORG]);

  await expectRejectTx(db, "an invalid origin is refused", `update people set origin = 'scraped' where id = $1`, [COLD]);
  await expectRejectTx(db, "an Exchange person cannot be laundered back to 'engine'", `update people set origin = 'engine' where id = $1`, [BUYER]);
  await expectRejectTx(db, "an Exchange opportunity cannot be laundered either", `update opportunities set origin = 'engine' where id = $1`, [OPP_X]);
  await expectRejectTx(
    db,
    "an Exchange opportunity cannot be enrolled in a sequence",
    `insert into enrollments (org_id, campaign_id, opportunity_id, status) values ($1, $2, $3, 'active')`,
    [ORG, CAMP, OPP_X],
  );
  await expectRejectTx(
    db,
    "no enrichment record can be written for an Exchange person",
    `insert into enrichment_records (org_id, entity_type, entity_id, provider, field, value) values ($1, 'person', $2, 'apollo', 'email', '"x"'::jsonb)`,
    [ORG, BUYER],
  );
  await expectRejectTx(
    db,
    "no provider-sourced contact point can be written for an Exchange person",
    `insert into contact_points (org_id, person_id, kind, value, provider) values ($1, $2, 'email', 'bea@buyer.test', 'hunter')`,
    [ORG, BUYER],
  );

  await db.exec("savepoint fw_accept");
  try {
    await db.query(
      `insert into contact_points (org_id, person_id, kind, value) values ($1, $2, 'email', 'bea@buyer.test')`,
      [ORG, BUYER],
    );
    ok("a contact detail the buyer gave (no provider) is accepted");
  } catch (e) {
    fail("a contact detail the buyer gave is accepted", e);
  }
  try {
    await db.query(
      `insert into enrichment_records (org_id, entity_type, entity_id, provider, field, value) values ($1, 'person', $2, 'apollo', 'email', '"x"'::jsonb)`,
      [ORG, COLD],
    );
    ok("an engine person is still enriched as before");
  } catch (e) {
    fail("an engine person is still enriched as before", e);
  }
  await db.exec("release savepoint fw_accept");

  const probe = await db.query<{ v: boolean }>(`select public.migration_0059_applied() as v`);
  if (probe.rows[0]?.v === true) ok("migration_0059_applied() exists for db:doctor");
  else fail("migration_0059_applied() exists", JSON.stringify(probe.rows));
  await db.exec("rollback");
}

console.log("\n0060/0061 — Exchange core: universal, global, buyer data stays the buyer's");
{
  const A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"; // buyer workspace
  const B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"; // provider workspace
  const OWNER_A = "11111111-1111-1111-1111-111111111111";
  const VIEWER_A = "22222222-2222-2222-2222-222222222222";
  const OWNER_B = "33333333-3333-3333-3333-333333333333";
  const NEED = "60606060-0060-0060-0060-0000000000a1";
  const PROV_B = "60606060-0060-0060-0060-0000000000b1";
  const OFFER_B = "60606060-0060-0060-0060-0000000000c1";
  const NEED_B = "60606060-0060-0060-0060-0000000000a2";

  // The seed (0061).
  const tree = await db.query<{ parents: number; leaves: number; on: number; gpus: boolean }>(`
    select count(*) filter (where parent_id is null)::int as parents,
           count(*) filter (where parent_id is not null)::int as leaves,
           count(*) filter (where matching_enabled)::int as on,
           bool_or(regulated) filter (where slug = 'gpus-accelerators') as gpus
      from exchange_categories`);
  const t = tree.rows[0]!;
  if (t.parents === 15 && t.leaves >= 50) ok(`the starting taxonomy is broad: ${t.parents} parents, ${t.leaves} leaves`);
  else fail("the starting taxonomy is broad", JSON.stringify(t));
  if (t.on === 0) ok("every category starts with matching off, until it has supply");
  else fail("every category starts with matching off", JSON.stringify(t));
  if (t.gpus === true) ok("export-controlled compute starts as regulated");
  else fail("export-controlled compute starts as regulated", JSON.stringify(t));
  const orphans = await db.query(`select slug from exchange_categories c where c.parent_id is null and c.attributes = '[]'::jsonb`);
  if (orphans.rows.length === 0) ok("every parent category defines the attributes its leaves inherit");
  else fail("every parent category defines attributes", JSON.stringify(orphans.rows));

  await db.exec("begin");
  const leaf = (await db.query<{ id: string }>(`select id from exchange_categories where slug = 'gpus-accelerators'`)).rows[0]!.id;

  // Engine context (no session): the rows a buyer and a provider would create.
  await db.query(
    `insert into exchange_needs (id, org_id, category_id, summary, quantity, unit, currency, budget_max, country, visibility)
     values ($1, $2, $3, '200 NVIDIA H200 NVL PCIe cards', 200, 'units', 'EUR', 6000000, 'DE', 2)`,
    [NEED, A, leaf],
  );
  await db.query(
    `insert into exchange_provider_profiles (id, org_id, name, domain, country, claimed_at)
     values ($1, $2, 'Northwind Compute', 'northwind.co', 'DE', now())`,
    [PROV_B, B],
  );
  await db.query(
    `insert into exchange_offerings (id, provider_id, org_id, category_id, title, currency, price_from, serves_countries, status)
     values ($1, $2, $3, $4, 'H200 NVL, authorised partner', 'EUR', 25000, '{DE,FR}', 'active')`,
    [OFFER_B, PROV_B, A, leaf],
  );
  const follows = await db.query<{ org_id: string }>(`select org_id from exchange_offerings where id = $1`, [OFFER_B]);
  if (follows.rows[0]?.org_id === B) ok("an offering's org_id follows its provider, whatever was sent");
  else fail("an offering's org_id follows its provider", JSON.stringify(follows.rows));

  await db.query(`insert into exchange_matches (need_id, offering_id, score) values ($1, $2, 72)`, [NEED, OFFER_B]);
  await db.query(`insert into exchange_needs (id, org_id, summary) values ($1, $2, 'Our own need')`, [NEED_B, B]);
  await expectRejectTx(
    db,
    "a workspace is never matched to its own offering",
    `insert into exchange_matches (need_id, offering_id) values ($1, $2)`,
    [NEED_B, OFFER_B],
  );
  await expectRejectTx(db, "an amount with no currency is refused", `insert into exchange_needs (org_id, summary, budget_max) values ($1, 'x', 10)`, [A]);
  await expectRejectTx(db, "a currency that is not ISO 4217 is refused", `insert into exchange_needs (org_id, summary, currency) values ($1, 'x', 'usd')`, [A]);
  await expectRejectTx(
    db,
    "an availability claim without its date is refused",
    `insert into exchange_offerings (provider_id, title, availability) values ($1, 'x', 'in_stock')`,
    [PROV_B],
  );
  await db.query(`insert into exchange_needs (org_id, summary) values ($1, 'Something I cannot categorise yet')`, [A]);
  ok("a need with no category is saved and counted (describe what you need)");

  await db.exec("set local role authenticated");

  // The provider's view.
  await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [OWNER_B]);
  const theirNeeds = await db.query(`select id from exchange_needs where org_id = $1`, [A]);
  if (theirNeeds.rows.length === 0) ok("a provider cannot read a buyer's needs (firewall)");
  else fail("a provider cannot read a buyer's needs", JSON.stringify(theirNeeds.rows));
  const theirMatches = await db.query(`select id from exchange_matches where org_id = $1`, [A]);
  if (theirMatches.rows.length === 0) ok("nor the buyer's matches");
  else fail("nor the buyer's matches", JSON.stringify(theirMatches.rows));
  const cats = await db.query<{ n: number }>(`select count(*)::int as n from exchange_categories`);
  if (cats.rows[0]!.n > 0) ok("every signed-in session can read the categories");
  else fail("every signed-in session can read the categories", "0 rows");
  await expectRejectTx(db, "a provider cannot verify its own profile", `update exchange_provider_profiles set verified_at = now() where id = $1`, [PROV_B]);
  await expectRejectTx(db, "a session cannot write categories", `insert into exchange_categories (slug, name) values ('mine', 'Mine')`);

  // The buyer's view.
  await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [OWNER_A]);
  const mine = await db.query(`select id from exchange_needs where id = $1`, [NEED]);
  if (mine.rows.length === 1) ok("the buyer reads their own need");
  else fail("the buyer reads their own need", JSON.stringify(mine.rows));
  const offers = await db.query(`select id from exchange_offerings where id = $1`, [OFFER_B]);
  if (offers.rows.length === 1) ok("an active offering is visible to buyers");
  else fail("an active offering is visible to buyers", JSON.stringify(offers.rows));
  const matchId = (await db.query<{ id: string }>(`select id from exchange_matches where need_id = $1`, [NEED])).rows[0]?.id;
  await db.query(`select public.exchange_set_match_state($1, 'shortlisted')`, [matchId]);
  const state = await db.query<{ buyer_state: string }>(`select buyer_state from exchange_matches where id = $1`, [matchId]);
  if (state.rows[0]?.buyer_state === "shortlisted") ok("the buyer can shortlist a match");
  else fail("the buyer can shortlist a match", JSON.stringify(state.rows));
  const direct = await db.query(`update exchange_matches set score = 100 where need_id = $1 returning id`, [NEED]);
  if (direct.rows.length === 0) ok("the buyer cannot change a match's score (no session writes matches)");
  else fail("the buyer cannot change a match's score", JSON.stringify(direct.rows));
  await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [OWNER_B]);
  await expectRejectTx(db, "another workspace cannot shortlist the buyer's match", `select public.exchange_set_match_state($1, 'dismissed')`, [matchId]);
  await expectRejectTx(
    db,
    "an intake session cannot point at another workspace's need",
    `insert into exchange_intake_sessions (org_id, direction, need_id) values ($1, 'buy', $2)`,
    [B, NEED],
  );
  await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [OWNER_A]);
  await expectRejectTx(db, "a session cannot write a match", `insert into exchange_matches (need_id, offering_id) values ($1, $2)`, [NEED, OFFER_B]);
  await db.query(`insert into exchange_intake_sessions (org_id, direction) values ($1, 'buy')`, [A]);
  ok("the buyer can start an intake session");

  await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [OWNER_B]);
  const intake = await db.query(`select id from exchange_intake_sessions`);
  if (intake.rows.length === 0) ok("nobody else can read someone's intake session");
  else fail("nobody else can read someone's intake session", JSON.stringify(intake.rows));

  await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [VIEWER_A]);
  await expectRejectTx(db, "a viewer cannot post a need", `insert into exchange_needs (org_id, summary) values ($1, 'x')`, [A]);

  await db.exec("reset role");
  for (const n of ["0060", "0061"]) {
    const probe = await db.query<{ v: boolean }>(`select public.migration_${n}_applied() as v`);
    if (probe.rows[0]?.v === true) ok(`migration_${n}_applied() exists for db:doctor`);
    else fail(`migration_${n}_applied() exists`, JSON.stringify(probe.rows));
  }
  await db.exec("rollback");
}

console.log("\n0062 — Exchange: anonymous cards, reveal log, evidence, recall, retention");
{
  const A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"; // buyer workspace
  const B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"; // provider workspace
  const OWNER_A = "11111111-1111-1111-1111-111111111111";
  const OWNER_B = "33333333-3333-3333-3333-333333333333";
  const NEED = "62626262-0062-0062-0062-0000000000a1";
  const PROV_B = "62626262-0062-0062-0062-0000000000b1";
  const OFFER_B = "62626262-0062-0062-0062-0000000000c1";
  const OFFER_B2 = "62626262-0062-0062-0062-0000000000c2";

  const band = await db.query<{ q: string; b: string; r: string; s: string; n: string | null }>(`
    select public.exchange_magnitude_band(200) as q, public.exchange_budget_band(6000000, 'EUR') as b,
           public.exchange_region('DE') as r, public.exchange_magnitude_band(5) as s,
           public.exchange_budget_band(10, null) as n`);
  const bb = band.rows[0]!;
  if (bb.q === "100–1K" && bb.b === "EUR 1M–10M" && bb.r === "Europe" && bb.s === "1–10" && bb.n === null) {
    ok("a card shows bands, not amounts: 200 → 100–1K, EUR 6,000,000 → EUR 1M–10M, DE → Europe");
  } else fail("bands", JSON.stringify(bb));

  await db.exec("begin");
  const leaf = (await db.query<{ id: string }>(`select id from exchange_categories where slug = 'gpus-accelerators'`)).rows[0]!.id;
  await db.query(
    `insert into exchange_needs (id, org_id, category_id, summary, quantity, currency, budget_max, country, visibility, requirement)
     values ($1, $2, $3, 'Acme GmbH needs 200 H200 cards, call Jan on +49 170 000', 200, 'EUR', 6000000, 'DE', 2,
             '{"must_haves": {"value": "authorised partner", "kind": "fact", "source": "answer"}}')`,
    [NEED, A, leaf],
  );
  await db.query(
    `insert into exchange_provider_profiles (id, org_id, name, country, claimed_at) values ($1, $2, 'Northwind Compute', 'DE', now())`,
    [PROV_B, B],
  );
  await db.query(
    `insert into exchange_offerings (id, provider_id, category_id, title, description, status, updated_at)
     values ($1, $3, $4, 'Refurbished A100 servers', 'Older cards', 'active', now()),
            ($2, $3, $4, 'H200 NVL cards, authorised partner', 'New H200 stock', 'active', now() - interval '1 day')`,
    [OFFER_B, OFFER_B2, PROV_B, leaf],
  );
  await db.query(`insert into exchange_matches (need_id, offering_id, score) values ($1, $2, 80)`, [NEED, OFFER_B2]);

  const recall = await db.query<{ id: string }>(`select * from public.exchange_recall_offerings($1, 10) as id`, [NEED]);
  if (recall.rows[0]?.id === OFFER_B2) ok("recall ranks the offering that shares the need's words first, over a newer one");
  else fail("recall ranks by shared words", JSON.stringify(recall.rows));

  await expectRejectTx(db, "an intent band outside hot/warm/cool is refused", `update exchange_needs set intent_band = 'urgent' where id = $1`, [NEED]);
  await expectRejectTx(
    db,
    "a fact with no source is refused as evidence",
    `insert into exchange_offering_evidence (offering_id, claim, kind) values ($1, 'Authorised partner', 'fact')`,
    [OFFER_B2],
  );

  await db.exec("set local role authenticated");

  // Supplier side.
  await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [OWNER_B]);
  await db.query(
    `insert into exchange_offering_evidence (offering_id, org_id, claim, kind, source_url)
     values ($1, $2, 'Listed as an NVIDIA partner', 'fact', 'https://example.test/partners')`,
    [OFFER_B2, A],
  );
  const ev = await db.query<{ org_id: string }>(`select org_id from exchange_offering_evidence where offering_id = $1`, [OFFER_B2]);
  if (ev.rows[0]?.org_id === B) ok("evidence belongs to the offering's workspace, whatever was sent");
  else fail("evidence follows the offering", JSON.stringify(ev.rows));

  const cards = await db.query<{
    need_id: string;
    summary: string | null;
    must_haves: string | null;
    place: string;
    quantity_band: string;
    budget_band: string;
  }>(`select * from public.exchange_matched_cards($1)`, [B]);
  const c = cards.rows[0];
  if (cards.rows.length === 1 && c?.quantity_band === "100–1K" && c.budget_band === "EUR 1M–10M") {
    ok("a matched supplier sees a level-2 request as a card of bands");
  } else fail("a level-2 card", JSON.stringify(cards.rows));
  if (c && c.summary === null && c.must_haves === null) ok("and none of the buyer's own words below level 3 (names and numbers hide in text)");
  else fail("no free text at level 2", JSON.stringify(c));
  if (c?.place === "Worldwide") ok("with fewer than k requests in DE or Europe, the place widens to Worldwide");
  else fail("place widens below k", JSON.stringify(c));
  const ownLog = await db.query(`select id from exchange_reveal_log`);
  if (ownLog.rows.length === 0) ok("the supplier cannot read the buyer's reveal log");
  else fail("the supplier cannot read the reveal log", JSON.stringify(ownLog.rows));
  await expectRejectTx(db, "a session cannot write the reveal log", `insert into exchange_reveal_log (need_id, org_id, level) values ($1, $2, 2)`, [NEED, A]);
  await expectRejectTx(db, "a workspace cannot read another's cards", `select * from public.exchange_matched_cards($1)`, [A]);

  // Buyer side.
  await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [OWNER_A]);
  const log = await db.query<{ viewer_name: string; level: number }>(`select viewer_name, level from exchange_reveal_log where need_id = $1`, [NEED]);
  if (log.rows[0]?.viewer_name === "Northwind Compute" && log.rows[0].level === 2) ok("the buyer reads who saw the request, and at which level");
  else fail("the buyer reads the reveal log", JSON.stringify(log.rows));
  const seen = await db.query(`select id from exchange_offering_evidence where offering_id = $1`, [OFFER_B2]);
  if (seen.rows.length === 1) ok("a buyer can read the evidence behind an active offering");
  else fail("a buyer reads offering evidence", JSON.stringify(seen.rows));
  await expectRejectTx(
    db,
    "a buyer cannot add evidence to another workspace's offering",
    `insert into exchange_offering_evidence (offering_id, claim, kind) values ($1, 'Fake', 'inference')`,
    [OFFER_B2],
  );
  await db.query(`update exchange_needs set visibility = 3 where id = $1`, [NEED]);

  await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [OWNER_B]);
  const open = await db.query<{ summary: string | null; must_haves: string | null }>(`select * from public.exchange_matched_cards($1)`, [B]);
  if (open.rows[0]?.summary && open.rows[0].must_haves === "authorised partner") ok("at level 3 the buyer's own words are shown");
  else fail("level 3 shows free text", JSON.stringify(open.rows));
  const again = await db.query<{ n: number }>(`select count(*)::int as n from public.exchange_matched_cards($1)`, [B]);
  if (again.rows[0]?.n === 1) ok("a repeat view is counted, not duplicated");
  else fail("repeat view", JSON.stringify(again.rows));

  await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [OWNER_A]);
  await db.query(`update exchange_needs set visibility = 1 where id = $1`, [NEED]);
  const views = await db.query<{ views: number }>(`select views from exchange_reveal_log where need_id = $1`, [NEED]);
  if (Number(views.rows[0]?.views) === 3) ok("every view is counted in the log (3)");
  else fail("views are counted", JSON.stringify(views.rows));
  await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [OWNER_B]);
  const hidden = await db.query(`select * from public.exchange_matched_cards($1)`, [B]);
  if (hidden.rows.length === 0) ok("lowering a request to level 1 hides it on the supplier's next read");
  else fail("lowering hides the card", JSON.stringify(hidden.rows));

  await db.exec("reset role");

  // k: ten open cards in the same category and country show the country.
  await db.query(`update exchange_needs set visibility = 2 where id = $1`, [NEED]);
  await db.query(
    `insert into exchange_needs (org_id, category_id, summary, country, visibility)
     select $1, $2, 'Another GPU request', 'DE', 2 from generate_series(1, 9)`,
    [A, leaf],
  );
  await db.exec("set local role authenticated");
  await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [OWNER_B]);
  const wide = await db.query<{ place: string }>(`select place from public.exchange_matched_cards($1)`, [B]);
  if (wide.rows[0]?.place === "DE") ok("with k = 10 open requests sharing it, the country is shown");
  else fail("country shown at k", JSON.stringify(wide.rows));
  await db.exec("reset role");

  // Retention.
  await db.query(`update exchange_needs set deleted_at = now() - interval '31 days' where id = $1`, [NEED]);
  await db.query(`insert into exchange_intake_sessions (org_id, user_id, direction) values ($1, $2, 'buy')`, [A, OWNER_A]);
  await db.query(`alter table exchange_intake_sessions disable trigger exchange_intake_sessions_touch`);
  await db.query(
    `insert into exchange_intake_sessions (org_id, user_id, direction, updated_at) values ($1, $2, 'buy', now() - interval '45 days')`,
    [A, OWNER_A],
  );
  await db.query(`alter table exchange_intake_sessions enable trigger exchange_intake_sessions_touch`);
  await db.query(`select set_config('request.jwt.claim.sub', '', true)`);
  const pruned = await db.query<{ r: { needs: number; intake_sessions: number } }>(`select public.exchange_prune() as r`);
  const gone = await db.query(`select id from exchange_needs where id = $1`, [NEED]);
  if (gone.rows.length === 0 && pruned.rows[0]!.r.needs >= 1) ok("a request removed more than 30 days ago is deleted, with its matches and log");
  else fail("retention deletes removed requests", JSON.stringify(pruned.rows));
  const left = await db.query<{ n: number }>(`select count(*)::int as n from exchange_intake_sessions`);
  if (pruned.rows[0]!.r.intake_sessions === 1 && left.rows[0]!.n === 1) ok("an abandoned questionnaire is deleted after 30 days; a fresh one is kept");
  else fail("retention prunes abandoned sessions only", JSON.stringify({ pruned: pruned.rows, left: left.rows }));

  const probe = await db.query<{ v: boolean }>(`select public.migration_0062_applied() as v`);
  if (probe.rows[0]?.v === true) ok("migration_0062_applied() exists for db:doctor");
  else fail("migration_0062_applied() exists", JSON.stringify(probe.rows));
  await db.exec("rollback");
}

console.log("\n0063 — Exchange introductions: only the buyer accepts; identity only after acceptance");
{
  const A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"; // buyer workspace
  const B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"; // supplier workspace
  const OWNER_A = "11111111-1111-1111-1111-111111111111";
  const VIEWER_A = "22222222-2222-2222-2222-222222222222";
  const OWNER_B = "33333333-3333-3333-3333-333333333333";
  const NEED = "63636363-0063-0063-0063-0000000000a1";
  const NEED_PRIVATE = "63636363-0063-0063-0063-0000000000a2";
  const PROV = "63636363-0063-0063-0063-0000000000b1";
  const OFFER = "63636363-0063-0063-0063-0000000000c1";
  const MATCH = "63636363-0063-0063-0063-0000000000d1";
  const MATCH_PRIVATE = "63636363-0063-0063-0063-0000000000d2";

  await db.exec("begin");
  const leaf = (await db.query<{ id: string }>(`select id from exchange_categories where slug = 'gpus-accelerators'`)).rows[0]!.id;
  await db.query(
    `insert into exchange_needs (id, org_id, category_id, summary, quantity, currency, budget_max, country, visibility)
     values ($1, $3, $4, 'Acme needs 200 H200 cards', 200, 'EUR', 6000000, 'DE', 2),
            ($2, $3, $4, 'A private request', 50, null, null, 'DE', 1)`,
    [NEED, NEED_PRIVATE, A, leaf],
  );
  await db.query(`insert into exchange_provider_profiles (id, org_id, name, claimed_at) values ($1, $2, 'Northwind Compute', now())`, [PROV, B]);
  await db.query(`insert into exchange_offerings (id, provider_id, category_id, title, status) values ($1, $2, $3, 'H200 NVL cards', 'active')`, [OFFER, PROV, leaf]);
  await db.query(
    `insert into exchange_matches (id, need_id, offering_id, score) values ($1, $3, $5, 80), ($2, $4, $5, 70)`,
    [MATCH, MATCH_PRIVATE, NEED, NEED_PRIVATE, OFFER],
  );

  await db.exec("set local role authenticated");
  const as = (u: string) => db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [u]);

  // The supplier asks.
  await as(OWNER_B);
  const intro = (await db.query<{ id: string }>(`select public.exchange_request_intro($1, 'We hold H200 stock in Frankfurt.') as id`, [MATCH])).rows[0]!.id;
  const first = await db.query<{ state: string; direction: string }>(`select state, direction from public.exchange_intro_list($2) where id = $1`, [intro, B]);
  if (first.rows[0]?.state === "requested" && first.rows[0].direction === "provider") ok("a supplier's request waits for the buyer");
  else fail("a supplier's request waits", JSON.stringify(first.rows));
  const again = (await db.query<{ id: string }>(`select public.exchange_request_intro($1) as id`, [MATCH])).rows[0]!.id;
  if (again === intro) ok("asking twice returns the same request, not a second one");
  else fail("asking twice is idempotent", again);
  const before = (await db.query<{ d: { buyerName: string | null; need: { requirement: unknown; summary: string | null; quantityBand: string } } }>(
    `select public.exchange_intro_detail($1) as d`,
    [intro],
  )).rows[0]!.d;
  if (before.buyerName === null && before.need.requirement === null && before.need.summary === null && before.need.quantityBand === "100–1K") {
    ok("before acceptance the supplier sees bands, not the buyer's name or words");
  } else fail("nothing revealed before acceptance", JSON.stringify(before));
  await expectRejectTx(db, "the supplier cannot accept its own request", `select public.exchange_decide_intro($1, true)`, [intro]);
  const direct = await db.query(`update exchange_intros set state = 'accepted' where id = $1 returning id`, [intro]);
  if (direct.rows.length === 0) ok("no session can change an introduction's state by hand");
  else fail("no direct state change", JSON.stringify(direct.rows));
  await expectRejectTx(db, "messages wait until the buyer accepts", `select public.exchange_send_message($1, 'hello?')`, [intro]);
  await expectRejectTx(
    db,
    "a supplier cannot ask about a request the buyer keeps below level 2",
    `select public.exchange_request_intro($1)`,
    [MATCH_PRIVATE],
  );

  // The buyer decides.
  await as(VIEWER_A);
  await expectRejectTx(db, "a read-only member cannot accept", `select public.exchange_decide_intro($1, true)`, [intro]);
  await as(OWNER_A);
  const list = await db.query<{ side: string; unread: boolean; buyer_name: string }>(`select side, unread, buyer_name from public.exchange_intro_list($1)`, [A]);
  if (list.rows[0]?.side === "buyer" && list.rows[0].unread === true) ok("the buyer sees the request, marked unread");
  else fail("buyer list", JSON.stringify(list.rows));
  const decided = await db.query<{ s: string }>(`select public.exchange_decide_intro($1, true) as s`, [intro]);
  if (decided.rows[0]?.s === "accepted") ok("the buyer accepts");
  else fail("the buyer accepts", JSON.stringify(decided.rows));
  const reveal = await db.query<{ what: string }>(`select what from exchange_reveal_log where need_id = $1 and what = 'intro'`, [NEED]);
  if (reveal.rows.length === 1) ok("acceptance is written to the buyer's reveal log");
  else fail("acceptance is logged", JSON.stringify(reveal.rows));
  await db.query(`select public.exchange_share_contact($1)`, [intro]);

  // The supplier, after acceptance.
  await as(OWNER_B);
  const after = (await db.query<{ d: { buyerName: string; contact: { email: string } | null; need: { summary: string; quantity: number } } }>(
    `select public.exchange_intro_detail($1) as d`,
    [intro],
  )).rows[0]!.d;
  if (after.buyerName === "Org A" && after.need.summary && Number(after.need.quantity) === 200) ok("after acceptance the supplier sees who the buyer is and the request in full");
  else fail("revealed after acceptance", JSON.stringify(after));
  if (after.contact?.email === "owner@a.test") ok("and the contact details the buyer chose to share");
  else fail("shared contact", JSON.stringify(after.contact));
  await db.query(`select public.exchange_send_message($1, 'Can deliver in two weeks.')`, [intro]);
  const msgs = await db.query<{ sender_side: string }>(`select sender_side from exchange_messages where intro_id = $1`, [intro]);
  if (msgs.rows[0]?.sender_side === "provider") ok("both parties can message once accepted");
  else fail("messaging", JSON.stringify(msgs.rows));
  await expectRejectTx(db, "a supplier cannot share the buyer's contact details", `select public.exchange_share_contact($1)`, [intro]);
  await expectRejectTx(db, "a session cannot insert a message directly", `insert into exchange_messages (intro_id, sender_side, body) values ($1, 'buyer', 'fake')`, [intro]);

  // A third party sees nothing.
  await db.exec("reset role");
  await db.query(`insert into auth.users (id, email) values ('63636363-0063-0063-0063-0000000000e1', 'outsider@c.test')`);
  await db.exec("set local role authenticated");
  await as("63636363-0063-0063-0063-0000000000e1");
  const outsider = await db.query(`select id from exchange_intros`);
  const outsiderMsgs = await db.query(`select id from exchange_messages`);
  const outsiderDetail = await db.query<{ d: unknown }>(`select public.exchange_intro_detail($1) as d`, [intro]);
  if (outsider.rows.length === 0 && outsiderMsgs.rows.length === 0 && outsiderDetail.rows[0]?.d === null) ok("nobody outside the two workspaces can read an introduction or its messages");
  else fail("third party sees nothing", JSON.stringify({ outsider: outsider.rows, outsiderMsgs: outsiderMsgs.rows }));

  // Outcome.
  await as(OWNER_B);
  await db.query(`select public.exchange_report_outcome($1, 'won', 'Signed for 200 units')`, [intro]);
  const closed = await db.query<{ state: string }>(`select state from public.exchange_intro_list($2) where id = $1`, [intro, B]);
  if (closed.rows[0]?.state === "closed") ok("reporting an outcome closes the introduction");
  else fail("outcome closes", JSON.stringify(closed.rows));
  await expectRejectTx(db, "and messages close with it", `select public.exchange_send_message($1, 'one more')`, [intro]);
  await as(OWNER_A);
  await db.query(`select public.exchange_report_outcome($1, 'no_decision')`, [intro]);
  const both = await db.query<{ side: string; outcome: string }>(`select side, outcome from exchange_outcomes where intro_id = $1 order by side`, [intro]);
  if (both.rows.length === 2 && both.rows[0]!.outcome === "no_decision" && both.rows[1]!.outcome === "won") ok("both sides report, and a disagreement is kept");
  else fail("both outcomes kept", JSON.stringify(both.rows));

  // The buyer's own choice skips the request step.
  const own = (await db.query<{ id: string }>(`select public.exchange_request_intro($1, 'Interested') as id`, [MATCH_PRIVATE])).rows[0]!.id;
  const ownState = await db.query<{ state: string; direction: string }>(`select state, direction from exchange_intros where id = $1`, [own]);
  if (ownState.rows[0]?.state === "accepted" && ownState.rows[0].direction === "buyer") ok("a buyer who asks is introduced at once, whatever the request's level");
  else fail("buyer-initiated intro", JSON.stringify(ownState.rows));
  await db.exec("reset role");

  // Supplier weekly cap.
  await db.query(
    `insert into exchange_intros (need_id, offering_id, buyer_org_id, provider_org_id, direction, state)
     select $1, $2, $3, $4, 'provider', 'withdrawn' from generate_series(1, 20)`,
    [NEED, OFFER, A, B],
  );
  await db.query(`update exchange_needs set status = 'open' where id = $1`, [NEED]);
  await db.exec("set local role authenticated");
  await as(OWNER_B);
  await expectRejectTx(db, "a supplier is capped at 20 introduction requests a week", `select public.exchange_request_intro($1)`, [MATCH]);
  await db.exec("reset role");

  // Expiry.
  await db.query(`select set_config('request.jwt.claim.sub', '', true)`);
  await db.query(`delete from exchange_intros where need_id = $1 and state = 'withdrawn'`, [NEED]);
  await db.query(
    `insert into exchange_intros (need_id, offering_id, buyer_org_id, provider_org_id, direction, state, created_at)
     values ($1, $2, $3, $4, 'provider', 'requested', now() - interval '15 days')`,
    [NEED, OFFER, A, B],
  );
  await db.query(`update exchange_needs set decide_by = current_date - 20, last_confirmed_at = now() - interval '40 days' where id = $1`, [NEED_PRIVATE]);
  const expired = await db.query<{ r: { requests_stale: number; needs_expired: number } }>(`select public.exchange_expire() as r`);
  if (expired.rows[0]!.r.requests_stale === 1 && expired.rows[0]!.r.needs_expired === 1) ok("an unanswered request goes stale after 14 days; a lapsed request expires");
  else fail("expiry", JSON.stringify(expired.rows));

  const probe = await db.query<{ v: boolean }>(`select public.migration_0063_applied() as v`);
  if (probe.rows[0]?.v === true) ok("migration_0063_applied() exists for db:doctor");
  else fail("migration_0063_applied() exists", JSON.stringify(probe.rows));
  await db.exec("rollback");
}

console.log("\n0064 — Exchange notifications: alerts say no more than the card, and only to who asked for them");
{
  const A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"; // buyer workspace
  const B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"; // supplier workspace
  const OWNER_A = "11111111-1111-1111-1111-111111111111";
  const OWNER_B = "33333333-3333-3333-3333-333333333333";
  const NEED = "64646464-0064-0064-0064-0000000000a1";
  const NEED_HIDDEN = "64646464-0064-0064-0064-0000000000a2";
  const NEED_OLD = "64646464-0064-0064-0064-0000000000a3";
  const PROV = "64646464-0064-0064-0064-0000000000b1";
  const OFFER = "64646464-0064-0064-0064-0000000000c1";
  const INTRO = "64646464-0064-0064-0064-0000000000e1";

  await db.exec("begin");
  const leaf = (await db.query<{ id: string }>(`select id from exchange_categories where slug = 'gpus-accelerators'`)).rows[0]!.id;
  await db.query(
    `insert into exchange_needs (id, org_id, created_by, category_id, summary, quantity, currency, budget_max, country, visibility, intent_band)
     values ($1, $3, $4, $5, 'Acme GmbH needs 200 H200 cards, call Jan', 200, 'EUR', 6000000, 'DE', 2, 'hot'),
            ($2, $3, $4, $5, 'A private request', 50, null, null, 'DE', 1, 'hot')`,
    [NEED, NEED_HIDDEN, A, OWNER_A, leaf],
  );
  await db.query(`insert into exchange_provider_profiles (id, org_id, name, claimed_at) values ($1, $2, 'Northwind Compute', now())`, [PROV, B]);
  await db.query(`insert into exchange_offerings (id, provider_id, category_id, title, status) values ($1, $2, $3, 'H200 NVL cards', 'active')`, [OFFER, PROV, leaf]);
  await db.query(`insert into exchange_matches (need_id, offering_id, score) values ($1, $3, 80), ($2, $3, 75)`, [NEED, NEED_HIDDEN, OFFER]);

  const queue = async () => (await db.query<{ r: Record<string, number> }>(`select public.exchange_queue_notifications() as r`)).rows[0]!.r;
  const alertsFor = async (user: string) =>
    (await db.query<{ title: string; body: string; channel: string; need_id: string }>(
      `select title, body, channel, need_id from exchange_notifications where user_id = $1 and kind = 'match_alert'`,
      [user],
    )).rows;

  const first = await queue();
  const alerts = await alertsFor(OWNER_B);
  if (first.alerts === 1 && alerts.length === 1 && alerts[0]!.need_id === NEED) ok("a supplier is alerted to a matched request it may see, and not to a level-1 one");
  else fail("one alert, level 2 only", JSON.stringify({ first, alerts }));
  const words = JSON.stringify(alerts);
  if (alerts[0]?.title.includes("100–1K") && !words.includes("Acme") && !words.includes("Jan") && !words.includes("DE") && !words.includes("6,000,000")) {
    ok("the alert says what a card says — bands, no buyer words, no place");
  } else fail("alert wording", words);
  if (alerts[0]?.channel === "digest") ok("by default it waits for the digest, never instant");
  else fail("digest by default", JSON.stringify(alerts));
  const again = await queue();
  if (again.alerts === 0) ok("queueing again adds nothing (deduplicated)");
  else fail("dedupe", JSON.stringify(again));

  await db.query(`delete from exchange_notifications`);
  await db.query(`insert into notification_preferences (org_id, user_id, exchange_alerts) values ($1, $2, 'instant')`, [B, OWNER_B]);
  await queue();
  if ((await alertsFor(OWNER_B))[0]?.channel === "instant") ok("someone who chose instant gets a hot request at once");
  else fail("instant for hot", JSON.stringify(await alertsFor(OWNER_B)));
  await db.query(`select set_config('request.jwt.claim.sub', '', true)`);
  await db.query(`update exchange_needs set intent_band = 'warm' where id = $1`, [NEED]);
  await db.query(`delete from exchange_notifications`);
  await queue();
  if ((await alertsFor(OWNER_B))[0]?.channel === "digest") ok("but a request that is not hot still waits for the digest (EX-9)");
  else fail("warm waits", JSON.stringify(await alertsFor(OWNER_B)));
  await db.query(`update notification_preferences set exchange_alert_category_ids = array[gen_random_uuid()] where user_id = $1`, [OWNER_B]);
  await db.query(`delete from exchange_notifications`);
  await queue();
  if ((await alertsFor(OWNER_B)).length === 0) ok("a category the supplier did not pick sends nothing");
  else fail("category filter", JSON.stringify(await alertsFor(OWNER_B)));
  await db.query(`update notification_preferences set exchange_alerts = 'off', exchange_alert_category_ids = '{}' where user_id = $1`, [OWNER_B]);
  await queue();
  if ((await alertsFor(OWNER_B)).length === 0) ok("alerts off means none at all");
  else fail("alerts off", JSON.stringify(await alertsFor(OWNER_B)));

  // Introductions and messages.
  await db.query(
    `insert into exchange_intros (id, need_id, offering_id, buyer_org_id, provider_org_id, direction, state)
     values ($1, $2, $3, $4, $5, 'provider', 'requested')`,
    [INTRO, NEED, OFFER, A, B],
  );
  await queue();
  const asked = await db.query<{ title: string; body: string; channel: string }>(`select title, body, channel from exchange_notifications where user_id = $1 and kind = 'intro_requested'`, [OWNER_A]);
  if (asked.rows[0]?.title.startsWith("Northwind Compute would like to talk") && asked.rows[0].channel === "instant") ok("the buyer hears at once who asked to talk");
  else fail("buyer told of request", JSON.stringify(asked.rows));
  const supplierSees = await db.query(`select id from exchange_notifications where user_id = $1 and title like '%Org A%'`, [OWNER_B]);
  if (supplierSees.rows.length === 0) ok("and the supplier is told nothing that names the buyer yet");
  else fail("no early name", JSON.stringify(supplierSees.rows));

  await db.query(`update exchange_intros set state = 'accepted', decided_at = now() where id = $1`, [INTRO]);
  await db.query(`insert into exchange_messages (intro_id, sender_side, body) values ($1, 'provider', 'Can deliver in two weeks.')`, [INTRO]);
  const counts = await queue();
  const accepted = await db.query<{ title: string }>(`select title from exchange_notifications where user_id = $1 and kind = 'intro_accepted'`, [OWNER_B]);
  if (accepted.rows[0]?.title.startsWith("Org A accepted")) ok("on acceptance the supplier is told, and may now see the buyer's name");
  else fail("accepted notice", JSON.stringify(accepted.rows));
  const msg = await db.query<{ title: string }>(`select title from exchange_notifications where user_id = $1 and kind = 'new_message'`, [OWNER_A]);
  if (counts.messages === 1 && msg.rows[0]?.title === "New message from Northwind Compute") ok("a new message reaches the other side");
  else fail("message notice", JSON.stringify({ counts, rows: msg.rows }));
  await db.query(`insert into exchange_messages (intro_id, sender_side, body) values ($1, 'provider', 'And a second one.')`, [INTRO]);
  if ((await queue()).messages === 0) ok("and a burst of messages is one notice an hour, not one each");
  else fail("message throttle", "more than one");

  // Re-confirm, and the owner fallback when the filer has gone.
  await db.query(
    `insert into exchange_needs (id, org_id, created_by, summary, visibility, decide_by, created_at, last_confirmed_at)
     values ($1, $2, null, 'An older request', 1, current_date + 10, now() - interval '20 days', now() - interval '20 days')`,
    [NEED_OLD, A],
  );
  await queue();
  const remind = await db.query<{ user_id: string }>(`select user_id from exchange_notifications where need_id = $1 and kind = 'reconfirm'`, [NEED_OLD]);
  if (remind.rows.length === 1 && remind.rows[0]!.user_id === OWNER_A) ok("halfway to its decide-by date, a request asks to be re-confirmed — to an owner if its filer is gone");
  else fail("reconfirm", JSON.stringify(remind.rows));

  // Who reads what.
  await db.exec("set local role authenticated");
  await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [OWNER_B]);
  const others = await db.query(`select id from exchange_notifications where user_id <> $1`, [OWNER_B]);
  if (others.rows.length === 0) ok("each person reads only their own notifications");
  else fail("own notifications only", JSON.stringify(others.rows));
  await expectRejectTx(
    db,
    "a session cannot write a notification",
    `insert into exchange_notifications (org_id, user_id, kind, title, href, channel, dedupe_key) values ($1, $2, 'reconfirm', 'x', '/x', 'none', 'fake')`,
    [B, OWNER_B],
  );
  await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [OWNER_A]);
  const marked = await db.query<{ n: number }>(`select public.exchange_mark_notifications_read($1) as n`, [A]);
  if (Number(marked.rows[0]?.n) >= 2) ok("a person marks their own feed read");
  else fail("mark read", JSON.stringify(marked.rows));
  await expectRejectTx(db, "a session cannot queue notifications", `select public.exchange_queue_notifications()`);
  await db.exec("reset role");

  const probe = await db.query<{ v: boolean }>(`select public.migration_0064_applied() as v`);
  if (probe.rows[0]?.v === true) ok("migration_0064_applied() exists for db:doctor");
  else fail("migration_0064_applied() exists", JSON.stringify(probe.rows));
  await db.exec("rollback");
}

console.log("\n0065 — Exchange trust and safety: reports, suspensions, spam limits, market demand");
{
  const A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"; // buyer workspace
  const B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"; // supplier workspace
  const OWNER_A = "11111111-1111-1111-1111-111111111111";
  const OWNER_B = "33333333-3333-3333-3333-333333333333";
  const NEED = "65656565-0065-0065-0065-0000000000a1";
  const NEED_PRIVATE = "65656565-0065-0065-0065-0000000000a2";
  const PROV = "65656565-0065-0065-0065-0000000000b1";
  const OFFER = "65656565-0065-0065-0065-0000000000c1";
  const INTRO = "65656565-0065-0065-0065-0000000000e1";

  await db.exec("begin");
  const leaf = (await db.query<{ id: string }>(`select id from exchange_categories where slug = 'gpus-accelerators'`)).rows[0]!.id;
  await db.query(
    `insert into exchange_needs (id, org_id, created_by, category_id, summary, quantity, country, visibility, intent_band)
     values ($1, $3, $4, $5, 'Acme needs 200 cards', 200, 'DE', 2, 'hot'), ($2, $3, $4, $5, 'A private one', 5, 'DE', 1, null)`,
    [NEED, NEED_PRIVATE, A, OWNER_A, leaf],
  );
  await db.query(`insert into exchange_provider_profiles (id, org_id, name, claimed_at) values ($1, $2, 'Northwind Compute', now())`, [PROV, B]);
  await db.query(`insert into exchange_offerings (id, provider_id, category_id, title, status) values ($1, $2, $3, 'H200 NVL cards', 'active')`, [OFFER, PROV, leaf]);
  await db.query(`insert into exchange_matches (need_id, offering_id, score) values ($1, $3, 80), ($2, $3, 70)`, [NEED, NEED_PRIVATE, OFFER]);
  await db.query(
    `insert into exchange_intros (id, need_id, offering_id, buyer_org_id, provider_org_id, direction, state, decided_at)
     values ($1, $2, $3, $4, $5, 'provider', 'accepted', now())`,
    [INTRO, NEED, OFFER, A, B],
  );
  await db.query(`insert into exchange_messages (intro_id, sender_org_id, sender_side, body) values ($1, $2, 'provider', 'Buy from our other site')`, [INTRO, B]);
  const MSG = (await db.query<{ id: string }>(`select id from exchange_messages where intro_id = $1`, [INTRO])).rows[0]!.id;

  await db.exec("set local role authenticated");
  const expectEqual = (name: string, got: unknown, want: unknown) =>
    JSON.stringify(got) === JSON.stringify(want) ? ok(name) : fail(name, `got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`);
  const engine = async () => {
    await db.exec("reset role");
    await db.query(`select set_config('request.jwt.claim.sub', '', true)`);
  };
  const as = (u: string) => db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [u]);

  // ── Reports ──
  await as(OWNER_B);
  const rep = (await db.query<{ id: string }>(`select public.exchange_report('need', $1, 'fake_buyer', 'Looks made up') as id`, [NEED])).rows[0]!.id;
  await engine();
  const row = await db.query<{ subject_org_id: string; reporter_org_id: string; state: string }>(`select subject_org_id, reporter_org_id, state from exchange_reports where id = $1`, [rep]);
  if (row.rows[0]?.subject_org_id === A && row.rows[0].reporter_org_id === B && row.rows[0].state === "open") ok("a supplier reports a request it was shown as a card, and the report names the buyer's workspace");
  else fail("report a need from a card", JSON.stringify(row.rows));
  await db.exec("set local role authenticated");
  await as(OWNER_B);
  const again = (await db.query<{ id: string }>(`select public.exchange_report('need', $1, 'spam') as id`, [NEED])).rows[0]!.id;
  if (again === rep) ok("reporting the same thing twice is one open report");
  else fail("one open report per subject", again);
  await expectRejectTx(db, "a request the buyer keeps below level 2 cannot be reported — it was never shown", `select public.exchange_report('need', $1, 'spam')`, [NEED_PRIVATE]);
  await expectRejectTx(db, "a supplier cannot report its own offering", `select public.exchange_report('offering', $1, 'spam')`, [OFFER]);
  await expectRejectTx(db, "an unknown reason is refused", `select public.exchange_report('message', $1, 'dislike')`, [MSG]);
  await expectRejectTx(db, "a session cannot write a report directly", `insert into exchange_reports (reporter_org_id, subject_type, subject_id, reason) values ($1, 'need', $2, 'spam')`, [B, NEED]);
  const mine = await db.query(`select * from public.exchange_my_reports($1)`, [B]);
  const raw = await db.query(`select * from exchange_reports`);
  if (raw.rows.length === 0) ok("no session reads the reports table, which names the workspace behind an anonymous request");
  else fail("reports table unreadable", JSON.stringify(raw.rows));
  if (mine.rows.length === 1 && !JSON.stringify(mine.rows).includes(A)) ok("the reporter reads their own reports, without who they are about");
  else fail("reporter reads own", JSON.stringify(mine.rows));

  await as(OWNER_A);
  const theirs = await db.query(`select id from public.exchange_my_reports($1)`, [A]);
  if (theirs.rows.length === 0) ok("the reported party cannot read reports about them");
  else fail("reported party reads nothing", JSON.stringify(theirs.rows));
  const msgReport = (await db.query<{ id: string }>(`select public.exchange_report('message', $1, 'spam', 'Pushes me off-platform') as id`, [MSG])).rows[0]!.id;
  await engine();
  const msgRow = await db.query<{ subject_org_id: string }>(`select subject_org_id from exchange_reports where id = $1`, [msgReport]);
  await db.exec("set local role authenticated");
  await as(OWNER_A);
  if (msgRow.rows[0]?.subject_org_id === B) ok("a buyer reports a supplier's message, and the report is about the sender");
  else fail("report a message", JSON.stringify(msgRow.rows));
  const offerReport = (await db.query<{ id: string }>(`select public.exchange_report('offering', $1, 'misrepresentation') as id`, [OFFER])).rows[0]!.id;
  if (offerReport) ok("a buyer reports an offering it was matched with");
  else fail("report offering", "none");
  await expectRejectTx(db, "a session cannot read the operator's queue", `select * from public.exchange_report_queue()`);
  await expectRejectTx(db, "or decide a report", `select public.exchange_resolve_report($1, 'dismiss')`, [rep]);

  // ── Operator ──
  await engine();
  const queue = await db.query<{ report_id: string; subject_org: string; open_reports_on_org: string }>(`select report_id, subject_org, open_reports_on_org from public.exchange_report_queue()`);
  if (queue.rows.length === 3 && Number(queue.rows[0]!.open_reports_on_org) >= 1) ok("the operator's queue lists open reports, the most-reported workspace first");
  else fail("queue", JSON.stringify(queue.rows));
  await expectRejectTx(db, "an unknown action is refused", `select public.exchange_resolve_report($1, 'ban')`, [msgReport]);
  const removed = await db.query<{ s: string }>(`select public.exchange_resolve_report($1, 'remove', 'Off-platform solicitation') as s`, [msgReport]);
  const gone = await db.query(`select id from exchange_messages where id = $1`, [MSG]);
  if (removed.rows[0]?.s === "actioned" && gone.rows.length === 0) ok("removing a reported message deletes it and closes the report");
  else fail("remove message", JSON.stringify({ removed: removed.rows, gone: gone.rows }));
  await expectRejectTx(db, "a decided report cannot be decided again", `select public.exchange_resolve_report($1, 'dismiss')`, [msgReport]);
  await db.query(`select public.exchange_resolve_report($1, 'dismiss', 'Looks genuine')`, [offerReport]);
  const audit = await db.query<{ action: string }>(`select action from audit_logs where target_id = $1`, [msgReport]);
  if (audit.rows.some((a) => a.action === "exchange.moderated") && audit.rows.some((a) => a.action === "exchange.report_actioned")) ok("every decision is in the audit log of both workspaces");
  else fail("audit", JSON.stringify(audit.rows));

  // ── Suspension ──
  const suspended = await db.query<{ s: string }>(`select public.exchange_resolve_report($1, 'suspend', 'Repeated fake requests') as s`, [rep]);
  if (suspended.rows[0]?.s === "actioned" && (await db.query<{ v: boolean }>(`select public.exchange_suspended($1) as v`, [A])).rows[0]!.v) ok("suspending puts the reported workspace out of the Exchange");
  else fail("suspend", JSON.stringify(suspended.rows));
  await db.exec("set local role authenticated");
  await as(OWNER_B);
  const cards = await db.query(`select * from public.exchange_matched_cards($1)`, [B]);
  if (cards.rows.length === 0) ok("a suspended buyer's requests are no longer shown to suppliers");
  else fail("suspended buyer hidden", JSON.stringify(cards.rows));
  await engine();
  const recall = await db.query<{ id: string }>(`select * from public.exchange_recall_offerings($1, 10) as id`, [NEED]);
  if (recall.rows.length === 1) ok("a buyer's suspension does not remove suppliers from its own matching");
  else fail("recall unaffected", JSON.stringify(recall.rows));
  await db.query(`insert into exchange_suspensions (org_id, reason) values ($1, 'test')`, [B]);
  const recallB = await db.query(`select * from public.exchange_recall_offerings($1, 10)`, [NEED]);
  if (recallB.rows.length === 0) ok("a suspended supplier's offerings are not candidates");
  else fail("suspended supplier excluded", JSON.stringify(recallB.rows));
  await expectRejectTx(
    db,
    "no new introduction from or to a suspended workspace",
    `insert into exchange_intros (need_id, offering_id, buyer_org_id, provider_org_id, direction) values ($1, $2, $3, $4, 'provider')`,
    [NEED_PRIVATE, OFFER, A, B],
  );
  await expectRejectTx(db, "nor a message in an existing introduction", `insert into exchange_messages (intro_id, sender_side, body) values ($1, 'provider', 'hello')`, [INTRO]);
  const notice = await db.query(
    `insert into exchange_notifications (org_id, user_id, kind, title, href, channel, dedupe_key) values ($1, $2, 'reconfirm', 'x', '/x', 'none', 'k65') returning id`,
    [B, OWNER_B],
  );
  if (notice.rows.length === 0) ok("no notification is queued for a suspended workspace");
  else fail("notice skipped", JSON.stringify(notice.rows));
  await db.exec("set local role authenticated");
  await as(OWNER_A);
  const noFile = await db.query<{ s: string | null }>(`select public.exchange_my_suspension($1) as s`, [A]);
  if (noFile.rows[0]?.s === "Repeated fake requests") ok("a suspended workspace can read why it is suspended");
  else fail("my suspension", JSON.stringify(noFile.rows));
  await engine();
  await db.query(`update exchange_suspensions set lifted_at = now() where org_id = $1`, [B]);
  if ((await db.query<{ b: boolean }>(`select public.exchange_lift_suspension($1) as b`, [A])).rows[0]!.b) ok("lifting a suspension restores the workspace; nothing it had was deleted");
  else fail("lift", "false");
  await db.exec("set local role authenticated");
  await as(OWNER_B);
  if ((await db.query(`select * from public.exchange_matched_cards($1)`, [B])).rows.length === 1) ok("and its request is shown to suppliers again");
  else fail("restored", "no card");
  await engine();

  // ── Spam limits ──
  await engine();
  await db.query(`update auth.users set email_confirmed_at = null where id = $1`, [OWNER_A]);
  await db.exec("set local role authenticated");
  await as(OWNER_A);
  await expectRejectTx(db, "a request needs a confirmed email address", `insert into exchange_needs (org_id, summary) values ($1, 'From an unconfirmed address')`, [A]);
  await engine();
  await db.query(`update auth.users set email_confirmed_at = now() where id = $1`, [OWNER_A]);
  await db.query(`delete from exchange_needs where created_at > now() - interval '1 minute' and id not in ($1, $2)`, [NEED, NEED_PRIVATE]);
  await db.exec("set local role authenticated");
  await as(OWNER_A);
  for (let i = 0; i < 8; i++) await db.query(`insert into exchange_needs (org_id, summary) values ($1, $2)`, [A, `Request ${i}`]);
  await expectRejectTx(db, "a workspace may file at most 10 requests a day", `insert into exchange_needs (org_id, summary) values ($1, 'The eleventh')`, [A]);
  await engine();
  await db.query(`insert into exchange_needs (org_id, summary) values ($1, 'The engine is not limited')`, [A]);
  ok("the engine itself is not rate-limited");

  // ── Market demand ──
  await db.query(`delete from exchange_needs where id not in ($1, $2)`, [NEED, NEED_PRIVATE]);
  await db.query(`update exchange_needs set visibility = 0 where id in ($1, $2)`, [NEED, NEED_PRIVATE]);
  const seed = (n: number, country: string) =>
    db.query(
      `insert into exchange_needs (org_id, created_by, category_id, summary, country, visibility, intent_band)
       select $1, $2, $3, 'Demand', $4, 1, 'warm' from generate_series(1, $5)`,
      [A, OWNER_A, leaf, country, n],
    );
  const demand = async (user: string, org: string) => {
    await db.exec("set local role authenticated");
    await as(user);
    const r = await db.query<{ region: string; open_requests: string }>(`select region, open_requests from public.exchange_market_demand($1) order by region`, [org]);
    await engine();
    return r.rows.map((x) => `${x.region}:${x.open_requests}`);
  };
  await seed(9, "DE");
  expectEqual("nine requests in a region are not enough to show", await demand(OWNER_B, B), []);
  await seed(1, "FR");
  expectEqual("ten share Europe, so Europe is shown, as a count of ten", await demand(OWNER_B, B), ["Europe:10"]);
  await db.query(`delete from exchange_needs where category_id = $1 and summary = 'Demand'`, [leaf]);
  await seed(6, "DE");
  await seed(5, "US");
  expectEqual("two thin regions that together reach ten fold into Worldwide", await demand(OWNER_B, B), ["Worldwide:11"]);
  await db.query(`delete from exchange_needs where category_id = $1 and summary = 'Demand'`, [leaf]);
  await seed(10, "DE");
  await db.query(`update auth.users set email_confirmed_at = null where id = $1`, [OWNER_A]);
  expectEqual("requests from an unconfirmed address are not counted", await demand(OWNER_B, B), []);
  await db.query(`update auth.users set email_confirmed_at = now() where id = $1`, [OWNER_A]);
  expectEqual("a confirmed buyer's are", await demand(OWNER_B, B), ["Europe:10"]);
  await db.query(`insert into exchange_suspensions (org_id, reason) values ($1, 'test')`, [A]);
  expectEqual("a suspended buyer's are not", await demand(OWNER_B, B), []);
  await db.query(`update exchange_suspensions set lifted_at = now() where org_id = $1`, [A]);
  expectEqual("a workspace never sees its own requests in the totals", await demand(OWNER_A, A), []);
  await db.query(`update exchange_provider_profiles set deleted_at = now() where id = $1`, [PROV]);
  expectEqual("and a workspace with no supplier profile sees no market data at all", await demand(OWNER_B, B), []);
  await db.exec("set local role authenticated");
  await as(OWNER_A);
  await expectRejectTx(db, "a workspace cannot ask for another's demand view", `select * from public.exchange_market_demand($1)`, [B]);
  await engine();

  const probe = await db.query<{ v: boolean }>(`select public.migration_0065_applied() as v`);
  if (probe.rows[0]?.v === true) ok("migration_0065_applied() exists for db:doctor");
  else fail("migration_0065_applied() exists", JSON.stringify(probe.rows));
  await db.exec("rollback");
}

console.log("\n0066 — Exchange audit fixes: company firewall, introduction privacy, derived intent, paused offerings");
{
  const A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"; // buyer workspace
  const B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"; // supplier workspace
  const OWNER_A = "11111111-1111-1111-1111-111111111111";
  const OWNER_B = "33333333-3333-3333-3333-333333333333";
  const CO = "66666666-0066-0066-0066-0000000000c1";
  const CO_PLAIN = "66666666-0066-0066-0066-0000000000c2";
  const NEED = "66666666-0066-0066-0066-0000000000a1";
  const PROV = "66666666-0066-0066-0066-0000000000b1";
  const OFFER = "66666666-0066-0066-0066-0000000000d1";
  const MATCH = "66666666-0066-0066-0066-0000000000e1";
  const eq = (name: string, got: unknown, want: unknown) =>
    JSON.stringify(got) === JSON.stringify(want) ? ok(name) : fail(name, `got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`);

  await db.exec("begin");
  const engine = async () => {
    await db.exec("reset role");
    await db.query(`select set_config('request.jwt.claim.sub', '', true)`);
  };
  const as = async (u: string) => {
    await db.exec("set local role authenticated");
    await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [u]);
  };
  await engine();

  // ── The company side of the firewall ──
  await db.query(
    `insert into companies (id, org_id, canonical_domain, name) values ($1, $3, 'buyer-66.test', 'Buyer'), ($2, $3, 'plain-66.test', 'Plain')`,
    [CO, CO_PLAIN, B],
  );
  await db.query(`insert into opportunities (org_id, company_id, priority_reason, origin) values ($1, $2, 'Stated need.', 'exchange')`, [B, CO]);
  const origin = await db.query<{ origin: string }>(`select origin from companies where id = $1`, [CO]);
  eq("an Exchange opportunity makes its company Exchange", origin.rows[0]?.origin, "exchange");
  await expectRejectTx(db, "which is permanent", `update companies set origin = 'engine' where id = $1`, [CO]);
  for (const column of ["last_enriched_at", "last_researched_at", "last_signal_checked_at", "research_asked_at"]) {
    await expectRejectTx(db, `an Exchange company's ${column} cannot be written`, `update companies set ${column} = now() where id = $1`, [CO]);
    await expectAccept(db, `an ordinary company's ${column} still is`, `update companies set ${column} = now() where id = $1`, [CO_PLAIN]);
  }
  await expectAccept(db, "a person can still edit an Exchange company", `update companies set name = 'Buyer GmbH' where id = $1`, [CO]);
  const record = `insert into enrichment_records (org_id, entity_type, entity_id, provider, field, value) values ($1, 'company', $2, 'apollo', 'industry', '"x"'::jsonb)`;
  await expectRejectTx(db, "no enrichment record is written for an Exchange company", record, [B, CO]);
  await expectAccept(db, "one is for an ordinary company", record, [B, CO_PLAIN]);
  const queue = async (job: string, company: string) =>
    (await db.query(`insert into job_executions (org_id, job_name, payload, status) values ($1, $2, $3, 'queued') returning id`, [B, job, JSON.stringify({ companyId: company })])).rows.length;
  for (const job of ["enrich_company", "research_company", "fetch_company_signals", "profile_company"]) {
    eq(`${job} cannot be queued for an Exchange company`, await queue(job, CO), 0);
    eq(`${job} still is for an ordinary one`, await queue(job, CO_PLAIN), 1);
  }
  const born = await db.query<{ id: string }>(`insert into companies (org_id, canonical_domain, name, origin) values ($1, 'born-66.test', 'Born', 'exchange') returning id`, [B]);
  const bornJobs = await db.query<{ job_name: string }>(`select job_name from job_executions where payload ->> 'companyId' = $1`, [born.rows[0]!.id]);
  eq("a company created from an introduction is never profiled, even at birth", bornJobs.rows, []);

  // ── Sequences on the company's other opportunities ──
  const enroll = async (tag: string) => {
    const co = (await db.query<{ id: string }>(`insert into companies (org_id, canonical_domain, name) values ($1, $2, $3) returning id`, [B, `${tag}-66.test`, tag])).rows[0]!.id;
    const icp = (await db.query<{ id: string }>(`insert into icps (org_id, name) values ($1, $2) returning id`, [B, `ICP ${tag}`])).rows[0]!.id;
    const opp = (await db.query<{ id: string }>(`insert into opportunities (org_id, company_id, icp_id, priority_reason) values ($1, $2, $3, 'Engine.') returning id`, [B, co, icp])).rows[0]!.id;
    const camp = (await db.query<{ id: string }>(`insert into campaigns (org_id, name, status) values ($1, $2, 'active') returning id`, [B, tag])).rows[0]!.id;
    const enr = (await db.query<{ id: string }>(`insert into enrollments (org_id, campaign_id, opportunity_id, status, next_action_at) values ($1, $2, $3, 'active', now()) returning id`, [B, camp, opp])).rows[0]!.id;
    const msg = (await db.query<{ id: string }>(`insert into messages (org_id, enrollment_id, direction, body_text, to_email, scheduled_at) values ($1, $2, 'outbound', 'Hi', 'a@x.test', now()) returning id`, [B, enr])).rows[0]!.id;
    return { co, opp, camp, enr, msg };
  };
  const state = async (e: { enr: string; msg: string }) => {
    const r = await db.query<{ status: string; due: boolean; queued: boolean; error: string | null }>(
      `select e.status, e.next_action_at is not null as due, m.scheduled_at is not null as queued, m.error from enrollments e, messages m where e.id = $1 and m.id = $2`,
      [e.enr, e.msg],
    );
    const x = r.rows[0]!;
    return [x.status, x.due, x.queued, Boolean(x.error?.includes("Exchange"))];
  };
  const seq = await enroll("seq");
  const other = await enroll("other");
  const reply = (await db.query<{ id: string }>(`insert into messages (org_id, opportunity_id, direction, body_text, to_email, scheduled_at) values ($1, $2, 'outbound', 'A reply', 'a@x.test', now()) returning id`, [B, seq.opp])).rows[0]!.id;
  await db.query(`insert into opportunities (org_id, company_id, priority_reason, origin) values ($1, $2, 'Stated need.', 'exchange')`, [B, seq.co]);
  eq("an introduction stops the sequence on the company's ICP opportunity and withdraws its queued email", await state(seq), ["stopped", false, false, true]);
  eq("a reply a person wrote is left alone", (await db.query(`select 1 from messages where id = $1 and scheduled_at is not null and error is null`, [reply])).rows.length, 1);
  eq("another company's sequence goes on", await state(other), ["active", true, true, false]);
  await expectRejectTx(db, "the stopped sequence cannot be resumed", `update enrollments set status = 'active' where id = $1`, [seq.enr]);
  await expectAccept(db, "its other fields still can change", `update enrollments set current_step = 1 where id = $1`, [seq.enr]);
  const camp2 = (await db.query<{ id: string }>(`insert into campaigns (org_id, name, status) values ($1, 'second', 'active') returning id`, [B])).rows[0]!.id;
  await expectRejectTx(db, "nor a new one started on the ICP opportunity", `insert into enrollments (org_id, campaign_id, opportunity_id, status) values ($1, $2, $3, 'active')`, [B, camp2, seq.opp]);
  await expectAccept(db, "another company still can be enrolled", `insert into enrollments (org_id, campaign_id, opportunity_id, status) values ($1, $2, $3, 'active')`, [B, camp2, other.opp]);
  await db.query(`update enrollments set status = 'parked', parked_reason = 'x' where id = $1`, [other.enr]);
  await db.query(`update opportunities set company_id = $2 where id = $1`, [other.opp, seq.co]);
  eq("merging a company into an introduced one stops its sequences too, waiting ones included", (await state(other))[0], "stopped");

  // ── Derived intent ──
  const leaf = (await db.query<{ id: string }>(`select id from exchange_categories where slug = 'gpus-accelerators'`)).rows[0]!.id;
  const parent = (await db.query<{ id: string }>(`select parent_id as id from exchange_categories where id = $1`, [leaf])).rows[0]!.id;
  await db.query(`update exchange_categories set attributes = '[]' where id = $1`, [leaf]);
  await db.query(
    `update exchange_categories set attributes = '[{"key":"item","label":"Item","required":true},{"key":"qty","label":"Quantity","required":true},{"key":"x","label":"Extra"}]' where id = $1`,
    [parent],
  );
  await db.query(`delete from exchange_needs where org_id = $1 and created_at > now() - interval '1 day'`, [A]);
  await as(OWNER_A);
  const full = `'{"item":{"value":"H200","kind":"fact"},"qty":{"value":"200","kind":"fact"}}'::jsonb`;
  await expectRejectTx(db, "a session cannot file a request already marked hot", `insert into exchange_needs (org_id, summary, intent_band) values ($1, 'Hot, honest', 'hot')`, [A]);
  await db.query(
    `insert into exchange_needs (id, org_id, category_id, summary, requirement, budget_max, currency, timeline, visibility, created_at, last_confirmed_at)
     values ($1, $2, $3, '200 H200 cards', ${full}, 100, 'EUR', 'this_month', 2, now() - interval '9 days', now() + interval '1 year')`,
    [NEED, A, leaf],
  );
  const filed = await db.query<{ intent_band: string; intent_dimensions: unknown; dated: boolean }>(
    `select intent_band, intent_dimensions, created_at > now() - interval '1 minute' and last_confirmed_at <= now() as dated from exchange_needs where id = $1`,
    [NEED],
  );
  eq("everything answered, a budget and a near timeline is hot", filed.rows[0]?.intent_band, "hot");
  eq("with its dimensions, the required fields read from the parent category", filed.rows[0]?.intent_dimensions, { budget: 100, timeline: 100, specificity: 100 });
  eq("a request cannot be backdated past the daily limit or pre-confirmed", filed.rows[0]?.dated, true);
  await expectRejectTx(db, "nor its band rewritten", `update exchange_needs set intent_band = 'warm' where id = $1`, [NEED]);
  await expectRejectTx(db, "nor its dimensions", `update exchange_needs set intent_dimensions = '{"budget":1}' where id = $1`, [NEED]);
  await expectRejectTx(db, "nor its confirmation date", `update exchange_needs set last_confirmed_at = now() + interval '1 day' where id = $1`, [NEED]);
  await db.query(`update exchange_needs set timeline = 'exploring', budget_max = null, requirement = '{}' where id = $1`, [NEED]);
  const cooled = await db.query<{ intent_band: string; intent_dimensions: unknown }>(`select intent_band, intent_dimensions from exchange_needs where id = $1`, [NEED]);
  eq("changing the answers re-scores the request", [cooled.rows[0]?.intent_band, cooled.rows[0]?.intent_dimensions], ["cool", { budget: null, timeline: 10, specificity: 0 }]);
  await db.query(`update exchange_needs set category_id = null where id = $1`, [NEED]);
  const thin = await db.query<{ intent_band: string | null }>(`select intent_band from exchange_needs where id = $1`, [NEED]);
  eq("with fewer than two measured the band is unknown, not cool", thin.rows[0]?.intent_band, null);
  await db.query(`update exchange_needs set category_id = $2 where id = $1`, [NEED, leaf]);
  const confirmed = await db.query<{ v: boolean }>(`select public.exchange_confirm_need($1) as v`, [NEED]);
  eq("Still needed dates the confirmation through its function", confirmed.rows[0]?.v, true);
  await expectRejectTx(db, "which does not leave the door open behind it", `update exchange_needs set last_confirmed_at = now() + interval '1 day' where id = $1`, [NEED]);
  await as(OWNER_B);
  await expectRejectTx(db, "another workspace cannot confirm it", `select public.exchange_confirm_need($1)`, [NEED]);

  // ── Paused offerings ──
  await engine();
  await db.query(`insert into exchange_provider_profiles (id, org_id, name, claimed_at) values ($1, $2, 'Northwind Compute', now())`, [PROV, B]);
  await db.query(`insert into exchange_offerings (id, provider_id, category_id, title, status) values ($1, $2, $3, 'H200 NVL cards', 'active')`, [OFFER, PROV, leaf]);
  await db.query(`insert into exchange_matches (id, need_id, offering_id, score) values ($1, $2, $3, 80)`, [MATCH, NEED, OFFER]);
  await as(OWNER_B);
  eq("an active offering's card is shown", (await db.query(`select * from public.exchange_matched_cards($1)`, [B])).rows.length, 1);
  await engine();
  await db.query(`update exchange_offerings set status = 'paused' where id = $1`, [OFFER]);
  await as(OWNER_B);
  eq("a paused offering's is not", (await db.query(`select * from public.exchange_matched_cards($1)`, [B])).rows.length, 0);
  await expectRejectTx(db, "nor can the supplier ask with it", `select public.exchange_request_intro($1)`, [MATCH]);
  await as(OWNER_A);
  await expectRejectTx(db, "or the buyer ask about it", `select public.exchange_request_intro($1)`, [MATCH]);
  await engine();
  await db.query(`update exchange_offerings set status = 'active' where id = $1`, [OFFER]);

  // ── Introductions: the supplier never reads the table ──
  await as(OWNER_B);
  const intro = (await db.query<{ id: string }>(`select public.exchange_request_intro($1) as id`, [MATCH])).rows[0]!.id;
  const seen = async () => {
    await as(OWNER_B);
    const raw = await db.query(`select * from exchange_intros`);
    const list = await db.query(`select * from public.exchange_intro_list($1)`, [B]);
    const detail = await db.query(`select public.exchange_intro_detail($1) as d`, [intro]);
    return { raw: raw.rows.length, list: list.rows.length, text: JSON.stringify([list.rows, detail.rows]) };
  };
  const hidden = (t: string) => ![A, NEED, OWNER_A, "Org A", "200 H200 cards"].some((x) => t.includes(x));
  const pending = await seen();
  eq("the supplier reads no row of the introductions table", pending.raw, 0);
  if (pending.list === 1 && hidden(pending.text)) ok("and its own read functions hold neither buyer, request nor decider before acceptance");
  else fail("nothing identifying before acceptance", pending.text);
  await engine();
  await db.query(`update exchange_intros set created_at = now() - interval '15 days' where id = $1`, [intro]);
  await db.query(`select public.exchange_expire()`);
  const stale = await seen();
  if (hidden(stale.text) && stale.text.includes('"stale"')) ok("a request nobody answered goes stale without revealing the buyer");
  else fail("stale reveals nothing", stale.text);
  await expectRejectTx(db, "nor can an outcome be reported on it", `select public.exchange_report_outcome($1, 'won')`, [intro]);
  await engine();
  await db.query(`update exchange_intros set state = 'closed' where id = $1`, [intro]);
  const closed = await seen();
  if (hidden(closed.text)) ok("nor does one the operator closed before it was answered");
  else fail("closed reveals nothing", closed.text);
  await engine();
  await db.query(`update exchange_intros set state = 'requested', created_at = now() where id = $1`, [intro]);
  await as(OWNER_A);
  eq("the buyer reads its own introduction", (await db.query(`select id from exchange_intros`)).rows.length, 1);
  await db.query(`select public.exchange_decide_intro($1, true)`, [intro]);
  await db.query(`select public.exchange_send_message($1, 'Hello')`, [intro]);
  const open = await seen();
  if (open.text.includes("Org A") && open.text.includes(NEED)) ok("after acceptance the supplier sees who the buyer is");
  else fail("revealed after acceptance", open.text);
  eq("still not from the table", open.raw, 0);
  eq("and reads the messages", (await db.query(`select id from exchange_messages where intro_id = $1`, [intro])).rows.length, 1);
  await engine();
  await db.query(`update exchange_intros set state = 'stale' where id = $1`, [intro]);
  if ((await seen()).text.includes("Org A")) ok("an accepted introduction that goes quiet keeps what was revealed");
  else fail("accepted then stale", "hidden");

  // ── Engine-only functions ──
  for (const call of ["exchange_prune()", "exchange_expire()"]) {
    await db.exec("reset role");
    await expectRejectTx(db, `a session cannot run ${call}`, `select public.${call}`);
  }
  await engine();
  const exposed = await db.query<{ function_name: string }>(`select * from public.engine_only_exposed()`);
  if (Array.isArray(exposed.rows)) ok("engine_only_exposed() reports for db:doctor");
  const probe = await db.query<{ v: boolean }>(`select public.migration_0066_applied() as v`);
  if (probe.rows[0]?.v === true) ok("migration_0066_applied() exists for db:doctor");
  else fail("migration_0066_applied() exists", JSON.stringify(probe.rows));
  await db.exec("rollback");
}

console.log("\n0067 — seats, HubSpot status, Exchange attention and metrics");
{
  const A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
  const OWNER_A = "11111111-1111-1111-1111-111111111111";
  const VIEWER_A = "22222222-2222-2222-2222-222222222222";
  const OWNER_B = "33333333-3333-3333-3333-333333333333";
  const JOINER = "67676767-0067-0067-0067-000000000001";
  const eq = (name: string, got: unknown, want: unknown) =>
    JSON.stringify(got) === JSON.stringify(want) ? ok(name) : fail(name, `got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`);
  await db.exec("begin");
  const engine = async () => {
    await db.exec("reset role");
    await db.query(`select set_config('request.jwt.claim.sub', '', true)`);
  };
  const as = async (u: string) => {
    await db.exec("set local role authenticated");
    await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [u]);
  };
  await engine();

  // ── Seats ──
  await db.query(`insert into auth.users (id, email) values ($1, 'joiner@a.test')`, [JOINER]);
  const members = Number((await db.query<{ n: number }>(`select count(*)::int as n from memberships where org_id = $1 and deleted_at is null`, [A])).rows[0]!.n);
  const setSeats = async (n: number) => {
    await engine();
    await db.query(`update plans set limits = limits || jsonb_build_object('seats', $1::int) where id in (select plan_id from organizations where id = $2)`, [n, A]);
  };
  await setSeats(members);
  await as(OWNER_A);
  const full = await db.query<{ used: string; quota: string; allowed: boolean }>(`select * from public.org_seats($1)`, [A]);
  eq("seats are the people in the workspace, not a monthly counter", [full.rows[0]!.allowed, Number(full.rows[0]!.quota)], [false, members]);
  const join = `insert into memberships (org_id, user_id, role) values ($1, $2, 'member') on conflict (org_id, user_id) do update set deleted_at = null`;
  await expectRejectTx(db, "nobody is admitted past the limit", join, [A, JOINER]);
  await expectAccept(db, "somebody already in is not counted twice", join, [A, VIEWER_A]);
  await as(OWNER_B);
  eq("another workspace's seats are not readable", (await db.query(`select * from public.org_seats($1)`, [A])).rows.length, 0);
  await setSeats(members + 1);
  await as(OWNER_A);
  await expectAccept(db, "with a free seat they are admitted", join, [A, JOINER]);

  // ── HubSpot ──
  await engine();
  await db.query(`insert into hubspot_connections (org_id, access_token, hub_id) values ($1, 'sealed', '42') on conflict (org_id) do update set hub_id = '42'`, [A]);
  await as(VIEWER_A);
  const hub = await db.query<Record<string, unknown>>(`select * from public.hubspot_status($1)`, [A]);
  eq("a member who is not an admin sees that HubSpot is connected", hub.rows[0]?.hub_id, "42");
  eq("and never the token", Object.keys(hub.rows[0] ?? {}).includes("access_token"), false);
  await as(OWNER_B);
  eq("another workspace's connection is not readable", (await db.query(`select * from public.hubspot_status($1)`, [A])).rows.length, 0);

  // ── Attention (DN-82) ──
  await engine();
  const leaf = (await db.query<{ id: string }>(`select id from exchange_categories where slug = 'gpus-accelerators'`)).rows[0]!.id;
  const need = (await db.query<{ id: string }>(`insert into exchange_needs (org_id, created_by, category_id, summary, visibility) values ($1, $2, $3, '200 cards', 2) returning id`, [A, OWNER_A, leaf])).rows[0]!.id;
  const prov = (await db.query<{ id: string }>(`insert into exchange_provider_profiles (org_id, name, claimed_at) values ($1, 'Northwind Compute', now()) returning id`, [B])).rows[0]!.id;
  const offer = (await db.query<{ id: string }>(`insert into exchange_offerings (provider_id, category_id, title, status) values ($1, $2, 'H200 cards', 'active') returning id`, [prov, leaf])).rows[0]!.id;
  const intro = (await db.query<{ id: string }>(`insert into exchange_intros (need_id, offering_id, buyer_org_id, provider_org_id, direction, state) values ($1, $2, $3, $4, 'provider', 'requested') returning id`, [need, offer, A, B])).rows[0]!.id;
  const waits = async (u: string, org: string) => {
    await as(u);
    return (await db.query<{ kind: string; title: string; subject: string }>(`select kind, title, subject from public.exchange_attention($1)`, [org])).rows;
  };
  eq("a supplier's request waits on the buyer", await waits(OWNER_A, A), [{ kind: "exchange-intro", title: "Northwind Compute", subject: "200 cards" }]);
  eq("and on nobody else", await waits(OWNER_B, B), []);
  await as(OWNER_B);
  await expectRejectTx(db, "nor can one workspace ask about another", `select * from public.exchange_attention($1)`, [A]);
  await engine();
  await db.query(`update exchange_intros set state = 'accepted', decided_at = now() where id = $1`, [intro]);
  await db.query(`insert into exchange_messages (intro_id, sender_org_id, sender_side, body, created_at) values ($1, $2, 'buyer', 'Hello', now())`, [intro, A]);
  eq("an unread message waits on the other side", (await waits(OWNER_B, B)).map((r) => [r.kind, r.subject]), [["exchange-message", "H200 cards"]]);
  eq("not on its sender", await waits(OWNER_A, A), []);
  await as(OWNER_B);
  await db.query(`select public.exchange_mark_intro_read($1)`, [intro]);
  eq("and stops waiting once read", await waits(OWNER_B, B), []);

  // ── Metrics ──
  await as(OWNER_A);
  await expectRejectTx(db, "metrics span workspaces, so no session reads them", `select * from public.exchange_metrics(30)`);
  await engine();
  await db.query(`delete from exchange_needs where id <> $1`, [need]);
  await db.query(`delete from exchange_intake_sessions`);
  await db.query(`insert into exchange_matches (need_id, offering_id, score) values ($1, $2, 80)`, [need, offer]);
  await db.query(
    `insert into exchange_intake_sessions (org_id, user_id, direction, status, turns, requirement) values
       ($1, $2, 'buy', 'completed', 4, '{"qty":{"value":"2","source":"answer"},"brand":{"value":null,"source":"skipped"}}'),
       ($1, $2, 'buy', 'abandoned', 1, '{"qty":{"value":null,"source":"skipped"}}')`,
    [A, OWNER_A],
  );
  const m = new Map((await db.query<{ metric: string; value: string | null }>(`select metric, value from public.exchange_metrics(30)`)).rows.map((r) => [r.metric, r.value === null ? null : Number(r.value)]));
  eq("match coverage and acceptance are shares", [m.get("match_coverage"), m.get("intro_acceptance"), m.get("accepted_intros_per_request")], [1, 1, 1]);
  eq("questionnaire completion, turns and skips per question", [m.get("intake_completion"), m.get("intake_turns"), m.get("skipped:qty"), m.get("skipped:brand")], [0.5, 4, 0.5, 1]);
  eq("an outcome nobody reported counts against the rate", m.get("outcome_rate"), 0);
  eq("with no model runs the failure rate is unknown, not zero", m.get("ai_failure_rate"), null);

  const probe = await db.query<{ v: boolean }>(`select public.migration_0067_applied() as v`);
  if (probe.rows[0]?.v === true) ok("migration_0067_applied() exists for db:doctor");
  else fail("migration_0067_applied() exists", JSON.stringify(probe.rows));
  await db.exec("rollback");
}

console.log("\n0068 — workspace purpose, alerts with no band, what to match next, demand totals");
{
  const A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
  const OWNER_A = "11111111-1111-1111-1111-111111111111";
  const OWNER_B = "33333333-3333-3333-3333-333333333333";
  const eq = (name: string, got: unknown, want: unknown) =>
    JSON.stringify(got) === JSON.stringify(want) ? ok(name) : fail(name, `got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`);
  await db.exec("begin");
  const engine = async () => {
    await db.exec("reset role");
    await db.query(`select set_config('request.jwt.claim.sub', '', true)`);
  };
  const as = async (u: string) => {
    await db.exec("set local role authenticated");
    await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [u]);
  };
  const purpose = async (org: string) => (await db.query<{ purpose: string }>(`select purpose from organizations where id = $1`, [org])).rows[0]!.purpose;
  await engine();
  await db.exec(`update organizations set purpose = 'seller'; delete from exchange_needs`);
  const leaf = (await db.query<{ id: string }>(`select id from exchange_categories where slug = 'gpus-accelerators'`)).rows[0]!.id;
  const file = async () => (await db.query<{ id: string }>(`insert into exchange_needs (org_id, created_by, category_id, summary, visibility) values ($1, $2, $3, 'Cards', 2) returning id`, [A, OWNER_A, leaf])).rows[0]!.id;
  const need = await file();
  eq("a seller that files a request is both", await purpose(A), "both");
  await db.query(`update organizations set purpose = 'buyer' where id in ($1, $2)`, [A, B]);
  const second = await file();
  eq("a buyer that files another stays a buyer", await purpose(A), "buyer");
  const prov = (await db.query<{ id: string }>(`insert into exchange_provider_profiles (org_id, name, claimed_at) values ($1, 'Northwind', now()) returning id`, [B])).rows[0]!.id;
  eq("a buyer that lists supply is both", await purpose(B), "both");
  await expectRejectTx(db, "and nothing else is a purpose", `update organizations set purpose = 'broker' where id = $1`, [A]);

  // ── A request with no intent band ──
  const offer = (await db.query<{ id: string }>(`insert into exchange_offerings (provider_id, category_id, title, status) values ($1, $2, 'H200', 'active') returning id`, [prov, leaf])).rows[0]!.id;
  await db.query(`update exchange_categories set matching_enabled = true where id = $1`, [leaf]);
  await db.query(`update exchange_needs set intent_band = null where id = $1`, [need]);
  await db.query(`insert into exchange_matches (need_id, offering_id, score) values ($1, $2, 70)`, [need, offer]);
  await expectAccept(db, "a matched request with no intent band does not stop every alert", `select public.exchange_queue_notifications()`, []);
  eq("its supplier is alerted, as not hot", (await db.query(`select hot from exchange_notifications where need_id = $1 and org_id = $2 and kind = 'match_alert' limit 1`, [need, B])).rows, [{ hot: false }]);

  // ── What to match next ──
  const due = async () => (await db.query<{ need_id: string; key: string }>(`select need_id, key from public.exchange_needs_due(10)`)).rows;
  await db.query(`update exchange_matches set computed_at = now() + interval '1 second' where need_id = $1`, [need]);
  const first = await due();
  eq("a request never matched is due; one matched since the last supply change is not", first.map((r) => r.need_id), [second]);
  await db.query(`insert into job_executions (org_id, job_name, idempotency_key) values ($1, 'match_needs', $2)`, [A, first[0]!.key]);
  eq("one already queued does not hold a place", await due(), []);
  await db.query(`update exchange_matches set computed_at = now() - interval '30 hours' where need_id = $1`, [need]);
  eq("a stale match is due again", (await due()).map((r) => r.need_id), [need]);
  await as(OWNER_A);
  await expectRejectTx(db, "no session reads the queue", `select * from public.exchange_needs_due(10)`);

  // ── Demand totals ──
  await engine();
  await db.query(`delete from demand_signals where org_id in ($1, $2)`, [A, B]);
  const theme = (await db.query<{ id: string }>(`insert into demand_themes (org_id, title, kind, status, origin) values ($1, 'SSO', 'request', 'open', 'user') returning id`, [A])).rows[0]!.id;
  await db.query(
    `insert into demand_signals (org_id, kind, statement, source_type, source_id, theme_id)
       select $1, 'request', 'Asked ' || i, 'note', gen_random_uuid(), case when i <= 1200 then $2::uuid end from generate_series(1, 1205) i`,
    [A, theme],
  );
  await as(OWNER_A);
  const w = new Map((await db.query<{ theme_id: string | null; signals: string }>(`select theme_id, signals from public.demand_weights($1)`, [A])).rows.map((r) => [r.theme_id, Number(r.signals)]));
  eq("totals count past the API's row cap", [w.get(theme), w.get(null)], [1200, 5]);
  await as(OWNER_B);
  eq("another workspace's are not readable", (await db.query(`select * from public.demand_weights($1)`, [A])).rows.length, 0);

  await engine();
  const probe = await db.query<{ v: boolean }>(`select public.migration_0068_applied() as v`);
  if (probe.rows[0]?.v === true) ok("migration_0068_applied() exists for db:doctor");
  else fail("migration_0068_applied() exists", JSON.stringify(probe.rows));
  await db.exec("rollback");
}

console.log("\n0069 — Exchange quotas");
{
  const A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const OWNER_A = "11111111-1111-1111-1111-111111111111";
  const OWNER_B = "33333333-3333-3333-3333-333333333333";
  const eq = (name: string, got: unknown, want: unknown) =>
    JSON.stringify(got) === JSON.stringify(want) ? ok(name) : fail(name, `got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`);
  await db.exec("begin");
  const engine = async () => {
    await db.exec("reset role");
    await db.query(`select set_config('request.jwt.claim.sub', '', true)`);
  };
  const as = async (u: string) => {
    await db.exec("set local role authenticated");
    await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [u]);
  };
  await engine();
  await db.exec(`delete from exchange_needs`);
  const file = `insert into exchange_needs (org_id, summary, visibility) values ($1, 'Cards', 2)`;
  await as(OWNER_A);
  eq("a plan with no limit shows none", (await db.query(`select * from public.exchange_quotas($1)`, [A])).rows, []);
  await expectAccept(db, "and refuses nothing", file, [A]);
  await engine();
  await db.query(`update plans set limits = limits || '{"needs_open": 2}' where id in (select plan_id from organizations where id = $1)`, [A]);
  await db.query(`insert into usage_counters (org_id, metric, period, used, "limit") values ($1, 'needs_open', date_trunc('month', now())::date, 0, 2) on conflict do nothing`, [A]);
  await as(OWNER_A);
  await db.query(file, [A]);
  eq("used and allowed are shown", (await db.query<{ metric: string; used: string; quota: string }>(`select metric, used, quota from public.exchange_quotas($1)`, [A])).rows.map((r) => [r.metric, Number(r.used), Number(r.quota)]), [["needs_open", 2, 2]]);
  await expectRejectTx(db, "past the limit is refused", file, [A]);
  await db.query(`update exchange_needs set status = 'paused' where id = (select id from exchange_needs where org_id = $1 limit 1)`, [A]);
  await expectAccept(db, "pausing one makes room", file, [A]);
  await expectRejectTx(db, "and reopening counts", `update exchange_needs set status = 'open' where org_id = $1 and status = 'paused'`, [A]);
  await expectAccept(db, "an open request can still be edited at the limit", `update exchange_needs set summary = 'Edited' where org_id = $1 and status = 'open'`, [A]);
  await as(OWNER_B);
  eq("another workspace's are not readable", (await db.query(`select * from public.exchange_quotas($1)`, [A])).rows, []);
  await engine();
  const probe = await db.query<{ v: boolean }>(`select public.migration_0069_applied() as v`);
  if (probe.rows[0]?.v === true) ok("migration_0069_applied() exists for db:doctor");
  else fail("migration_0069_applied() exists", JSON.stringify(probe.rows));
  await db.exec("rollback");
}

console.log("\n0070 — pass 21 integrity");
{
  const A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const OWNER_A = "11111111-1111-1111-1111-111111111111";
  const SECOND = "22222222-2222-2222-2222-222222222222";
  const OWNER_B = "33333333-3333-3333-3333-333333333333";
  const B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
  const engine = async () => {
    await db.exec("reset role");
    await db.query(`select set_config('request.jwt.claim.sub', '', true)`);
  };
  const as = async (u: string) => {
    await db.exec("set local role authenticated");
    await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [u]);
  };
  const scalar = async <T>(sql: string, params: unknown[] = []) =>
    ((await db.query<{ v: T }>(sql, params)).rows[0]?.v ?? null) as T | null;

  // DB-004: the last live owner stays.
  await db.exec("begin");
  await as(OWNER_A);
  await expectRejectTx(db, "the sole owner cannot leave their workspace", `update memberships set deleted_at = now() where org_id = $1 and user_id = $2`, [A, OWNER_A]);
  await expectRejectTx(db, "nor demote themselves", `update memberships set role = 'admin' where org_id = $1 and user_id = $2`, [A, OWNER_A]);
  await engine();
  await db.query(`update memberships set role = 'admin' where org_id = $1 and user_id = $2`, [A, SECOND]);
  await as(SECOND);
  await expectRejectTx(db, "an admin cannot make themselves an owner", `update memberships set role = 'owner' where org_id = $1 and user_id = $2`, [A, SECOND]);
  await as(OWNER_A);
  await expectAccept(db, "an owner can make another owner", `update memberships set role = 'owner' where org_id = $1 and user_id = $2`, [A, SECOND]);
  await expectAccept(db, "and then step down", `update memberships set role = 'admin' where org_id = $1 and user_id = $2`, [A, OWNER_A]);
  await db.exec("rollback");

  // DB-008 / OUT-204: the mailbox cap.
  await db.exec("begin");
  await engine();
  const mailbox = await scalar<string>(`insert into mailboxes (org_id, provider, email) values ($1, 'gmail', 'send@a.test') returning id as v`, [A]);
  await expectRejectTx(db, "a daily limit above 500 is refused", `update mailboxes set daily_limit = 100000 where id = $1`, [mailbox]);
  await db.query(`update memberships set role = 'member' where org_id = $1 and user_id = $2`, [A, SECOND]);
  await as(SECOND);
  await expectRejectTx(db, "a member cannot change a mailbox's daily limit", `update mailboxes set daily_limit = 200 where id = $1`, [mailbox]);
  await expectAccept(db, "a member can still rename it", `update mailboxes set display_name = 'Sales' where id = $1`, [mailbox]);
  await db.query(`delete from mailboxes where id = $1`, [mailbox]);
  await engine();
  if ((await scalar<number>(`select count(*)::int as v from mailboxes where id = $1`, [mailbox])) === 1) ok("a member cannot hard-delete a mailbox");
  else fail("a member cannot hard-delete a mailbox", "deleted");
  await db.exec("rollback");

  // DB-005: erasure reaches every identifier.
  await db.exec("begin");
  await engine();
  const person = await scalar<string>(`insert into people (org_id, company_id, first_name, title) values ($1, 'c0000000-0000-0000-0000-00000000000a', 'Pat', 'CFO') returning id as v`, [A]);
  await db.query(`insert into contact_points (org_id, person_id, kind, value) values ($1, $2, 'email', 'pat@x.test'), ($1, $2, 'phone', '+15550100'), ($1, $2, 'linkedin', 'https://linkedin.com/in/pat')`, [A, person]);
  const thread = await scalar<string>(`insert into threads (org_id, subject, participants) values ($1, 'Hello Pat', array['pat@x.test', 'me@a.test']) returning id as v`, [A]);
  await db.query(`select public.erase_contact($1, 'Pat@x.test')`, [A]);
  if ((await scalar<number>(`select count(*)::int as v from contact_points where person_id = $1`, [person])) === 0) ok("erasure removes the phone and LinkedIn too");
  else fail("erasure removes every contact point", "some remain");
  const t = (await db.query<{ subject: string; participants: string[] }>(`select subject, participants from threads where id = $1`, [thread])).rows[0];
  if (t?.subject === "[erased]" && !t.participants.includes("pat@x.test") && t.participants.includes("me@a.test")) ok("and the address leaves the thread, nobody else does");
  else fail("thread redacted", JSON.stringify(t));
  if ((await scalar<string | null>(`select title as v from people where id = $1`, [person])) === null) ok("and the title is cleared");
  else fail("title cleared", "kept");
  await db.exec("rollback");

  // TRUST-001 / TRUST-002: a profile's domain.
  await db.exec("begin");
  await as(OWNER_B);
  await expectRejectTx(db, "a workspace cannot claim a domain nobody there has an address at", `insert into exchange_provider_profiles (org_id, name, domain, claimed_at) values ($1, 'B supply', 'a.test', now())`, [B]);
  await as(OWNER_A);
  await expectAccept(db, "its own domain can be claimed", `insert into exchange_provider_profiles (org_id, name, domain, claimed_at) values ($1, 'A supply', 'a.test', now())`, [A]);
  await engine();
  await db.query(`update exchange_provider_profiles set verified_at = now() where org_id = $1`, [A]);
  await as(OWNER_A);
  await db.query(`update exchange_provider_profiles set name = 'Someone else' where org_id = $1`, [A]);
  if ((await scalar<string | null>(`select verified_at as v from exchange_provider_profiles where org_id = $1`, [A])) === null) ok("renaming a verified profile clears Verified");
  else fail("renaming a verified profile clears Verified", "kept");
  await db.exec("rollback");

  // DB-001 / DB-002: a deleted workspace.
  await db.exec("begin");
  await engine();
  const cat = await scalar<string>(`select id as v from exchange_categories limit 1`);
  const profile = await scalar<string>(`insert into exchange_provider_profiles (org_id, name, claimed_at) values ($1, 'A supply', now()) returning id as v`, [A]);
  if (cat) await db.query(`insert into exchange_offerings (provider_id, category_id, title, status) values ($1, $2, 'Cards', 'active')`, [profile, cat]);
  await db.query(`insert into exchange_needs (org_id, summary, visibility) values ($1, 'Cards', 2)`, [A]);
  await as(OWNER_A);
  await db.query(`select public.delete_organization($1)`, [A]);
  if ((await scalar<boolean>(`select public.has_org_role($1, 'owner') as v`, [A])) === false) ok("a deleted workspace confers no role");
  else fail("a deleted workspace confers no role", "still owner");
  await expectRejectTx(db, "so its members can no longer file requests", `insert into exchange_needs (org_id, summary, visibility) values ($1, 'More', 2)`, [A]);
  await engine();
  if ((await scalar<number>(`select count(*)::int as v from exchange_offerings where org_id = $1 and status = 'active'`, [A])) === 0) ok("its offerings are paused");
  else fail("its offerings are paused", "still active");
  if ((await scalar<number>(`select count(*)::int as v from exchange_needs where org_id = $1 and status = 'open'`, [A])) === 0) ok("its open requests are withdrawn");
  else fail("its open requests are withdrawn", "still open");
  if ((await scalar<number>(`select count(*)::int as v from exchange_provider_profiles where org_id = $1 and deleted_at is null`, [A])) === 0) ok("its supplier profile leaves the catalogue");
  else fail("its supplier profile leaves the catalogue", "still listed");
  await expectAccept(db, "and a workspace that claimed a profile can be removed for good", `delete from organizations where id = $1`, [A]);
  await db.exec("rollback");

  // DB-011 / DB-010.
  await db.exec("begin");
  await engine();
  const NEWCOMER = "70707070-0070-0070-0070-000000000001";
  await db.query(`insert into auth.users (id, email, email_confirmed_at) values ($1, 'newcomer-0070@a.test', null)`, [NEWCOMER]);
  await db.query(`update organizations set primary_domain = 'a.test', is_discoverable = true where id = $1`, [A]);
  await as(NEWCOMER);
  if ((await scalar<number>(`select count(*)::int as v from public.discoverable_workspaces()`)) === 0) ok("an unconfirmed address discovers no workspace");
  else fail("an unconfirmed address discovers no workspace", "listed");
  await engine();
  await db.query(`update auth.users set email_confirmed_at = now() where id = $1`, [NEWCOMER]);
  await as(NEWCOMER);
  if ((await scalar<number>(`select count(*)::int as v from public.discoverable_workspaces()`)) === 1) ok("once confirmed, it does");
  else fail("once confirmed, it does", "not listed");
  await as(OWNER_A);
  const exported = await scalar<Record<string, unknown>>(`select public.export_organization($1) as v`, [A]);
  if (exported && ["campaigns", "sequences", "sequenceSteps", "exchangeRequests", "exchangeOfferings"].every((k) => Array.isArray(exported[k]))) ok("the export carries campaigns, sequences and Exchange listings");
  else fail("the export carries campaigns, sequences and Exchange listings", JSON.stringify(Object.keys(exported ?? {})));
  const probe = await scalar<boolean>(`select public.migration_0070_applied() as v`);
  if (probe === true) ok("migration_0070_applied() exists for db:doctor");
  else fail("migration_0070_applied() exists", String(probe));
  await db.exec("rollback");
}

console.log("\n0050 — one send per address in flight (OUT-013)");
{
  await db.exec("begin");
  const M1 = "d0000000-0000-0000-0000-0000000050a1";
  const M2 = "d0000000-0000-0000-0000-0000000050a2";
  const claim = async (email: string, message: string) =>
    (await db.query<{ ok: boolean }>(`select public.claim_contact_lane($1, $2, $3) as ok`, [ORG_A, email, message]))
      .rows[0]?.ok;

  if ((await claim("Pat@Example.test", M1)) === true) ok("the first message takes the lane");
  else fail("the first message takes the lane", "refused");
  if ((await claim(" pat@example.test", M2)) === false) ok("a second message to the same address waits");
  else fail("a second message to the same address waits", "allowed");
  if ((await claim("pat@example.test", M1)) === true) ok("the holder may claim again (a retry)");
  else fail("the holder may claim again (a retry)", "refused");
  if ((await claim("sam@example.test", M2)) === true) ok("another address is its own lane");
  else fail("another address is its own lane", "refused");

  await db.query(`select public.release_contact_lane($1, $2)`, [ORG_A, M1]);
  if ((await claim("pat@example.test", M2)) === true) ok("a released lane is free at once");
  else fail("a released lane is free at once", "refused");

  await db.query(`update contact_send_lanes set claimed_at = now() - interval '11 minutes'`);
  if ((await claim("pat@example.test", M1)) === true) ok("a lane older than ten minutes is stale");
  else fail("a lane older than ten minutes is stale", "refused");

  await db.exec("rollback");
}

console.log("\n0050 — every new company is resolved and profiled (FLOW-106)");
{
  await db.exec("begin");
  const C = "c0000000-0000-0000-0000-0000000050c1";
  const queued = async () =>
    (
      await db.query<{ job_name: string }>(
        `select job_name from job_executions
          where payload->>'companyId' = $1 or payload->>'entityId' = $1
          order by job_name`,
        [C],
      )
    ).rows.map((r) => r.job_name);

  await db.query(
    `insert into companies (id, org_id, canonical_domain, name) values ($1, $2, 'added-50.test', 'Added Co')`,
    [C, ORG_A],
  );
  const added = await queued();
  if (added.join() === "profile_company,resolve_entity") ok("a company added by any path queues both");
  else fail("a company added by any path queues both", JSON.stringify(added));

  await db.query(`update companies set name = 'Renamed' where id = $1`, [C]);
  if ((await queued()).length === 2) ok("an ordinary update queues nothing more");
  else fail("an ordinary update queues nothing more", JSON.stringify(await queued()));

  await db.query(`update job_executions set status = 'succeeded' where payload->>'companyId' = $1 or payload->>'entityId' = $1`, [C]);
  await db.query(`update companies set deleted_at = now() where id = $1`, [C]);
  await db.query(`update companies set deleted_at = null where id = $1`, [C]);
  if ((await queued()).length === 4) ok("a restored company is looked at again");
  else fail("a restored company is looked at again", JSON.stringify(await queued()));

  await db.exec("rollback");
}

console.log("\n0011 — the breaker counts the right failures");
{
  await db.exec("begin");

  for (let i = 0; i < 4; i++) {
    await db.query(
      `select public.record_provider_call($1, 'company.search', 'apollo', 'h', 'failed', 0, 500, null, 1, 'boom')`,
      [ORG_A],
    );
  }
  const four = await db.query<{ open_until: string | null }>(
    `select open_until from provider_breakers where org_id = $1 and provider = 'apollo'`,
    [ORG_A],
  );
  if (four.rows[0]?.open_until === null) ok("four failures do not open the circuit");
  else fail("four failures do not open the circuit", JSON.stringify(four.rows[0]));

  await db.query(
    `select public.record_provider_call($1, 'company.search', 'apollo', 'h', 'failed', 0, 500, null, 1, 'boom')`,
    [ORG_A],
  );
  const five = await db.query<{ open_until: string | null }>(
    `select open_until from provider_breakers where org_id = $1 and provider = 'apollo'`,
    [ORG_A],
  );
  if (five.rows[0]?.open_until !== null) ok("the fifth does");
  else fail("the fifth does", "circuit stayed closed");

  // A success closes it immediately. A breaker that needed a timer to
  // recover would keep a healthy vendor offline after one bad minute.
  await db.query(
    `select public.record_provider_call($1, 'company.search', 'apollo', 'h', 'ok', 1)`,
    [ORG_A],
  );
  const healed = await db.query<{ open_until: string | null; consecutive_failures: number }>(
    `select open_until, consecutive_failures from provider_breakers where org_id = $1 and provider = 'apollo'`,
    [ORG_A],
  );
  if (healed.rows[0]?.open_until === null && Number(healed.rows[0]?.consecutive_failures) === 0) {
    ok("and one success closes it again");
  } else {
    fail("and one success closes it again", JSON.stringify(healed.rows[0]));
  }

  // 429 is the provider working correctly. Opening a circuit on it would take
  // the system offline for obeying a rate limit.
  await db.query(
    `select public.record_provider_call($1, 'company.search', 'apollo', 'h', 'rate_limited', 0, 429)`,
    [ORG_A],
  );
  const limited = await db.query<{ consecutive_failures: number }>(
    `select consecutive_failures from provider_breakers where org_id = $1 and provider = 'apollo'`,
    [ORG_A],
  );
  if (Number(limited.rows[0]?.consecutive_failures) === 0) {
    ok("a 429 is not a transport failure and does not count toward it");
  } else {
    fail("a 429 is not a transport failure and does not count toward it", JSON.stringify(limited.rows[0]));
  }

  await db.exec("rollback");
}

console.log("\n0012 — one company, however it was found");
{
  await db.exec("begin");

  // The fixtures are inserted *after* the migrations run, so the backfill in
  // `0012` saw an empty table — which is exactly the situation of any company
  // created from now on. Writing the domain row is the application's job, in
  // `upsertCompany`, and this asserts the shape that has to hold rather than
  // a backfill that could not have covered these rows.
  const before = await db.query<{ n: number }>(
    `select count(*)::int as n from company_domains where org_id = $1`,
    [ORG_A],
  );
  if (before.rows[0]?.n === 0) {
    ok("a company created after 0012 has no domain row until something writes one");
  } else {
    fail("a company created after 0012 has no domain row until something writes one", JSON.stringify(before.rows[0]));
  }

  await db.query(
    `insert into company_domains (org_id, company_id, domain, kind, asserted_by, confidence)
     values ($1, $2, 'alphio.ai', 'primary', 'test', 'high')`,
    [ORG_A, SUBJ],
  );

  const byDomain = await db.query<{ company_id: string; matched_on: string }>(
    `select company_id, matched_on from public.resolve_company($1, 'alphio.ai')`,
    [ORG_A],
  );
  if (byDomain.rows[0]?.company_id === SUBJ && byDomain.rows[0]?.matched_on === "domain") {
    ok("an exact domain resolves to the company that owns it");
  } else {
    fail("an exact domain resolves to the company that owns it", JSON.stringify(byDomain.rows[0]));
  }

  // The whole point: a provider returning a second domain for a company we
  // already have must resolve, not duplicate.
  await db.query(
    `insert into company_domains (org_id, company_id, domain, kind, asserted_by)
     values ($1, $2, 'www-alphio.com', 'alternate', 'provider:apollo')`,
    [ORG_A, SUBJ],
  );
  const alt = await db.query<{ company_id: string }>(
    `select company_id from public.resolve_company($1, 'www-alphio.com')`,
    [ORG_A],
  );
  if (alt.rows[0]?.company_id === SUBJ) ok("and so does an alternate domain");
  else fail("and so does an alternate domain", JSON.stringify(alt.rows[0]));

  await db.query(
    `insert into external_ids (org_id, entity_type, entity_id, provider, provider_id)
     values ($1, 'company', $2, 'apollo', 'org_123')`,
    [ORG_A, SUBJ],
  );
  const byProvider = await db.query<{ company_id: string; matched_on: string }>(
    `select company_id, matched_on from public.resolve_company($1, null, 'apollo', 'org_123')`,
    [ORG_A],
  );
  if (byProvider.rows[0]?.company_id === SUBJ && byProvider.rows[0]?.matched_on === "provider_id") {
    ok("a provider id resolves when the domain is unknown");
  } else {
    fail("a provider id resolves when the domain is unknown", JSON.stringify(byProvider.rows[0]));
  }

  // A domain we have never seen resolves to nothing, rather than to the
  // nearest thing. Silence is the correct answer and a wrong match is the
  // expensive one.
  const miss = await db.query(`select * from public.resolve_company($1, 'unrelated.example')`, [ORG_A]);
  if (miss.rows.length === 0) ok("an unknown domain resolves to nothing rather than to something near it");
  else fail("an unknown domain resolves to nothing rather than to something near it", JSON.stringify(miss.rows));

  await db.exec("rollback");
}

console.log("\n0012 — a merge moves everything, and cannot cross a tenant");
{
  await db.exec("begin");

  await db.query(
    `insert into companies (id, org_id, canonical_domain, name)
     values ('c0000000-0000-0000-0000-0000000000dd', $1, 'alphio-dup.ai', 'Alphio (dup)')`,
    [ORG_A],
  );
  await db.query(
    `insert into company_domains (org_id, company_id, domain, kind)
     values ($1, 'c0000000-0000-0000-0000-0000000000dd', 'alphio-dup.ai', 'primary')`,
    [ORG_A],
  );
  await db.query(
    `insert into people (org_id, company_id, first_name, last_name)
     values ($1, 'c0000000-0000-0000-0000-0000000000dd', 'Dup', 'Person')`,
    [ORG_A],
  );

  const merge = await db.query<{ merge_companies: string }>(
    `select public.merge_companies($1, $2, 'c0000000-0000-0000-0000-0000000000dd', 'same company') as merge_companies`,
    [ORG_A, SUBJ],
  );
  if (merge.rows[0]?.merge_companies) ok("a merge returns its record id");
  else fail("a merge returns its record id", JSON.stringify(merge.rows[0]));

  const moved = await db.query<{ n: number }>(
    `select count(*)::int as n from people where org_id = $1 and company_id = $2 and first_name = 'Dup'`,
    [ORG_A, SUBJ],
  );
  if (moved.rows[0]?.n === 1) ok("the loser's people move to the winner");
  else fail("the loser's people move to the winner", JSON.stringify(moved.rows[0]));

  // The domain follows, demoted. Two primaries would break the partial index
  // and make the display name depend on row order.
  const domains = await db.query<{ kind: string }>(
    `select kind from company_domains where org_id = $1 and domain = 'alphio-dup.ai'`,
    [ORG_A],
  );
  if (domains.rows[0]?.kind === "alternate") ok("and its primary domain follows as an alternate");
  else fail("and its primary domain follows as an alternate", JSON.stringify(domains.rows[0]));

  // The loser is soft-deleted with a pointer, not removed. An old link, an
  // old job payload and an external reference all still resolve.
  const loser = await db.query<{ deleted_at: string | null; merged_into_id: string | null }>(
    `select deleted_at, merged_into_id from companies where id = 'c0000000-0000-0000-0000-0000000000dd'`,
  );
  if (loser.rows[0]?.deleted_at && loser.rows[0]?.merged_into_id === SUBJ) {
    ok("the loser survives, soft-deleted, pointing at the winner");
  } else {
    fail("the loser survives, soft-deleted, pointing at the winner", JSON.stringify(loser.rows[0]));
  }

  await db.exec("rollback");
}

// The most important test in this block. A merge that accepted a company from
// another org would move that org's people, evidence and opportunities under
// this org's row — a cross-tenant write with no RLS to stop it, because the
// function is SECURITY DEFINER and RLS does not apply to it at all.
{
  await db.exec("begin");
  await expectRejectTx(
    db,
    "a merge naming another tenant's company is refused",
    `select public.merge_companies('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
       'c0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-00000000000b', 'attack')`,
  );

  await expectRejectTx(
    db,
    "and a merge of a company with itself is refused",
    `select public.merge_companies('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
       'c0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-00000000000a', 'nonsense')`,
  );
  await db.exec("rollback");
}

console.log("\n0013 — the ICP shape cannot silently disagree with its readers");
{
  await db.exec("begin");
  await db.query(
    `insert into icps (id, org_id, name, criteria)
     values ('11111111-0000-0000-0000-0000000000ac', $1, 'Test ICP',
             '{"segments":["Fintech"],"sizes":["11-50"]}'::jsonb)`,
    [ORG_A],
  );
  ok("a profile using the v1 key names is accepted unchanged");

  // The `ICP-01` failure, made impossible: a writer that never read the
  // schema puts an unrecognised key in, every reader silently sees an empty
  // profile, and the model judges every company against nothing.
  await expectRejectTx(
    db,
    "a profile with an unrecognised criteria key is rejected rather than silently ignored",
    `insert into icps (org_id, name, criteria)
     values ($1, 'Bad ICP', '{"industires":["Fintech"]}'::jsonb)`,
    [ORG_A],
  );

  await expectRejectTx(
    db,
    "and criteria that is not an object is rejected",
    `insert into icps (org_id, name, criteria) values ($1, 'Bad ICP 2', '["fintech"]'::jsonb)`,
    [ORG_A],
  );

  const v = await db.query<{ version: number; n: number }>(
    `select version, (select count(*)::int from icp_versions where icp_id = '11111111-0000-0000-0000-0000000000ac') as n
     from icps where id = '11111111-0000-0000-0000-0000000000ac'`,
  );
  // A profile created after 0013 has no version until something bumps it —
  // the backfill only covered rows that existed. Asserted so the behaviour is
  // deliberate rather than discovered later.
  if (v.rows[0]?.n === 0) ok("a new profile has no version until one is written");
  else fail("a new profile has no version until one is written", JSON.stringify(v.rows[0]));

  await db.query(
    `select public.bump_icp_version($1, '11111111-0000-0000-0000-0000000000ac', '{"reason":"test"}'::jsonb, 60)`,
    [ORG_A],
  );
  await db.query(
    `select public.bump_icp_version($1, '11111111-0000-0000-0000-0000000000ac', '{"reason":"test 2"}'::jsonb, 65)`,
    [ORG_A],
  );
  const after = await db.query<{ version: number; quality_score: number; n: number }>(
    `select i.version, i.quality_score,
            (select count(*)::int from icp_versions where icp_id = i.id) as n
     from icps i where i.id = '11111111-0000-0000-0000-0000000000ac'`,
  );
  if (
    Number(after.rows[0]?.version) === 2 &&
    after.rows[0]?.n === 2 &&
    Number(after.rows[0]?.quality_score) === 65
  ) {
    ok("bumping twice produces two immutable snapshots and one current pointer");
  } else {
    fail("bumping twice produces two immutable snapshots and one current pointer", JSON.stringify(after.rows[0]));
  }

  await db.exec("rollback");
}

console.log("\n0014 — a failed search is never an empty market");
{
  await db.exec("begin");
  await db.query(
    `insert into discovery_queries (id, org_id, name, filters, filters_hash)
     values ('d0000000-0000-0000-0000-0000000000a1', $1, 'Fintech', '{}'::jsonb, 'hash1')`,
    [ORG_A],
  );

  // A provider run must name the query that produced it. A row with neither
  // a query nor a source cannot be rendered or resumed.
  await expectRejectTx(
    db,
    "a provider run with no query is rejected",
    `insert into discovery_runs (org_id, channel) values ($1, 'provider')`,
    [ORG_A],
  );

  await db.query(
    `insert into discovery_runs (id, org_id, channel, query_id, status)
     values ('d0000000-0000-0000-0000-0000000000b1', $1, 'provider', 'd0000000-0000-0000-0000-0000000000a1', 'running')`,
    [ORG_A],
  );

  // Two live runs of one query is two identical paid searches.
  await expectRejectTx(
    db,
    "a second live run of the same query is rejected",
    `insert into discovery_runs (org_id, channel, query_id, status)
     values ($1, 'provider', 'd0000000-0000-0000-0000-0000000000a1', 'queued')`,
    [ORG_A],
  );

  await db.query(
    `insert into discovery_results (org_id, run_id, provider, provider_id, raw_domain, outcome)
     values ($1, 'd0000000-0000-0000-0000-0000000000b1', 'apollo', 'p1', 'a.test', 'new'),
            ($1, 'd0000000-0000-0000-0000-0000000000b1', 'apollo', 'p2', 'b.test', 'matched'),
            ($1, 'd0000000-0000-0000-0000-0000000000b1', 'apollo', 'p3', 'c.test', 'excluded')`,
    [ORG_A],
  );

  // The same organization on page 1 and page 3 counts once.
  await expectRejectTx(
    db,
    "the same provider id twice in one run is rejected",
    `insert into discovery_results (org_id, run_id, provider, provider_id, outcome)
     values ($1, 'd0000000-0000-0000-0000-0000000000b1', 'apollo', 'p1', 'new')`,
    [ORG_A],
  );

  await db.query(
    `select public.finish_discovery_run('d0000000-0000-0000-0000-0000000000b1', 'partial', 'credit_budget', null, 'page-3', 900)`,
  );
  const run = await db.query<{
    status: string; results_returned: number; companies_new: number;
    results_excluded: number; total_available: number; page_cursor: string;
  }>(
    `select status, results_returned, companies_new, results_excluded, total_available, page_cursor
     from discovery_runs where id = 'd0000000-0000-0000-0000-0000000000b1'`,
  );
  const r = run.rows[0];
  if (
    r?.status === "partial" &&
    Number(r.results_returned) === 3 &&
    Number(r.companies_new) === 1 &&
    Number(r.results_excluded) === 1 &&
    Number(r.total_available) === 900 &&
    r.page_cursor === "page-3"
  ) {
    ok("a budget-stopped run is `partial`, keeps its results, and stays resumable");
  } else {
    fail("a budget-stopped run is `partial`, keeps its results, and stays resumable", JSON.stringify(r));
  }

  // Counts are derived, so running the finisher twice is harmless — which is
  // what lets the handler be safely re-run.
  await db.query(
    `select public.finish_discovery_run('d0000000-0000-0000-0000-0000000000b1', 'partial', 'credit_budget')`,
  );
  const again = await db.query<{ results_returned: number }>(
    `select results_returned from discovery_runs where id = 'd0000000-0000-0000-0000-0000000000b1'`,
  );
  if (Number(again.rows[0]?.results_returned) === 3) ok("and finishing it twice changes nothing");
  else fail("and finishing it twice changes nothing", JSON.stringify(again.rows[0]));

  await db.exec("rollback");
}

console.log("\n0017 — a contact cannot be pestered, and erasure cannot un-suppress");
{
  await db.exec("begin");

  const fresh = await db.query<{ allowed: boolean; reason: string }>(
    `select allowed, reason from public.can_contact($1, 'New.Person@Example.com')`,
    [ORG_A],
  );
  if (fresh.rows[0]?.allowed === true) ok("a never-contacted address is allowed");
  else fail("a never-contacted address is allowed", JSON.stringify(fresh.rows[0]));

  await db.query(`select public.record_contact_send($1, 'New.Person@Example.com')`, [ORG_A]);

  // The address is normalized on both sides, so a differently-cased copy of
  // the same person does not get a second email today.
  const tooSoon = await db.query<{ allowed: boolean; reason: string }>(
    `select allowed, reason from public.can_contact($1, 'new.person@example.com')`,
    [ORG_A],
  );
  if (tooSoon.rows[0]?.allowed === false && tooSoon.rows[0]?.reason === "too_soon") {
    ok("and is refused immediately afterwards, case-insensitively");
  } else {
    fail("and is refused immediately afterwards, case-insensitively", JSON.stringify(tooSoon.rows[0]));
  }

  // A reply lifts the cadence cap: answering someone who wrote to you is not
  // cold outreach.
  await db.query(`select public.record_contact_reply($1, 'new.person@example.com')`, [ORG_A]);
  const replied = await db.query<{ allowed: boolean }>(
    `select allowed from public.can_contact($1, 'new.person@example.com')`,
    [ORG_A],
  );
  if (replied.rows[0]?.allowed === true) ok("a reply lifts the cadence cap");
  else fail("a reply lifts the cadence cap", JSON.stringify(replied.rows[0]));

  // The trap: erasure must not make somebody contactable again.
  await db.query(
    `insert into people (id, org_id, company_id, first_name, last_name)
     values ('e0000000-0000-0000-0000-0000000000c1', $1, $2, 'Erase', 'Me')`,
    [ORG_A, SUBJ],
  );
  await db.query(
    `insert into contact_points (org_id, person_id, kind, value)
     values ($1, 'e0000000-0000-0000-0000-0000000000c1', 'email', 'erase@example.com')`,
    [ORG_A],
  );

  await db.query(`select public.erase_contact($1, 'erase@example.com')`, [ORG_A]);

  const gone = await db.query<{ n: number }>(
    `select count(*)::int as n from contact_points where org_id = $1 and value = 'erase@example.com'`,
    [ORG_A],
  );
  if (gone.rows[0]?.n === 0) ok("erasure removes the address");
  else fail("erasure removes the address", JSON.stringify(gone.rows[0]));

  const stillBlocked = await db.query<{ allowed: boolean; reason: string }>(
    `select allowed, reason from public.can_contact($1, 'erase@example.com')`,
    [ORG_A],
  );
  if (stillBlocked.rows[0]?.allowed === false && stillBlocked.rows[0]?.reason === "suppressed") {
    ok("and the person stays suppressed afterwards — the whole point");
  } else {
    fail("and the person stays suppressed afterwards — the whole point", JSON.stringify(stillBlocked.rows[0]));
  }

  // The residue is a hash, so the suppression works without the system still
  // holding the address it was asked to forget.
  const residue = await db.query<{ value: string; is_erasure_residue: boolean }>(
    `select value, is_erasure_residue from suppressions where org_id = $1 and is_erasure_residue = true`,
    [ORG_A],
  );
  if (
    residue.rows[0]?.is_erasure_residue === true &&
    !String(residue.rows[0]?.value).includes("@")
  ) {
    ok("and what remains is a hash rather than the address");
  } else {
    fail("and what remains is a hash rather than the address", JSON.stringify(residue.rows[0]));
  }

  await db.exec("rollback");
}

console.log("\n0016 — a disagreement is recorded, and agreement is not");
{
  await db.exec("begin");
  await db.exec(`set local role authenticated`).catch(() => {});
  await db.exec(`set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111'`);

  const real = await db.query<{ record_override: string | null }>(
    `select public.record_override($1, 'opportunity_priority', 'opportunity', $2, 'hot', 'ignore', 'wrong market') as record_override`,
    [ORG_A, "0bbbbbbb-0000-0000-0000-00000000000a"],
  );
  if (real.rows[0]?.record_override) ok("a real disagreement is recorded");
  else fail("a real disagreement is recorded", JSON.stringify(real.rows[0]));

  // Re-saving a form is not a correction, and counting it as one pollutes the
  // only clean training signal the product gets.
  const noop = await db.query<{ record_override: string | null }>(
    `select public.record_override($1, 'opportunity_priority', 'opportunity', $2, 'hot', 'hot') as record_override`,
    [ORG_A, "0bbbbbbb-0000-0000-0000-00000000000a"],
  );
  if (noop.rows[0]?.record_override === null) ok("and setting a value to itself is not");
  else fail("and setting a value to itself is not", JSON.stringify(noop.rows[0]));

  await db.exec("rollback");
}

console.log("\n0021 — a competitor is a subject evidence may be about");
{
  await db.exec("begin");

  const competitor = await db.query<{ id: string }>(
    `insert into competitors (org_id, name, domain, origin, status)
     values ($1, 'Gong', 'gong.io', 'user', 'active') returning id`,
    [ORG_A],
  );
  const competitorId = competitor.rows[0]!.id;

  // `0015` built `competitor_evidence` to point at rows `0002`'s CHECK made
  // uninsertable. This is the join table becoming usable.
  const written = await db.query<{ id: string }>(
    `insert into evidence
       (org_id, subject_type, subject_id, claim, kind, confidence, reliability, source_url, field)
     values ($1, 'competitor', $2, 'Charges per seat', 'fact', 'high', 'first_party',
             'https://gong.io/pricing', 'pricing_model')
     returning id`,
    [ORG_A, competitorId],
  );
  if (written.rows[0]?.id) ok("evidence about a competitor is insertable at all");
  else fail("evidence about a competitor is insertable at all", JSON.stringify(written.rows));

  const link = await db.query<{ id: string }>(
    `insert into competitor_evidence (org_id, competitor_id, evidence_id, field)
     values ($1, $2, $3, 'pricing_model') returning id`,
    [ORG_A, competitorId, written.rows[0]!.id],
  );
  if (link.rows[0]?.id) ok("and the join table can finally reference it");
  else fail("and the join table can finally reference it", JSON.stringify(link.rows));

  // Widening an enum is where a typo gets in. The other four subjects still
  // work, and a fifth invented one still does not.
  await expectRejectTx(
    db,
    "a subject_type nobody defined is still refused",
    `insert into evidence (org_id, subject_type, subject_id, claim, kind)
     values ($1, 'compettitor', $2, 'x', 'inference')`,
    [ORG_A, competitorId],
  );

  // §7 does not relax because the subject changed. This is the constraint that
  // caught `enrich_company`, and it is the one that matters most here: a
  // competitor claim with nowhere to check it is the exact failure `0015` is
  // built around.
  await expectRejectTx(
    db,
    "and a competitor 'fact' with no source is still not a fact",
    `insert into evidence (org_id, subject_type, subject_id, claim, kind, confidence)
     values ($1, 'competitor', $2, 'They have no SOC 2', 'fact', 'high')`,
    [ORG_A, competitorId],
  );

  // `0020`'s contradiction detector groups by (subject_type, subject_id,
  // field). A competitor that is also somebody's prospect must not have its
  // pricing contradict that company's research — which is the whole reason
  // this is a fifth subject_type rather than a reuse of 'company'.
  await db.query(
    `insert into evidence
       (org_id, subject_type, subject_id, claim, kind, confidence, reliability, source_url, field)
     values ($1, 'competitor', $2, 'Charges per usage', 'fact', 'medium', 'press',
             'https://example.com/report', 'pricing_model')`,
    [ORG_A, competitorId],
  );
  await db.query(`select public.flag_contradictions($1, 'competitor', $2)`, [
    ORG_A,
    competitorId,
  ]);
  const flagged = await db.query<{ n: number }>(
    `select count(*)::int as n from evidence
     where org_id = $1 and subject_type = 'competitor' and subject_id = $2 and contradicted`,
    [ORG_A, competitorId],
  );
  if (Number(flagged.rows[0]?.n) === 2) {
    ok("two sources disagreeing about a competitor's pricing are both flagged, not silently picked");
  } else {
    fail("two sources disagreeing about a competitor's pricing are both flagged", JSON.stringify(flagged.rows[0]));
  }

  await db.exec("rollback");
}

console.log("\n0022 — three outlets reporting one round is one claim, not three");
{
  await db.exec("begin");

  const SUBJECT = "0ccccccc-0000-0000-0000-00000000000e";

  // The same sentence, punctuated three ways, from three sources of differing
  // reliability. This is what a well-fed source list actually produces.
  await db.query(
    `insert into evidence
       (org_id, subject_type, subject_id, claim, kind, confidence, reliability,
        source_url, observed_at)
     values
       ($1, 'company', $2, 'Raised $12M Series B.', 'fact', 'high', 'press',
        'https://outlet-a.example/1', '2026-08-01T00:00:00Z'),
       ($1, 'company', $2, 'raised $12m series b', 'fact', 'medium', 'press',
        'https://outlet-b.example/2', '2026-08-03T00:00:00Z'),
       ($1, 'company', $2, 'Raised $12M   Series B!', 'fact', 'high', 'first_party',
        'https://acme.example/news', '2026-08-05T00:00:00Z')`,
    [ORG_A, SUBJECT],
  );

  const hashes = await db.query<{ n: number }>(
    `select count(distinct claim_hash)::int as n from evidence
     where org_id = $1 and subject_id = $2`,
    [ORG_A, SUBJECT],
  );
  if (Number(hashes.rows[0]?.n) === 1) {
    ok("case and punctuation do not make three different claims");
  } else {
    fail("case and punctuation do not make three different claims", JSON.stringify(hashes.rows[0]));
  }

  const merged = await db.query<{ merge_duplicate_evidence: number }>(
    `select public.merge_duplicate_evidence($1, 'company', $2) as merge_duplicate_evidence`,
    [ORG_A, SUBJECT],
  );
  if (Number(merged.rows[0]?.merge_duplicate_evidence) === 2) ok("two of the three are superseded");
  else fail("two of the three are superseded", JSON.stringify(merged.rows[0]));

  const survivor = await db.query<{ reliability: string; observed_at: string }>(
    `select reliability, observed_at from evidence
     where org_id = $1 and subject_id = $2 and deleted_at is null`,
    [ORG_A, SUBJECT],
  );
  if (survivor.rows.length === 1 && survivor.rows[0]?.reliability === "first_party") {
    ok("and the company's own statement outranks the outlets that repeated it");
  } else {
    fail("and the company's own statement outranks the outlets that repeated it", JSON.stringify(survivor.rows));
  }

  // The claim is as old as its earliest sighting. A duplicate arriving today
  // must not make a report from three days ago look like today's news.
  if (new Date(String(survivor.rows[0]?.observed_at)).toISOString().startsWith("2026-08-01")) {
    ok("and it is dated from the first sighting, not the last duplicate");
  } else {
    fail("and it is dated from the first sighting, not the last duplicate", JSON.stringify(survivor.rows[0]));
  }

  const citations = await db.query<{ n: number }>(
    `select count(*)::int as n from evidence_citations where org_id = $1`,
    [ORG_A],
  );
  if (Number(citations.rows[0]?.n) === 3) {
    ok("all three citations survive — corroboration is the whole point of merging");
  } else {
    fail("all three citations survive", JSON.stringify(citations.rows[0]));
  }

  // Anything already pointing at a merged row keeps resolving, and says what
  // replaced it. Deleting the loser would break a trigger's evidence link.
  const pointers = await db.query<{ n: number }>(
    `select count(*)::int as n from evidence
     where org_id = $1 and subject_id = $2 and deleted_at is not null and superseded_by is null`,
    [ORG_A, SUBJECT],
  );
  if (Number(pointers.rows[0]?.n) === 0) ok("no superseded row is left without a pointer to its successor");
  else fail("no superseded row is left without a pointer to its successor", JSON.stringify(pointers.rows[0]));

  // The failure that would be invisible: merging two claims that are not the
  // same claim. Normalisation is textual on purpose, and stops well short of
  // deciding that two differently-worded sentences mean one thing.
  await db.query(
    `insert into evidence (org_id, subject_type, subject_id, claim, kind, confidence, reliability, source_url)
     values ($1, 'company', $2, 'Raised $12M Series C.', 'fact', 'high', 'press',
             'https://outlet-c.example/3')`,
    [ORG_A, SUBJECT],
  );
  const second = await db.query<{ merge_duplicate_evidence: number }>(
    `select public.merge_duplicate_evidence($1, 'company', $2) as merge_duplicate_evidence`,
    [ORG_A, SUBJECT],
  );
  if (Number(second.rows[0]?.merge_duplicate_evidence) === 0) {
    ok("a different round is a different claim and is left alone");
  } else {
    fail("a different round is a different claim and is left alone", JSON.stringify(second.rows[0]));
  }

  await db.exec("rollback");
}

console.log("\n0023 — one live recomputation, resumable, and stoppable");
{
  await db.exec("begin");

  const first = await db.query<{ id: string }>(
    `insert into score_recompute_requests (org_id, reason) values ($1, 'rule_change') returning id`,
    [ORG_A],
  );
  const requestId = first.rows[0]!.id;

  /* The property the partial index exists for. Two overlapping passes would
     hold different cursors and report different counts for the same work, and
     a customer looking at two half-finished recomputations cannot tell which
     number is true. */
  await expectRejectTx(
    db,
    "a second recomputation for the same profile is refused while one is live",
    `insert into score_recompute_requests (org_id, reason) values ($1, 'icp_change')`,
    [ORG_A],
  );

  await expectAccept(
    db,
    "but another org's is unaffected",
    `insert into score_recompute_requests (org_id, reason) values ($1, 'rule_change')`,
    ["bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"],
  );

  const running = await db.query<{ id: string; cursor: string | null }>(
    `select id, cursor from public.claim_due_recomputes(5) where org_id = $1`,
    [ORG_A],
  );
  if (running.rows.length === 1 && running.rows[0]?.cursor === null) {
    ok("claiming marks it running and hands back no cursor on the first pass");
  } else {
    fail("claiming marks it running and hands back no cursor", JSON.stringify(running.rows));
  }

  const reclaim = await db.query(`select * from public.claim_due_recomputes(5)`);
  if (reclaim.rows.length === 0) ok("and a running request is not claimed twice");
  else fail("a running request is not claimed twice", JSON.stringify(reclaim.rows));

  await db.query(
    `select public.advance_recompute($1, 'co_199', 200, 200, false)`,
    [requestId],
  );
  await db.query(
    `select public.advance_recompute($1, 'co_399', 200, 150, false)`,
    [requestId],
  );
  const progress = await db.query<{ cursor: string; companies_seen: number; scores_enqueued: number }>(
    `select cursor, companies_seen, scores_enqueued from score_recompute_requests where id = $1`,
    [requestId],
  );
  if (
    progress.rows[0]?.cursor === "co_399" &&
    Number(progress.rows[0]?.companies_seen) === 400 &&
    Number(progress.rows[0]?.scores_enqueued) === 350
  ) {
    ok("progress accumulates across batches and the cursor moves forward");
  } else {
    fail("progress accumulates across batches", JSON.stringify(progress.rows[0]));
  }

  /* A job already in flight cannot be interrupted, so "stop" has to reach it
     as an answer to something it was going to ask anyway. */
  await db.query(
    `update score_recompute_requests set status = 'cancelled' where id = $1`,
    [requestId],
  );
  const afterCancel = await db.query<{ advance_recompute: string }>(
    `select public.advance_recompute($1, 'co_599', 200, 200, false) as advance_recompute`,
    [requestId],
  );
  if (afterCancel.rows[0]?.advance_recompute === "cancelled") {
    ok("a cancelled request tells the next batch to stop, rather than being un-cancelled by it");
  } else {
    fail("a cancelled request tells the next batch to stop", JSON.stringify(afterCancel.rows[0]));
  }

  // Cancelling frees the slot, so the customer can start a corrected one.
  await expectAccept(
    db,
    "and cancelling releases the one-live-recomputation slot",
    `insert into score_recompute_requests (org_id, reason) values ($1, 'manual')`,
    [ORG_A],
  );

  await db.exec("rollback");
}

console.log("\n0024 — onboarding progress belongs to the workspace, role to the person");
{
  await db.exec("begin");

  /* The backfill is the assertion that matters most here, because it runs
     once against real customer data and cannot be re-run if it is wrong. Org A
     has no active ICP in the fixtures, so it must have been left mid-flow;
     an org that HAS one must have been marked done. Marching an established
     workspace back through company research is the failure being guarded. */
  const backfilled = await db.query<{ onboarding_step: string }>(
    `select onboarding_step from organizations where id = $1`,
    [ORG_A],
  );
  if (backfilled.rows[0]?.onboarding_step === "you") {
    ok("an org with no active ICP is left at the start of the flow");
  } else {
    fail("an org with no active ICP is left at the start", JSON.stringify(backfilled.rows[0]));
  }

  await db.query(
    `insert into icps (org_id, name, criteria, is_active)
     values ($1, 'Backfill probe', '{"segments":["x"]}'::jsonb, true)`,
    [ORG_A],
  );
  // Re-run the backfill predicate exactly as the migration wrote it.
  await db.query(
    `update organizations o set onboarding_step = 'done',
            onboarding_completed_at = now()
      where o.id = $1 and o.onboarding_completed_at is null
        and exists (select 1 from icps i
                     where i.org_id = o.id and i.is_active and i.deleted_at is null)`,
    [ORG_A],
  );
  const afterIcp = await db.query<{ onboarding_step: string }>(
    `select onboarding_step from organizations where id = $1`,
    [ORG_A],
  );
  if (afterIcp.rows[0]?.onboarding_step === "done") {
    ok("and an org that already has one is never walked through setup again");
  } else {
    fail("an org with an active ICP is marked done", JSON.stringify(afterIcp.rows[0]));
  }

  await expectRejectTx(
    db,
    "a step nobody defined is refused",
    `update organizations set onboarding_step = 'pick-a-plan' where id = $1`,
    [ORG_A],
  );

  await expectRejectTx(
    db,
    "a goal outside the five loop stages is refused",
    `update organizations set goals = array['world-domination'] where id = $1`,
    [ORG_A],
  );

  /* The cap is a product rule with a real consequence: the answer's only job
     is to RANK the dashboard, and five selections express no ranking. */
  await expectRejectTx(
    db,
    "and selecting more than two goals is refused, because that is not a ranking",
    `update organizations set goals = array['discover','qualify','enrich'] where id = $1`,
    [ORG_A],
  );

  await expectAccept(
    db,
    "two goals are fine",
    `update organizations set goals = array['discover','reach_out'] where id = $1`,
    [ORG_A],
  );

  await expectRejectTx(
    db,
    "a role outside the set the dashboard has layouts for is refused",
    `update profiles set role = 'chief vibes officer' where id = $1`,
    ["11111111-1111-1111-1111-111111111111"],
  );

  // advance_onboarding is the narrow write path. The tenant boundary inside it
  // is the only thing standing between a signed-in stranger and someone else's
  // workspace, because SECURITY DEFINER bypasses RLS.
  await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [
    "33333333-3333-3333-3333-333333333333",
  ]);
  await expectRejectTx(
    db,
    "a member of another org cannot advance this one's onboarding",
    `select public.advance_onboarding($1, 'icp')`,
    [ORG_A],
  );

  await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [
    "11111111-1111-1111-1111-111111111111",
  ]);
  const advanced = await db.query<{ advance_onboarding: string }>(
    `select public.advance_onboarding($1, 'sources') as advance_onboarding`,
    [ORG_A],
  );
  if (advanced.rows[0]?.advance_onboarding === "sources") {
    ok("but a member of this one can");
  } else {
    fail("a member can advance their own onboarding", JSON.stringify(advanced.rows[0]));
  }

  /* Completion is a fact about the past. A user who revisits their ICP a month
     later has not un-onboarded, so the timestamp is set once and never moved. */
  await db.query(`select public.advance_onboarding($1, 'done')`, [ORG_A]);
  const first = await db.query<{ onboarding_completed_at: string }>(
    `select onboarding_completed_at from organizations where id = $1`,
    [ORG_A],
  );
  await db.query(`select public.advance_onboarding($1, 'icp')`, [ORG_A]);
  await db.query(`select public.advance_onboarding($1, 'done')`, [ORG_A]);
  const second = await db.query<{ onboarding_completed_at: string }>(
    `select onboarding_completed_at from organizations where id = $1`,
    [ORG_A],
  );
  if (
    first.rows[0]?.onboarding_completed_at &&
    String(first.rows[0].onboarding_completed_at) ===
      String(second.rows[0]?.onboarding_completed_at)
  ) {
    ok("and finishing twice does not move the date the workspace was finished");
  } else {
    fail(
      "onboarding_completed_at is set once",
      `${String(first.rows[0]?.onboarding_completed_at)} vs ${String(second.rows[0]?.onboarding_completed_at)}`,
    );
  }

  await db.exec("rollback");
}

console.log("\n0025 — research for a visitor who has no account yet");
{
  await db.exec("begin");

  await db.query(
    `insert into public_research (canonical_domain, understanding, is_live)
     values ('acme.test', '{"companyName":"Acme"}'::jsonb, true)`,
  );

  await expectRejectTx(
    db,
    "one domain is one row — a second reading does not become a second cache entry",
    `insert into public_research (canonical_domain, understanding)
     values ('acme.test', '{}'::jsonb)`,
  );

  /* A claim that names when but not who is unattributable, which defeats the
     point of recording it. */
  await expectRejectTx(
    db,
    "a half-written claim is refused",
    `update public_research set claimed_at = now() where canonical_domain = 'acme.test'`,
  );

  /* The access control is "RLS on, no policy". Asserted structurally because
     the failure mode is somebody adding `using (true)` to make it readable,
     which turns the table into a public index of who we have researched. */
  const policies = await db.query<{ count: string }>(
    `select count(*) as count from pg_policies
      where schemaname = 'public' and tablename = 'public_research'`,
  );
  if (Number(policies.rows[0]?.count) === 0) {
    ok("no policy exists, which is what makes it unreadable through PostgREST");
  } else {
    fail("public_research has no policy", `${policies.rows[0]?.count} found`);
  }

  /* claim_research takes no domain argument on purpose: it derives one from
     the caller's own verified address. So the test that matters is that a user
     at a different domain gets nothing — not that a bad argument is rejected,
     because there is no argument to pass. */
  await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [
    "11111111-1111-1111-1111-111111111111", // owner@a.test
  ]);
  const wrongDomain = await db.query(`select * from public.claim_research()`);
  if (wrongDomain.rows.length === 0) {
    ok("a user cannot claim research done for a company they have no address at");
  } else {
    fail("claim is scoped to the caller's own domain", JSON.stringify(wrongDomain.rows));
  }

  await db.query(
    `insert into public_research (canonical_domain, understanding, is_live)
     values ('a.test', '{"companyName":"A"}'::jsonb, true)`,
  );
  const claimed = await db.query<{ research_domain: string }>(
    `select research_domain from public.claim_research()`,
  );
  if (claimed.rows[0]?.research_domain === "a.test") {
    ok("but they do get the research done for their own");
  } else {
    fail("a matching domain is claimed", JSON.stringify(claimed.rows));
  }

  const again = await db.query(`select * from public.claim_research()`);
  if (again.rows.length === 0) {
    ok("and it is claimed exactly once, so two tabs cannot both take it");
  } else {
    fail("a claim happens once", JSON.stringify(again.rows));
  }

  await db.query(
    `update public_research set expires_at = now() - interval '1 day'`,
  );
  const purged = await db.query<{ purge_expired_research: number }>(
    `select public.purge_expired_research() as purge_expired_research`,
  );
  if (Number(purged.rows[0]?.purge_expired_research) >= 1) {
    ok("expired research is swept, including rows that were claimed");
  } else {
    fail("expired research is purged", JSON.stringify(purged.rows[0]));
  }

  await db.exec("rollback");
}

console.log("\n0026 — the research a product was built from survives the flow");
{
  await db.exec("begin");

  await expectAccept(
    db,
    "the whole understanding is storable, claim kinds and all",
    `insert into products (org_id, name, description, research, researched_at, research_is_live)
     values ($1, 'Alphio', 'Policy infrastructure.',
       '{"companyName":"Alphio","findings":[{"field":"sells","kind":"fact","sourceUrl":"https://a.test/x"}]}'::jsonb,
       now(), true)`,
    [ORG_A],
  );

  /* Weak on purpose — full validation belongs where it can produce a message
     a person can act on. What this stops is a scalar landing in a column every
     reader will treat as an object with a `findings` array. */
  await expectRejectTx(
    db,
    "a scalar where every reader expects an object is refused",
    `insert into products (org_id, name, research) values ($1, 'Bad', '"just a string"'::jsonb)`,
    [ORG_A],
  );

  await expectAccept(
    db,
    "and a product with no research at all is still a product",
    `insert into products (org_id, name) values ($1, 'No research yet')`,
    [ORG_A],
  );

  /* The §7 rule made durable. A worked example shown when no model is
     configured must not be promoted to a real reading by the next thing that
     reads the row. */
  const live = await db.query<{ research_is_live: boolean }>(
    `select research_is_live from products where org_id = $1 and name = 'No research yet'`,
    [ORG_A],
  );
  if (live.rows[0]?.research_is_live === false) {
    ok("research defaults to not-live, so an unlabelled row is never taken as real");
  } else {
    fail("research_is_live defaults false", JSON.stringify(live.rows[0]));
  }

  await db.exec("rollback");
}

console.log("\n0027 — colleagues can find their own company, and nobody else's");
{
  await db.exec("begin");

  await db.query(
    `update organizations set primary_domain = 'a.test' where id = $1`,
    [ORG_A],
  );
  await db.query(
    `update organizations set primary_domain = 'b.test' where id = $1`,
    ["bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"],
  );

  /* owner@a.test is already a member of Org A, so it is not a *discovery* —
     the whole point is finding a workspace you are not in. */
  await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [
    "11111111-1111-1111-1111-111111111111",
  ]);
  const ownMembership = await db.query(`select * from public.discoverable_workspaces()`);
  if (ownMembership.rows.length === 0) {
    ok("a workspace you already belong to is not offered as a discovery");
  } else {
    fail("own membership excluded", JSON.stringify(ownMembership.rows));
  }

  /* A new colleague at a.test. This is the case the feature exists for: they
     would otherwise create a second workspace for a company that has one. */
  await db.query(
    `insert into auth.users (id, email) values ($1, 'colleague-0027@a.test')`,
    ["d1d10000-0000-0000-0000-000000000001"],
  );
  await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [
    "d1d10000-0000-0000-0000-000000000001",
  ]);
  const found = await db.query<{ org_slug: string; member_count: string }>(
    `select org_slug, member_count from public.discoverable_workspaces()`,
  );
  if (found.rows.length === 1 && found.rows[0]?.org_slug === "org-a") {
    ok("a colleague at the same domain finds the workspace, with its member count");
  } else {
    fail("colleague discovery", JSON.stringify(found.rows));
  }
  /* Never anybody else's. Org B is at b.test and must be invisible — this is
     the assertion that separates domain discovery from a customer directory. */
  if (!found.rows.some((r) => r.org_slug === "org-b")) {
    ok("and learns nothing about a company they have no address at");
  } else {
    fail("cross-domain leak", JSON.stringify(found.rows));
  }

  /* SEC-302 (0052): Org B's owner is owner@b.test. Claiming a.test does not
     make Org B "your company's workspace" to everybody at a.test. */
  await db.query(`update organizations set primary_domain = 'a.test' where id = $1`, ["bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"]);
  const claimed = await db.query<{ org_slug: string }>(`select org_slug from public.discoverable_workspaces()`);
  if (claimed.rows.length === 1 && claimed.rows[0]?.org_slug === "org-a") {
    ok("a workspace claiming a domain none of its owners or admins has an address at is not offered there (SEC-302)");
  } else {
    fail("a claimed domain is not discoverable without an owner there (SEC-302)", JSON.stringify(claimed.rows));
  }
  await db.query(`update organizations set primary_domain = 'b.test' where id = $1`, ["bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"]);

  /* Opting out has to actually work, or the column is decoration. */
  await db.query(`update organizations set is_discoverable = false where id = $1`, [ORG_A]);
  const hidden = await db.query(`select * from public.discoverable_workspaces()`);
  if (hidden.rows.length === 0) ok("a workspace that opted out is not discoverable");
  else fail("is_discoverable respected", JSON.stringify(hidden.rows));
  await db.query(`update organizations set is_discoverable = true where id = $1`, [ORG_A]);

  /* A free-mail domain must never resolve. Otherwise every Gmail user is
     handed every workspace anybody created from a Gmail address. */
  await db.query(
    `insert into auth.users (id, email) values ($1, 'freemail-0027@gmail.com')`,
    ["d1d10000-0000-0000-0000-000000000002"],
  );
  await db.query(`update organizations set primary_domain = 'gmail.com' where id = $1`, [ORG_A]);
  await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [
    "d1d10000-0000-0000-0000-000000000002",
  ]);
  const freemail = await db.query(`select * from public.discoverable_workspaces()`);
  if (freemail.rows.length === 0) {
    ok("a free-mail address discovers nothing, whatever is stored against it");
  } else {
    fail("free-mail refused", JSON.stringify(freemail.rows));
  }
  await db.query(`update organizations set primary_domain = 'a.test' where id = $1`, [ORG_A]);

  /* Requesting to join is bounded by the same visibility. Without this it is a
     way to send an unsolicited request to any org whose uuid you can guess. */
  await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [
    "d1d10000-0000-0000-0000-000000000002",
  ]);
  await expectRejectTx(
    db,
    "you cannot ask to join a workspace you could not have found",
    `select public.request_to_join($1)`,
    [ORG_A],
  );

  await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [
    "d1d10000-0000-0000-0000-000000000001",
  ]);
  await expectAccept(
    db,
    "but a colleague at the domain can",
    `select public.request_to_join($1)`,
    [ORG_A],
  );

  // Asking twice is not an error — the partial index makes it a no-op.
  await expectAccept(
    db,
    "and asking twice is a no-op rather than a failure",
    `select public.request_to_join($1)`,
    [ORG_A],
  );
  const pending = await db.query<{ count: string }>(
    `select count(*) as count from join_requests where org_id = $1 and status = 'pending'`,
    [ORG_A],
  );
  if (Number(pending.rows[0]?.count) === 1) ok("one pending request, not two");
  else fail("one pending request", JSON.stringify(pending.rows[0]));

  /* Approval creates the membership in the same call. An approved request that
     did not is a screen saying yes and a user still locked out. */
  await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [
    "11111111-1111-1111-1111-111111111111",
  ]);
  const requestId = (
    await db.query<{ id: string }>(
      `select id from join_requests where org_id = $1 and status = 'pending'`,
      [ORG_A],
    )
  ).rows[0]!.id;
  await db.query(`select public.approve_join_request($1)`, [requestId]);
  const joined = await db.query<{ count: string }>(
    `select count(*) as count from memberships where org_id = $1 and user_id = $2 and deleted_at is null`,
    [ORG_A, "d1d10000-0000-0000-0000-000000000001"],
  );
  if (Number(joined.rows[0]?.count) === 1) {
    ok("approving a request is what creates the membership");
  } else {
    fail("approval creates membership", JSON.stringify(joined.rows[0]));
  }

  await expectRejectTx(
    db,
    "and the same request cannot be approved twice",
    `select public.approve_join_request($1)`,
    [requestId],
  );

  await db.exec("rollback");
}

// A view over tenant tables without security_invoker runs as its owner and
// serves every org's rows to every user. Checked structurally, because the
// failure is silent and the setting is one word.
console.log("\nStructural — no view leaks across tenants");
{
  const r = await db.query<{ viewname: string }>(`
    select c.relname as viewname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'v'
      and not coalesce(
        (select option_value = 'true' from pg_options_to_table(c.reloptions)
         where option_name = 'security_invoker'),
        false
      )
  `);
  if (r.rows.length === 0) ok("every view is security_invoker");
  else fail("every view is security_invoker", r.rows.map((x) => x.viewname).join(", "));
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

/*
 * ── The combined paste is the four migrations, and nothing else ──────────
 *
 * `COMBINED-0024-0027.sql` exists because the four cannot be applied by this
 * repository — nobody here has the database password — so they are applied by
 * a person pasting one file into the Supabase SQL Editor. That makes it the
 * artefact that actually reaches production, and an unverified copy of a
 * verified thing is the worst of both.
 *
 * It is not re-executed: running it after the originals fails on the first
 * `create trigger`, correctly. Instead it is checked to *be* them — every
 * migration's body present verbatim, in order, inside one transaction. A
 * hand-edit to the paste, or a fifth migration nobody added to it, fails here
 * rather than in somebody's production database.
 */
console.log("\nCombined paste — the migrations it claims, and in order");
{
  const combined = normalise(
    await readFile(path.join(migrationsDir, "COMBINED-0024-0027.sql"), "utf8"),
  );
  const parts = ["0024", "0025", "0026", "0027"];

  const included = files.filter((f) => parts.some((p) => f.startsWith(p)));
  if (included.length === parts.length) ok("all four migrations still exist");
  else fail("all four migrations still exist", included.join(", "));

  let cursor = 0;
  let ordered = true;
  for (const file of included) {
    const body = normalise(await readFile(path.join(migrationsDir, file), "utf8"));
    const at = combined.indexOf(body, cursor);
    if (at < 0) {
      fail(`${file} appears in the paste verbatim`, "absent, altered, or out of order");
      ordered = false;
      continue;
    }
    ok(`${file} appears in the paste verbatim`);
    cursor = at + body.length;
  }
  if (ordered) ok("and each after the one before it");

  /* One transaction. A partial application is the failure the file's own
     header promises cannot happen, and that promise is only as good as the
     two keywords implementing it. */
  if (/^begin;$/m.test(combined)) ok("the paste opens a transaction");
  else fail("the paste opens a transaction", "no bare 'begin;' line");
  if (/^commit;$/m.test(combined)) ok("and commits it");
  else fail("and commits it", "no bare 'commit;' line");
}

// ── 0030 — create_organization ──────────────────────────────────────────────
// Onboarding could never create a workspace through the tenant client: no
// insert policy on organizations, and membership_write needs an admin of an
// org that does not exist yet. The function is the only way in.
console.log("\n0030 — creating a workspace");
{
  const NEWCOMER = "30303030-0030-0030-0030-000000000030";
  await db.query(`insert into auth.users (id, email) values ($1, 'founder-0030@c.test')`, [NEWCOMER]);

  const asUser = async (user: string, sql: string, params: unknown[] = []) => {
    await db.exec("begin");
    try {
      await db.exec("set local role authenticated");
      await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [user]);
      const r = await db.query<Record<string, unknown>>(sql, params);
      await db.exec("commit");
      return { rows: r.rows, error: null as string | null };
    } catch (e) {
      await db.exec("rollback");
      return { rows: [], error: (e as Error).message };
    }
  };

  const direct = await asUser(
    NEWCOMER,
    `insert into organizations (name, slug) values ('Direct', 'direct-0030')`,
  );
  if (direct.error) ok("a direct insert is still refused by RLS");
  else fail("a direct insert is still refused by RLS", "insert succeeded");

  const created = await asUser(
    NEWCOMER,
    `select public.create_organization('Kima', 'kima-0030', 'Kima.Finance') as id`,
  );
  const orgId = created.rows[0]?.id as string | undefined;
  if (orgId) ok("an authenticated caller creates a workspace");
  else fail("an authenticated caller creates a workspace", created.error);

  const role = await db.query<{ role: string }>(
    `select role from memberships where org_id = $1 and user_id = $2`,
    [orgId, NEWCOMER],
  );
  if (role.rows[0]?.role === "owner") ok("and is made its owner in the same call");
  else fail("and is made its owner in the same call", role.rows);

  const domain = await db.query<{ primary_domain: string }>(
    `select primary_domain from organizations where id = $1`,
    [orgId],
  );
  if (domain.rows[0]?.primary_domain === "kima.finance") ok("the domain is stored lower-cased");
  else fail("the domain is stored lower-cased", domain.rows);

  const visible = await asUser(NEWCOMER, `select id from organizations where id = $1`, [orgId]);
  if (visible.rows.length === 1) ok("the creator can read it back through RLS");
  else fail("the creator can read it back through RLS", visible.error ?? "no row");

  const taken = await asUser(
    NEWCOMER,
    `select public.create_organization('Org A again', 'org-a', null)`,
  );
  if (taken.error && /duplicate|unique/i.test(taken.error)) ok("a taken slug raises unique_violation");
  else fail("a taken slug raises unique_violation", taken.error ?? "created");

  const badSlug = await asUser(
    NEWCOMER,
    `select public.create_organization('Bad', 'Not A Slug', null)`,
  );
  if (badSlug.error) ok("a malformed slug is refused");
  else fail("a malformed slug is refused", "created");

  // No session: auth.uid() is null, exactly as for an anonymous request.
  const anonymous = await asUser("", `select public.create_organization('Anon', 'anon-0030', null)`);
  if (anonymous.error) ok("a caller with no session cannot create one");
  else fail("a caller with no session cannot create one", "created");
}

// ── 0031 — tenant write hardening ───────────────────────────────────────────
// Pass 14 found member-writable engine tables, a global idempotency index, an
// admin → owner escalation, and a deleted workspace that kept running. Each
// check below fails against the schema before 0031.
console.log("\n0031 — tenant write hardening");
{
  const OWNER_A = "11111111-1111-1111-1111-111111111111";
  const ADMIN_A = "31313131-0031-0031-0031-000000000031";
  const INVITEE = "31313131-0031-0031-0031-000000000032";
  const ORG_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const ORG_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

  await db.query(
    `insert into auth.users (id, email) values ($1, 'admin-0031@a.test'), ($2, 'invitee-0031@a.test')`,
    [ADMIN_A, INVITEE],
  );
  await db.query(`insert into memberships (org_id, user_id, role) values ($1, $2, 'admin')`, [
    ORG_A,
    ADMIN_A,
  ]);

  const asUser = async (user: string, sql: string, params: unknown[] = []) => {
    await db.exec("begin");
    try {
      await db.exec("set local role authenticated");
      await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [user]);
      const r = await db.query<Record<string, unknown>>(sql, params);
      await db.exec("commit");
      return { rows: r.rows, count: r.affectedRows ?? r.rows.length, error: null as string | null };
    } catch (e) {
      await db.exec("rollback");
      return { rows: [], count: 0, error: (e as Error).message };
    }
  };

  // SEC-001: the queue is read-only to sessions.
  const enqueue = await asUser(
    OWNER_A,
    `insert into job_executions (org_id, job_name) values ($1, 'purge_contact_data')`,
    [ORG_A],
  );
  if (enqueue.error) ok("a member cannot enqueue a job directly");
  else fail("a member cannot enqueue a job directly", "insert accepted");

  const readQueue = await asUser(OWNER_A, `select count(*)::int as n from job_executions`);
  if (!readQueue.error) ok("and can still read the org's queue");
  else fail("and can still read the org's queue", readQueue.error);

  // SEC-001: one tenant's key no longer collides with another tenant's.
  try {
    await db.query(
      `insert into job_executions (org_id, job_name, idempotency_key) values
         ($1, 'scan_source', 'k-0031'), ($2, 'scan_source', 'k-0031')`,
      [ORG_A, ORG_B],
    );
    ok("the same idempotency key in two orgs does not collide");
  } catch (e) {
    fail("the same idempotency key in two orgs does not collide", e);
  }
  try {
    await db.query(
      `insert into job_executions (org_id, job_name, idempotency_key) values
         (null, 'schedule_scans', 'sweep-0031'), (null, 'schedule_scans', 'sweep-0031')`,
    );
    fail("a global sweeper key still collapses", "second row accepted");
  } catch {
    ok("a global sweeper key still collapses");
  }

  // SEC-007: engine ledgers are read-only.
  for (const table of ["provider_calls", "provider_cache", "provider_breakers", "evidence_citations"]) {
    const del = await asUser(OWNER_A, `delete from ${table} where org_id = $1`, [ORG_A]);
    const policies = await db.query<{ n: number }>(
      `select count(*)::int as n from pg_policies
        where tablename = $1 and cmd in ('ALL', 'INSERT', 'UPDATE', 'DELETE')`,
      [table],
    );
    if (policies.rows[0]!.n === 0 && !del.error && del.count === 0)
      ok(`${table} has no session write policy`);
    else fail(`${table} has no session write policy`, `${policies.rows[0]!.n} write policies`);
  }

  // SEC-007: companies are soft-deleted only.
  const before = await db.query<{ n: number }>(
    `select count(*)::int as n from companies where org_id = $1`,
    [ORG_A],
  );
  await asUser(OWNER_A, `delete from companies where org_id = $1`, [ORG_A]);
  const after = await db.query<{ n: number }>(
    `select count(*)::int as n from companies where org_id = $1`,
    [ORG_A],
  );
  if (before.rows[0]!.n > 0 && after.rows[0]!.n === before.rows[0]!.n)
    ok("an owner cannot hard-delete companies");
  else fail("an owner cannot hard-delete companies", `${before.rows[0]!.n} → ${after.rows[0]!.n}`);

  // SEC-005 / SEC-006: definer functions are not callable by sessions.
  for (const fn of [
    "public.merge_duplicate_evidence(uuid, text, uuid)",
    "public.prune_rate_limits(interval)",
    /* 0046: returned any workspace's plan limits to any caller. */
    "public.usage_limit(uuid, text)",
  ]) {
    const r = await db.query<{ can: boolean }>(
      `select has_function_privilege('authenticated', $1, 'execute') as can`,
      [fn],
    );
    if (!r.rows[0]!.can) ok(`authenticated cannot execute ${fn}`);
    else fail(`authenticated cannot execute ${fn}`, "execute granted");
  }

  // 0046: the quota a member can read still resolves its limit through
  // `usage_limit`, now that sessions cannot call that function themselves.
  const quota = await asUser(OWNER_A, `select * from public.check_quota($1, 'opportunities')`, [ORG_A]);
  if (!quota.error && quota.rows.length === 1) ok("a member's check_quota still resolves after 0046");
  else fail("a member's check_quota still resolves after 0046", quota.error ?? "no row");

  // SEC-002: an admin cannot take or strip the owner role.
  const selfPromote = await asUser(
    ADMIN_A,
    `update memberships set role = 'owner' where org_id = $1 and user_id = $2`,
    [ORG_A, ADMIN_A],
  );
  if (selfPromote.error) ok("an admin cannot make themselves owner");
  else fail("an admin cannot make themselves owner", "update accepted");

  const demote = await asUser(
    ADMIN_A,
    `update memberships set role = 'member' where org_id = $1 and user_id = $2`,
    [ORG_A, OWNER_A],
  );
  if (demote.error) ok("an admin cannot demote an owner");
  else fail("an admin cannot demote an owner", "update accepted");

  const ownerInvite = await asUser(
    ADMIN_A,
    `insert into invitations (org_id, email, role) values ($1, 'x-0031@a.test', 'owner')`,
    [ORG_A],
  );
  if (ownerInvite.error) ok("an admin cannot invite an owner");
  else fail("an admin cannot invite an owner", "insert accepted");

  const adminRename = await asUser(
    ADMIN_A,
    `update memberships set role = 'viewer' where org_id = $1 and user_id = $2`,
    [ORG_A, "22222222-2222-2222-2222-222222222222"],
  );
  if (!adminRename.error) ok("an admin can still change a non-owner's role");
  else fail("an admin can still change a non-owner's role", adminRename.error);

  // An owner invitation from an owner can be accepted by its invitee.
  const invited = await asUser(
    OWNER_A,
    `insert into invitations (org_id, email, role) values ($1, 'invitee-0031@a.test', 'owner')
     returning token`,
    [ORG_A],
  );
  const accepted = await asUser(INVITEE, `select * from public.accept_invitation($1)`, [
    invited.rows[0]?.token,
  ]);
  if (accepted.rows[0]?.joined_role === "owner") ok("an owner's owner invitation is accepted");
  else fail("an owner's owner invitation is accepted", accepted.error ?? accepted.rows);

  // SEC-015: accepting a lower invitation keeps the stronger role.
  const lower = await asUser(
    OWNER_A,
    `insert into invitations (org_id, email, role) values ($1, 'owner@a.test', 'member')
     returning token`,
    [ORG_A],
  );
  const kept = await asUser(OWNER_A, `select * from public.accept_invitation($1)`, [
    lower.rows[0]?.token,
  ]);
  if (kept.rows[0]?.joined_role === "owner") ok("accepting a member invite does not demote an owner");
  else fail("accepting a member invite does not demote an owner", kept.error ?? kept.rows);

  // SEC-009: a deleted workspace disappears and stops discovering.
  const DOOMED = "d0d0d0d0-0031-0031-0031-000000000031";
  await db.query(`insert into organizations (id, name, slug) values ($1, 'Doomed', 'doomed-0031')`, [
    DOOMED,
  ]);
  await db.query(`insert into memberships (org_id, user_id, role) values ($1, $2, 'owner')`, [
    DOOMED,
    OWNER_A,
  ]);
  await db.query(
    `insert into discovery_queries (org_id, name, filters, filters_hash, is_enabled, next_run_at)
     values ($1, 'q-0031', '{}'::jsonb, 'h-0031', true, now() - interval '1 minute')`,
    [DOOMED],
  ).catch((e) => fail("seed a discovery query", e));
  const dropped = await asUser(OWNER_A, `select public.delete_organization($1)`, [DOOMED]);
  if (!dropped.error) ok("the owner deletes the workspace");
  else fail("the owner deletes the workspace", dropped.error);

  const seen = await asUser(OWNER_A, `select id from organizations where id = $1`, [DOOMED]);
  if (seen.rows.length === 0) ok("a deleted workspace is invisible to its members");
  else fail("a deleted workspace is invisible to its members", "still visible");

  const q = await db.query<{ is_enabled: boolean }>(
    `select is_enabled from discovery_queries where org_id = $1`,
    [DOOMED],
  );
  if (q.rows.length > 0 && q.rows.every((r) => !r.is_enabled))
    ok("and its discovery queries are disabled");
  else fail("and its discovery queries are disabled", JSON.stringify(q.rows));

  const claimed = await db.query<{ org_id: string }>(
    `select org_id from public.claim_due_discovery_queries(50)`,
  );
  if (!claimed.rows.some((r) => r.org_id === DOOMED)) ok("and the claimer skips it");
  else fail("and the claimer skips it", "claimed");
}

// ── 0032 — evidence keys and provenance ─────────────────────────────────────
// TRUST-001: PostgREST names an on_conflict target as plain columns. The 0020
// index was an expression + partial index, which no plain list can infer, so
// every provider evidence upsert failed. These run the exact statement shape
// the handlers now send.
console.log("\n0032 — evidence keys and provenance");
{
  const ORG_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const SUBJECT = "32323232-0032-0032-0032-000000000032";
  const upsert = (claim: string) =>
    db.query(
      `insert into evidence (org_id, subject_type, subject_id, claim, kind, source_url, field)
       values ($1, 'company', $2, $3, 'fact', 'https://app.apollo.io/x', 'employee_count')
       on conflict (org_id, subject_type, subject_id, field, live_source_key)
       do update set claim = excluded.claim`,
      [ORG_A, SUBJECT, claim],
    );

  try {
    await upsert("180 employees");
    await upsert("190 employees");
    const r = await db.query<{ n: number; claim: string }>(
      `select count(*)::int as n, max(claim) as claim from evidence
        where subject_id = $1 and deleted_at is null`,
      [SUBJECT],
    );
    if (r.rows[0]!.n === 1 && r.rows[0]!.claim === "190 employees")
      ok("a provider evidence upsert updates its row instead of failing");
    else fail("a provider evidence upsert updates its row instead of failing", JSON.stringify(r.rows));
  } catch (e) {
    fail("a provider evidence upsert updates its row instead of failing", e);
  }

  try {
    await db.query(`update evidence set deleted_at = now() where subject_id = $1`, [SUBJECT]);
    await upsert("200 employees");
    const r = await db.query<{ n: number }>(
      `select count(*)::int as n from evidence where subject_id = $1`,
      [SUBJECT],
    );
    if (r.rows[0]!.n === 2) ok("a soft-deleted row never blocks a fresh claim");
    else fail("a soft-deleted row never blocks a fresh claim", `${r.rows[0]!.n} rows`);
  } catch (e) {
    fail("a soft-deleted row never blocks a fresh claim", e);
  }

  // TRUST-004.
  const PERSON = "32323232-0032-0032-0032-0000000000aa";
  await db.query(
    `insert into people (id, org_id, company_id, first_name)
     select $1, $2, id, '0032' from companies where org_id = $2 limit 1`,
    [PERSON, ORG_A],
  );
  await expectReject(
    db,
    "an unknown verification status is refused",
    `insert into contact_points (org_id, person_id, kind, value, verification_status)
     values ($1, $2, 'email', 'x-0032@a.test', 'verified')`,
    [ORG_A, PERSON],
  );

  // FLOW-004 / FLOW-003.
  const cols = await db.query<{ column_name: string }>(
    `select column_name from information_schema.columns
      where (table_name = 'opportunities' and column_name = 'priority_set_by')
         or (table_name = 'companies' and column_name = 'last_enriched_at')`,
  );
  if (cols.rows.length === 2) ok("priority_set_by and last_enriched_at exist");
  else fail("priority_set_by and last_enriched_at exist", JSON.stringify(cols.rows));

  await expectReject(
    db,
    "priority_set_by is system or user",
    `update opportunities set priority_set_by = 'robot'`,
  );
}

// ── 0035 — one outbound message per enrollment step ─────────────────────────
// OUT-002: a run killed between drafting a step and advancing the enrollment
// drafted the step again next time. The index makes that impossible.
console.log("\n0035 — one message per enrollment step");
{
  const index = await db.query<{ indexdef: string }>(
    `select indexdef from pg_indexes where indexname = 'messages_one_per_enrollment_step'`,
  );
  const def = index.rows[0]?.indexdef ?? "";
  if (/UNIQUE/i.test(def) && /enrollment_id, step_id/.test(def) && /outbound/.test(def))
    ok("outbound messages are unique per (enrollment, step)");
  else fail("outbound messages are unique per (enrollment, step)", def || "no index");
}

// ── 0037 — the daily loop ───────────────────────────────────────────────────
// The activity ledger is fed by triggers, so its two promises are tested
// directly: it records what happened, and it can never stop the thing that
// happened from happening.
console.log("\n0037 — the activity ledger and the daily loop");
{
  const A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const OWNER = "11111111-1111-1111-1111-111111111111";
  const VIEWER = "22222222-2222-2222-2222-222222222222";
  const OWNER_B = "33333333-3333-3333-3333-333333333333";
  const OPP = "37373737-0037-0037-0037-000000000001";
  const CO = "37373737-0037-0037-0037-0000000000c0";
  const MSG = "37373737-0037-0037-0037-0000000000a1";
  const MSG2 = "37373737-0037-0037-0037-0000000000a2";

  const asUser = async (user: string, sql: string, params: unknown[] = []) => {
    await db.exec("begin");
    try {
      await db.exec("set local role authenticated");
      await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [user]);
      const r = await db.query<Record<string, unknown>>(sql, params);
      await db.exec("commit");
      return { rows: r.rows, error: null as string | null };
    } catch (e) {
      await db.exec("rollback");
      return { rows: [], error: (e as Error).message };
    }
  };
  const count = async (sql: string, params: unknown[] = []) =>
    Number((await db.query<{ n: number }>(sql, params)).rows[0]?.n ?? 0);

  for (const t of ["activities", "attention_snoozes"]) {
    const r = await db.query<{ on: boolean }>(
      `select relrowsecurity as on from pg_class where relname = $1`,
      [t],
    );
    if (r.rows[0]?.on) ok(`RLS is on for ${t}`);
    else fail(`RLS is on for ${t}`, "off");
  }

  await db.query(
    `insert into companies (id, org_id, canonical_domain, name) values ($1, $2, 'ledger-0037.test', 'Ledger Co')`,
    [CO, A],
  );
  await db.query(
    `insert into opportunities (id, org_id, company_id, priority, priority_reason, first_seen_at)
     values ($1, $2, $3, 'warm', 'Hiring for the problem.', now() - interval '3 days')`,
    [OPP, A, CO],
  );
  if (
    (await count(
      `select count(*)::int as n from activities where opportunity_id = $1 and kind = 'discovered'`,
      [OPP],
    )) === 1
  )
    ok("a new opportunity records that it was found");
  else fail("a new opportunity records that it was found", "no row");

  // A draft becomes history only when it is sent.
  await db.query(
    `insert into messages (id, org_id, opportunity_id, direction, subject, body_text, ai_generated, to_email)
     values ($1, $2, $3, 'outbound', 'Hello', 'Body', true, 'buyer@alphio.ai')`,
    [MSG, A, OPP],
  );
  if (
    (await count(`select count(*)::int as n from activities where ref_id = $1`, [MSG])) === 0
  )
    ok("an unsent draft is not history");
  else fail("an unsent draft is not history", "projected");

  await db.query(
    `update messages set sent_at = now(), provider_message_id = 'p-1' where id = $1`,
    [MSG],
  );
  const sent = await db.query<{ kind: string; summary: string }>(
    `select kind, summary from activities where ref_id = $1`,
    [MSG],
  );
  if (sent.rows.length === 1 && sent.rows[0]!.kind === "email_sent")
    ok("sending it records an email_sent activity");
  else fail("sending it records an email_sent activity", JSON.stringify(sent.rows));
  if (!/Hello|Body/.test(sent.rows[0]?.summary ?? ""))
    ok("and the ledger copies no subject or body");
  else fail("and the ledger copies no subject or body", sent.rows[0]?.summary);

  // The promise that matters most: a broken projection cannot stop a send.
  await db.exec(`alter table activities add constraint boom_0037 check (false) not valid`);
  await db.query(
    `insert into messages (id, org_id, opportunity_id, direction, subject, body_text, ai_generated, to_email)
     values ($1, $2, $3, 'outbound', 'Second', 'Body', true, 'buyer@alphio.ai')`,
    [MSG2, A, OPP],
  );
  try {
    await db.query(
      `update messages set sent_at = now(), provider_message_id = 'p-2' where id = $1`,
      [MSG2],
    );
    const r = await db.query<{ sent_at: string | null }>(
      `select sent_at from messages where id = $1`,
      [MSG2],
    );
    if (r.rows[0]?.sent_at) ok("a failing projection does not abort the send it describes");
    else fail("a failing projection does not abort the send it describes", "sent_at not stored");
  } catch (e) {
    fail("a failing projection does not abort the send it describes", e);
  }
  await db.exec(`alter table activities drop constraint boom_0037`);

  // ...and the backfill repairs the gap, idempotently.
  await db.query(`select public.backfill_activities($1)`, [A]);
  const afterFirst = await count(`select count(*)::int as n from activities where org_id = $1`, [A]);
  await db.query(`select public.backfill_activities($1)`, [A]);
  const afterSecond = await count(`select count(*)::int as n from activities where org_id = $1`, [A]);
  if (
    (await count(`select count(*)::int as n from activities where ref_id = $1`, [MSG2])) === 1
  )
    ok("the backfill repairs a gap the failing projection left");
  else fail("the backfill repairs a gap the failing projection left", "still missing");
  if (afterFirst === afterSecond) ok("running the backfill twice adds nothing");
  else fail("running the backfill twice adds nothing", `${afterFirst} → ${afterSecond}`);

  // Bands: the engine's moves are history; a rescore inside a band is not.
  const bands = () =>
    count(
      `select count(*)::int as n from activities where opportunity_id = $1 and kind = 'priority_changed'`,
      [OPP],
    );
  const b0 = await bands();
  await db.query(`update opportunities set priority = 'warm' where id = $1`, [OPP]);
  if ((await bands()) === b0) ok("a rescore that keeps the band records nothing");
  else fail("a rescore that keeps the band records nothing", "recorded");
  await db.query(`update opportunities set priority = 'hot' where id = $1`, [OPP]);
  if ((await bands()) === b0 + 1) ok("the engine moving the band is recorded");
  else fail("the engine moving the band is recorded", "missing");

  // Stage changes carry their actor.
  const moved = await asUser(
    OWNER,
    `update opportunities set status = 'contacted' where id = $1 returning id`,
    [OPP],
  );
  const stage = await db.query<{ actor_type: string; actor_id: string | null }>(
    `select actor_type, actor_id from activities
      where opportunity_id = $1 and kind = 'stage_changed' order by created_at desc limit 1`,
    [OPP],
  );
  if (!moved.error && stage.rows[0]?.actor_type === "user" && stage.rows[0]?.actor_id === OWNER)
    ok("a person's stage change is recorded as theirs");
  else fail("a person's stage change is recorded as theirs", moved.error ?? JSON.stringify(stage.rows));

  // What a session may write.
  const forged = await asUser(
    OWNER,
    `insert into activities (org_id, opportunity_id, kind, channel, direction, actor_type, actor_id,
       occurred_at, summary, origin)
     values ($1, $2, 'email_sent', 'email', 'outbound', 'user', $3, now(), 'Email sent', 'manual')`,
    [A, OPP, OWNER],
  );
  if (forged.error) ok("a session cannot forge a system activity");
  else fail("a session cannot forge a system activity", "insert accepted");

  const asSomeoneElse = await asUser(
    OWNER,
    `insert into activities (org_id, opportunity_id, kind, channel, direction, actor_type, actor_id,
       occurred_at, summary, origin)
     values ($1, $2, 'note', 'other', 'internal', 'user', $3, now(), 'A note', 'manual')`,
    [A, OPP, VIEWER],
  );
  if (asSomeoneElse.error) ok("a session cannot log an activity as somebody else");
  else fail("a session cannot log an activity as somebody else", "insert accepted");

  const note = await asUser(
    OWNER,
    `insert into activities (org_id, opportunity_id, kind, channel, direction, actor_type, actor_id,
       occurred_at, summary, body, origin)
     values ($1, $2, 'message', 'linkedin', 'outbound', 'user', $3, now(),
       'LinkedIn message', 'Asked about their custody setup.', 'manual') returning id`,
    [A, OPP, OWNER],
  );
  if (!note.error) ok("a member logs a LinkedIn message as themselves");
  else fail("a member logs a LinkedIn message as themselves", note.error);

  const viewerNote = await asUser(
    VIEWER,
    `insert into activities (org_id, opportunity_id, kind, channel, direction, actor_type, actor_id,
       occurred_at, summary, origin)
     values ($1, $2, 'note', 'other', 'internal', 'user', $3, now(), 'Viewer note', 'manual')`,
    [A, OPP, VIEWER],
  );
  if (viewerNote.error) ok("a viewer cannot log activity");
  else fail("a viewer cannot log activity", "insert accepted");

  const hardDelete = await asUser(OWNER, `delete from activities where org_id = $1 returning id`, [A]);
  if (hardDelete.rows.length === 0) ok("the ledger cannot be hard-deleted by a session");
  else fail("the ledger cannot be hard-deleted by a session", `${hardDelete.rows.length} rows`);

  const otherTenant = await asUser(
    OWNER_B,
    `select count(*)::int as n from activities where org_id = $1`,
    [A],
  );
  if (Number(otherTenant.rows[0]?.n ?? -1) === 0) ok("another tenant reads none of it");
  else fail("another tenant reads none of it", JSON.stringify(otherTenant.rows));

  // Snoozes are personal.
  await asUser(
    OWNER,
    `insert into attention_snoozes (org_id, user_id, item_key, snoozed_until)
     values ($1, $2, 'quiet:x', now() + interval '1 day')`,
    [A, OWNER],
  );
  const viewerSees = await asUser(
    VIEWER,
    `select count(*)::int as n from attention_snoozes where org_id = $1`,
    [A],
  );
  if (Number(viewerSees.rows[0]?.n ?? -1) === 0) ok("nobody reads another person's snoozes");
  else fail("nobody reads another person's snoozes", JSON.stringify(viewerSees.rows));
  const snoozeForOther = await asUser(
    VIEWER,
    `insert into attention_snoozes (org_id, user_id, item_key, snoozed_until)
     values ($1, $2, 'quiet:y', now() + interval '1 day')`,
    [A, OWNER],
  );
  if (snoozeForOther.error) ok("nor writes them");
  else fail("nor writes them", "insert accepted");

  // Outcomes with a why become history; reasons are bounded.
  await db.query(
    `insert into outcomes (org_id, opportunity_id, kind, reason_category, reason, recorded_by)
     values ($1, $2, 'disqualified', 'not_a_fit', 'They build in-house.', $3)`,
    [A, OPP, OWNER],
  );
  if (
    (await count(
      `select count(*)::int as n from activities where opportunity_id = $1 and kind = 'outcome_recorded'`,
      [OPP],
    )) === 1
  )
    ok("a disqualification with its reason is on the timeline");
  else fail("a disqualification with its reason is on the timeline", "missing");
  await expectReject(
    db,
    "an unknown loss reason category is refused",
    `insert into outcomes (org_id, opportunity_id, kind, reason_category) values ($1, $2, 'lost', 'vibes')`,
    [A, OPP],
  );

  // Erasure reaches hand-written activity about the person.
  const PERSON = "37373737-0037-0037-0037-0000000000b1";
  await db.query(
    `insert into people (id, org_id, company_id, first_name) values ($1, $2, $3, 'Erin')`,
    [PERSON, A, CO],
  );
  await db.query(
    `insert into contact_points (org_id, person_id, kind, value) values ($1, $2, 'email', 'erin-0037@alphio.ai')`,
    [A, PERSON],
  );
  await db.query(
    `insert into activities (org_id, opportunity_id, person_id, kind, channel, direction, actor_type,
       actor_id, occurred_at, summary, body, origin)
     values ($1, $2, $3, 'call', 'phone', 'outbound', 'user', $4, now(), 'Call with Erin',
       'Erin said budget is frozen until Q3.', 'manual')`,
    [A, OPP, PERSON, OWNER],
  );
  await db.query(
    `insert into messages (org_id, opportunity_id, direction, subject, body_text, from_email)
     values ($1, $2, 'inbound', 'Re: Hello', 'Not now, thanks.', 'erin-0037@alphio.ai')`,
    [A, OPP],
  );
  await db.query(`select public.erase_contact($1, 'erin-0037@alphio.ai', null)`, [A]);
  const erased = await db.query<{ body: string | null; summary: string }>(
    `select body, summary from activities where person_id = $1`,
    [PERSON],
  );
  if (erased.rows.length > 0 && erased.rows.every((r) => r.body === null && r.summary === "[erased]"))
    ok("erasing a contact redacts what people wrote about them");
  else fail("erasing a contact redacts what people wrote about them", JSON.stringify(erased.rows));
  if (
    (await count(
      `select count(*)::int as n from messages where org_id = $1 and body_text = 'Not now, thanks.'`,
      [A],
    )) === 0
  )
    ok("and their own replies, not only mail sent to them");
  else fail("and their own replies, not only mail sent to them", "inbound body survived");

  // Draft review columns exist, and a rejected draft becomes history.
  await db.query(
    `update messages set rejected_at = now(), rejected_by = $2, rejection_reason = 'Wrong angle',
       deleted_at = now() where id = (
         select id from messages where org_id = $1 and direction = 'outbound'
         and sent_at is null limit 1)`,
    [A, OWNER],
  );
  await db.query(
    `insert into messages (org_id, opportunity_id, direction, subject, body_text, ai_generated, to_email)
     values ($1, $2, 'outbound', 'Draft', 'Draft body', true, 'buyer@alphio.ai')`,
    [A, OPP],
  );
  await db.query(
    `update messages set rejected_at = now(), rejected_by = $2, rejection_reason = 'Too pushy',
       deleted_at = now() where org_id = $1 and subject = 'Draft'`,
    [A, OWNER],
  );
  if (
    (await count(
      `select count(*)::int as n from activities where opportunity_id = $1 and kind = 'draft_rejected'`,
      [OPP],
    )) >= 1
  )
    ok("a rejected draft is recorded, with who rejected it");
  else fail("a rejected draft is recorded, with who rejected it", "missing");

  const callable = await db.query<{ can: boolean }>(
    `select has_function_privilege('authenticated', 'public.backfill_activities(uuid)', 'execute') as can`,
  );
  if (!callable.rows[0]!.can) ok("sessions cannot run the backfill");
  else fail("sessions cannot run the backfill", "execute granted");
}


// ── 0038 — paid discovery respects the backlog cap ──────────────────────────
console.log("\n0038 — discovery pauses for a saturated backlog, without losing its turn");
{
  const ORG = "38383838-0038-0038-0038-000000000038";
  await db.query(
    `insert into organizations (id, name, slug, settings) values ($1, 'Backlog Co', 'backlog-0038', '{"engine":{"backlogCap":1}}'::jsonb)`,
    [ORG],
  );
  await db.query(
    `insert into companies (id, org_id, canonical_domain, name)
     values ('38383838-0038-0038-0038-0000000000c1', $1, 'full-0038.test', 'Full')`,
    [ORG],
  );
  await db.query(
    `insert into opportunities (org_id, company_id, priority, priority_reason, status)
     values ($1, '38383838-0038-0038-0038-0000000000c1', 'warm', 'Waiting for review.', 'qualified')`,
    [ORG],
  );
  await db.query(
    `insert into discovery_queries (org_id, name, filters, filters_hash, is_enabled, next_run_at)
     values ($1, 'q-0038', '{}'::jsonb, 'h-0038', true, now() - interval '1 minute')`,
    [ORG],
  );

  const first = await db.query<{ org_id: string }>(`select org_id from public.claim_due_discovery_queries(100)`);
  if (!first.rows.some((r) => r.org_id === ORG)) ok("a workspace at its backlog cap is not claimed");
  else fail("a workspace at its backlog cap is not claimed", "claimed");

  const still = await db.query<{ due: boolean }>(
    `select next_run_at <= now() as due from discovery_queries where org_id = $1`,
    [ORG],
  );
  if (still.rows[0]?.due) ok("and its query stays due rather than losing a turn");
  else fail("and its query stays due rather than losing a turn", "advanced");

  await db.query(`update organizations set settings = '{"engine":{"backlogCap":0}}'::jsonb where id = $1`, [ORG]);
  const second = await db.query<{ org_id: string }>(`select org_id from public.claim_due_discovery_queries(100)`);
  if (second.rows.some((r) => r.org_id === ORG)) ok("with the cap lifted (0 = unlimited) it is claimed");
  else fail("with the cap lifted (0 = unlimited) it is claimed", "not claimed");
}

// ── 0043 — learning extended to competitors and demand ─────────────────────
console.log("\n0043 — findings about competitors and demand cite them by id");
{
  const ORG = "43434343-0043-0043-0043-000000000043";
  const RUN = "43434343-0043-0043-0043-0000000000a1";
  await db.query(`insert into organizations (id, name, slug) values ($1, 'Learn Co', 'learn-0043')`, [ORG]);
  await db.query(
    `insert into learning_runs (id, org_id, window_start, window_end)
     values ($1, $2, now() - interval '90 days', now())`,
    [RUN, ORG],
  );
  for (const kind of ["competitive_positioning", "product_demand"]) {
    await expectAccept(
      db,
      `a ${kind} finding is accepted, with its citations`,
      `insert into learning_findings
         (org_id, run_id, kind, headline, detail, recommendation, cited_competitor_ids, cited_theme_ids)
       values ($1, $2, $3, 'h', 'd', 'r',
               array['43434343-0043-0043-0043-0000000000c1']::uuid[],
               array['43434343-0043-0043-0043-0000000000d1']::uuid[])`,
      [ORG, RUN, kind],
    );
  }
  await expectAccept(
    db,
    "the kinds from 0018 are still accepted",
    `insert into learning_findings (org_id, run_id, kind, headline, detail, recommendation)
     values ($1, $2, 'outreach_angle', 'h', 'd', 'r')`,
    [ORG, RUN],
  );
  const defaults = await db.query<{ c: string[]; t: string[] }>(
    `select cited_competitor_ids as c, cited_theme_ids as t from learning_findings
      where org_id = $1 and kind = 'outreach_angle'`,
    [ORG],
  );
  const row = defaults.rows[0];
  if (row && row.c.length === 0 && row.t.length === 0) ok("and an older finding cites no competitor or theme");
  else fail("and an older finding cites no competitor or theme", JSON.stringify(row));
}

// ── 0044 — personal memories are private; signals belong to their person ────
console.log("\n0044 — a personal memory is private to the person it is about");
{
  const ORG = "44444444-0044-0044-0044-000000000044";
  const ALICE = "44444444-0044-0044-0044-0000000000a1"; // owner
  const BOB = "44444444-0044-0044-0044-0000000000b1"; // member
  const VIC = "44444444-0044-0044-0044-0000000000c1"; // viewer
  await db.query(
    `insert into auth.users (id, email) values ($1, 'alice@0044.test'), ($2, 'bob@0044.test'), ($3, 'vic@0044.test')`,
    [ALICE, BOB, VIC],
  );
  await db.query(`insert into organizations (id, name, slug) values ($1, 'Personal Co', 'personal-0044')`, [ORG]);
  await db.query(
    `insert into memberships (org_id, user_id, role) values ($1, $2, 'owner'), ($1, $3, 'member'), ($1, $4, 'viewer')`,
    [ORG, ALICE, BOB, VIC],
  );
  await db.query(
    `insert into memories (id, org_id, scope, scope_id, content, origin)
     values ('44444444-0044-0044-0044-00000000e001', $1, 'user', $2, 'Bob keeps emails short', 'learned'),
            ('44444444-0044-0044-0044-00000000e002', $1, 'organization', null, 'House style', 'stated')`,
    [ORG, BOB],
  );

  const as = async (uid: string) => {
    await db.exec("set local role authenticated");
    await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [uid]);
  };

  await db.exec("begin");
  await as(BOB);
  const own = await db.query<{ n: number }>(`select count(*)::int as n from memories where org_id = $1`, [ORG]);
  if (own.rows[0]!.n === 2) ok("the subject sees their personal memory and the workspace's");
  else fail("the subject sees their personal memory and the workspace's", `saw ${own.rows[0]!.n}`);
  await db.exec("rollback");

  await db.exec("begin");
  await as(ALICE);
  const admin = await db.query<{ n: number }>(
    `select count(*)::int as n from memories where org_id = $1 and scope = 'user'`,
    [ORG],
  );
  if (admin.rows[0]!.n === 0) ok("an owner cannot read a colleague's unshared personal memory");
  else fail("an owner cannot read a colleague's unshared personal memory", `saw ${admin.rows[0]!.n}`);
  const edited = await db.query(
    `update memories set content = 'changed' where id = '44444444-0044-0044-0044-00000000e001' returning id`,
  );
  if (edited.rows.length === 0) ok("nor edit it");
  else fail("nor edit it", "updated");
  await expectRejectTx(
    db,
    "nor write a personal memory for somebody else",
    `insert into memories (org_id, scope, scope_id, content) values ($1, 'user', $2, 'x')`,
    [ORG, BOB],
  );
  await db.exec("rollback");

  await db.exec("begin");
  await as(VIC);
  await expectAccept(
    db,
    "a viewer may keep personal preferences",
    `insert into memories (org_id, scope, scope_id, content) values ($1, 'user', $2, 'Bullets please')`,
    [ORG, VIC],
  );
  await expectRejectTx(
    db,
    "but still cannot write the workspace's",
    `insert into memories (org_id, scope, scope_id, content) values ($1, 'organization', null, 'x')`,
    [ORG],
  );
  await db.exec("rollback");

  await db.query(`update memories set shared_at = now() where id = '44444444-0044-0044-0044-00000000e001'`);
  await db.exec("begin");
  await as(ALICE);
  const shared = await db.query<{ n: number }>(
    `select count(*)::int as n from memories where org_id = $1 and scope = 'user'`,
    [ORG],
  );
  if (shared.rows[0]!.n === 1) ok("once shared, an admin can read it to promote it");
  else fail("once shared, an admin can read it to promote it", `saw ${shared.rows[0]!.n}`);
  await db.exec("rollback");

  await db.exec("begin");
  await as(VIC);
  const viewerShared = await db.query<{ n: number }>(
    `select count(*)::int as n from memories where org_id = $1 and scope = 'user' and scope_id <> $2`,
    [ORG, VIC],
  );
  if (viewerShared.rows[0]!.n === 0) ok("and a non-admin still cannot");
  else fail("and a non-admin still cannot", `saw ${viewerShared.rows[0]!.n}`);
  await db.exec("rollback");

  await expectReject(
    db,
    "only a personal memory can be shared",
    `update memories set shared_at = now() where id = '44444444-0044-0044-0044-00000000e002'`,
  );

  await db.query(
    `insert into preference_signals (id, org_id, user_id, kind, features)
     values ('44444444-0044-0044-0044-00000000f001', $1, $2, 'draft_edited', '{"wordDelta":-30}'::jsonb)`,
    [ORG, BOB],
  );
  await db.exec("begin");
  await as(ALICE);
  const theirs = await db.query<{ n: number }>(`select count(*)::int as n from preference_signals where org_id = $1`, [ORG]);
  if (theirs.rows[0]!.n === 0) ok("a colleague's signals are invisible, even to an owner");
  else fail("a colleague's signals are invisible, even to an owner", `saw ${theirs.rows[0]!.n}`);
  await expectRejectTx(
    db,
    "and nobody can record a signal for someone else",
    `insert into preference_signals (org_id, user_id, kind) values ($1, $2, 'draft_edited')`,
    [ORG, BOB],
  );
  const exported = await db.query<{ e: { memories: unknown[] } }>(`select public.export_organization($1) as e`, [ORG]);
  const leaked = (exported.rows[0]!.e.memories as { scope: string }[]).filter((m) => m.scope === "user");
  if (leaked.length === 0) ok("the workspace export leaves colleagues' personal memories out");
  else fail("the workspace export leaves colleagues' personal memories out", `${leaked.length} included`);
  await db.exec("rollback");

  await db.exec("begin");
  await as(BOB);
  const mine = await db.query<{ e: { memories: unknown[]; signals: unknown[] } }>(
    `select public.export_my_learning($1) as e`,
    [ORG],
  );
  const e = mine.rows[0]!.e;
  if (e.memories.length === 1 && e.signals.length === 1) ok("a person can export what Huntloop learned about them");
  else fail("a person can export what Huntloop learned about them", JSON.stringify(e).slice(0, 120));
  await expectRejectTx(
    db,
    "a question key is a dotted identifier",
    `insert into user_questions (org_id, user_id, question_key) values ($1, $2, 'Not A Key')`,
    [ORG, BOB],
  );
  await expectAccept(
    db,
    "and a person can be asked one",
    `insert into user_questions (org_id, user_id, question_key) values ($1, $2, 'outreach.signoff')`,
    [ORG, BOB],
  );
  await db.exec("rollback");

  const derived = await db.query<{ origin: string }>(
    `insert into memories (org_id, scope, content, source) values ($1, 'organization', 'Concluded', 'derived') returning origin`,
    [ORG],
  );
  if (derived.rows[0]?.origin === "learned") ok("a memory the product concluded is marked learned");
  else fail("a memory the product concluded is marked learned", derived.rows[0]?.origin);

  await expectReject(
    db,
    "a third personal goal is refused",
    `update profiles set goals = array['discover','qualify','learn'] where id = $1`,
    [BOB],
  );
  await expectReject(
    db,
    "and a workspace kind outside the set",
    `update organizations set workspace_kind = 'family' where id = $1`,
    [ORG],
  );

  /* 0045: several assistant conversations per person, still theirs alone. */
  await db.exec("begin");
  await as(BOB);
  await expectAccept(
    db,
    "a person can keep several assistant conversations",
    `insert into conversations (org_id, user_id, scope, title)
     values ($1, $2, 'workspace', 'Pipeline'), ($1, $2, 'workspace', 'Pricing')`,
    [ORG, BOB],
  );
  await as(ALICE);
  const others = await db.query<{ n: number }>(
    `select count(*)::int as n from conversations where org_id = $1 and user_id = $2`,
    [ORG, BOB],
  );
  if (others.rows[0]!.n === 0) ok("and a colleague still cannot read them");
  else fail("and a colleague still cannot read them", `saw ${others.rows[0]!.n}`);
  await db.exec("rollback");
}

console.log(
  `\n${failures === 0 ? "PASS" : "FAIL"} — ${checks - failures}/${checks} checks passed\n`,
);
process.exit(failures === 0 ? 0 : 1);

/**
 * Line endings, flattened.
 *
 * The paste and the migrations are separate files in a checkout that may be
 * CRLF or LF for reasons that have nothing to do with whether the SQL matches.
 * Comparing raw bytes would fail on a difference no database can observe.
 */
function normalise(sql: string): string {
  return sql.split("\r\n").join("\n");
}
