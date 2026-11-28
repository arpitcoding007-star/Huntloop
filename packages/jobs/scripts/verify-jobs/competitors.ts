/** Competitor mentions, competitor research and competitors' named customers. */
import { OrgScope, setAdminClientForTests } from "../../src/scope.ts";
import { HANDLERS } from "../../src/registry.ts";
import { normalizeCompanyName, pickMatch } from "../../src/handlers/prospect-competitor-customers.ts";
import { detectMentions } from "../../src/handlers/resolve-competitor-mentions.ts";
import { icpOverlap, splitList } from "../../src/handlers/research-competitor.ts";
import { expect, expectEqual, fakeClient, ORG_A } from "./harness.ts";

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

/* ── prospect_competitor_customers — a named customer, matched or not ─── */

console.log("\nprospect_competitor_customers — only an unambiguous name becomes a company");
{
  const company = (name: string, domain: string | null) => ({
    providerId: name, name, domain, website: null, description: null, industry: null,
    employeeCount: null, revenueBand: null, country: null, region: null, city: null,
    foundedYear: null, linkedinUrl: null, technologies: [], funding: null, raw: null,
  });
  expectEqual(
    "legal suffixes and punctuation do not make two names differ",
    normalizeCompanyName("Acme, Inc."),
    normalizeCompanyName("acme"),
  );
  expectEqual(
    "an exact match with a domain is taken",
    pickMatch("Acme Inc", [company("Acme", "acme.com"), company("Acme Robotics", "acmerobotics.com")])?.domain,
    "acme.com",
  );
  expectEqual(
    "two companies with the same name are a guess, not a match",
    pickMatch("Acme", [company("Acme", "acme.com"), company("ACME", "acme.io")]),
    null,
  );
  expectEqual("a match with no domain cannot be researched", pickMatch("Acme", [company("Acme", null)]), null);
}

