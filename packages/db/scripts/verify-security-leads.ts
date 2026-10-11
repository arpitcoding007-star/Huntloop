/**
 * Regression suite for the database leads from the 2026-10-11 security audit
 * (run-1, `quick` profile; report in ~/security-audit-skill/huntloop/run-1).
 *
 * Leads 1–7 were each traced from source by a hunter and kept by an
 * independent verifier, then reproduced here on a fresh copy of the
 * migrations. Migration `0047` closes them, and with leads 11 and 12 (closed
 * in the same migration) every case below now asserts the fixed behaviour.
 * Each one also asserts that the ordinary path still works, so a fix that
 * simply refused everything would fail too.
 *
 *   npm run test:security-leads --workspace @huntloop/db   (part of `npm test`)
 *
 * Same machinery as verify-migrations.ts: PGlite, the auth stubs, and the
 * non-superuser `authenticated` and `anon` roles, because RLS does not apply
 * to the superuser PGlite connects as. Dummy data only; nothing leaves the
 * process.
 */
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
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
console.log(`Applied ${files.length} migrations`);

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

// ── Fixtures ───────────────────────────────────────────────────────────────
const ORG_A = "aaaaaaaa-0000-0000-0000-00000000000a";
const ORG_B = "bbbbbbbb-0000-0000-0000-00000000000b";
const OWNER = "a0000000-0000-0000-0000-000000000001";
const OWNER2 = "a0000000-0000-0000-0000-000000000002";
const ADMIN = "a0000000-0000-0000-0000-000000000003";
const MEMBER = "a0000000-0000-0000-0000-000000000004";
const MEMBER2 = "a0000000-0000-0000-0000-000000000005";
const VIEWER = "a0000000-0000-0000-0000-000000000006";
const OWNER_B = "b0000000-0000-0000-0000-000000000001";
const COMPANY_A = "ca000000-0000-0000-0000-00000000000a";
const COMPANY_B = "cb000000-0000-0000-0000-00000000000b";
const OPP_A = "0a000000-0000-0000-0000-00000000000a";
const OPP_B = "0b000000-0000-0000-0000-00000000000b";

await db.exec(`
  insert into auth.users (id, email) values
    ('${OWNER}',   'owner@a.test'),
    ('${OWNER2}',  'owner2@a.test'),
    ('${ADMIN}',   'admin@a.test'),
    ('${MEMBER}',  'member@a.test'),
    ('${MEMBER2}', 'member2@a.test'),
    ('${VIEWER}',  'viewer@a.test'),
    ('${OWNER_B}', 'owner@b.test');

  insert into organizations (id, name, slug, primary_domain) values
    ('${ORG_A}', 'Org A', 'org-a', 'a.test'),
    ('${ORG_B}', 'Org B', 'org-b', 'b.test');

  insert into memberships (org_id, user_id, role) values
    ('${ORG_A}', '${OWNER}',   'owner'),
    ('${ORG_A}', '${OWNER2}',  'owner'),
    ('${ORG_A}', '${ADMIN}',   'admin'),
    ('${ORG_A}', '${MEMBER}',  'member'),
    ('${ORG_A}', '${MEMBER2}', 'member'),
    ('${ORG_A}', '${VIEWER}',  'viewer'),
    ('${ORG_B}', '${OWNER_B}', 'owner');

  insert into companies (id, org_id, canonical_domain, name) values
    ('${COMPANY_A}', '${ORG_A}', 'alphio.test',    'Alphio'),
    ('${COMPANY_B}', '${ORG_B}', 'northwind.test', 'Northwind');

  insert into opportunities (id, org_id, company_id, priority, priority_reason, outreach_angle) values
    ('${OPP_A}', '${ORG_A}', '${COMPANY_A}', 'hot',  'Funding trigger.', 'Angle A'),
    ('${OPP_B}', '${ORG_B}', '${COMPANY_B}', 'warm', 'Hiring signal.',   'SECRET-ANGLE-B');
`);

