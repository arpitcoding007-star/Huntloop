/** What is learned about a company and its people: signals, job boards, site facts, ranking and enrichment. */
import { OrgScope, setAdminClientForTests } from "../../src/scope.ts";
import { enrichPerson } from "../../src/handlers/enrich-person.ts";
import { resetRegistryForTests } from "@huntloop/providers";
import { HANDLERS } from "../../src/registry.ts";
import { ENRICH_TOP, rankContactsJob } from "../../src/handlers/rank-contacts.ts";
import { boardBelongsTo, boardSignals, fetchCompanySignals } from "../../src/handlers/fetch-company-signals.ts";
import { atsApiUrl, findAtsBoards, parseAtsPostings } from "../../src/ats.ts";
import { detectSiteFacts, profileCompany } from "../../src/handlers/profile-company.ts";
import { onCompanySite } from "../../src/handlers/research-company.ts";
import { expect, expectEqual, fakeClient, ORG_A } from "./harness.ts";
import { OPPORTUNITY_ID } from "./fixtures.ts";

/* ── fetch_company_signals ─────────────────────────────────────────────── */

console.log("\nfetch_company_signals — refuses to guess a provider id it does not have");
{
  const { client, calls } = fakeClient({
    "select:companies": { data: { id: "co1", canonical_domain: "acme.com", name: "Acme" }, error: null },
    "select:external_ids": { data: [], error: null },
  });
  setAdminClientForTests(client);

  const outcome = await fetchCompanySignals({
    scope: new OrgScope(ORG_A, client),
    payload: { companyId: "co1" },
    job: { id: "job-1", org_id: ORG_A, job_name: "fetch_company_signals" } as never,
    now: new Date(),
  });

  expect("no provider id means the job succeeds by skipping, not by failing", outcome.ok === true);
  expect(
    "and nothing was written to evidence — there is nothing to write yet",
    !calls.some((c) => c.table === "evidence"),
  );
  setAdminClientForTests(null);
}

console.log("\nresearch_company — AI-002: a fact cites the company's own site");
expect("a page on the company's domain counts", onCompanySite("https://acme.test/about", "acme.test"));
expect("so does a subdomain and www", onCompanySite("https://www.blog.acme.test/x", "acme.test"));
expect("another site does not", !onCompanySite("https://news.example/acme", "acme.test"));
expect("nor a lookalike suffix", !onCompanySite("https://evilacme.test/", "acme.test"));
expect("nor a missing or unreadable URL", !onCompanySite(null, "acme.test") && !onCompanySite("x", "acme.test"));

console.log("\nrank_contacts — Phase 0.3: the best unverified contacts go to enrich_person");

{
  const { client, calls } = fakeClient({
    "select:opportunities": {
      data: {
        id: OPPORTUNITY_ID, company_id: "c1", icp_id: null, primary_person_id: null, contact_selected_by: null,
        companies: { id: "c1", name: "Acme", canonical_domain: "acme.co" },
      },
      error: null,
    },
    "select:people": {
      data: [
        { id: "p-ceo", first_name: "Dana", last_name: "Lee", title: "CEO", employment_status: "current", last_verified_at: null,
          contact_points: [{ kind: "email", value: "dana@acme.co", confidence: "medium", verification_status: "unverified" }] },
        { id: "p-cto", first_name: "Sam", last_name: "Roe", title: "CTO", employment_status: "current", last_verified_at: null,
          contact_points: [{ kind: "email", value: "sam@acme.co", confidence: "high", verification_status: "deliverable" }] },
        { id: "p-vp", first_name: "Kai", last_name: "Moe", title: "VP Sales", employment_status: "current", last_verified_at: null,
          contact_points: [] },
        { id: "p-intern", first_name: "Ari", last_name: "Poe", title: "Intern", employment_status: "current", last_verified_at: null,
          contact_points: [] },
      ],
      error: null,
    },
  });
  setAdminClientForTests(client);
  const outcome = await rankContactsJob({
    scope: new OrgScope(ORG_A, client),
    payload: { opportunityId: OPPORTUNITY_ID },
    job: { id: "job-r", org_id: ORG_A, job_name: "rank_contacts" } as never,
    now: new Date(),
  });
  const queued = calls
    .filter((c) => c.table === "job_executions" && c.verb === "insert" && (c.payload as { job_name?: string })?.job_name === "enrich_person")
    .map((c) => (c.payload as { payload: { personId: string } }).payload.personId);
  expect("ranking succeeds", outcome.ok);
  expectEqual(`at most ${ENRICH_TOP} are sent for enrichment`, queued.length, ENRICH_TOP);
  expect("a contact already verified is not sent", !queued.includes("p-cto"));
  setAdminClientForTests(null);
}

