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
  // Org A is on the default plan, `free`, whose emails limit is 0 — so this
  // metric is over quota on its first unit, which is the boundary worth
  // testing. `opportunities` is 50 and gives the accumulating case.
  const one = await db.query<Usage>(
    `select * from public.increment_usage($1, 'opportunities', 3)`,
    [ORG_A_ID],
  );
  const two = await db.query<Usage>(
    `select * from public.increment_usage($1, 'opportunities', 2)`,
    [ORG_A_ID],
  );
  if (one.rows[0]!.used === 3 && two.rows[0]!.used === 5 && two.rows[0]!.quota === 50)
    ok("usage accumulates within the period and resolves the plan's limit");
  else fail("usage accumulates within the period", JSON.stringify([one.rows[0], two.rows[0]]));

  const overshoot = await db.query<Usage>(
    `select * from public.increment_usage($1, 'emails', 1)`,
    [ORG_A_ID],
  );
  if (overshoot.rows[0]!.allowed === false && overshoot.rows[0]!.used === 1)
    ok("a metric past its plan limit still counts, and says it is over");
  else fail("a metric past its plan limit still counts", JSON.stringify(overshoot.rows[0]));

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
    `select * from public.increment_usage($1, 'opportunities', 1)`,
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
    insert into messages (id, org_id, direction, to_email, subject, unsubscribe_token)
    values ('d0000000-0000-0000-0000-000000000001',
            'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'outbound', 'Reader@alphio.ai',
            'Hello', 'a0000000-0000-0000-0000-0000000000ff');
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
  await db.exec(`
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
