/** Retention, erasure and the request hash: deletion that is safe to automate. */
import { OrgScope, setAdminClientForTests } from "../../src/scope.ts";
import { HANDLERS } from "../../src/registry.ts";
import { hashIp } from "../../src/public-research.ts";
import { expect, expectEqual, fakeClient, ORG_A, ORG_B } from "./harness.ts";

/* ── Compliance ──────────────────────────────────────────────────────────
   `0017` shipped erasure and retention as SQL that nothing called. These are
   the jobs that call it, and the properties below are the ones that make an
   automatic delete safe to turn on. */

console.log("\nenforce_retention — deletes only what somebody asked to be deleted");
{
  const { client, calls } = fakeClient({ "select:organizations": { data: [], error: null } });
  setAdminClientForTests(client);

  const outcome = await HANDLERS.enforce_retention({
    scope: new OrgScope(ORG_A, client),
    payload: {},
    job: {} as never,
    now: new Date(),
  });

  expect(
    "an estate where nobody set a retention period deletes nothing",
    outcome.ok && outcome.result.removed === 0,
    JSON.stringify(outcome),
  );
  expect(
    "and nothing is pruned to establish that",
    !calls.some((c) => c.table === "prune_stale_contacts"),
    JSON.stringify(calls.map((c) => c.table)),
  );
  /* The filter is the whole safety property. Reading every org and asking the
     function to decide would work, but it would also mean one bad `p_org`
     away from a delete against a tenant with no policy at all. */
  expect(
    "the sweep asks only for orgs that configured one",
    calls.some(
      (c) =>
        c.table === "organizations" &&
        c.filters.some(([k]) => String(k).includes("contact_retention_days")),
    ),
    JSON.stringify(calls[0]?.filters),
  );
  setAdminClientForTests(null);
}

{
  const { client, calls } = fakeClient({
    "select:organizations": {
      data: [{ id: ORG_B, contact_retention_days: 90 }],
      error: null,
    },
    "rpc:prune_stale_contacts": { data: 4, error: null },
  });
  setAdminClientForTests(client);

  const outcome = await HANDLERS.enforce_retention({
    scope: new OrgScope(ORG_A, client),
    payload: {},
    job: {} as never,
    now: new Date(),
  });

  expect("a configured org is pruned", outcome.ok && outcome.result.removed === 4, JSON.stringify(outcome));

  const audit = calls.find((c) => c.table === "write_audit_log_internal");
  expect(
    "and the deletion is recorded — CMPL-02 requires it be verifiable afterwards",
    Boolean(audit) &&
      (audit?.payload as Record<string, unknown>)?.p_action === "contact_data.retention_pruned",
    JSON.stringify(audit?.payload),
  );
  expect(
    "against the org whose rows went, not the org the sweep happens to run as",
    (audit?.payload as Record<string, unknown>)?.p_org === ORG_B,
    JSON.stringify(audit?.payload),
  );
  setAdminClientForTests(null);
}

{
  // An audit log that is mostly "nothing happened" is one nobody reads on the
  // day it matters.
  const { client, calls } = fakeClient({
    "select:organizations": { data: [{ id: ORG_B, contact_retention_days: 90 }], error: null },
    "rpc:prune_stale_contacts": { data: 0, error: null },
  });
  setAdminClientForTests(client);
  await HANDLERS.enforce_retention({
    scope: new OrgScope(ORG_A, client),
    payload: {},
    job: {} as never,
    now: new Date(),
  });
  expect(
    "a prune that removed nothing writes no audit row",
    !calls.some((c) => c.table === "write_audit_log_internal"),
    JSON.stringify(calls.map((c) => c.table)),
  );
  setAdminClientForTests(null);
}

{
  /* One tenant's broken prune must not suspend retention for every other
     tenant — and the failure direction is safe: their data is still there. */
  const { client } = fakeClient({
    "select:organizations": {
      data: [
        { id: ORG_A, contact_retention_days: 30 },
        { id: ORG_B, contact_retention_days: 30 },
      ],
      error: null,
    },
    "rpc:prune_stale_contacts": { data: null, error: { message: "deadlock detected" } },
  });
  setAdminClientForTests(client);
  const outcome = await HANDLERS.enforce_retention({
    scope: new OrgScope(ORG_A, client),
    payload: {},
    job: {} as never,
    now: new Date(),
  });
  expect(
    "a failing tenant is reported, and the sweep still visits the rest",
    outcome.ok && Array.isArray(outcome.result.failures) && outcome.result.failures.length === 2,
    JSON.stringify(outcome),
  );
  setAdminClientForTests(null);
}

console.log("\npurge_contact_data — a verifiable deletion, or a loud refusal");
{
  const { client, calls } = fakeClient({
    "rpc:erase_contact": {
      data: { contact_points: 2, messages_redacted: 5, people: 1 },
      error: null,
    },
  });
  setAdminClientForTests(client);

  const outcome = await HANDLERS.purge_contact_data({
    scope: new OrgScope(ORG_A, client),
    payload: { email: "  Erase.Me@Example.com " },
    job: {} as never,
    now: new Date(),
  });

  expect(
    "the erasure reports what it actually removed, per table",
    outcome.ok && outcome.result.messagesRedacted === 5 && outcome.result.contactPoints === 2,
    JSON.stringify(outcome),
  );
  expect(
    "and normalisation is left to the function, so one implementation decides what an address is",
    (calls.find((c) => c.table === "erase_contact")?.payload as Record<string, unknown>)
      ?.p_email === "Erase.Me@Example.com",
    JSON.stringify(calls.find((c) => c.table === "erase_contact")?.payload),
  );
  setAdminClientForTests(null);
}

{
  const { client } = fakeClient();
  setAdminClientForTests(client);
  const outcome = await HANDLERS.purge_contact_data({
    scope: new OrgScope(ORG_A, client),
    payload: {},
    job: {} as never,
    now: new Date(),
  });
  expect(
    "an erasure with no address fails permanently rather than erasing something else",
    !outcome.ok && outcome.permanent === true,
    JSON.stringify(outcome),
  );
  setAdminClientForTests(null);
}

console.log("\nhashIp — a stored request hash is not reversible from the repository");
{
  const saved = {
    salt: process.env.PUBLIC_RESEARCH_SALT,
    secret: process.env.SUPABASE_SECRET_KEY,
    service: process.env.SUPABASE_SERVICE_ROLE_KEY,
  };
  const restore = (name: string, value: string | undefined) => {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  };
  delete process.env.PUBLIC_RESEARCH_SALT;
  delete process.env.SUPABASE_SECRET_KEY;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  const publicConstant = await hashIp("203.0.113.7");

  process.env.SUPABASE_SECRET_KEY = "a-deployment-secret";
  const derived = await hashIp("203.0.113.7");
  expect("with a database secret and no salt set, the public constant is not the salt", derived !== publicConstant);
  expectEqual("and the derived hash is stable", await hashIp("203.0.113.7"), derived);
  expect("and still separates addresses", (await hashIp("203.0.113.8")) !== derived);

  process.env.PUBLIC_RESEARCH_SALT = "explicit";
  expect("an explicit salt still wins", (await hashIp("203.0.113.7")) !== derived);

  restore("PUBLIC_RESEARCH_SALT", saved.salt);
  restore("SUPABASE_SECRET_KEY", saved.secret);
  restore("SUPABASE_SERVICE_ROLE_KEY", saved.service);
}

