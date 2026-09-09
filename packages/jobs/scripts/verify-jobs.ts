/**
 * Exercises the engine without a network, a database, or a key.
 *
 * What is worth testing here is not "does supabase-js work". It is the set of
 * properties that would keep *looking* correct if they were quietly removed:
 *
 *   · a scope cannot be talked out of its org filter, even by a caller
 *     supplying a different org_id;
 *   · the fetcher refuses the addresses that turn a scan into an SSRF, and
 *     re-checks them on every redirect hop;
 *   · the extractor produces one document per feed item and the same hash for
 *     the same article reached two ways (§60);
 *   · a tick claims, dispatches, records, and stops at its deadline rather
 *     than being killed holding a lock.
 *
 *   npm test --workspace @huntloop/jobs
 */
import { OrgScope, setAdminClientForTests } from "../src/scope.ts";
import { assertFetchable, FetchRefused } from "../src/fetch.ts";
import { canonicalize, extract, urlHash, UnreadableContent } from "../src/extract.ts";
import { sweep, tick } from "../src/runner.ts";
import { HANDLERS } from "../src/registry.ts";
import { sendMessage } from "../src/handlers/send-message.ts";
import { applyClassification, syncMailbox } from "../src/handlers/sync-mailbox.ts";
import { gmail } from "../src/mailbox/gmail.ts";
import { ruleFacts } from "../src/handlers/score-opportunity.ts";
import { detectMentions } from "../src/handlers/resolve-competitor-mentions.ts";
import { icpOverlap, splitList } from "../src/handlers/research-competitor.ts";
import { RULE_FIELDS } from "@huntloop/db/rules";
import type { JobHandler } from "../src/registry.ts";

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

async function expectThrows(name: string, fn: () => unknown, matching?: RegExp) {
  try {
    await fn();
    fail(name, "did not throw");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (matching && !matching.test(message)) fail(name, `threw the wrong thing: ${message}`);
    else ok(name);
  }
}

/* ── A recording stand-in for the admin client ───────────────────────────── */

interface Recorded {
  table: string;
  verb: string;
  filters: [string, unknown][];
  payload?: unknown;
}

/**
 * Just enough of PostgREST's builder to observe what a scope did.
 *
 * Deliberately not a mock of supabase-js. It records the verb, the table, the
 * filters and the payload, and returns an awaitable that yields whatever the
 * test queued — which is all any assertion below needs, and it cannot drift
 * out of agreement with a library it does not imitate.
 */
function fakeClient(responses: Record<string, unknown> = {}) {
  const calls: Recorded[] = [];

  const builder = (record: Recorded) => {
    const chain: Record<string, unknown> = {};
    const passthrough = [
      "eq", "neq", "is", "in", "or", "order", "limit", "lt", "lte", "gt", "gte", "not",
      /* `contains` is how `matchThread` asks whether a thread's participants
         array holds the sender. Added when that path first got a test. */
      "contains",
    ];
    for (const method of passthrough) {
      chain[method] = (column: string, value: unknown) => {
        record.filters.push([`${method}:${column}`, value]);
        return chain;
      };
    }
    chain.select = (columns: string) => {
      if (record.verb === "from") record.verb = "select";
      record.payload = record.payload ?? columns;
      return chain;
    };
    chain.single = () => chain;
    chain.maybeSingle = () => chain;
    chain.then = (resolve: (v: unknown) => unknown) =>
      Promise.resolve(
        responses[`${record.verb}:${record.table}`] ?? { data: null, error: null },
      ).then(resolve);
    return chain;
  };

  const client = {
    from(table: string) {
      const record: Recorded = { table, verb: "from", filters: [] };
      calls.push(record);
      const chain = builder(record) as Record<string, unknown>;
      chain.insert = (rows: unknown) => {
        record.verb = "insert";
        record.payload = rows;
        return chain;
      };
      chain.upsert = (rows: unknown) => {
        record.verb = "upsert";
        record.payload = rows;
        return chain;
      };
      chain.update = (values: unknown) => {
        record.verb = "update";
        record.payload = values;
        return chain;
      };
      chain.delete = () => {
        record.verb = "delete";
        return chain;
      };
      return chain;
    },
    rpc(fn: string, args: unknown) {
      const record: Recorded = { table: fn, verb: "rpc", filters: [], payload: args };
      calls.push(record);
      return Promise.resolve(responses[`rpc:${fn}`] ?? { data: null, error: null });
    },
  };

  /* eslint-disable-next-line @typescript-eslint/no-explicit-any --
     The stand-in implements the surface `OrgScope` uses and nothing else. */
  return { client: client as any, calls };
}

const ORG_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const ORG_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

/* ── OrgScope ────────────────────────────────────────────────────────────── */

console.log("\nOrgScope — the tenant filter is not the handler's to remember");
{
  const { client, calls } = fakeClient();
  const scope = new OrgScope(ORG_A, client);

  await scope.select("companies", "id").eq("id", "x");
  expect(
    "a select is filtered to the scope's org before the caller sees it",
    Boolean(calls[0]?.filters.some(([k, v]) => k === "eq:org_id" && v === ORG_A)),
    JSON.stringify(calls[0]),
  );

  await scope.update("companies", { name: "x" }).eq("id", "y");
  expect(
    "so is an update",
    calls[1]?.verb === "update" &&
      calls[1].filters.some(([k, v]) => k === "eq:org_id" && v === ORG_A),
    JSON.stringify(calls[1]),
  );

  await scope.delete("companies").eq("id", "y");
  expect(
    "so is a delete",
    calls[2]?.verb === "delete" &&
      calls[2].filters.some(([k, v]) => k === "eq:org_id" && v === ORG_A),
    JSON.stringify(calls[2]),
  );
}

{
  // The failure this class exists to make impossible: a handler that copies a
  // row from somewhere and carries its org_id along with it.
  const { client, calls } = fakeClient();
  const scope = new OrgScope(ORG_A, client);

  await scope.insert("companies", { name: "Acme", org_id: ORG_B });
  const inserted = (calls[0]?.payload as { org_id: string }[])[0];
  expectEqual("an insert's org_id is supplied, not honoured", inserted?.org_id, ORG_A);

  await scope.upsert("companies", [{ name: "A", org_id: ORG_B }, { name: "B" }], {
    onConflict: "org_id,canonical_domain",
  });
  const upserted = calls[1]?.payload as { org_id: string }[];
  expectEqual(
    "and every row of an upsert, not just the first",
    upserted.map((r) => r.org_id),
    [ORG_A, ORG_A],
  );
}

await expectThrows(
  "a scope with no org refuses to exist",
  () => new OrgScope("", fakeClient().client),
  /requires an org id/,
);

/* ── The fetcher ─────────────────────────────────────────────────────────── */

console.log("\nfetchPage — the addresses a scan must never be talked into");
{
  const refusals: [string, RegExp][] = [
    ["file:///etc/passwd", /not a scheme/],
    ["gopher://example.com/", /not a scheme/],
    ["http://127.0.0.1:5432/", /private network/],
    ["http://localhost:3000/", /private network/],
    ["http://169.254.169.254/latest/meta-data/", /private network/],
    ["http://10.0.0.5/", /private network/],
    ["http://192.168.1.1/", /private network/],
    ["http://172.16.4.4/", /private network/],
    ["http://[::1]/", /private network/],
    ["not a url at all", /is not a URL/],
  ];
  for (const [url, pattern] of refusals) {
    await expectThrows(`${url} is refused`, () => assertFetchable(url), pattern);
  }
}

{
  // Public addresses pass. Written as a literal IP so the assertion does not
  // depend on DNS, which would make this test fail on a train.
  try {
    const url = await assertFetchable("https://93.184.216.34/feed.xml");
    expectEqual("a public address is allowed through", url.protocol, "https:");
  } catch (error) {
    fail("a public address is allowed through", error);
  }
}

{
  const refusal = new FetchRefused("timed out", true);
  expect("a timeout is marked retryable", refusal.retryable);
  expect("and a bad scheme is not", !new FetchRefused("bad scheme", false).retryable);
}

/* ── The extractor ───────────────────────────────────────────────────────── */