console.log("\njob boards — P2-5: hiring signals from the company's own ATS");

{
  const html = `
    <a href="https://boards.greenhouse.io/acme">Careers</a>
    <a href="https://jobs.lever.co/Acme-Inc/123">One role</a>
    <a href="https://jobs.ashbyhq.com/acme">Ashby</a>
    <a href="https://apply.workable.com/acme/">Workable</a>
    <a href="https://boards.greenhouse.io/acme">Again</a>
    <a href="https://boards.greenhouse.io/embed/job_board?for=acmeembed">Embed</a>`;
  const boards = findAtsBoards(html).map((b) => `${b.kind}:${b.slug}`).sort();
  expectEqual(
    "each board linked from the page is found once, embeds included",
    boards,
    ["ashby:acme", "greenhouse:acme", "greenhouse:acmeembed", "lever:acme-inc", "workable:acme"],
  );
  expectEqual("an unrelated page has no boards", findAtsBoards("<a href='https://acme.co/about'>"), []);
  expectEqual("greenhouse's public API", atsApiUrl({ kind: "greenhouse", slug: "acme" }), "https://boards-api.greenhouse.io/v1/boards/acme/jobs");

  const gh = parseAtsPostings("greenhouse", {
    jobs: [{ id: 7, title: "Account Executive", absolute_url: "https://boards.greenhouse.io/acme/jobs/7", location: { name: "Austin" }, updated_at: "2026-10-01T00:00:00Z" }],
  });
  expectEqual("a greenhouse posting is read with its own URL", gh[0]?.url, "https://boards.greenhouse.io/acme/jobs/7");
  const lever = parseAtsPostings("lever", [
    { id: "a1", text: "SDR", hostedUrl: "https://jobs.lever.co/acme/a1", categories: { location: "Remote", team: "Sales" }, createdAt: 1_790_000_000_000 },
  ]);
  expectEqual("a lever posting keeps its team", lever[0]?.department, "Sales");
  expectEqual(
    "an unlisted ashby posting is skipped",
    parseAtsPostings("ashby", { jobs: [{ id: "x", title: "Hidden", jobUrl: "https://jobs.ashbyhq.com/acme/x", isListed: false }] }).length,
    0,
  );
  expectEqual("a posting with no URL is not a citable fact, so it is dropped", parseAtsPostings("workable", { jobs: [{ shortcode: "Q1", title: "AE" }] }).length, 0);
  expectEqual("an unexpected shape is no postings, not an error", parseAtsPostings("greenhouse", "nonsense"), []);

  const pages: Record<string, { status: number; body: string }> = {
    "https://acme.co/careers": { status: 200, body: html },
    "https://boards-api.greenhouse.io/v1/boards/acme/jobs": {
      status: 200,
      body: JSON.stringify({ jobs: [{ id: 7, title: "Account Executive", absolute_url: "https://boards.greenhouse.io/acme/jobs/7", location: { name: "Austin" } }] }),
    },
  };
  const { client, calls } = fakeClient();
  const result = await boardSignals(
    { scope: new OrgScope(ORG_A, client), payload: {}, job: { id: "j", org_id: ORG_A, job_name: "fetch_company_signals" } as never, now: new Date() },
    "c1",
    "acme.co",
    async (url) => pages[url] ?? { status: 404, body: "" },
  );
  expectEqual("a posting from the board is written as evidence", result.found, 1);
  const row = (calls.find((c) => c.table === "evidence" && c.verb === "upsert")?.payload as Record<string, unknown>[] | undefined)?.[0];
  expect("as a first-party fact citing the posting", row?.kind === "fact" && row?.reliability === "first_party" && row?.source_url === "https://boards.greenhouse.io/acme/jobs/7", row);
  expect("observed_at is when we looked, the posting date is event_date", row?.observed_at !== row?.event_date);

  /* TRUST-102: a board whose slug is not the company is a link, not its own. */
  expect("a board named for the company is its own", boardBelongsTo("acme", "acme.co") && boardBelongsTo("acmeinc", "acme.co", "Acme Inc"));
  expect("a partner's board is not", !boardBelongsTo("globex", "acme.co", "Acme"));
  const partner = fakeClient();
  await boardSignals(
    { scope: new OrgScope(ORG_A, partner.client), payload: {}, job: { id: "j", org_id: ORG_A, job_name: "fetch_company_signals" } as never, now: new Date() },
    "c1",
    "acme.co",
    async (url) =>
      url === "https://acme.co/careers"
        ? { status: 200, body: "<a href='https://jobs.lever.co/globex'>Partner jobs</a>" }
        : url.startsWith("https://api.lever.co/v0/postings/globex")
          ? { status: 200, body: JSON.stringify([{ id: "g1", text: "SDR", hostedUrl: "https://jobs.lever.co/globex/g1" }, { id: "g2", text: "Spoof", hostedUrl: "https://evil.example/x" }]) }
          : { status: 404, body: "" },
    "Acme",
  );
  const prow = (partner.calls.find((c) => c.table === "evidence" && c.verb === "upsert")?.payload as Record<string, unknown>[] | undefined) ?? [];
  expect("a partner board's posting is stored as an inference about a link", prow.length === 1 && prow[0]?.kind === "inference" && String(prow[0]?.claim).includes("links to"), prow);
  expect("and a posting citing a host off the board is dropped", !prow.some((r) => String(r.source_url).includes("evil.example")));

  /* TRUST-103: postings no longer listed are retired. */
  const retire = fakeClient({
    "select:evidence": { data: [{ id: "old-1", field: "hiring_signal:greenhouse:99" }, { id: "kept", field: "hiring_signal:greenhouse:7" }], error: null },
  });
  await boardSignals(
    { scope: new OrgScope(ORG_A, retire.client), payload: {}, job: { id: "j", org_id: ORG_A, job_name: "fetch_company_signals" } as never, now: new Date() },
    "c1",
    "acme.co",
    async (url) => pages[url] ?? { status: 404, body: "" },
  );
  const retired = retire.calls.find((c) => c.table === "evidence" && c.verb === "update");
  expect(
    "a posting the board no longer lists is soft-deleted, and a listed one is kept",
    Boolean(retired) && JSON.stringify(retired?.filters).includes("old-1") && !JSON.stringify(retired?.filters).includes("kept"),
    retired?.filters,
  );

  const none = await boardSignals(
    { scope: new OrgScope(ORG_A, client), payload: {}, job: { id: "j", org_id: ORG_A, job_name: "fetch_company_signals" } as never, now: new Date() },
    "c1",
    "acme.co",
    async () => {
      throw new Error("ECONNREFUSED");
    },
  );
  expectEqual("an unreachable site is no signals, not a failure", none.found, 0);
}

