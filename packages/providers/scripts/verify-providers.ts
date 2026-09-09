/**
 * The provider seam, exercised without a network or a key.
 *
 * What is worth testing here is not "does fetch work". It is the set of
 * properties that would keep *looking* correct if they were quietly removed —
 * and every one of them is about money or about a lie:
 *
 *   · a refusal costs nothing and is never mistaken for an empty result;
 *   · a failure is never cached, so an outage does not become "no results"
 *     for a whole TTL;
 *   · a cache hit is recorded, so the hit rate is measurable;
 *   · the same question written two ways produces one cache key;
 *   · an address Apollo constructed from a pattern is `low` and unverified,
 *     because calling it anything else launders a guess into a finding and
 *     the bounce lands on the customer's sending domain;
 *   · a retry happens for transport and a rate limit, and does not happen for
 *     a rejected key — three attempts against a wrong credential is three
 *     times the noise for the same answer.
 *
 *   npm test --workspace @huntloop/providers
 */
import { requestHash } from "../src/cache.ts";
import { ProviderRefused, callProvider } from "../src/call.ts";
import { ProviderError, type RawCall } from "../src/contract.ts";
import { apolloAdapter, employeeRanges } from "../src/adapters/apollo.ts";
import { hunterAdapter } from "../src/adapters/hunter.ts";
import { zerobounceAdapter } from "../src/adapters/zerobounce.ts";
import { adapterFor, configuredProviders, resetRegistryForTests } from "../src/registry.ts";

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

/* ── A database stand-in ─────────────────────────────────────────────────
   Implements the surface this package uses and nothing else, in the same
   shape as `packages/jobs/scripts/verify-jobs.ts`. `rows` is the cache. */

interface Recorded {
  table: string;
  verb: string;
  payload?: unknown;
}

function fakeDb(options: {
  cache?: { body: unknown; fetchedAt: string } | null;
  budget?: { allowed: boolean; used: number; limit: number | null; remaining: number | null };
  breakerOpenUntil?: string | null;
  credentialsBad?: boolean;
} = {}) {
  const calls: Recorded[] = [];

  const chain = (record: Recorded, result: unknown) => {
    const c: Record<string, unknown> = {};
    for (const method of ["eq", "gt", "gte", "lt", "is", "in", "order", "limit", "select"]) {
      c[method] = () => c;
    }
    c.maybeSingle = () => c;
    c.single = () => c;
    c.insert = (rows: unknown) => { record.verb = "insert"; record.payload = rows; return c; };
    c.upsert = (rows: unknown) => { record.verb = "upsert"; record.payload = rows; return c; };
    c.update = (v: unknown) => { record.verb = "update"; record.payload = v; return c; };
    c.delete = () => { record.verb = "delete"; return c; };
    c.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve);
    return c;
  };

  const client = {
    from(table: string) {
      const record: Recorded = { table, verb: "from" };
      calls.push(record);

      if (table === "provider_cache") {
        const cached = options.cache;
        return chain(
          record,
          cached
            ? { data: { body: cached.body, fetched_at: cached.fetchedAt, expires_at: cached.fetchedAt }, error: null }
            : { data: null, error: null },
        );
      }
      if (table === "provider_breakers") {
        return chain(record, {
          data: options.breakerOpenUntil ? { open_until: options.breakerOpenUntil } : null,
          error: null,
        });
      }
      if (table === "provider_accounts") {
        return chain(record, {
          data: options.credentialsBad
            ? { credential_status: "invalid", is_enabled: true }
            : { credential_status: "valid", is_enabled: true },
          error: null,
        });
      }
      return chain(record, { data: null, error: null });
    },
    rpc(fn: string, args: unknown) {
      calls.push({ table: fn, verb: "rpc", payload: args });
      if (fn === "provider_budget_state") {
        const b = options.budget ?? { allowed: true, used: 0, limit: null, remaining: null };
        return Promise.resolve({ data: [b], error: null });
      }
      return Promise.resolve({ data: null, error: null });
    },
  };

  /* eslint-disable-next-line @typescript-eslint/no-explicit-any --
     The stand-in implements the surface this package uses and nothing else. */
  return { db: client as any, calls };
}

const ORG = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

/** The ledger row a call produced, as recorded through the RPC. */
function ledger(calls: Recorded[]): Array<Record<string, unknown>> {
  return calls
    .filter((c) => c.table === "record_provider_call")
    .map((c) => c.payload as Record<string, unknown>);
}