console.log("\nextract — one document per item, whatever the shape");
{
  const rss = `<?xml version="1.0"?>
    <rss version="2.0"><channel>
      <title>Feed</title>
      <item>
        <title>Alphio AI raises $12M</title>
        <link>https://news.test/alphio?utm_source=rss</link>
        <pubDate>Sat, 08 Aug 2026 10:00:00 GMT</pubDate>
        <description><![CDATA[<p>Alphio AI has raised $12 million.</p>]]></description>
      </item>
      <item>
        <title>Northwind hires</title>
        <link>https://news.test/northwind</link>
        <description>Two integration engineers.</description>
      </item>
    </channel></rss>`;

  const result = extract({ url: "https://news.test/feed", contentType: "application/rss+xml", body: rss });
  expectEqual("RSS yields one document per item", result.documents.length, 2);
  expectEqual("titles survive", result.documents[0]?.title, "Alphio AI raises $12M");
  expectEqual(
    "CDATA and markup are unwrapped into text",
    result.documents[0]?.text,
    "Alphio AI has raised $12 million.",
  );
  expectEqual(
    "a date the feed gave is parsed",
    result.documents[0]?.publishedAt?.slice(0, 10),
    "2026-08-08",
  );
  expectEqual(
    "and an item with no date carries null rather than today",
    result.documents[1]?.publishedAt,
    null,
  );
}

{
  const atom = `<?xml version="1.0"?>
    <feed xmlns="http://www.w3.org/2005/Atom">
      <title>Releases</title>
      <entry>
        <title>v2.0 &amp; the new API</title>
        <link rel="alternate" href="https://acme.test/releases/2"/>
        <updated>2026-07-01T00:00:00Z</updated>
        <summary>Ships the thing.</summary>
      </entry>
    </feed>`;

  const result = extract({ url: "https://acme.test/atom", contentType: "application/atom+xml", body: atom });
  expectEqual("Atom is recognised as its own format", result.format, "atom");
  expectEqual("the link comes from the href attribute", result.documents[0]?.url, "https://acme.test/releases/2");
  expectEqual("entities are decoded", result.documents[0]?.title, "v2.0 & the new API");
}

{
  const html = `<!doctype html><html><head>
      <title>About Northwind</title>
      <link rel="canonical" href="https://northwind.test/about"/>
      <link rel="alternate" type="application/rss+xml" href="/feed.xml"/>
      <script>var tracking = 1;</script>
    </head><body>
      <nav><a href="/">Home</a></nav>
      <p>We move freight across the Midwest.</p>
      <footer>© 2026</footer>
    </body></html>`;

  const result = extract({ url: "https://northwind.test/about?utm_campaign=x", contentType: "text/html", body: html });
  expectEqual("HTML is one document, not none", result.documents.length, 1);
  expectEqual("the canonical link wins over the fetched URL", result.documents[0]?.canonicalUrl, "https://northwind.test/about");
  expect(
    "scripts, nav and footer are not prose",
    result.documents[0]?.text === "We move freight across the Midwest.",
    JSON.stringify(result.documents[0]?.text),
  );
  expectEqual(
    "an advertised feed is reported rather than silently adopted",
    result.discoveredFeeds,
    ["https://northwind.test/feed.xml"],
  );
}

await expectThrows(
  "a PDF is refused with its content type in the message",
  () => extract({ url: "https://x.test/a.pdf", contentType: "application/pdf", body: "%PDF-1.7" }),
  /application\/pdf/,
);
expect(
  "and the refusal is its own type, so the caller can stop retrying",
  (() => {
    try {
      extract({ url: "https://x.test/a.pdf", contentType: "application/pdf", body: "%PDF" });
      return false;
    } catch (e) {
      return e instanceof UnreadableContent;
    }
  })(),
);

console.log("\n§60 — the same page reached two ways is one page");
{
  const cases: [string, string][] = [
    ["https://news.test/alphio?utm_source=rss", "https://news.test/alphio"],
    ["https://www.news.test/alphio/", "https://news.test/alphio"],
    ["https://news.test/alphio#section", "https://news.test/alphio"],
    ["https://news.test/alphio?gclid=abc&id=7", "https://news.test/alphio?id=7"],
  ];
  let allRight = true;
  for (const [messy, clean] of cases) {
    if (urlHash(messy) !== urlHash(clean)) {
      allRight = false;
      fail(`${messy} hashes as ${clean}`, `${canonicalize(messy)} !== ${canonicalize(clean)}`);
    }
  }
  if (allRight) ok("tracking parameters, www, fragments and trailing slashes collapse");

  expect(
    "but a real query parameter is kept — it is a different page",
    urlHash("https://news.test/a?page=2") !== urlHash("https://news.test/a?page=3"),
  );
}

/* ── The runner ──────────────────────────────────────────────────────────── */

console.log("\ntick — claim, dispatch, record, and stop before being killed");
{
  const original = { ...HANDLERS };
  const ran: string[] = [];

  const queue = [
    { id: "j1", org_id: ORG_A, job_name: "scan_source", status: "running", attempts: 1, max_attempts: 3, payload: { sourceId: "s1" }, run_at: new Date().toISOString(), error: null },
    { id: "j2", org_id: ORG_A, job_name: "scan_source", status: "running", attempts: 1, max_attempts: 3, payload: { sourceId: "s2" }, run_at: new Date().toISOString(), error: null },
  ];

  const { client, calls } = fakeClient({
    "rpc:claim_job_executions": { data: queue, error: null },
    "rpc:requeue_stalled_jobs": { data: 2, error: null },
  });
  setAdminClientForTests(client);

  (HANDLERS as Record<string, JobHandler>).scan_source = async (ctx) => {
    ran.push(String(ctx.payload.sourceId));
    return ctx.payload.sourceId === "s2"
      ? { ok: false, error: "the feed timed out" }
      : { ok: true, result: { documents: 3 } };
  };

  const report = await tick({ limit: 2, worker: "test" });

  expectEqual("both jobs ran", ran, ["s1", "s2"]);
  expectEqual("the report counts each outcome", [report.succeeded, report.failed], [1, 1]);
  expectEqual("abandoned work is recovered before new work is claimed", report.requeued, 2);
  expect(
    "the requeue happens first, not after",
    calls.findIndex((c) => c.table === "requeue_stalled_jobs") <
      calls.findIndex((c) => c.table === "claim_job_executions"),
    calls.map((c) => c.table).join(" → "),
  );
  expect(
    "a failure is written back to its own row, not to the tick",
    calls.some(
      (c) =>
        c.table === "job_executions" &&
        c.verb === "update" &&
        (c.payload as { error?: string })?.error === "the feed timed out",
    ),
    JSON.stringify(calls.filter((c) => c.table === "job_executions").map((c) => c.payload)),
  );

  Object.assign(HANDLERS, original);
  setAdminClientForTests(null);
}

{
  const original = { ...HANDLERS };
  let ranAnything = false;

  const { client, calls } = fakeClient({
    "rpc:claim_job_executions": {
      data: [
        { id: "j1", org_id: ORG_A, job_name: "scan_source", status: "running", attempts: 1, max_attempts: 3, payload: {}, run_at: new Date().toISOString(), error: null },
      ],
      error: null,
    },
    "rpc:requeue_stalled_jobs": { data: 0, error: null },
  });
  setAdminClientForTests(client);
  (HANDLERS as Record<string, JobHandler>).scan_source = async () => {
    ranAnything = true;
    return { ok: true, result: {} };
  };

  // A deadline already inside the reserve window: the runner is about to be
  // killed, and starting a job now guarantees a row stuck in `running` that
  // only the ten-minute sweeper can recover.
  const report = await tick({ deadline: new Date(Date.now() + 1_000), reserveMs: 20_000 });

  expect("a job is not started when there is no time to finish it", !ranAnything);
  expect("and the tick says it stopped early", report.stoppedEarly);
  expect(
    "the claimed job goes back to the queue rather than being lost",
    calls.some(
      (c) =>
        c.verb === "update" &&
        (c.payload as { status?: string })?.status === "queued",
    ),
    JSON.stringify(calls.filter((c) => c.verb === "update").map((c) => c.payload)),
  );

  Object.assign(HANDLERS, original);
  setAdminClientForTests(null);
}

{
  const original = { ...HANDLERS };
  const { client, calls } = fakeClient({
    "rpc:claim_job_executions": {
      data: [
        { id: "j1", org_id: ORG_A, job_name: "scan_source", status: "running", attempts: 1, max_attempts: 3, payload: {}, run_at: new Date().toISOString(), error: null },
        { id: "j2", org_id: ORG_A, job_name: "scan_source", status: "running", attempts: 1, max_attempts: 3, payload: {}, run_at: new Date().toISOString(), error: null },
      ],
      error: null,
    },
    "rpc:requeue_stalled_jobs": { data: 0, error: null },
  });
  setAdminClientForTests(client);

  let second = false;
  (HANDLERS as Record<string, JobHandler>).scan_source = async () => {
    if (!second) {
      second = true;
      throw new Error("kaboom");
    }
    return { ok: true, result: {} };
  };

  const report = await tick({ limit: 2 });
  expectEqual("one job throwing does not end the tick", [report.succeeded, report.failed], [1, 1]);
  expect(
    "a thrown error keeps its retries — it is usually transient",
    calls.some(
      (c) =>
        c.verb === "update" &&
        (c.payload as { status?: string; error?: string })?.status === "queued" &&
        /kaboom/.test(String((c.payload as { error?: string })?.error)),
    ),
    JSON.stringify(calls.filter((c) => c.verb === "update").map((c) => c.payload)),
  );

  Object.assign(HANDLERS, original);
  setAdminClientForTests(null);
}