// ── Harness ────────────────────────────────────────────────────────────────
type Verdict = { lead: string; holds: boolean | null; detail: string };
const verdicts: Verdict[] = [];

/** Become `uid` the way PostgREST does: a role switch plus the JWT subject. */
async function as(uid: string | null, role: "authenticated" | "anon" = "authenticated") {
  await db.exec(`set local role ${role}`);
  await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [uid ?? ""]);
}

/** Back to the superuser, to observe what actually happened. */
async function asSuperuser() {
  await db.exec("reset role");
  await db.query(`select set_config('request.jwt.claim.sub', '', true)`);
}

/** Runs one statement; a refusal is an answer, not a crash. */
async function attempt<T>(sql: string, params: unknown[] = []) {
  await db.exec("savepoint attempt");
  try {
    const r = await db.query<T>(sql, params);
    await db.exec("release savepoint attempt");
    return { ok: true as const, rows: r.rows, affected: r.affectedRows ?? 0 };
  } catch (e) {
    await db.exec("rollback to savepoint attempt");
    return { ok: false as const, error: String(e).split("\n")[0] };
  }
}

/** One case, in its own rolled-back transaction. */
async function lead(name: string, body: () => Promise<{ holds: boolean; detail: string }>) {
  console.log(`\n${name}`);
  await db.exec("begin");
  try {
    const v = await body();
    verdicts.push({ lead: name, ...v });
    console.log(`  ${v.holds ? "✓ holds" : "✗ REGRESSED"} — ${v.detail}`);
  } catch (e) {
    verdicts.push({ lead: name, holds: null, detail: String(e) });
    console.log(`  ? harness error — ${String(e).split("\n")[0]}`);
  } finally {
    await db.exec("rollback");
  }
}

const one = async <T>(sql: string, params: unknown[] = []) =>
  (await db.query<T>(sql, params)).rows[0];

const said = (r: { ok: boolean; error?: string; affected?: number }) =>
  r.ok ? `accepted (${r.affected ?? 0} row)` : `refused (${r.error})`;

// ── 1. organizations: plan_id and deleted_at are not tenant-writable ───────
await lead("1. An admin cannot rewrite organizations.plan_id / deleted_at", async () => {
  await db.query(
    `insert into usage_counters (org_id, period, metric, used)
     values ($1, to_char(now() at time zone 'utc', 'YYYY-MM'), 'ai_runs', 1000)`,
    [ORG_A],
  );

  await as(ADMIN);
  const nullPlan = await attempt(`update organizations set plan_id = null where id = $1`, [ORG_A]);
  const scale = await attempt(`update organizations set plan_id = 'scale' where id = $1`, [ORG_A]);
  const trial = await attempt(`update organizations set trial_ends_at = now() + interval '1 year' where id = $1`, [ORG_A]);
  const quota = await one<{ allowed: boolean }>(`select allowed from check_quota($1, 'ai_runs')`, [ORG_A]);
  const rpc = await attempt(`select public.delete_organization($1)`, [ORG_A]);
  // PostgREST's default PATCH is return=minimal: no RETURNING, so only the
  // UPDATE policy and triggers apply.
  const del = await attempt(`update organizations set deleted_at = now() where id = $1`, [ORG_A]);
  // What admins are meant to edit still saves.
  const rename = await attempt(`update organizations set name = 'Org A renamed' where id = $1`, [ORG_A]);

  // The owner-only path still works, through the function.
  await as(OWNER2);
  const ownerDelete = await attempt(`select public.delete_organization($1)`, [ORG_A]);

  await asSuperuser();
  const row = await one<{ plan_id: string | null; name: string; deleted_at: string | null }>(
    `select plan_id, name, deleted_at from organizations where id = $1`,
    [ORG_A],
  );
  return {
    holds:
      !nullPlan.ok && !scale.ok && !trial.ok && !del.ok && quota?.allowed === false &&
      !rpc.ok && rename.ok && rename.affected === 1 && ownerDelete.ok &&
      row?.plan_id === "free" && row.name === "Org A renamed" && row.deleted_at != null,
    detail:
      `plan_id=null ${said(nullPlan)}; plan_id='scale' ${said(scale)}; trial ${said(trial)}; quota still blocked=${quota?.allowed === false}; ` +
      `admin delete_organization ${rpc.ok ? "accepted" : "refused"}; direct deleted_at ${said(del)}; ` +
      `rename ${said(rename)}; owner delete_organization ${said(ownerDelete)}`,
  };
});

