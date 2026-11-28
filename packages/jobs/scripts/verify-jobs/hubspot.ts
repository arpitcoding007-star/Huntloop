/** sync_hubspot, end to end. */
import { OrgScope, setAdminClientForTests } from "../../src/scope.ts";
import { syncHubspot } from "../../src/handlers/sync-hubspot.ts";
import { expect, expectEqual, fakeClient, ORG_A } from "./harness.ts";
import { encryptSecret } from "./fixtures.ts";

/* ── sync_hubspot, end to end ───────────────────────────────────────────────
   The push path, with a fake HubSpot and a fake database. What is worth
   holding down here is not "does fetch work" — `@huntloop/crm` tests that —
   but the three decisions this handler owns and that would keep *looking*
   correct if they broke: a second sync must update the deal it already
   created rather than making another one, HubSpot's stage must come back as
   evidence rather than as a status overwrite, and an undecryptable
   credential must stop permanently instead of retrying a key that will not
   change by itself. */

/* `MAILBOX_ENCRYPTION_KEY` is already set by `fixtures.ts`, which runs first —
   one key covers every stored credential, which is the decision recorded in
   `packages/db/src/crypto.ts`. These tests inherit it rather than setting a
   second one, so if that decision is ever reversed they fail here too. */
function hubspotWorld(options: { existingDealId?: string | null; dealGone?: boolean } = {}) {
  const existing = options.existingDealId ?? null;

  const { client, calls } = fakeClient({
    "select:hubspot_connections": {
      data: { access_token: encryptSecret("pat-na1-test"), hub_id: "4242", is_enabled: true },
      error: null,
    },
    "select:organizations": { data: { slug: "acme-co" }, error: null },
    "select:opportunities": {
      data: {
        id: "opp1",
        company_id: "co1",
        primary_person_id: "pp1",
        why_now: "Posted three AE roles this week.",
        status: "qualified",
      },
      error: null,
    },
    "select:companies": {
      data: { id: "co1", name: "Acme", canonical_domain: "acme.com", industry: "SaaS", employee_count: 180 },
      error: null,
    },
    "select:opportunity_scores": { data: { score: 78 }, error: null },
    "select:people": { data: { id: "pp1", first_name: "Dana", last_name: "Reed", title: "VP Sales" }, error: null },
    "select:contact_points": { data: [{ value: "dana@acme.com" }], error: null },
    "select:external_ids": {
      data: existing ? [{ provider_id: existing }] : [],
      error: null,
    },
  });
  setAdminClientForTests(client);

  const http: Array<{ method: string; url: string }> = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const u = String(url);
    http.push({ method, url: u });

    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

    if (u.includes("/properties/deals")) return json({ message: "exists" }, 409);
    if (options.dealGone && method === "PATCH" && u.includes("/objects/")) return json({ message: "not found" }, 404);
    if (u.includes("/search")) return json({ results: [] });
    if (u.includes("/pipelines/deals")) {
      return json({ results: [{ stages: [{ id: "presentationscheduled", label: "Demo scheduled" }] }] });
    }
    if (u.includes("/crm/v4/")) return new Response(null, { status: 204 });
    if (method === "GET" && u.includes("/objects/deals/")) {
      return json({ properties: { dealstage: "presentationscheduled" } });
    }
    if (u.includes("/objects/companies")) return json({ id: "hs-co-1" });
    if (u.includes("/objects/contacts")) return json({ id: "hs-ct-1" });
    if (u.includes("/objects/deals")) return json({ id: "hs-deal-1" });
    return json({});
  }) as typeof fetch;

  return {
    calls,
    http,
    restore: () => {
      globalThis.fetch = original;
      setAdminClientForTests(null);
    },
    ctx: {
      scope: new OrgScope(ORG_A, client),
      payload: { opportunityId: "opp1" },
      job: { id: "job-1", org_id: ORG_A, job_name: "sync_hubspot" } as never,
      now: new Date(),
    },
  };
}