{
  const { client } = fakeClient({
    "rpc:claim_job_executions": {
      data: [
        { id: "j1", org_id: null, job_name: "scan_source", status: "running", attempts: 1, max_attempts: 3, payload: {}, run_at: new Date().toISOString(), error: null },
      ],
      error: null,
    },
    "rpc:requeue_stalled_jobs": { data: 0, error: null },
  });
  setAdminClientForTests(client);

  const report = await tick({ limit: 1 });
  expectEqual(
    "a job with no org is refused rather than run against every tenant",
    report.jobs[0]?.detail,
    "no org_id",
  );
  setAdminClientForTests(null);
}

/* ── The sweep ───────────────────────────────────────────────────────────── */

console.log("\nsweep — the heartbeat that puts periodic work into the queue");

{
  const { client, calls } = fakeClient();
  setAdminClientForTests(client);

  await sweep();

  const enqueued = calls
    .filter((c) => c.table === "job_executions" && c.verb === "insert")
    .map((c) => c.payload as Record<string, unknown>);

  expectEqual(
    "every sweeper is enqueued, and nothing else is",
    enqueued.map((row) => row.job_name).sort(),
    [
      "advance_enrollments",
      /* Retention, added with the compliance jobs. Keyed daily rather than
         per-tick — see `DAILY` in the runner. */
      "enforce_retention",
      /* Added with `0014`. Listed explicitly rather than derived from
         `SWEEPERS`, so adding a cross-tenant job is a deliberate two-line
         change — the set is the most consequential list in the engine, and a
         test that read it from the source would assert nothing about it. */
      "schedule_discovery",
      "schedule_learning",
      "schedule_recomputes",
      "schedule_scans",
      "schedule_sends",
      "schedule_syncs",
    ],
  );
  expect(
    "each carries no org — a sweeper is the cross-tenant question",
    enqueued.every((row) => row.org_id === null),
    JSON.stringify(enqueued.map((row) => row.org_id)),
  );
  /* The per-tick sweepers key on their own name, so a slow sweep is not
     started twice. `schedule_learning` keys on name-plus-hour instead, which
     is the same guarantee with a coarser clock: its answer changes weekly, and
     asking it twice a minute is two cross-tenant queries a minute forever for
     the same result. Asserted as two separate rules rather than one loose one,
     because "the key contains the name" would pass for a sweeper that had
     silently stopped collapsing at all. */
  expect(
    "a per-tick sweeper is idempotent on its own name",
    enqueued
      .filter((row) => row.job_name !== "schedule_learning" && row.job_name !== "enforce_retention")
      .every((row) => row.idempotency_key === row.job_name),
    JSON.stringify(enqueued.map((row) => row.idempotency_key)),
  );
  expect(
    "the learning sweep collapses to one an hour rather than one a tick",
    enqueued
      .filter((row) => row.job_name === "schedule_learning")
      .every((row) =>
        /^schedule_learning:\d{4}-\d{2}-\d{2}T\d{2}$/.test(String(row.idempotency_key)),
      ),
    JSON.stringify(enqueued.map((row) => row.idempotency_key)),
  );
  expect(
    "the retention sweep collapses to one a day — its answer changes daily at most",
    enqueued
      .filter((row) => row.job_name === "enforce_retention")
      .every((row) =>
        /^enforce_retention:\d{4}-\d{2}-\d{2}$/.test(String(row.idempotency_key)),
      ),
    JSON.stringify(enqueued.map((row) => row.idempotency_key)),
  );
  expect(
    "and none is retried — the next tick asks the same question of fresher rows",
    enqueued.every((row) => row.max_attempts === 1),
    JSON.stringify(enqueued.map((row) => row.max_attempts)),
  );

  setAdminClientForTests(null);
}

{
  /* The complement of "a job with no org is refused": the sweepers are the
     jobs for which that is not a bug, and the runner has to tell them apart by
     name. A regression here is silent in both directions — either the engine
     stops sweeping, or an ordinary job starts running unscoped. */
  const original = { ...HANDLERS };
  let sawOrg: string | null = null;

  const { client } = fakeClient({
    "rpc:claim_job_executions": {
      data: [
        { id: "j1", org_id: null, job_name: "schedule_syncs", status: "running", attempts: 1, max_attempts: 1, payload: {}, run_at: new Date().toISOString(), error: null },
      ],
      error: null,
    },
    "rpc:requeue_stalled_jobs": { data: 0, error: null },
  });
  setAdminClientForTests(client);

  (HANDLERS as Record<string, JobHandler>).schedule_syncs = async (ctx) => {
    sawOrg = ctx.scope.orgId;
    return { ok: true, result: {} };
  };

  const report = await tick({ limit: 1 });

  expectEqual("a sweeper runs without an org id", report.succeeded, 1);
  expectEqual(
    "under the nil uuid, which matches no row — so a scoped read returns nothing",
    sawOrg,
    "00000000-0000-0000-0000-000000000000",
  );

  Object.assign(HANDLERS, original);
  setAdminClientForTests(null);
}

{
  /* Totality is enforced by the type of `HANDLERS`, which is exactly why this
     check is here: a `Record<JobName, JobHandler>` satisfied by a cast, or by
     a stale build, compiles and then fails at runtime as "no handler" — three
     retries after the work was queued. */
  expectEqual(
    "every job name that can be enqueued has a handler",
    Object.entries(HANDLERS)
      .filter(([, handler]) => typeof handler !== "function")
      .map(([name]) => name),
    [],
  );
}

/* ── send_message — the handler with no undo ─────────────────────────────── */

/**
 * §78 and §46, as behaviour rather than as comments.
 *
 * This handler had no tests, which is worth saying plainly: it is the one
 * place in the product that puts mail in a stranger's inbox, and every guard
 * in it — already-sent, approved, suppressed, allowance — was verified only by
 * reading. A scan that runs twice costs a little money; a send that runs twice
 * costs a prospect.
 *
 * `authorize()` and the provider are reached through the real code path rather
 * than stubbed out: the token is genuinely encrypted with a test key and
 * genuinely decrypted, and only the provider's `send` is replaced. What is
 * being tested is the order of the checks, so anything that would let a check
 * be skipped has to stay real.
 */

const MESSAGE_ID = "11111111-1111-1111-1111-111111111111";
const MAILBOX_ID = "22222222-2222-2222-2222-222222222222";

process.env.MAILBOX_ENCRYPTION_KEY = "a".repeat(64);
const { encryptSecret } = await import("@huntloop/db");

/** A message that would send, so each test can spoil exactly one thing. */
function sendable(overrides: Record<string, unknown> = {}) {
  return {
    id: MESSAGE_ID,
    enrollment_id: null,
    mailbox_id: MAILBOX_ID,
    thread_id: null,
    direction: "outbound",
    subject: "The policy layer your agents are missing",
    body_text: "How are you gating custody today?",
    body_html: null,
    to_email: "dana@acme.co",
    sent_at: null,
    scheduled_at: new Date().toISOString(),
    unsubscribe_token: "44444444-4444-4444-4444-444444444444",
    provider_message_id: null,
    ...overrides,
  };
}

/** A connected mailbox whose token is valid for another hour. */
function connectedMailbox() {
  return {
    id: MAILBOX_ID,
    email: "founder@huntloop.test",
    provider: "gmail",
    status: "connected",
    oauth_token_enc: encryptSecret("test-access-token"),
    refresh_token_enc: encryptSecret("test-refresh-token"),
    token_expires_at: new Date(Date.now() + 3600_000).toISOString(),
    sync_cursor: null,
    daily_limit: 50,
  };
}

function sendContext(message: Record<string, unknown>, responses: Record<string, unknown> = {}) {
  const { client, calls } = fakeClient({
    "select:messages": { data: message, error: null },
    "select:mailboxes": { data: connectedMailbox(), error: null },
    /* `0017`'s single gate. Returned as a one-row array because it is a
       `returns table`, which is what PostgREST hands back — and the handler
       reading only the first element of an object would be a bug this stub
       must be able to catch. */
    "rpc:can_contact": { data: [{ allowed: true, reason: "ok", detail: {} }], error: null },
    "rpc:claim_mailbox_send": { data: true, error: null },
    "insert:threads": { data: { id: "55555555-5555-5555-5555-555555555555" }, error: null },
    ...responses,
  });
  setAdminClientForTests(client);
  return {
    calls,
    ctx: {
      scope: new OrgScope(ORG_A, client),
      payload: { messageId: MESSAGE_ID },
      job: { id: "job-1", org_id: ORG_A, job_name: "send_message" } as never,
      now: new Date(),
    },
  };
}

