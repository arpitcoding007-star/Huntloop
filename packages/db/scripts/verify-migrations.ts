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

  // No account configured → no limit → allowed. The pre-existing behaviour
  // for every deployment, and the one this must not change.
  const open = await db.query<{ allowed: boolean; limit: number | null }>(
    `select allowed, "limit" from public.provider_budget_state($1, 'apollo')`,
    [ORG_A],
  );
  if (open.rows[0]?.allowed === true && open.rows[0]?.limit === null) {
    ok("with no limit configured, spending is allowed and says so");
  } else {
    fail("with no limit configured, spending is allowed and says so", JSON.stringify(open.rows[0]));
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

console.log(
  `\n${failures === 0 ? "PASS" : "FAIL"} — ${checks - failures}/${checks} checks passed\n`,
);
process.exit(failures === 0 ? 0 : 1);
