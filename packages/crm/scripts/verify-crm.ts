/**
 * Exercises the HubSpot adapter without a network or a token.
 *
 * What matters here: search-then-write chooses the right verb, a 409 on
 * property creation is treated as success rather than failure, association
 * calls hit the documented default-associations shape, and a 404 deal read
 * is a real answer ("no such deal") rather than a thrown error.
 *
 *   npm test --workspace @huntloop/crm
 */
import {
  associate,
  createDeal,
  ensureDealProperties,
  getDealStage,
  upsertCompany,
  upsertContact,
  verifyHubspotToken,
} from "../src/hubspot.ts";

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
function expect(name: string, condition: boolean, detail: unknown = "expected true") {
  if (condition) ok(name);
  else fail(name, detail);
}
function expectEqual(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a === b) ok(name);
  else fail(name, `got ${a}, wanted ${b}`);
}

/** Records every call this fake fetch received, so a test can assert on shape. */
interface Call {
  url: string;
  method: string;
  body: unknown;
}

function fakeFetch(handler: (call: Call) => { status: number; body?: unknown }) {
  const calls: Call[] = [];
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    const call: Call = {
      url: String(url),
      method: init?.method ?? "GET",
      body: init?.body ? JSON.parse(String(init.body)) : null,
    };
    calls.push(call);
    const { status, body } = handler(call);
    return new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  return calls;
}

const original = globalThis.fetch;

console.log("\nverifyHubspotToken — a bad token says so, not 'no results'");
{
  fakeFetch(() => ({ status: 401, body: { message: "invalid token" } }));
  const bad = await verifyHubspotToken("wrong");
  expect("a 401 is reported as not-ok", bad.ok === false);

  fakeFetch(() => ({ status: 200, body: { results: [] } }));
  const good = await verifyHubspotToken("right");
  expect("a 200 is reported as ok", good.ok === true);
}

console.log("\nupsertCompany — search first, then PATCH or POST");
{
  const calls = fakeFetch((call) => {
    if (call.url.includes("/search")) return { status: 200, body: { results: [{ id: "c1" }] } };
    return { status: 200, body: { id: "c1" } };
  });
  const updated = await upsertCompany("t", { name: "Acme", domain: "acme.com", industry: null, employeeCount: null });
  expectEqual("an existing company is found and updated", updated, { id: "c1", created: false });
  expect("the write is a PATCH, not a POST", calls[1]?.method === "PATCH");
}
{
  fakeFetch((call) => {
    if (call.url.includes("/search")) return { status: 200, body: { results: [] } };
    return { status: 200, body: { id: "c2" } };
  });
  const created = await upsertCompany("t", { name: "New Co", domain: "newco.com", industry: null, employeeCount: 40 });
  expectEqual("no match means a new company is created", created, { id: "c2", created: true });
}
{
  const calls = fakeFetch(() => ({ status: 200, body: { id: "c3" } }));
  await upsertCompany("t", { name: "No Domain Co", domain: null, industry: null, employeeCount: null });
  expect("no domain skips the search entirely rather than searching for nothing", calls.length === 1 && calls[0]?.method === "POST");
}

console.log("\nupsertContact — same pattern, keyed on email");
{
  const calls = fakeFetch((call) => {
    if (call.url.includes("/search")) return { status: 200, body: { results: [] } };
    return { status: 200, body: { id: "p1" } };
  });
  const result = await upsertContact("t", { email: "a@acme.com", firstName: "A", lastName: "B", title: "VP" });
  expectEqual("a new contact is created", result, { id: "p1", created: true });
  const posted = calls[1]?.body as { properties?: Record<string, string> };
  expectEqual("email maps to the email property", posted.properties?.email, "a@acme.com");
  expectEqual("title maps to jobtitle, HubSpot's own name for it", posted.properties?.jobtitle, "VP");
}

console.log("\ncreateDeal — Huntloop's own fields ride along as custom properties");
{
  const calls = fakeFetch(() => ({ status: 200, body: { id: "d1" } }));
  const result = await createDeal("t", {
    name: "Acme — opportunity", score: 78, whyNow: "Posted three AE roles this week.",
    evidenceUrl: "https://app.huntloop.example/acme/opportunities/o1",
  });
  expectEqual("the deal is created", result, { id: "d1", created: true });
  const posted = calls[0]?.body as { properties?: Record<string, string> };
  expectEqual("the score rides along as huntloop_score", posted.properties?.huntloop_score, "78");
  expect("the evidence link rides along too", posted.properties?.huntloop_evidence_url?.includes("/opportunities/o1") === true);
}
{
  const calls = fakeFetch(() => ({ status: 200, body: { id: "d2" } }));
  await createDeal("t", { name: "Unscored", score: null, whyNow: "x", evidenceUrl: "y" });
  const posted = calls[0]?.body as { properties?: Record<string, string> };
  expect("a null score is omitted, not sent as the string 'null'", !("huntloop_score" in (posted.properties ?? {})));
}

console.log("\nensureDealProperties — a 409 is success, not a failure");
{
  const calls = fakeFetch(() => ({ status: 409, body: { message: "already exists" } }));
  await ensureDealProperties("t");
  ok("four calls (one group, three properties), none of them thrown");
  expectEqual("one call per property plus the group", calls.length, 4);
}

console.log("\nassociate — the documented v4 default-association shape");
{
  const calls = fakeFetch(() => ({ status: 204 }));
  await associate("t", "deals", "d1", "companies", "c1");
  expect("PUT, not POST", calls[0]?.method === "PUT");
  expect(
    "against the default-associations path, with no numeric type id to get wrong",
    calls[0]?.url.includes("/crm/v4/objects/deals/d1/associations/default/companies/c1") === true,
  );
}

console.log("\ngetDealStage — a 404 is 'no such deal', not a thrown error");
{
  fakeFetch(() => ({ status: 404, body: { message: "not found" } }));
  const missing = await getDealStage("t", "gone");
  expectEqual("a missing deal reads as null", missing, null);
}
{
  fakeFetch((call) => {
    if (call.url.includes("/pipelines/deals")) {
      return {
        status: 200,
        body: { results: [{ label: "Sales", stages: [{ id: "closedwon", label: "Closed won" }] }] },
      };
    }
    return {
      status: 200,
      body: { properties: { dealstage: "closedwon", hs_is_closed: "true", hs_is_closed_won: "true" } },
    };
  });
  const stage = await getDealStage("t", "d1");
  expectEqual("a real stage comes back with the closed/won flags HubSpot sends", stage, {
    stageId: "closedwon", stageLabel: "Closed won", isClosed: true, isWon: true,
  });
}
{
  /* A portal that refuses the pipelines read — custom permissions do this —
     must still sync. Losing a label is not worth losing the push. */
  fakeFetch((call) => {
    if (call.url.includes("/pipelines/deals")) return { status: 403, body: { message: "no scope" } };
    return { status: 200, body: { properties: { dealstage: "qualifiedtobuy" } } };
  });
  const stage = await getDealStage("t", "d1");
  expectEqual("an unreadable pipeline degrades to a null label, not a failed sync", stage, {
    stageId: "qualifiedtobuy", stageLabel: null, isClosed: false, isWon: false,
  });
}

globalThis.fetch = original;

console.log(`\n${failures === 0 ? "PASS" : "FAIL"} — ${checks - failures}/${checks} checks passed\n`);
process.exit(failures === 0 ? 0 : 1);