function base<T>(db: unknown, run: () => Promise<RawCall<T>>, over: Record<string, unknown> = {}) {
  return {
    /* eslint-disable-next-line @typescript-eslint/no-explicit-any -- stand-in */
    db: db as any,
    orgId: ORG,
    capability: "company.search" as const,
    provider: "testvendor",
    requestHash: "hash1",
    ttl: 1000,
    entity: null,
    run,
    fromCache: (b: unknown) => b as T,
    toCache: (d: T) => d,
    ...over,
  };
}

/* ════ The cache key ═════════════════════════════════════════════════════ */

console.log("\ncache — the same question written two ways is one key");
{
  // Key order. `JSON.stringify` preserves insertion order, so without
  // canonicalization these hash differently while being the same query — and
  // the cache would silently never hit.
  const a = requestHash("company.search", "apollo", { industries: ["a"], locations: ["b"] });
  const b = requestHash("company.search", "apollo", { locations: ["b"], industries: ["a"] });
  expect("object key order does not change the key", a === b);

  // Array order. A filter list is a set; a user reordering chips in the UI
  // must not produce a second paid call.
  const c = requestHash("company.search", "apollo", { industries: ["a", "b"] });
  const d = requestHash("company.search", "apollo", { industries: ["b", "a"] });
  expect("filter order does not change the key", c === d);

  const e = requestHash("company.search", "apollo", { industries: ["a"], keywords: null });
  const f = requestHash("company.search", "apollo", { industries: ["a"] });
  expect("an explicit null and an omitted field are the same question", e === f);

  const g = requestHash("company.search", "apollo", { industries: ["a"] });
  const h = requestHash("company.search", "apollo", { industries: ["a", "c"] });
  expect("but a different filter is a different key", g !== h);

  const i = requestHash("company.search", "apollo", { x: 1 });
  const j = requestHash("company.search", "other", { x: 1 });
  expect("and swapping the provider is a different key", i !== j);

  const k = requestHash("company.enrich", "apollo", { x: 1 });
  expect("as is asking a different capability", i !== k);
}

/* ════ The order of operations ═══════════════════════════════════════════ */

console.log("\ncall — five of the eight steps exist to not spend money");
{
  const { db, calls } = fakeDb({ breakerOpenUntil: new Date(Date.now() + 60_000).toISOString() });
  let ran = false;
  try {
    await callProvider(base(db, async () => { ran = true; return { data: { items: [] }, credits: 5, httpStatus: 200 }; }));
    fail("an open breaker refuses before calling", "did not throw");
  } catch (e) {
    expect("an open breaker refuses before calling", e instanceof ProviderRefused);
    expect("and does not call the provider", !ran);
    const row = ledger(calls)[0];
    expect("the refusal is recorded", row?.p_outcome === "refused");
    expect("costing nothing", row?.p_credits === 0);
  }
}

{
  const { db, calls } = fakeDb({
    budget: { allowed: false, used: 100, limit: 100, remaining: 0 },
  });
  let ran = false;
  try {
    await callProvider(base(db, async () => { ran = true; return { data: { items: [] }, credits: 5, httpStatus: 200 }; }));
    fail("an exhausted budget refuses before calling", "did not throw");
  } catch (e) {
    expect("an exhausted budget refuses before calling", e instanceof ProviderRefused);
    expect("and does not call the provider", !ran);
    expect(
      "the reason names the budget, not a generic failure",
      e instanceof ProviderRefused && e.meta.refusal === "budget_exhausted",
    );
    expect("costing nothing", ledger(calls)[0]?.p_credits === 0);
  }
}

console.log("\ncall — a cached answer is served before the budget is consulted");
{
  // Deliberate ordering. A cached answer cost nothing to serve, so refusing
  // it for lack of budget would deny a customer data they already paid for.
  const { db, calls } = fakeDb({
    cache: { body: { items: [{ providerId: "1" }] }, fetchedAt: new Date().toISOString() },
    budget: { allowed: false, used: 100, limit: 100, remaining: 0 },
  });
  let ran = false;
  const result = await callProvider(
    base<{ items: unknown[] }>(db, async () => { ran = true; return { data: { items: [] }, credits: 5, httpStatus: 200 }; }),
  );
  expect("a cache hit is served even with the budget exhausted", result.meta.outcome === "cache_hit");
  expect("without calling the provider", !ran);
  expect("with one item", result.data.items.length === 1);

  // Without this row the hit rate is unmeasurable, and an unmeasured cache is
  // indistinguishable from a broken one.
  const row = ledger(calls)[0];
  expect("a cache hit still writes a ledger row", row?.p_outcome === "cache_hit");
  expect("recording zero credits", row?.p_credits === 0);
}

/* ════ Outcomes ══════════════════════════════════════════════════════════ */