/** Did anything write a send time? The one question these tests keep asking. */
function markedSent(calls: Recorded[]): boolean {
  return calls.some(
    (c) =>
      c.table === "messages" &&
      c.verb === "update" &&
      Boolean((c.payload as { sent_at?: string })?.sent_at),
  );
}

console.log("\nsend_message — the checks that stop a second send");

{
  /* Step 1. The queue is at-least-once by design, so this branch is the only
     thing between a retried job and a prospect receiving the same email
     twice. */
  const { ctx, calls } = sendContext(
    sendable({ sent_at: new Date().toISOString(), provider_message_id: "gmail-1" }),
  );
  const outcome = await sendMessage(ctx);

  expect("an already-sent message is skipped rather than resent", outcome.ok);
  expectEqual(
    "and says so, with the provider id that proves it went",
    (outcome as { result: Record<string, unknown> }).result.skipped,
    "already sent",
  );
  expect("nothing was sent again", !markedSent(calls));
  setAdminClientForTests(null);
}

{
  // §46's ladder. At autonomy 0–1 a person approves; a message in the queue
  // without `scheduled_at` means something enqueued work it should not have.
  const { ctx, calls } = sendContext(sendable({ scheduled_at: null }));
  const outcome = await sendMessage(ctx);

  expect("an unapproved message is refused", !outcome.ok);
  expect(
    "permanently — retrying will not make a person approve it",
    (outcome as { permanent?: boolean }).permanent === true,
  );
  expect("and it is not sent", !markedSent(calls));
  setAdminClientForTests(null);
}

{
  const { ctx, calls } = sendContext(sendable({ direction: "inbound" }));
  const outcome = await sendMessage(ctx);
  expect("an inbound message is never sent", !outcome.ok && !markedSent(calls));
  setAdminClientForTests(null);
}

{
  const { ctx, calls } = sendContext(sendable({ to_email: null }));
  const outcome = await sendMessage(ctx);
  expect("a message with no recipient is refused rather than sent nowhere", !outcome.ok);
  expect("and not marked sent", !markedSent(calls));
  setAdminClientForTests(null);
}

console.log("\nsend_message — an unsubscribe that lands mid-approval still wins");

{
  /* Step 2. `advance_enrollments` already checked suppression, and it is
     checked again here because the gap between drafting and sending can be
     days when a human is approving. */
  const { ctx, calls } = sendContext(sendable(), {
    "rpc:can_contact": { data: [{ allowed: false, reason: "suppressed", detail: {} }], error: null },
  });
  const outcome = await sendMessage(ctx);

  expect("a suppressed recipient is not written to", outcome.ok && !markedSent(calls));
  expectEqual(
    "and the skip names the reason",
    (outcome as { result: Record<string, unknown> }).result.skipped,
    "suppressed",
  );
  expect(
    "the refusal is recorded against the message, not only in the job log",
    calls.some(
      (c) =>
        c.table === "messages" &&
        c.verb === "update" &&
        /suppression list/.test(String((c.payload as { error?: string })?.error)),
    ),
  );
  expect(
    "and a failed event goes on the timeline",
    calls.some((c) => c.table === "message_events" && c.verb === "insert"),
  );
  setAdminClientForTests(null);
}

console.log("\nsend_message — OUT-01: the cap that existed and was never asked");
{
  /* The gap this closes. `can_contact` covers five refusals; the handler used
     to call `is_suppressed`, which is one of them. A two-day cadence was
     configurable, documented, tested in SQL — and unenforced by the only code
     that sends mail. */
  const { ctx, calls } = sendContext(sendable(), {
    "rpc:can_contact": {
      data: [{ allowed: false, reason: "too_soon", detail: { minDays: 2 } }],
      error: null,
    },
  });
  const outcome = await sendMessage(ctx);

  expect("a contact inside the cadence window is not written to", !markedSent(calls));
  expect(
    "and it stays retryable — 'too soon' becomes 'fine' on its own",
    !outcome.ok,
    JSON.stringify(outcome),
  );
  expect(
    "the reason on the message names the setting rather than a code",
    calls.some(
      (c) =>
        c.table === "messages" &&
        c.verb === "update" &&
        /every 2 days/.test(String((c.payload as { error?: string })?.error)),
    ),
    JSON.stringify(calls.filter((c) => c.table === "messages").map((c) => c.payload)),
  );
  setAdminClientForTests(null);
}

{
  // Erasure's whole point: the plaintext address is gone, only the hash
  // remains, and `is_suppressed` therefore finds nothing.
  const { ctx, calls } = sendContext(sendable(), {
    "rpc:can_contact": {
      data: [{ allowed: false, reason: "org_daily_cap", detail: { sentToday: 200, cap: 200 } }],
      error: null,
    },
  });
  const outcome = await sendMessage(ctx);
  expect("an org at its daily ceiling sends nothing further", !markedSent(calls) && !outcome.ok);
  setAdminClientForTests(null);
}

{
  /* Every other quota in this codebase fails open, and is right to. This one
     must not: the cost of being wrong is an email to somebody who asked never
     to hear from us, and it cannot be recalled. */
  const { ctx, calls } = sendContext(sendable(), {
    "rpc:can_contact": { data: null, error: { message: "function does not exist" } },
  });
  const outcome = await sendMessage(ctx);
  expect(
    "a safety check that cannot be read fails CLOSED, unlike every budget in this codebase",
    !markedSent(calls) && !outcome.ok,
    JSON.stringify(outcome),
  );
  setAdminClientForTests(null);
}

{
  /* Order matters as much as presence. The safety check has to come before the
     mailbox allowance is claimed, or a refused message still consumes one of
     the day's sends from a limit somebody is paying for.

     The send itself needs a provider and a token, so these tests stop at the
     mailbox; `record_contact_send` after a successful send is covered by
     `0017`'s own suite, which can run the counter for real. */
  const { ctx, calls } = sendContext(sendable(), {
    /* Stopped at the allowance on purpose. Letting this run on would reach
       `provider.send`, which is a real HTTP request to a mail API — a test
       that tries to send mail is not a test. */
    "rpc:claim_mailbox_send": { data: false, error: null },
  });
  await sendMessage(ctx);
  const rpcs = calls.filter((c) => c.verb === "rpc").map((c) => c.table);
  expect(
    "the contact-safety check runs before the mailbox allowance is claimed",
    rpcs.indexOf("can_contact") >= 0 &&
      rpcs.indexOf("can_contact") < rpcs.indexOf("claim_mailbox_send"),
    JSON.stringify(rpcs),
  );
  setAdminClientForTests(null);
}

console.log("\nsend_message — the allowance is claimed before the send, not after");

{
  const { ctx, calls } = sendContext(sendable(), {
    "rpc:claim_mailbox_send": { data: false, error: null },
  });
  const outcome = await sendMessage(ctx);

  expect("a mailbox out of allowance does not send", !outcome.ok && !markedSent(calls));
  expect(
    "and the failure is retryable — tomorrow the allowance resets",
    (outcome as { permanent?: boolean }).permanent !== true,
  );
  setAdminClientForTests(null);
}

console.log("\nsend_message — §78: sent means sent, and failed means failed");

{
  const original = gmail.send;
  const { ctx, calls } = sendContext(sendable());
  gmail.send = async () => ({
    providerMessageId: "gmail-abc",
    providerThreadId: "thread-abc",
    messageIdHeader: "<abc@mail.gmail.com>",
  });

  const outcome = await sendMessage(ctx);
  gmail.send = original;

  expect("a successful send reports the provider id", outcome.ok);

  const written = calls.find(
    (c) => c.table === "messages" && c.verb === "update" && (c.payload as { sent_at?: string })?.sent_at,
  )?.payload as Record<string, unknown> | undefined;

  expect("the send time is written", Boolean(written?.sent_at));
  expectEqual(
    "together with the provider id, because 0004's CHECK refuses one without the other",
    written?.provider_message_id,
    "gmail-abc",
  );
  expectEqual(
    "and the Message-ID, so a reply can be matched back to it",
    written?.message_id_header,
    "<abc@mail.gmail.com>",
  );
  setAdminClientForTests(null);
}