console.log("\nsync_hubspot — the first push creates, and records what it created");
{
  const world = hubspotWorld();
  const outcome = await syncHubspot(world.ctx);

  expect("the sync succeeds", outcome.ok === true);
  expect(
    "a deal is created",
    world.http.some((c) => c.method === "POST" && /\/objects\/deals$/.test(c.url)),
    JSON.stringify(world.http),
  );
  expect(
    "the company is associated to it",
    world.http.some((c) => c.method === "PUT" && c.url.includes("/associations/default/companies/")),
  );

  /* `OrgScope.upsert` normalises a single row into an array before it reaches
     the client — and injects `org_id` while it is there — so what a recorded
     call carries is always a list, never the object the handler passed. */
  const rowsOf = (verb: string, table: string) =>
    world.calls
      .filter((c) => c.table === table && c.verb === verb)
      .flatMap((c) => (Array.isArray(c.payload) ? c.payload : [c.payload]) as Record<string, unknown>[]);

  const linked = rowsOf("upsert", "external_ids");
  expectEqual(
    "every HubSpot id is remembered — company, contact and deal",
    linked.map((row) => row.entity_type).sort(),
    ["company", "opportunity", "person"],
  );
  expect(
    "and remembered against the right provider, so the next sync finds them",
    linked.every((row) => row.provider === "hubspot"),
  );

  const evidence = rowsOf("upsert", "evidence");
  expectEqual("HubSpot's stage is written as one evidence row", evidence.length, 1);
  expect(
    "carrying the readable label rather than the raw stage id",
    String(evidence[0]?.claim ?? "").includes("Demo scheduled"),
    String(evidence[0]?.claim),
  );
  expect(
    "and nothing wrote to opportunities — a CRM stage is recorded, not obeyed",
    !world.calls.some((c) => c.table === "opportunities" && c.verb === "update"),
  );

  world.restore();
}

console.log("\nsync_hubspot — the second push updates, and never creates a twin");
{
  const world = hubspotWorld({ existingDealId: "hs-deal-1" });
  const outcome = await syncHubspot(world.ctx);

  expect("the sync succeeds", outcome.ok === true);
  expect(
    "no second deal is created",
    !world.http.some((c) => c.method === "POST" && /\/objects\/deals$/.test(c.url)),
    JSON.stringify(world.http),
  );
  expect(
    "the existing one is patched instead",
    world.http.some((c) => c.method === "PATCH" && c.url.includes("/objects/deals/hs-deal-1")),
  );
  expect(
    "and associated again, so a first push whose association failed is repaired (CRM-001)",
    world.http.some((c) => c.method === "PUT" && c.url.includes("/objects/deals/hs-deal-1/associations/")),
  );

  world.restore();
}

console.log("\nsync_hubspot — a deal deleted in HubSpot, or another portal, is created afresh (CRM-003)");
{
  const world = hubspotWorld({ existingDealId: "hs-deal-old", dealGone: true });
  const outcome = await syncHubspot(world.ctx);

  expect("the sync succeeds", outcome.ok === true, JSON.stringify(outcome));
  expect(
    "a new deal is created",
    world.http.some((c) => c.method === "POST" && /\/objects\/deals$/.test(c.url)),
    JSON.stringify(world.http),
  );
  expect(
    "and the stale link is forgotten",
    world.calls.some((c) => c.table === "external_ids" && c.verb === "delete"),
  );

  world.restore();
}

console.log("\nsync_hubspot — a credential it cannot read stops, rather than retrying forever");
{
  const savedKey = process.env.MAILBOX_ENCRYPTION_KEY;
  const world = hubspotWorld();
  /* Rotate the key out from under the already-stored value — the real-world
     shape of this is an operator regenerating MAILBOX_ENCRYPTION_KEY, or a
     row that predates the column being encrypted at all. */
  process.env.MAILBOX_ENCRYPTION_KEY = "b".repeat(64);

  const outcome = await syncHubspot(world.ctx);

  expect("it fails", outcome.ok === false);
  expect(
    "permanently, because a rotated key does not fix itself on attempt three",
    outcome.ok === false && outcome.permanent === true,
  );
  expect("and nothing was sent to HubSpot", world.http.length === 0);
  expect(
    "the reason is written where the settings screen can show it",
    world.calls.some(
      (c) =>
        c.table === "hubspot_connections" &&
        c.verb === "update" &&
        Boolean((c.payload as { last_sync_error?: string })?.last_sync_error),
    ),
  );

  world.restore();
  if (savedKey === undefined) delete process.env.MAILBOX_ENCRYPTION_KEY;
  else process.env.MAILBOX_ENCRYPTION_KEY = savedKey;
}

console.log("\nsync_hubspot — an org that never connected HubSpot is a normal state, not a failure");
{
  const { client, calls } = fakeClient({
    /* No `select:hubspot_connections` entry: the fake client's default,
       `{ data: null, error: null }`, is exactly what "never connected"
       looks like from the database's side — the same state a fresh org is
       actually in, not a contrived one. */
  });
  setAdminClientForTests(client);

  const outcome = await syncHubspot({
    scope: new OrgScope(ORG_A, client),
    payload: { opportunityId: "opp1" },
    job: { id: "job-1", org_id: ORG_A, job_name: "sync_hubspot" } as never,
    now: new Date(),
  });

  expect("a missing connection succeeds by skipping", outcome.ok === true);
  expect(
    "and stops immediately — it never even reads the opportunity",
    !calls.some((c) => c.table === "opportunities"),
  );
  setAdminClientForTests(null);
}