console.log("\ncall — empty, partial and failed are three different facts");
{
  const { db, calls } = fakeDb();
  const result = await callProvider(
    base<{ items: unknown[] }>(db, async () => ({ data: { items: [] }, credits: 1, httpStatus: 200 })),
  );
  expect("a provider that looked and found nothing is `empty`", result.meta.outcome === "empty");
  expect("and it cost a credit, because it was asked", ledger(calls)[0]?.p_credits === 1);
}

{
  const { db } = fakeDb();
  const result = await callProvider(
    base<{ items: unknown[] }>(db, async () => ({
      data: { items: [{ a: 1 }] }, credits: 1, httpStatus: 200, partial: true,
    })),
  );
  // The distinction the whole discovery design rests on: `partial` is a
  // resumable success, not a failure and not completeness.
  expect("a provider that returned less than asked is `partial`", result.meta.outcome === "partial");
  expect("and the data is real", result.data.items.length === 1);
}

console.log("\ncall — a failure is never cached");
{
  const { db, calls } = fakeDb();
  try {
    await callProvider(
      base(db, async () => {
        throw new ProviderError("testvendor", "boom", { httpStatus: 500, retryable: false });
      }),
    );
    fail("a provider failure throws", "did not throw");
  } catch {
    ok("a provider failure throws");
  }

  const row = ledger(calls)[0];
  expect("it is recorded as failed", row?.p_outcome === "failed");
  expect("costing nothing, because nothing was delivered", row?.p_credits === 0);

  // The important half. An outage cached as "no results" would be served for
  // the whole TTL, and a customer would spend a day looking at an empty
  // market that is not empty.
  expect(
    "and nothing was written to the cache",
    !calls.some((c) => c.table === "provider_cache" && c.verb === "upsert"),
  );
}

/* ════ Retries ═══════════════════════════════════════════════════════════ */

console.log("\ncall — retried for transport and rate limits, not for a bad key");
{
  const { db } = fakeDb();
  let attempts = 0;
  const result = await callProvider(
    base<{ items: unknown[] }>(db, async () => {
      attempts++;
      if (attempts < 3) throw new ProviderError("testvendor", "fetch failed", { retryable: true });
      return { data: { items: [{ a: 1 }] }, credits: 1, httpStatus: 200 };
    }),
  );
  expect("a transport failure is retried", attempts === 3);
  expect("and the eventual success is returned", result.meta.outcome === "ok");
  expect("with the attempt count recorded", result.meta.attempts === 3);
}

{
  const { db, calls } = fakeDb();
  let attempts = 0;
  try {
    await callProvider(
      base(db, async () => {
        attempts++;
        throw new ProviderError("testvendor", "rate limited", { httpStatus: 429, rateLimited: true });
      }),
    );
  } catch { /* expected */ }
  expect("a rate limit is retried to the cap", attempts === 3);
  expect(
    "and recorded as rate_limited rather than failed",
    ledger(calls)[0]?.p_outcome === "rate_limited",
  );
}

{
  const { db } = fakeDb();
  let attempts = 0;
  try {
    await callProvider(
      base(db, async () => {
        attempts++;
        throw new ProviderError("testvendor", "rejected the API key", { httpStatus: 401, retryable: false });
      }),
    );
  } catch { /* expected */ }
  // Three attempts against a wrong credential is three times the noise for
  // the same answer, and buries the real failures in the log.
  expect("a rejected key is not retried", attempts === 1);
}

/* ════ The Apollo mapping ════════════════════════════════════════════════ */