console.log("\nprofile_company — P2-4: what a homepage says about itself, without a model");

{
  const html = `
    <script src="//js.hs-scripts.com/123.js"></script>
    <script>gtag('config', 'AW-123456');</script>
    <link href="https://assets.calendly.com/assets/external/widget.css">
    <p>We integrate with Stripe and Shopify.</p>`;
  expectEqual(
    "vendor scripts are detected, words on the page are not",
    detectSiteFacts(html).map((f) => f.key).sort(),
    ["calendly", "google_ads", "hubspot"],
  );
  /* TRUST-101 */
  expectEqual("a plain link to someone's Calendly page is not a booking widget", detectSiteFacts('<a href="https://calendly.com/dana/30min">Book</a>').length, 0);
  const stripe = detectSiteFacts('<script src="https://js.stripe.com/v3/"></script>')[0];
  expect("Stripe.js is recorded as an inference, not \"takes payments\"", stripe?.kind === "inference" && !/takes payments/i.test(stripe.claim), stripe);
  const moved = await profileCompany(
    { scope: new OrgScope(ORG_A, fakeClient({ "select:companies": { data: { id: "c1", canonical_domain: "acme.co" }, error: null } }).client), payload: { companyId: "c1" }, job: { id: "j", org_id: ORG_A, job_name: "profile_company" } as never, now: new Date() },
    async () => ({ url: "https://parked-domains.example/", status: 200, body: html }),
  );
  expect("a homepage that redirected to another domain is not profiled", moved.ok && "skipped" in ((moved as { result: object }).result));

  const { client, calls } = fakeClient({
    "select:companies": { data: { id: "c1", canonical_domain: "acme.co" }, error: null },
  });
  const ctx = { scope: new OrgScope(ORG_A, client), payload: { companyId: "c1" }, job: { id: "j", org_id: ORG_A, job_name: "profile_company" } as never, now: new Date() };
  const outcome = await profileCompany(ctx, async (url) => ({ url, status: 200, body: html }));
  const rows = calls.find((c) => c.table === "evidence" && c.verb === "upsert")?.payload as Record<string, unknown>[] | undefined;
  expect("each detection is a first-party fact citing the homepage", outcome.ok && rows?.length === 3 && rows.every((r) => r.kind === "fact" && r.source_url === "https://acme.co/"), rows);

  const down = await profileCompany(ctx, async () => {
    throw new Error("ENOTFOUND");
  });
  expect("an unreachable site is a skip, not a failure", down.ok);
}