// ── 2. increment_usage: nobody can exhaust the org's quota ─────────────────
await lead("2. Nobody can exhaust the org's quota through increment_usage", async () => {
  await as(VIEWER);
  const viewer = await attempt(`select allowed from public.increment_usage($1, 'ai_runs', 1)`, [ORG_A]);

  await as(MEMBER);
  const huge = await attempt(`select * from public.increment_usage($1, 'ai_runs', 1000000000000)`, [ORG_A]);
  const emails = await attempt(`select * from public.increment_usage($1, 'emails', 1)`, [ORG_A]);
  const negative = await attempt(`select * from public.increment_usage($1, 'ai_runs', -5)`, [ORG_A]);
  // The one thing a session meters: a delivered AI run (countAiRun).
  const run = await attempt<{ used: number }>(`select used from public.increment_usage($1, 'ai_runs', 1)`, [ORG_A]);

  await as(OWNER);
  const owner = await one<{ allowed: boolean; used: number }>(`select allowed, used from check_quota($1, 'ai_runs')`, [ORG_A]);

  return {
    holds: !viewer.ok && !huge.ok && !emails.ok && !negative.ok && run.ok && owner?.allowed === true && Number(owner.used) === 1,
    detail:
      `viewer ${said(viewer)}; member 1e12 ${said(huge)}; member 'emails' ${said(emails)}; negative ${said(negative)}; ` +
      `member one run ${said(run)} → owner sees used=${owner?.used} allowed=${owner?.allowed}`,
  };
});

// ── 3. References stay inside the tenant ───────────────────────────────────
// OrgScope (packages/jobs/src/scope.ts) filters only the root table, and a
// PostgREST embed under the service role is a join with no RLS. So the
// database must refuse to let a member plant the reference in the first place.
await lead("3. A member cannot plant references into another workspace", async () => {
  await as(MEMBER);
  const opp = await attempt(
    `insert into opportunities (org_id, company_id, priority, priority_reason)
     values ($1, $2, 'hot', 'planted')`,
    [ORG_A, COMPANY_B],
  );
  const campaign = await one<{ id: string }>(
    `insert into campaigns (org_id, name, status) values ($1, 'c', 'active') returning id`,
    [ORG_A],
  );
  const enr = await attempt(
    `insert into enrollments (org_id, campaign_id, opportunity_id, status, next_action_at)
     values ($1, $2, $3, 'active', now())`,
    [ORG_A, campaign!.id, OPP_B],
  );
  const repoint = await attempt(`update opportunities set company_id = $1 where id = $2`, [COMPANY_B, OPP_A]);
  // The same writes inside the member's own workspace are fine.
  const second = await one<{ id: string }>(
    `insert into companies (org_id, canonical_domain, name) values ($1, 'betaco.test', 'Betaco') returning id`,
    [ORG_A],
  );
  const own = await attempt(
    `insert into opportunities (org_id, company_id, priority, priority_reason)
     values ($1, $2, 'warm', 'own company')`,
    [ORG_A, second!.id],
  );
  const ownEnr = await attempt(
    `insert into enrollments (org_id, campaign_id, opportunity_id, status, next_action_at)
     values ($1, $2, $3, 'active', now())`,
    [ORG_A, campaign!.id, OPP_A],
  );
  const touch = await attempt(`update opportunities set outreach_angle = 'Angle A2' where id = $1`, [OPP_A]);

  await asSuperuser();
  const leaked = await db.query(
    `select 1 from opportunities o join companies c on c.id = o.company_id
      where o.org_id = $1 and c.org_id <> o.org_id
     union all
     select 1 from enrollments e join opportunities o on o.id = e.opportunity_id
      where e.org_id = $1 and o.org_id <> e.org_id`,
    [ORG_A],
  );
  return {
    holds: !opp.ok && !enr.ok && !repoint.ok && own.ok && ownEnr.ok && touch.ok && leaked.rows.length === 0,
    detail:
      `opportunity → org B company ${said(opp)}; enrollment → org B opportunity ${said(enr)}; repoint ${said(repoint)}; ` +
      `same-org opportunity ${said(own)}, enrollment ${said(ownEnr)}, edit ${said(touch)}; cross-org rows ${leaked.rows.length}`,
  };
});

