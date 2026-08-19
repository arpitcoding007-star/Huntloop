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
    ["advance_enrollments", "schedule_scans", "schedule_sends", "schedule_syncs"],
  );
  expect(
    "each carries no org — a sweeper is the cross-tenant question",
    enqueued.every((row) => row.org_id === null),
    JSON.stringify(enqueued.map((row) => row.org_id)),
  );
  expect(
    "each is idempotent on its own name, so a slow sweep is not started twice",
    enqueued.every((row) => row.idempotency_key === row.job_name),
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
    "rpc:is_suppressed": { data: false, error: null },
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
    "rpc:is_suppressed": { data: true, error: null },
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

console.log(
  `\n${failures === 0 ? "PASS" : "FAIL"} — ${checks - failures}/${checks} checks passed\n`,
);
process.exit(failures === 0 ? 0 : 1);