{
  const original = gmail.send;
  const { ctx, calls } = sendContext(sendable());
  gmail.send = async () => {
    throw new Error("550 mailbox unavailable");
  };

  const outcome = await sendMessage(ctx);
  gmail.send = original;

  expect("a provider failure fails the job", !outcome.ok);
  expect(
    "and the message is NOT marked sent — §78, the rule this handler exists for",
    !markedSent(calls),
  );
  expect(
    "the reason is on the row, where the person reading the inbox will find it",
    calls.some(
      (c) =>
        c.table === "messages" &&
        c.verb === "update" &&
        /550 mailbox unavailable/.test(String((c.payload as { error?: string })?.error)),
    ),
  );
  expect(
    "and a failed event is recorded rather than a delivered one",
    calls.some(
      (c) =>
        c.table === "message_events" &&
        c.verb === "insert" &&
        /* `scope.insert` normalises to a list, so the row is payload[0]. */
        (c.payload as { kind?: string }[])?.[0]?.kind === "failed",
    ),
  );
  setAdminClientForTests(null);
}

/* ── sync_mailbox — what a reply does, and what it must not do ───────────── */

/**
 * §78: "a sequence that keeps sending after a reply is the single most
 * damaging bug this system can have." That sentence was in the file's own
 * header and nothing tested it.
 *
 * Two layers here. The storage path runs through the real handler, including
 * the real `authorize()` — with no `ANTHROPIC_API_KEY` in the test
 * environment, classification is skipped, which is itself a behaviour worth
 * pinning: the messages are still stored and simply unclassified. The
 * classification consequences are driven through `applyClassification`
 * directly, because reaching them through the handler means making a model
 * call the suite deliberately cannot make.
 */

const THREAD_ID = "66666666-6666-6666-6666-666666666666";
const OPPORTUNITY_ID = "77777777-7777-7777-7777-777777777777";
const INBOUND_ID = "88888888-8888-8888-8888-888888888888";

function incoming(overrides: Record<string, unknown> = {}) {
  return {
    providerMessageId: "gmail-in-1",
    providerThreadId: "thread-abc",
    messageIdHeader: "<reply@mail.acme.co>",
    inReplyTo: "<abc@mail.gmail.com>",
    from: "dana@acme.co",
    to: "founder@huntloop.test",
    subject: "Re: The policy layer your agents are missing",
    text: "Interesting — how does it handle multisig?",
    receivedAt: new Date().toISOString(),
    ...overrides,
  };
}

function syncContext(messages: Record<string, unknown>[], responses: Record<string, unknown> = {}) {
  const { client, calls } = fakeClient({
    "select:mailboxes": { data: connectedMailbox(), error: null },
    // No row with this provider id yet, so the message is new.
    "select:messages": { data: null, error: null },
    "insert:messages": { data: { id: INBOUND_ID }, error: null },
    "select:threads": { data: null, error: null },
    ...responses,
  });
  setAdminClientForTests(client);

  const original = gmail.sync;
  gmail.sync = async () => ({ messages: messages as never, cursor: "cursor-2" });

  return {
    calls,
    restore: () => {
      gmail.sync = original;
      setAdminClientForTests(null);
    },
    ctx: {
      scope: new OrgScope(ORG_A, client),
      payload: { mailboxId: MAILBOX_ID },
      job: { id: "job-2", org_id: ORG_A, job_name: "sync_mailbox" } as never,
      now: new Date(),
    },
  };
}

console.log("\nsync_mailbox — what gets stored, and what does not");

{
  const { ctx, calls, restore } = syncContext([incoming()]);
  const outcome = await syncMailbox(ctx);
  restore();

  expect("an arriving reply is stored", outcome.ok);
  const inserted = calls.find((c) => c.table === "messages" && c.verb === "insert")
    ?.payload as Record<string, unknown>[] | undefined;
  expectEqual("as inbound", inserted?.[0]?.direction, "inbound");
  expectEqual(
    "with the sender's own Message-ID, so our reply can thread against it",
    inserted?.[0]?.message_id_header,
    "<reply@mail.acme.co>",
  );
  expect(
    "and the cursor is written back, so the next sync does not re-read it",
    calls.some(
      (c) =>
        c.table === "mailboxes" &&
        c.verb === "update" &&
        (c.payload as { sync_cursor?: string })?.sync_cursor === "cursor-2",
    ),
  );
}

{
  /* Our own sends come back through the sync on some providers. Storing one
     would create a second row for a message already recorded and — worse —
     classify our own copy as a reply from the prospect. */
  const { ctx, calls, restore } = syncContext([
    incoming({ from: "founder@huntloop.test" }),
  ]);
  await syncMailbox(ctx);
  restore();

  expect(
    "a message from our own address is not stored as a reply",
    !calls.some((c) => c.table === "messages" && c.verb === "insert"),
  );
}

{
  const { ctx, calls, restore } = syncContext([incoming()], {
    "select:messages": { data: { id: "already-here" }, error: null },
  });
  await syncMailbox(ctx);
  restore();

  expect(
    "a message already stored is not stored twice — the sync is at-least-once too",
    !calls.some((c) => c.table === "messages" && c.verb === "insert"),
  );
}

{
  /* With no API key the classifier cannot run. The messages must still land:
     an unmatched or unclassified reply is still a human being answering, and
     dropping it would make the product look like it loses mail. */
  const { ctx, calls, restore } = syncContext([incoming()]);
  const outcome = await syncMailbox(ctx);
  restore();

  expect("with no model configured the message is still stored", outcome.ok);
  expect(
    "and it is stored, not discarded",
    calls.some((c) => c.table === "messages" && c.verb === "insert"),
  );
  expect(
    "no classification is invented for it",
    !calls.some((c) => c.table === "threads" && c.verb === "update"),
  );
}

console.log("\nsync_mailbox — §78: a reply stops the sequence");

/** Drives the consequences of one classification and reports what was written. */
async function classify(label: string, extra: Record<string, unknown> = {}) {
  const { client, calls } = fakeClient({
    "select:threads": { data: { opportunity_id: OPPORTUNITY_ID }, error: null },
    ...extra,
  });
  setAdminClientForTests(client);

  await applyClassification(
    {
      scope: new OrgScope(ORG_A, client),
      payload: {},
      job: { id: "job-3", org_id: ORG_A, job_name: "sync_mailbox" } as never,
      now: new Date(),
    },
    {
      messageId: INBOUND_ID,
      threadId: THREAD_ID,
      from: "dana@acme.co",
      classification: {
        label,
        summary: "They asked how it handles multisig.",
        confidence: "high",
        needsHuman: label !== "out_of_office",
      } as never,
    },
  );

  setAdminClientForTests(null);
  return calls;
}

/** Did anything stop the enrollment? */
function stopped(calls: Recorded[]): boolean {
  return calls.some(
    (c) =>
      c.table === "enrollments" &&
      c.verb === "update" &&
      (c.payload as { status?: string })?.status === "stopped",
  );
}

{
  const calls = await classify("positive");

  expect("a positive reply stops the enrollment", stopped(calls));
  expect(
    "and clears its next action, so nothing is waiting to fire",
    calls.some(
      (c) =>
        c.table === "enrollments" &&
        c.verb === "update" &&
        (c.payload as { next_action_at?: string | null })?.next_action_at === null,
    ),
  );
  expect(
    "the opportunity moves to replied",
    calls.some(
      (c) =>
        c.table === "opportunities" &&
        c.verb === "update" &&
        (c.payload as { status?: string })?.status === "replied",
    ),
  );
  expect(
    "and a positive outcome is recorded as its own kind, not collapsed into 'reply'",
    calls.some(
      (c) =>
        c.table === "outcomes" &&
        c.verb === "insert" &&
        (c.payload as { kind?: string }[])?.[0]?.kind === "positive",
    ),
  );
}

{
  const calls = await classify("negative");
  expect("a negative reply stops the sequence just the same", stopped(calls));
  expect(
    "and is recorded as a reply rather than as positive",
    calls.some(
      (c) =>
        c.table === "outcomes" &&
        c.verb === "insert" &&
        (c.payload as { kind?: string }[])?.[0]?.kind === "reply",
    ),
  );
}

{
  /* The one exception, and it has to be an exception: the person is back next
     week and the follow-up is the entire point of the sequence. */
  const calls = await classify("out_of_office");
  expect("an out-of-office does NOT stop the sequence", !stopped(calls));
  expect(
    "and does not move the opportunity to replied",
    !calls.some((c) => c.table === "opportunities" && c.verb === "update"),
  );
}

{
  const calls = await classify("bounce");

  expect(
    "a bounce marks the address undeliverable, which stops every future campaign",
    calls.some(
      (c) =>
        c.table === "contact_points" &&
        c.verb === "update" &&
        (c.payload as { verification_status?: string })?.verification_status === "undeliverable",
    ),
  );
  expect("it stops this enrollment too", stopped(calls));
  expect(
    "but the opportunity is NOT moved to replied — a bounce is not an answer",
    !calls.some(
      (c) =>
        c.table === "opportunities" &&
        c.verb === "update" &&
        (c.payload as { status?: string })?.status === "replied",
    ),
  );
}