// Structural: a reference added by a later migration must be guarded too.
await lead("3b. Every tenant-to-tenant reference a session can write is guarded", async () => {
  const r = await db.query<{ src: string; col: string; dst: string; guarded: boolean }>(`
    with fk as (
      select c.conrelid, c.conrelid::regclass::text as src, c.confrelid::regclass::text as dst,
             (select a.attname from pg_attribute a
               where a.attrelid = c.conrelid and a.attnum = c.conkey[1]) as col
        from pg_constraint c
       where c.contype = 'f' and c.connamespace = 'public'::regnamespace
         and array_length(c.conkey, 1) = 1
    )
    select fk.src, fk.col, fk.dst,
           exists (
             select 1 from pg_trigger t
              where t.tgrelid = fk.conrelid and t.tgname = fk.src || '_same_org'
                and fk.col::text = any (string_to_array(encode(t.tgargs, 'escape'), '\\000'))
           ) as guarded
      from fk
     where fk.dst <> 'organizations'
       and exists (select 1 from pg_attribute a where a.attrelid = fk.conrelid and a.attname = 'org_id')
       and exists (select 1 from pg_attribute a where a.attrelid = fk.dst::regclass and a.attname = 'org_id')
       and exists (select 1 from pg_policy p where p.polrelid = fk.conrelid and p.polcmd in ('a', 'w', '*')
                     and pg_get_expr(p.polqual, p.polrelid) is distinct from 'false')
  `);
  const missing = r.rows.filter((x) => !x.guarded).map((x) => `${x.src}.${x.col} → ${x.dst}`);
  return {
    holds: r.rows.length > 50 && missing.length === 0,
    detail: missing.length
      ? `unguarded: ${missing.join(", ")} — add them to the list in 0047 (or a later migration)`
      : `${r.rows.length} references guarded`,
  };
});

// ── 4. Re-approving a removed owner does not restore owner ─────────────────
await lead("4. An admin cannot bring back a removed owner as owner", async () => {
  // Owner removes the other owner — exactly what removeMemberAction does.
  await as(OWNER);
  await db.query(`update memberships set deleted_at = now() where org_id = $1 and user_id = $2`, [ORG_A, OWNER2]);

  // The direct route: an admin un-deletes the owner row.
  await as(ADMIN);
  const undelete = await attempt(
    `update memberships set deleted_at = null where org_id = $1 and user_id = $2`,
    [ORG_A, OWNER2],
  );

  // The join-request route.
  await as(OWNER2);
  const ask = await attempt(`select public.request_to_join($1)`, [ORG_A]);
  await as(ADMIN);
  const req = await one<{ id: string }>(
    `select id from join_requests where org_id = $1 and user_id = $2 and status = 'pending'`,
    [ORG_A, OWNER2],
  );
  const approve = req
    ? await attempt(`select public.approve_join_request($1)`, [req.id])
    : { ok: false as const, error: "no pending request" };

  await asSuperuser();
  const m = await one<{ role: string; deleted_at: string | null }>(
    `select role, deleted_at from memberships where org_id = $1 and user_id = $2`,
    [ORG_A, OWNER2],
  );
  return {
    holds: !undelete.ok && ask.ok && approve.ok && m?.role === "member" && m.deleted_at == null,
    detail:
      `admin un-deletes owner row ${said(undelete)}; request_to_join ${said(ask)}; admin approval ${said(approve)}; ` +
      `membership now role=${m?.role} live=${m?.deleted_at == null}`,
  };
});