console.log("\nschedule_signal_fetches — Phase 4.3: only companies someone is working");

{
  const { client, calls } = fakeClient({ "select:companies": { data: [{ id: "c1", org_id: ORG_A }], error: null } });
  setAdminClientForTests(client);
  const outcome = await HANDLERS.schedule_signal_fetches({
    scope: OrgScope.global() as never,
    payload: {},
    job: { id: "j", org_id: null, job_name: "schedule_signal_fetches" } as never,
    now: new Date(),
  });
  const read = calls.find((c) => c.table === "companies" && c.verb === "select");
  const has = (k: string, v?: unknown) => Boolean(read?.filters.some(([f, x]) => f === k && (v === undefined || x === v)));
  expect("it reads companies joined to their opportunities", String(read?.payload).includes("opportunities!inner"));
  expect("closed opportunities are excluded", has("not:opportunities.status", "in"));
  expect("an Apollo id is no longer required", !has("eq:external_ids.provider"));
  expect("companies met through the Exchange are never due (0066)", has("neq:origin", "exchange"));
  expect("and the due company is queued", outcome.ok && calls.some((c) => c.table === "job_executions" && c.verb === "insert"));
  setAdminClientForTests(null);
}

console.log("\nenrich_person — FLOW-108: a verified address is kept, and not re-verified");
{
  const saved = { a: process.env.APOLLO_API_KEY, v: process.env.EMAIL_VERIFICATION_API_KEY, f: globalThis.fetch };
  process.env.APOLLO_API_KEY = "test-apollo";
  process.env.EMAIL_VERIFICATION_API_KEY = "test-zb";
  resetRegistryForTests();
  const hosts: string[] = [];
  globalThis.fetch = (async (url: string | URL) => {
    hosts.push(new URL(String(url)).host);
    return new Response(
      JSON.stringify({ person: { id: "p1", first_name: "Pat", last_name: "Lee", email: "pat@acme.test", email_status: "guessed" } }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;

  const { client, calls } = fakeClient({
    "select:people": {
      data: { id: "pp-1", first_name: "Pat", last_name: "Lee", title: "CTO", company_id: "c-1", companies: { canonical_domain: "acme.test", name: "Acme" } },
      error: null,
    },
    "select:contact_points": { data: { verification_status: "deliverable" }, error: null },
    "rpc:check_quota_internal": { data: [{ allowed: true, used: 0, quota: 100 }], error: null },
  });
  setAdminClientForTests(client);
  try {
    const outcome = await enrichPerson({
      scope: new OrgScope(ORG_A, client),
      payload: { personId: "pp-1" },
      job: { id: "job-e", org_id: ORG_A, job_name: "enrich_person" } as never,
      now: new Date(),
    });
    const upserted = calls.find((c) => c.table === "contact_points" && c.verb === "upsert")?.payload;
    const point = (Array.isArray(upserted) ? upserted[0] : upserted) as
      | { verification_status?: string }
      | undefined;
    expect("the run succeeds", outcome.ok, outcome);
    expect("a deliverable address stays deliverable after a guessed match", point?.verification_status === "deliverable", point);
    expect("and the verifier is not paid to ask again", !hosts.some((h) => h.includes("zerobounce")), hosts);
  } finally {
    globalThis.fetch = saved.f;
    if (saved.a === undefined) delete process.env.APOLLO_API_KEY; else process.env.APOLLO_API_KEY = saved.a;
    if (saved.v === undefined) delete process.env.EMAIL_VERIFICATION_API_KEY; else process.env.EMAIL_VERIFICATION_API_KEY = saved.v;
    resetRegistryForTests();
    setAdminClientForTests(null);
  }
}