console.log("\napollo — email_status is the most important mapping in the package");
{
  const original = globalThis.fetch;
  const respond = (body: unknown, status = 200) => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })) as typeof fetch;
  };

  const adapter = apolloAdapter("test-key");

  respond({ person: { id: "p1", first_name: "A", last_name: "B", email: "a@acme.com", email_status: "verified" } });
  const verified = await adapter.matchPerson!({
    firstName: "A", lastName: "B", title: null, companyDomain: "acme.com", companyName: "Acme",
  });
  const vEmail = verified.data?.contacts.find((c) => c.kind === "email");
  expect("a verified address is high confidence", vEmail?.confidence === "high");
  expect("and marked verified", vEmail?.verified === true);

  // THE test. Apollo returns addresses constructed from a company's pattern.
  // Calling one of those anything above `low`, or `verified`, would launder a
  // guess into a finding — and the bounce lands on the customer's domain.
  for (const status of ["guessed", "unavailable", "extrapolated", "likely_to_engage", undefined]) {
    respond({ person: { id: "p1", first_name: "A", last_name: "B", email: "a@acme.com", email_status: status } });
    const guessed = await adapter.matchPerson!({
      firstName: "A", lastName: "B", title: null, companyDomain: "acme.com", companyName: "Acme",
    });
    const gEmail = guessed.data?.contacts.find((c) => c.kind === "email");
    if (gEmail?.confidence !== "low" || gEmail?.verified !== false) {
      fail(`email_status "${status}" is low and unverified`, JSON.stringify(gEmail));
    } else {
      ok(`email_status "${status}" is low and unverified`);
    }
  }

  console.log("\napollo — a social profile never becomes a company identity");
  respond({
    organizations: [
      { id: "o1", name: "Acme", primary_domain: "acme.com" },
      // Providers return these as websites. If it canonicalized to
      // linkedin.com, every such company would resolve to one row.
      { id: "o2", name: "Globex", website_url: "https://www.linkedin.com/company/globex" },
      // No id: not a company. Counted as `invalid` by the runner, which is
      // how "this provider returns junk" becomes measurable.
      { name: "Nameless" },
    ],
    pagination: { total_entries: 3, total_pages: 1, page: 1 },
  });
  const search = await adapter.searchCompanies!({
    keywords: [], industries: [], locations: [], employeeMin: null, employeeMax: null,
    revenueBands: [], technologies: [], excludeDomains: [], cursor: null, limit: 25,
  });
  expectEqual("a row with no id is dropped", search.data.items.length, 2);
  expectEqual("a real domain survives", search.data.items[0]?.domain, "acme.com");
  expect("a linkedin URL becomes a null domain, not linkedin.com", search.data.items[1]?.domain === null);
  expect("the provider's total is passed through", search.data.total === 3);
  expect("a single complete page is not partial", search.data.partial === false);
  expect("and offers no cursor", search.data.cursor === null);

  respond({
    organizations: [{ id: "o1", name: "Acme", primary_domain: "acme.com" }],
    pagination: { total_entries: 500, total_pages: 20, page: 1 },
  });
  const paged = await adapter.searchCompanies!({
    keywords: [], industries: [], locations: [], employeeMin: null, employeeMax: null,
    revenueBands: [], technologies: [], excludeDomains: [], cursor: null, limit: 25,
  });
  expect("more pages means partial", paged.data.partial === true);
  expectEqual("with a resumable cursor", paged.data.cursor, "2");

  console.log("\napollo — errors are classified so retries are correct");
  respond({}, 401);
  try {
    await adapter.searchCompanies!({
      keywords: [], industries: [], locations: [], employeeMin: null, employeeMax: null,
      revenueBands: [], technologies: [], excludeDomains: [], cursor: null, limit: 25,
    });
    fail("a 401 throws", "did not throw");
  } catch (e) {
    expect("a 401 throws", e instanceof ProviderError);
    expect("and is not retryable", e instanceof ProviderError && !e.retryable);
    expect(
      "and says the key was rejected, not that there were no results",
      e instanceof ProviderError && /rejected the API key/.test(e.message),
    );
  }

  respond({}, 429);
  try {
    await adapter.searchCompanies!({
      keywords: [], industries: [], locations: [], employeeMin: null, employeeMax: null,
      revenueBands: [], technologies: [], excludeDomains: [], cursor: null, limit: 25,
    });
    fail("a 429 throws", "did not throw");
  } catch (e) {
    expect("a 429 is rate-limited and retryable", e instanceof ProviderError && e.rateLimited && e.retryable);
  }

  respond({}, 503);
  try {
    await adapter.searchCompanies!({
      keywords: [], industries: [], locations: [], employeeMin: null, employeeMax: null,
      revenueBands: [], technologies: [], excludeDomains: [], cursor: null, limit: 25,
    });
    fail("a 503 throws", "did not throw");
  } catch (e) {
    expect("a 5xx is retryable", e instanceof ProviderError && e.retryable);
  }

  globalThis.fetch = original;
}

console.log("\napollo — a numeric range becomes a superset of bands, never a subset");
{
  // A superset is filtered at our end, where the exclusion is visible with a
  // reason. A subset would silently drop companies the customer asked for.
  expectEqual("40–60 spans the two bands it touches", employeeRanges(40, 60), ["21,50", "51,100"]);
  expectEqual("an open top reaches the last band", employeeRanges(10001, null).length, 1);
  expectEqual("no range asks for no filter", employeeRanges(null, null), []);
  expect("an open bottom starts at the first band", employeeRanges(null, 10)[0] === "1,10");
}

/* ════ Hunter and ZeroBounce ═════════════════════════════════════════════ */