// ── 5. provider_accounts cannot lift the plan's provider ceiling ───────────
await lead("5. An admin cannot raise the provider-credit ceiling above the plan", async () => {
  await db.query(
    `insert into usage_counters (org_id, period, metric, used)
     values ($1, to_char(now(), 'YYYY-MM'), 'provider_credits:apollo', 20)`,
    [ORG_A],
  );
  const before = await one<{ limit: string; allowed: boolean }>(
    `select "limit", allowed from provider_budget_state($1, 'apollo')`,
    [ORG_A],
  );

  await as(ADMIN);
  const raise = await attempt(
    `insert into provider_accounts (org_id, capability, provider, monthly_credit_limit)
     values ($1, 'company.search', 'apollo', 1000000000)`,
    [ORG_A],
  );
  await asSuperuser();
  const raised = await one<{ limit: string; allowed: boolean }>(
    `select "limit", allowed from provider_budget_state($1, 'apollo')`,
    [ORG_A],
  );

  // Lowering it is what the setting is for, and still works.
  await as(ADMIN);
  await db.query(`update provider_accounts set monthly_credit_limit = 10 where org_id = $1`, [ORG_A]);
  await asSuperuser();
  const lowered = await one<{ limit: string; allowed: boolean }>(
    `select "limit", allowed from provider_budget_state($1, 'apollo')`,
    [ORG_A],
  );
  return {
    holds:
      Number(before?.limit) === 25 && Number(raised?.limit) === 25 && raised?.allowed === true &&
      Number(lowered?.limit) === 10 && lowered?.allowed === false,
    detail:
      `plan ceiling ${before?.limit}; admin writes 1e9 ${said(raise)} → ceiling ${raised?.limit}; ` +
      `admin lowers to 10 → ceiling ${lowered?.limit} allowed=${lowered?.allowed}`,
  };
});

// ── 6. Unsubscribe tokens are not readable by tenant sessions ──────────────
await lead("6. No session can read unsubscribe tokens, and the link still works", async () => {
  const person = await one<{ id: string }>(
    `insert into people (org_id, company_id, first_name) values ($1, $2, 'Pat') returning id`,
    [ORG_A, COMPANY_A],
  );
  await db.query(
    `insert into contact_points (org_id, person_id, kind, value) values ($1, $2, 'email', 'pat@alphio.test')`,
    [ORG_A, person!.id],
  );
  const campaign = await one<{ id: string }>(
    `insert into campaigns (org_id, name, status) values ($1, 'c', 'active') returning id`,
    [ORG_A],
  );
  await db.query(
    `insert into enrollments (org_id, campaign_id, opportunity_id, status, next_action_at)
     values ($1, $2, $3, 'active', now())`,
    [ORG_A, campaign!.id, OPP_A],
  );
  const message = await one<{ id: string }>(
    `insert into messages (org_id, direction, subject, to_email) values ($1, 'outbound', 's', 'pat@alphio.test') returning id`,
    [ORG_A],
  );

  const readable: string[] = [];
  for (const [who, uid] of [["viewer", VIEWER], ["member", MEMBER], ["owner", OWNER]] as const) {
    await as(uid);
    const r = await attempt(`select token from message_unsubscribe_tokens`);
    if (r.ok && r.rows.length > 0) readable.push(who);
  }
  await as(VIEWER);
  const column = await attempt(`select unsubscribe_token from messages`);

  // The recipient's click: no session at all, holding the real token.
  await asSuperuser();
  const token = (await one<{ token: string }>(
    `select token from message_unsubscribe_tokens where message_id = $1`,
    [message!.id],
  ))!.token;
  await as(null, "anon");
  const click = await attempt(`select * from public.record_unsubscribe($1)`, [token]);
  await asSuperuser();
  const effect = await one<{ suppressed: number; stopped: number }>(
    `select (select count(*)::int from suppressions where org_id = $1 and value = 'pat@alphio.test') as suppressed,
            (select count(*)::int from enrollments where org_id = $1 and status = 'stopped') as stopped`,
    [ORG_A],
  );

  return {
    holds: readable.length === 0 && !column.ok && click.ok && effect!.suppressed === 1 && effect!.stopped === 1,
    detail:
      `tokens readable by ${readable.length ? readable.join(", ") : "no session role"}; messages.unsubscribe_token ${column.ok ? "still exists" : "gone"}; ` +
      `recipient's click ${said(click)} → suppressed=${effect?.suppressed} stopped=${effect?.stopped}`,
  };
});

