/** OrgScope, the guarded fetcher and the extractor: what a scan may reach and what it stores. */
import { OrgScope } from "../../src/scope.ts";
import { assertFetchable, FetchRefused, guardedAgent, isPrivateAddress } from "../../src/fetch.ts";
import { fetch as undiciFetch } from "undici";
import { createServer } from "node:http";
import { canonicalize, extract, urlHash, UnreadableContent } from "../../src/extract.ts";
import { ok, fail, expect, expectEqual, expectThrows, fakeClient, ORG_A, ORG_B } from "./harness.ts";

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
    // SEC-003: every spelling of a private address, not only the dotted one.
    ["http://[::ffff:7f00:1]/", /private network/],
    ["http://[::ffff:a9fe:a9fe]/", /private network/],
    ["http://[64:ff9b::a9fe:a9fe]/", /private network/],
    ["http://[2002:7f00:1::]/", /private network/],
    ["http://[0:0:0:0:0:0:0:1]/", /private network/],
    ["http://[fd00::1]/", /private network/],
    ["not a url at all", /is not a URL/],
  ];
  for (const [url, pattern] of refusals) {
    await expectThrows(`${url} is refused`, () => assertFetchable(url), pattern);
  }

  const publicAddresses = ["93.184.216.34", "2606:2800:220:1:248:1893:25c8:1946", "::ffff:5db8:d822", "64:ff9b::5db8:d822"];
  expect(
    "public addresses, however written, are not private",
    publicAddresses.every((a) => !isPrivateAddress(a)),
  );
  expect("an address that cannot be read is treated as private", isPrivateAddress("1::2::3"));
}

{
  /* SEC-003, the rebinding half. A real server on loopback, reached by name,
     through the agent fetchPage uses: the lookup at connect time must refuse
     it even though no earlier check ran. No network needed. */
  const server = createServer((_req, res) => res.end("internal"));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  try {
    await undiciFetch(`http://localhost:${port}/`, { dispatcher: guardedAgent });
    fail("a connection that resolves to loopback is refused at connect time", "it connected");
  } catch (error) {
    const code = (error as { cause?: { code?: string } }).cause?.code;
    expectEqual(
      "a connection that resolves to loopback is refused at connect time",
      code,
      "EHUNTLOOP_PRIVATE_ADDRESS",
    );
  } finally {
    server.close();
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