{
  const calls = await classify("unsubscribe");

  expect(
    "an unsubscribe is written to the suppression list, not just to the thread",
    calls.some((c) => c.table === "suppressions" && c.verb === "upsert"),
  );
  expect("and it stops the sequence", stopped(calls));
}

{
  /* A reply on a thread with no opportunity behind it still has to be safe:
     there is nothing to stop, and nothing should be invented to stop. */
  const calls = await classify("positive", {
    "select:threads": { data: { opportunity_id: null }, error: null },
  });
  expect("a reply with no opportunity behind it stops nothing", !stopped(calls));
  expect(
    "and the reply is still recorded against the thread",
    calls.some((c) => c.table === "threads" && c.verb === "update"),
  );
}

/* ── The backlog cap ─────────────────────────────────────────────────────── */

console.log("\nschedule_scans — an org drowning in unworked opportunities is not given more");
{
  const due = [
    { id: "src_a", org_id: ORG_A, next_scan_at: null },
    { id: "src_b", org_id: ORG_B, next_scan_at: null },
  ];

  const { client, calls } = fakeClient({
    "select:sources": { data: due, error: null },
    /* PostgREST returns a `setof uuid` as bare scalars. The handler reads both
       shapes on purpose — a future change from one to the other must not
       silently produce an empty set, which would disable the cap while every
       log line still said it was running. */
    "rpc:saturated_org_ids": { data: [ORG_A], error: null },
    "insert:job_executions": { data: { id: "job_1" }, error: null },
  });
  setAdminClientForTests(client);

  const outcome = await HANDLERS.schedule_scans({
    scope: new OrgScope(ORG_A, client),
    payload: {},
    job: {} as never,
    now: new Date(),
  });

  const enqueued = calls
    .filter((c) => c.table === "job_executions" && c.verb === "insert")
    .map((c) => c.payload as Record<string, unknown>);

  expectEqual(
    "only the org below its cap is enqueued",
    enqueued.map((row) => row.org_id),
    [ORG_B],
  );
  expect(
    "and the skip is reported rather than silent",
    outcome.ok && outcome.result.skipped_backlog_full === 1,
    JSON.stringify(outcome),
  );
  expect(
    "the saturated source's schedule is NOT pushed forward",
    !calls.some((c) => c.table === "sources" && c.verb === "update"),
    "a source pushed an interval into the future for being behind would drift out of schedule permanently",
  );

  setAdminClientForTests(null);
}

console.log("\nschedule_scans — a cap that cannot be read does not stop the engine");
{
  const { client, calls } = fakeClient({
    "select:sources": { data: [{ id: "src_a", org_id: ORG_A, next_scan_at: null }], error: null },
    "rpc:saturated_org_ids": { data: null, error: { message: "function does not exist" } },
    "insert:job_executions": { data: { id: "job_1" }, error: null },
  });
  setAdminClientForTests(client);

  const outcome = await HANDLERS.schedule_scans({
    scope: new OrgScope(ORG_A, client),
    payload: {},
    job: {} as never,
    now: new Date(),
  });

  expect(
    "backpressure fails open — the cost of that is a reconciliation, and it is ours",
    outcome.ok && outcome.result.enqueued === 1,
    JSON.stringify(outcome),
  );
  expect(
    "and a scan is still enqueued",
    calls.some((c) => c.table === "job_executions" && c.verb === "insert"),
  );

  setAdminClientForTests(null);
}

/* ── The learning sweeper ────────────────────────────────────────────────── */

console.log("\nschedule_learning — a request beats the schedule");
{
  const { client, calls } = fakeClient({
    "select:learning_runs": {
      data: [
        {
          id: "run_1",
          org_id: ORG_A,
          window_start: "2026-03-01T00:00:00.000Z",
          window_end: "2026-06-01T00:00:00.000Z",
        },
      ],
      error: null,
    },
    "select:outcomes": { data: [], error: null },
    "insert:job_executions": { data: { id: "job_1" }, error: null },
  });
  setAdminClientForTests(client);

  const outcome = await HANDLERS.schedule_learning({
    scope: new OrgScope(ORG_A, client),
    payload: {},
    job: {} as never,
    now: new Date("2026-06-01T00:00:00.000Z"),
  });

  const enqueued = calls
    .filter((c) => c.table === "job_executions" && c.verb === "insert")
    .map((c) => c.payload as Record<string, unknown>);

  expectEqual("the requested run is turned into a job", enqueued.length, 1);
  expectEqual(
    "carrying the run row's own id, so the screen can show it running",
    (enqueued[0]!.payload as Record<string, unknown>).runId,
    "run_1",
  );
  expectEqual(
    "keyed on the run, so an overlapping tick does not start it twice",
    enqueued[0]!.idempotency_key,
    "learn-run:run_1",
  );
  expectEqual(
    "and never retried — an Opus call retried on an unwatched schedule is an unexplained bill",
    enqueued[0]!.max_attempts,
    1,
  );
  expect(
    "the request bypasses the six-day interval entirely",
    outcome.ok && outcome.result.requested === 1,
    JSON.stringify(outcome),
  );

  setAdminClientForTests(null);
}

console.log("\nschedule_learning — an idle org is never enqueued");
{
  /* The mirror-image of the bug the reference system's weekly cron had: it
     selected orgs with any feedback in the last seven days, then called an
     analysis that refused unless the org had three rows in total — so it
     reliably enqueued work it had already decided to refuse. */
  const { client, calls } = fakeClient({
    "select:learning_runs": { data: [], error: null },
    "select:outcomes": {
      data: [
        { org_id: ORG_A, occurred_at: "2026-05-01" },
        { org_id: ORG_A, occurred_at: "2026-05-02" },
      ],
      error: null,
    },
  });
  setAdminClientForTests(client);

  const outcome = await HANDLERS.schedule_learning({
    scope: new OrgScope(ORG_A, client),
    payload: {},
    job: {} as never,
    now: new Date("2026-06-01T00:00:00.000Z"),
  });

  expect(
    "two outcomes is not enough to be worth asking about",
    outcome.ok && outcome.result.candidates === 0,
    JSON.stringify(outcome),
  );
  expect(
    "so nothing is queued",
    !calls.some((c) => c.table === "job_executions" && c.verb === "insert"),
  );

  setAdminClientForTests(null);
}

/* ── analyze_performance ─────────────────────────────────────────────────── */

console.log("\nanalyze_performance — it refuses before spending, and says why");
{
  const { client, calls } = fakeClient({
    "select:outcomes": { data: [], error: null },
    "select:ai_decisions": { data: [], error: null },
    "select:sources": { data: [], error: null },
    "select:scoring_rules": { data: [], error: null },
    "select:memories": { data: [], error: null },
    "update:learning_runs": { data: { id: "run_1" }, error: null },
  });
  setAdminClientForTests(client);

  const outcome = await HANDLERS.analyze_performance({
    scope: new OrgScope(ORG_A, client),
    payload: { runId: "run_1" },
    job: {} as never,
    now: new Date(),
  });

  expect(
    "an org with nothing recorded is skipped, not failed",
    outcome.ok && typeof outcome.result.skipped === "string",
    JSON.stringify(outcome),
  );
  expect(
    "with an instruction rather than an error",
    outcome.ok && /Record outcomes on opportunities/.test(String(outcome.result.skipped)),
    JSON.stringify(outcome),
  );

  const closed = calls.find((c) => c.table === "learning_runs" && c.verb === "update");
  expectEqual(
    "and the run somebody asked for is closed as `insufficient`, not `failed`",
    (closed?.payload as Record<string, unknown>)?.status,
    "insufficient",
  );
  expect(
    "no model call was made — the refusal is before the spend, not after it",
    !calls.some((c) => c.table === "ai_runs"),
  );

  setAdminClientForTests(null);
}

console.log("\nanalyze_performance — a scheduled sweep leaves no row when there is nothing to say");
{
  const { client, calls } = fakeClient({
    "select:outcomes": { data: [], error: null },
    "select:ai_decisions": { data: [], error: null },
    "select:sources": { data: [], error: null },
    "select:scoring_rules": { data: [], error: null },
    "select:memories": { data: [], error: null },
  });
  setAdminClientForTests(client);

  await HANDLERS.analyze_performance({
    scope: new OrgScope(ORG_A, client),
    payload: { scheduled: true },
    job: {} as never,
    now: new Date(),
  });

  expect(
    "a weekly job noting 'still nothing' is history nobody wants",
    !calls.some((c) => c.table === "learning_runs"),
  );

  setAdminClientForTests(null);
}

/* ── The rule facts ──────────────────────────────────────────────────────── */