// ── 7. A manual activity cannot be re-attributed to someone else ───────────
await lead("7. Nobody can re-attribute a logged activity to a colleague", async () => {
  await as(MEMBER);
  const act = await one<{ id: string }>(
    `insert into activities (org_id, opportunity_id, kind, channel, direction, actor_type, actor_id, occurred_at, summary, origin)
     values ($1, $2, 'note', 'other', 'internal', 'user', $3, now(), 'test', 'manual') returning id`,
    [ORG_A, OPP_A, MEMBER],
  );
  const reassign = await attempt(`update activities set actor_id = $1, summary = 'forged' where id = $2`, [MEMBER2, act!.id]);
  const edit = await attempt(`update activities set summary = 'edited by the author' where id = $1`, [act!.id]);

  await as(ADMIN);
  const adminReassign = await attempt(`update activities set actor_id = $1 where id = $2`, [ADMIN, act!.id]);
  const adminTidy = await attempt(`update activities set summary = 'tidied by an admin' where id = $1`, [act!.id]);

  await asSuperuser();
  const row = await one<{ actor_id: string; summary: string }>(`select actor_id, summary from activities where id = $1`, [act!.id]);
  return {
    holds: !reassign.ok && !adminReassign.ok && edit.ok && adminTidy.ok && row?.actor_id === MEMBER && row.summary === "tidied by an admin",
    detail:
      `member reassigns ${said(reassign)}; author edits ${said(edit)}; admin reassigns ${said(adminReassign)}; ` +
      `admin tidies ${said(adminTidy)}; stored actor is ${row?.actor_id === MEMBER ? "the author" : "someone else"}`,
  };
});

// ── 11. Anonymous research is reserved before it is paid for ───────────────
await lead("11. /discover reserves each paid attempt before the model call", async () => {
  const reserve = (ip: string, perIp: number, daily: number) =>
    one<{ allowed: boolean; reason: string | null }>(
      `select * from public.reserve_public_research($1, $2, $3)`,
      [ip, perIp, daily],
    );

  // Per source: five, then refused — and a refusal is not counted.
  const ip: boolean[] = [];
  for (let i = 0; i < 7; i++) ip.push((await reserve("ip-1", 5, 100))!.allowed);
  const attempts = await one<{ n: number }>(`select count(*)::int as n from public_research_attempts where ip_hash = 'ip-1'`);

  // Across all sources: the daily ceiling (5 already reserved above).
  const day: (string | null)[] = [];
  for (let i = 0; i < 3; i++) {
    const r = await reserve(`ip-day-${i}`, 5, 7);
    day.push(r!.allowed ? "ok" : r!.reason);
  }

  // Sessions cannot reserve (or burn) the allowance themselves.
  await as(MEMBER);
  const session = await attempt(`select * from public.reserve_public_research('x', 1000, 1000)`);
  await as(null, "anon");
  const anon = await attempt(`select * from public.reserve_public_research('x', 1000, 1000)`);
  await asSuperuser();

  return {
    holds:
      ip.join() === "true,true,true,true,true,false,false" && attempts?.n === 5 &&
      day.join() === "ok,ok,over_budget" && !session.ok && !anon.ok,
    detail:
      `per source ${ip.map((a) => (a ? "✓" : "✗")).join("")} (${attempts?.n} counted); daily ${day.join(", ")}; ` +
      `session ${said(session)}; anon ${said(anon)}`,
  };
});