console.log("\nhunter — a derived address is never called verified");
{
  const original = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ data: { email: "a@acme.com", score: 97 } }), { status: 200 })) as typeof fetch;

  const result = await hunterAdapter("k").matchPerson!({
    firstName: "A", lastName: "B", title: null, companyDomain: "acme.com", companyName: "Acme",
  });
  const email = result.data?.contacts[0];
  expect("a high score is high confidence", email?.confidence === "high");
  // Hunter's score is confidence in a derivation, not an observation that the
  // mailbox exists. `verified` is reserved for something a verifier asserted.
  expect("but never verified", email?.verified === false);
  expect("the raw score is kept, attributed", (result.data?.raw as { score?: number })?.score === 97);
  expect("and the synthesised id is obviously not a Hunter id", result.data?.providerId.startsWith("email:") === true);

  globalThis.fetch = (async () => new Response("{}", { status: 404 })) as typeof fetch;
  const nothing = await hunterAdapter("k").matchPerson!({
    firstName: "A", lastName: "B", title: null, companyDomain: "acme.com", companyName: "Acme",
  });
  expect("a 404 is an answer, not a failure", nothing.data === null);

  globalThis.fetch = original;
}

console.log("\nzerobounce — every ambiguous status rounds down");
{
  const original = globalThis.fetch;
  const cases: Array<[string, string]> = [
    ["valid", "deliverable"],
    ["invalid", "undeliverable"],
    // Technically deliverable, and sending to one is how a domain gets
    // blocklisted. The question being asked is "should we send".
    ["spamtrap", "undeliverable"],
    ["do_not_mail", "undeliverable"],
    ["catch-all", "risky"],
    ["abuse", "risky"],
    ["unknown", "unknown"],
    // A status we have not seen is not a yes.
    ["something_new", "unknown"],
  ];

  let bad = 0;
  for (const [input, expected] of cases) {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ status: input }), { status: 200 })) as typeof fetch;
    const result = await zerobounceAdapter("k").verifyEmail!("a@acme.com");
    if (result.data !== expected) {
      fail(`"${input}" maps to ${expected}`, `got ${result.data}`);
      bad++;
    }
  }
  if (bad === 0) ok(`${cases.length} verification statuses map conservatively`);

  globalThis.fetch = original;
}

/* ════ The registry ══════════════════════════════════════════════════════ */

console.log("\nregistry — nothing is configured until a key says so");
{
  const saved = {
    apollo: process.env.APOLLO_API_KEY,
    enrichment: process.env.ENRICHMENT_API_KEY,
    verify: process.env.EMAIL_VERIFICATION_API_KEY,
  };

  delete process.env.APOLLO_API_KEY;
  delete process.env.ENRICHMENT_API_KEY;
  delete process.env.EMAIL_VERIFICATION_API_KEY;
  resetRegistryForTests();

  // "No provider" is a normal deployment state, and every caller is written
  // around it. The failure to avoid is a product that guesses an address and
  // presents it as a finding.
  expect("with no keys, no capability has a provider", configuredProviders().every((c) => c.provider === null));
  expect("and adapterFor returns null rather than throwing", adapterFor("company.search") === null);

  process.env.APOLLO_API_KEY = "k";
  resetRegistryForTests();
  expect("Apollo serves company search", adapterFor("company.search")?.name === "apollo");
  expect("and person match, when it is the only option", adapterFor("person.match")?.name === "apollo");
  expect("but not verification, which it does not do", adapterFor("email.verify") === null);

  process.env.ENRICHMENT_API_KEY = "k";
  resetRegistryForTests();
  // The specialist wins the capability it specialises in, leaving Apollo's
  // more expensive credits for the searching only Apollo can do.
  expect("Hunter takes person match from Apollo when both are present", adapterFor("person.match")?.name === "hunter");
  expect("and Apollo keeps company search", adapterFor("company.search")?.name === "apollo");

  if (saved.apollo === undefined) delete process.env.APOLLO_API_KEY;
  else process.env.APOLLO_API_KEY = saved.apollo;
  if (saved.enrichment === undefined) delete process.env.ENRICHMENT_API_KEY;
  else process.env.ENRICHMENT_API_KEY = saved.enrichment;
  if (saved.verify === undefined) delete process.env.EMAIL_VERIFICATION_API_KEY;
  else process.env.EMAIL_VERIFICATION_API_KEY = saved.verify;
  resetRegistryForTests();
}

console.log(
  `\n${failures === 0 ? "PASS" : "FAIL"} — ${checks - failures}/${checks} checks passed\n`,
);
process.exit(failures === 0 ? 0 : 1);