console.log("\nscore_opportunity — every field a rule may name is actually supplied");
{
  /* The check that matters most about the rules engine, and the one that
     cannot be written against the handler: reaching it needs a model call.

     A field in `RULE_FIELDS` that `ruleFacts` does not produce is a rule that
     never fires. It does not error and it is not visible anywhere — the
     customer writes it, activates it, and believes it is running, while it
     quietly matches nothing forever. That is the failure the closed list
     exists to prevent, and this is what keeps the list and its one supplier in
     agreement. */
  const supplied = ruleFacts(
    {
      name: "Northwind",
      canonical_domain: "northwind.co",
      industry: "Fintech",
      country: "US",
      region: "North America",
      business_model: "SaaS",
      description: "Payments infrastructure.",
      employee_count: 120,
      tech_stack: ["Go"],
    },
    [
      {
        claim: "They are hiring platform engineers.",
        kind: "fact",
        confidence: "high",
        sourceUrl: "https://northwind.co/jobs",
        excerpt: null,
        eventDate: "2026-05-01",
      },
    ],
    ["funding"],
    { score: 70, priority: "warm" },
  );

  const missing = RULE_FIELDS.filter((field) => !(field in supplied));
  expectEqual("no declared field is left unsupplied", missing, []);

  const unknown = Object.keys(supplied).filter(
    (key) => !(RULE_FIELDS as readonly string[]).includes(key),
  );
  expectEqual("and nothing is supplied that no rule can name", unknown, []);

  /* A company with nothing filled in produces nulls and empty lists rather
     than absent keys, so a rule using `missing` behaves the same whether the
     column is null or the row is sparse. */
  const sparse = ruleFacts({}, [], [], { score: 0, priority: "ignore" });
  expectEqual(
    "a company with nothing known still supplies every key",
    RULE_FIELDS.filter((field) => !(field in sparse)),
    [],
  );
  expectEqual(
    "with an unknown headcount as null, never as a zero",
    sparse["company.employee_count"],
    null,
  );
}

console.log("\nschedule_recomputes — the request seam, resumed rather than restarted");
{
  const { client, calls } = fakeClient({
    "rpc:claim_due_recomputes": {
      data: [
        { id: "req_1", org_id: ORG_A, icp_id: null, reason: "rule_change", cursor: "co_399" },
        { id: "req_2", org_id: ORG_B, icp_id: "icp_9", reason: "icp_change", cursor: null },
      ],
      error: null,
    },
    "insert:job_executions": { data: { id: "job_s" }, error: null },
  });
  setAdminClientForTests(client);

  const outcome = await HANDLERS.schedule_recomputes({
    scope: new OrgScope(ORG_A, client),
    payload: {},
    job: {} as never,
    now: new Date(),
  });

  const enqueued = calls
    .filter((c) => c.table === "job_executions" && c.verb === "insert")
    .map((c) => c.payload as Record<string, unknown>);

  expectEqual(
    "each claimed request becomes one job carrying its own org",
    enqueued.map((row) => row.org_id),
    [ORG_A, ORG_B],
  );
  expectEqual(
    "a request with a cursor resumes there rather than re-scoring what it already paid for",
    (enqueued[0]?.payload as Record<string, unknown>)?.after,
    "co_399",
  );
  expect(
    "a fresh request carries no cursor at all",
    !("after" in ((enqueued[1]?.payload ?? {}) as Record<string, unknown>)),
    JSON.stringify(enqueued[1]?.payload),
  );
  expect(
    "and the key is the request, so a racing claim collapses instead of forking it",
    enqueued.every((row) => /^recompute:req_\d$/.test(String(row.idempotency_key))),
    JSON.stringify(enqueued.map((row) => row.idempotency_key)),
  );
  expect("the sweep reports what it claimed", outcome.ok && outcome.result.claimed === 2, JSON.stringify(outcome));
  setAdminClientForTests(null);
}

console.log("\nrecompute_scores — SCO-03: rescoring what a rule change invalidated");
{
  const rows = Array.from({ length: 200 }, (_, i) => ({
    id: `opp_${i}`,
    company_id: `co_${String(i).padStart(3, "0")}`,
  }));
  const { client, calls } = fakeClient({
    "select:opportunities": { data: rows, error: null },
    "insert:job_executions": { data: { id: "job_r" }, error: null },
    "rpc:advance_recompute": { data: "running", error: null },
  });
  setAdminClientForTests(client);

  const outcome = await HANDLERS.recompute_scores({
    scope: new OrgScope(ORG_A, client),
    payload: { reason: "rule_change" },
    job: {} as never,
    now: new Date(),
  });

  const enqueued = calls
    .filter((c) => c.table === "job_executions" && c.verb === "insert")
    .map((c) => c.payload as Record<string, unknown>);

  const scores = enqueued.filter((row) => row.job_name === "score_opportunity");
  expect("one scoring job per company, not one giant job", scores.length === 200, String(scores.length));
  expect(
    "each carries the reason, so a score history can tell a rule change from a market change",
    scores.every((row) => (row.payload as Record<string, unknown>).reason === "rule_change"),
    JSON.stringify(scores[0]?.payload),
  );
  expect(
    "and reuses the scan's idempotency key, so a rescore during a scan is paid for once",
    scores.every((row) =>
      /^score:co_\d{3}$/.test(String(row.idempotency_key)),
    ),
    JSON.stringify(scores[0]?.idempotency_key),
  );

  const continuation = enqueued.filter((row) => row.job_name === "recompute_scores");
  expect(
    "a full page continues from a cursor rather than looping inside one claim",
    continuation.length === 1 &&
      (continuation[0]!.payload as Record<string, unknown>).after === "co_199",
    JSON.stringify(continuation.map((row) => row.payload)),
  );
  expect(
    "and the run reports itself unfinished",
    outcome.ok && outcome.result.done === false,
    JSON.stringify(outcome),
  );

  /* The cursor is over `company_id`, which this job does not write. Ordering
     by `last_scored_at` would reorder rows as the job rescored them, so a
     cursor over it would skip and repeat companies unpredictably. */
  expect(
    "the page is ordered by the column the job does not modify",
    calls.some(
      (c) =>
        c.table === "opportunities" &&
        c.filters.some(([k]) => k === "order:company_id"),
    ),
    JSON.stringify(calls.find((c) => c.table === "opportunities")?.filters),
  );
  setAdminClientForTests(null);
}

{
  const { client, calls } = fakeClient({
    "select:opportunities": {
      data: [{ id: "opp_1", company_id: "co_1" }],
      error: null,
    },
    "insert:job_executions": { data: { id: "job_r" }, error: null },
  });
  setAdminClientForTests(client);
  const outcome = await HANDLERS.recompute_scores({
    scope: new OrgScope(ORG_A, client),
    payload: {},
    job: {} as never,
    now: new Date(),
  });
  expect(
    "a short page is the end, and does not enqueue a continuation forever",
    outcome.ok &&
      outcome.result.done === true &&
      !calls.some(
        (c) =>
          c.verb === "insert" &&
          (c.payload as Record<string, unknown>)?.job_name === "recompute_scores",
      ),
    JSON.stringify(outcome),
  );
  setAdminClientForTests(null);
}

{
  /* Cancellation reaches a pass that is already running as the answer to the
     progress call it was going to make anyway — there is no other signal that
     survives a job already in flight. */
  const rows = Array.from({ length: 200 }, (_, i) => ({
    id: `opp_${i}`,
    company_id: `co_${String(i).padStart(3, "0")}`,
  }));
  const { client, calls } = fakeClient({
    "select:opportunities": { data: rows, error: null },
    "insert:job_executions": { data: { id: "job_r" }, error: null },
    "rpc:advance_recompute": { data: "cancelled", error: null },
  });
  setAdminClientForTests(client);

  const outcome = await HANDLERS.recompute_scores({
    scope: new OrgScope(ORG_A, client),
    payload: { requestId: "req_1", reason: "manual" },
    job: {} as never,
    now: new Date(),
  });

  expect(
    "a cancelled recomputation stops after the batch in flight",
    outcome.ok &&
      outcome.result.cancelled === true &&
      !calls.some(
        (c) =>
          c.verb === "insert" &&
          (c.payload as Record<string, unknown>)?.job_name === "recompute_scores",
      ),
    JSON.stringify(outcome),
  );
  setAdminClientForTests(null);
}

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

/* ── Competitor mentions ─────────────────────────────────────────────────
   `detectMentions` is the entire judgement of `resolve_competitor_mentions`,
   and its output becomes a badge that changes what a salesperson says out
   loud. The tests below are mostly about the *wrong* answers: a mention that
   is not there, and a partnership read as a displacement opportunity. */

const COMPETITORS = [
  { id: "c_gong", name: "Gong", domain: "gong.io" },
  { id: "c_sl", name: "Salesloft", domain: "salesloft.com" },
  { id: "c_close", name: "Close", domain: "close.com" },
];