// ── 12. An invitation needs a confirmed address ────────────────────────────
await lead("12. An unconfirmed address cannot accept an invitation", async () => {
  const UNCONFIRMED = "c0000000-0000-0000-0000-000000000001";
  const CONFIRMED = "c0000000-0000-0000-0000-000000000002";
  await db.query(
    `insert into auth.users (id, email, email_confirmed_at) values ($1, 'Invitee@a.test', null), ($2, 'later@a.test', now())`,
    [UNCONFIRMED, CONFIRMED],
  );

  await as(OWNER);
  const member = await one<{ token: string }>(
    `insert into invitations (org_id, email, role, invited_by) values ($1, 'invitee@a.test', 'member', $2) returning token`,
    [ORG_A, OWNER],
  );
  const owner = await one<{ token: string }>(
    `insert into invitations (org_id, email, role, invited_by) values ($1, 'later@a.test', 'owner', $2) returning token`,
    [ORG_A, OWNER],
  );

  await as(UNCONFIRMED);
  const early = await attempt(`select * from public.accept_invitation($1)`, [member!.token]);

  // The owner guard's invitation branch, reached with an unconfirmed address.
  await asSuperuser();
  await db.query(`update auth.users set email_confirmed_at = null where id = $1`, [CONFIRMED]);
  await as(CONFIRMED);
  const ownerEarly = await attempt(`select * from public.accept_invitation($1)`, [owner!.token]);

  await asSuperuser();
  await db.query(`update auth.users set email_confirmed_at = now() where id in ($1, $2)`, [UNCONFIRMED, CONFIRMED]);
  await as(UNCONFIRMED);
  const confirmed = await attempt(`select * from public.accept_invitation($1)`, [member!.token]);
  await as(CONFIRMED);
  const ownerInvite = await attempt(`select * from public.accept_invitation($1)`, [owner!.token]);

  await asSuperuser();
  const roles = await db.query<{ user_id: string; role: string }>(
    `select user_id, role from memberships where org_id = $1 and user_id in ($2, $3) and deleted_at is null`,
    [ORG_A, UNCONFIRMED, CONFIRMED],
  );
  const role = (u: string) => roles.rows.find((r) => r.user_id === u)?.role;
  return {
    holds: !early.ok && !ownerEarly.ok && confirmed.ok && ownerInvite.ok && role(UNCONFIRMED) === "member" && role(CONFIRMED) === "owner",
    detail:
      `unconfirmed member invitee ${said(early)}; unconfirmed owner invitee ${said(ownerEarly)}; ` +
      `after confirming: member ${said(confirmed)} → ${role(UNCONFIRMED)}, owner ${said(ownerInvite)} → ${role(CONFIRMED)}`,
  };
});

// ── Summary ────────────────────────────────────────────────────────────────
const regressed = verdicts.filter((v) => v.holds === false);
const errored = verdicts.filter((v) => v.holds === null);
console.log(
  `\n${verdicts.length - regressed.length - errored.length} of ${verdicts.length} fixes hold` +
    (regressed.length ? `, ${regressed.length} regressed` : "") +
    (errored.length ? `, ${errored.length} could not be run` : ""),
);
process.exit(regressed.length || errored.length ? 1 : 0);