console.log("\ndetectMentions — a name is not a relationship");
{
  expectEqual(
    "a bare name is a mention and claims nothing more",
    detectMentions("Their VP wrote a post referencing Salesloft.", COMPETITORS),
    [{ competitorId: "c_sl", relationship: "mentions", matched: "Salesloft" }],
  );

  expectEqual(
    "leaving is the strongest buying signal there is, and it is not 'uses'",
    detectMentions("They are migrating away from Salesloft this quarter.", COMPETITORS).map(
      (m) => m.relationship,
    ),
    ["former"],
  );

  expectEqual(
    "an integration is a partnership, not a displacement opportunity",
    detectMentions("The platform integrates with Gong for call recording.", COMPETITORS).map(
      (m) => m.relationship,
    ),
    ["partner"],
  );

  expectEqual(
    "a stated deployment is 'uses'",
    detectMentions("Their revenue team runs on Salesloft today.", COMPETITORS).map(
      (m) => m.relationship,
    ),
    ["uses"],
  );

  expectEqual(
    "a comparison in progress is 'evaluating'",
    detectMentions("They are comparing Gong and two alternatives.", COMPETITORS).map(
      (m) => m.relationship,
    ),
    ["evaluating"],
  );

  expectEqual(
    "a competitor nobody named produces nothing",
    detectMentions("They just raised a Series B led by Acme Ventures.", COMPETITORS),
    [],
  );
}

console.log("\ndetectMentions — the false positive is worse than the miss");
{
  expectEqual(
    "an ambiguous name in ordinary prose is not a mention",
    detectMentions("Please close the loop with their VP before Friday.", COMPETITORS),
    [],
  );

  expectEqual(
    "the same name as a product name is",
    detectMentions("Their SDRs work out of Close all day.", COMPETITORS).map(
      (m) => m.competitorId,
    ),
    ["c_close"],
  );

  expectEqual(
    "a longer word containing the name does not match it",
    detectMentions("The gongs rang out across the office.", COMPETITORS),
    [],
  );

  expectEqual(
    "a domain matches regardless of case, which is why resolving one is worth doing",
    detectMentions("Docs at GONG.IO describe the integration.", COMPETITORS).map(
      (m) => m.competitorId,
    ),
    ["c_gong"],
  );

  expectEqual(
    "and a hostname it is only a prefix of is not it",
    detectMentions("Their status page is at gong.iosomething.net.", COMPETITORS),
    [],
  );
}

console.log("\nresolve_competitor_mentions — what it writes, and what it refuses to");
{
  const { client, calls } = fakeClient({
    "select:competitors": { data: COMPETITORS, error: null },
    "select:evidence": {
      data: [
        {
          id: "ev_1",
          claim: "They are moving off Salesloft.",
          excerpt: "we are moving off Salesloft in Q3",
          observed_at: "2026-09-01T00:00:00Z",
          event_date: "2026-08-01T00:00:00Z",
        },
        {
          id: "ev_2",
          claim: "A blog post mentions Gong.",
          excerpt: null,
          observed_at: "2026-08-20T00:00:00Z",
          event_date: null,
        },
      ],
      error: null,
    },
    "insert:job_executions": { data: { id: "job_c" }, error: null },
  });
  setAdminClientForTests(client);

  const outcome = await HANDLERS.resolve_competitor_mentions({
    scope: new OrgScope(ORG_A, client),
    payload: { companyId: "co_1" },
    job: {} as never,
    now: new Date(),
  });

  const written = (calls.find(
    (c) => c.table === "company_competitor_signals" && c.verb === "upsert",
  )?.payload ?? []) as Record<string, unknown>[];

  expectEqual(
    "one signal per relationship, strongest phrasing kept",
    written.map((row) => [row.competitor_id, row.relationship]),
    [
      ["c_sl", "former"],
      ["c_gong", "mentions"],
    ],
  );
  expect(
    "every signal is an inference — a phrase match is evidence about the text",
    written.every((row) => row.claim_kind === "inference"),
    JSON.stringify(written),
  );
  expectEqual(
    "a bare mention is weaker than a stated relationship, and says so",
    written.map((row) => row.confidence),
    ["medium", "low"],
  );
  expectEqual(
    "the signal cites the evidence that produced it, so it can be checked",
    written.map((row) => row.evidence_id),
    ["ev_1", "ev_2"],
  );
  expectEqual(
    "and is dated when the thing happened, not when we read about it",
    written[0]?.observed_at,
    "2026-08-01T00:00:00Z",
  );
  expect(
    "the verdict is stale once a prospect is known to use a competitor",
    calls.some(
      (c) =>
        c.table === "job_executions" &&
        c.verb === "insert" &&
        (c.payload as Record<string, unknown>).job_name === "score_opportunity",
    ),
    JSON.stringify(calls.map((c) => c.table)),
  );
  expect("and the run reports what it scanned", outcome.ok && outcome.result.signals === 2, JSON.stringify(outcome));

  setAdminClientForTests(null);
}

{
  // Day one for every org, and it is a success with nothing to do.
  const { client, calls } = fakeClient({ "select:competitors": { data: [], error: null } });
  setAdminClientForTests(client);
  const outcome = await HANDLERS.resolve_competitor_mentions({
    scope: new OrgScope(ORG_A, client),
    payload: { companyId: "co_1" },
    job: {} as never,
    now: new Date(),
  });
  expect(
    "an org with no competitors is not a failure",
    outcome.ok && typeof outcome.result.skipped === "string",
    JSON.stringify(outcome),
  );
  expect(
    "and no evidence is read to prove it",
    !calls.some((c) => c.table === "evidence"),
    JSON.stringify(calls.map((c) => c.table)),
  );
  setAdminClientForTests(null);
}

console.log("\nresearch_competitor — what it will not spend a model call on");
{
  const { client } = fakeClient({
    "select:competitors": {
      data: { id: "c_1", name: "Gong", domain: "gong.io", status: "dismissed" },
      error: null,
    },
  });
  setAdminClientForTests(client);
  const outcome = await HANDLERS.research_competitor({
    scope: new OrgScope(ORG_A, client),
    payload: { competitorId: "c_1" },
    job: {} as never,
    now: new Date(),
  });
  expect(
    "a competitor a person dismissed is not researched at their expense",
    outcome.ok && String(outcome.result.skipped).includes("dismissed"),
    JSON.stringify(outcome),
  );
  setAdminClientForTests(null);
}

{
  const { client } = fakeClient({
    "select:competitors": {
      data: { id: "c_1", name: "Gong", domain: null, status: "active" },
      error: null,
    },
  });
  setAdminClientForTests(client);
  const outcome = await HANDLERS.research_competitor({
    scope: new OrgScope(ORG_A, client),
    payload: { competitorId: "c_1" },
    job: {} as never,
    now: new Date(),
  });
  expect(
    "a name with no domain fails permanently — retrying will not produce a site",
    !outcome.ok && outcome.permanent === true,
    JSON.stringify(outcome),
  );
  setAdminClientForTests(null);
}

{
  const { client } = fakeClient({
    "select:competitors": {
      data: {
        id: "c_1",
        name: "Gong",
        domain: "gong.io",
        status: "active",
        last_researched_at: new Date(Date.now() - 3 * 86_400_000).toISOString(),
      },
      error: null,
    },
  });
  setAdminClientForTests(client);
  const outcome = await HANDLERS.research_competitor({
    scope: new OrgScope(ORG_A, client),
    payload: { competitorId: "c_1" },
    job: {} as never,
    now: new Date(),
  });
  expect(
    "a current profile is not re-bought, and the skip says why",
    outcome.ok && String(outcome.result.skipped).includes("still current"),
    JSON.stringify(outcome),
  );
  setAdminClientForTests(null);
}

console.log("\nresearch_competitor — the two pure decisions");
{
  expectEqual(
    "a prose list splits on lines and commas",
    splitList("- Mid-market SaaS\n- Enterprise fintech"),
    ["Mid-market SaaS", "Enterprise fintech"],
  );
  expectEqual(
    "but a number keeps its thousands separator",
    splitList("Teams of 1,000 seats and up"),
    ["Teams of 1,000 seats and up"],
  );
  expectEqual(
    "overlap is containment in both directions, because exact-match lists never intersect",
    icpOverlap(["Mid-market SaaS", "Public sector"], ["SaaS", "Fintech"]),
    ["Mid-market SaaS"],
  );
  expectEqual(
    "and an org with no ICP yet overlaps with nothing rather than erroring",
    icpOverlap(["Mid-market SaaS"], []),
    [],
  );
}

console.log(
  `\n${failures === 0 ? "PASS" : "FAIL"} — ${checks - failures}/${checks} checks passed\n`,
);
process.exit(failures === 0 ? 0 : 1);
