/** The Exchange: the firewall, matching, introductions and notifications. */
import { OrgScope, setAdminClientForTests } from "../../src/scope.ts";
import { enrichPerson } from "../../src/handlers/enrich-person.ts";
import { explainKey, matchNeeds } from "../../src/handlers/match-needs.ts";
import { enforceRetention } from "../../src/handlers/enforce-retention.ts";
import { createIntroOpportunities, placeholderDomain } from "../../src/handlers/create-intro-opportunities.ts";
import { allowedNow, inQuietHours, sendExchangeNotifications } from "../../src/handlers/send-exchange-notifications.ts";
import { verifyExchangeUnsubscribeToken } from "../../src/email/exchange-token.ts";
import { reusableExplanations, applyExplanations, eligible, scoreMatch, splitMustHaves, type MatchNeed, type MatchOffering } from "../../src/exchange-match.ts";
import { resetRegistryForTests } from "@huntloop/providers";
import { HANDLERS } from "../../src/registry.ts";
import { enqueue } from "../../src/queue.ts";
import { rankContactsJob } from "../../src/handlers/rank-contacts.ts";
import { advanceOne } from "../../src/handlers/advance-enrollments.ts";
import { expect, expectEqual, fakeClient, ORG_A, ORG_B } from "./harness.ts";

console.log("\nfirewall (0059) — Exchange rows are never enriched, ranked or sequenced");
{
  /* enrich_person: refused before the quota read and before any provider. */
  const saved = { a: process.env.APOLLO_API_KEY, f: globalThis.fetch };
  process.env.APOLLO_API_KEY = "test-apollo";
  resetRegistryForTests();
  const hosts: string[] = [];
  globalThis.fetch = (async (url: string | URL) => {
    hosts.push(new URL(String(url)).host);
    return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  const { client, calls } = fakeClient({
    "select:people": {
      data: {
        id: "pp-x", origin: "exchange", first_name: "Bea", last_name: "Buyer", title: "Founder",
        company_id: "c-x", companies: { canonical_domain: "buyer.test", name: "Buyer" },
      },
      error: null,
    },
    "rpc:check_quota_internal": { data: [{ allowed: true, used: 0, quota: 100 }], error: null },
  });
  setAdminClientForTests(client);
  try {
    const outcome = await enrichPerson({
      scope: new OrgScope(ORG_A, client),
      payload: { personId: "pp-x" },
      job: { id: "job-fw", org_id: ORG_A, job_name: "enrich_person" } as never,
      now: new Date(),
    });
    const result = outcome.ok ? (outcome.result as { firewall?: boolean }) : null;
    expect("enrich_person succeeds as a refusal, so it is not retried", outcome.ok && result?.firewall === true, outcome);
    expect("no provider is called for an Exchange person", hosts.length === 0, hosts);
    expect("not even the quota is read", !calls.some((c) => c.verb === "rpc"), calls.map((c) => `${c.verb}:${c.table}`));
    expect(
      "nothing is written",
      !calls.some((c) => ["insert", "upsert", "update"].includes(c.verb)),
      calls.map((c) => `${c.verb}:${c.table}`),
    );
  } finally {
    globalThis.fetch = saved.f;
    if (saved.a === undefined) delete process.env.APOLLO_API_KEY; else process.env.APOLLO_API_KEY = saved.a;
    resetRegistryForTests();
    setAdminClientForTests(null);
  }
}
{
  /* rank_contacts: refused before personas, discovery or enrichment. */
  const { client, calls } = fakeClient({
    "select:opportunities": {
      data: {
        id: "opp-x", origin: "exchange", company_id: "c-x", icp_id: null, primary_person_id: null,
        contact_selected_by: null, companies: { id: "c-x", name: "Buyer", canonical_domain: "buyer.test" },
      },
      error: null,
    },
  });
  const outcome = await rankContactsJob({
    scope: new OrgScope(ORG_A, client),
    payload: { opportunityId: "opp-x", discover: true },
    job: { id: "job-fw2", org_id: ORG_A, job_name: "rank_contacts" } as never,
    now: new Date(),
  });
  const result = outcome.ok ? (outcome.result as { firewall?: boolean }) : null;
  expect("rank_contacts refuses an Exchange opportunity", outcome.ok && result?.firewall === true, outcome);
  expect(
    "and queues no enrichment",
    !calls.some((c) => c.table === "job_executions" && c.verb === "insert"),
    calls.map((c) => `${c.verb}:${c.table}`),
  );
}
{
  /* advance_enrollments: an enrollment that somehow exists is stopped, and no draft is written. */
  const { client, calls } = fakeClient({
    "select:enrollments": {
      data: {
        id: "enr-x", campaign_id: "camp-1", opportunity_id: "opp-x", current_step: 0, mailbox_id: null,
        campaigns: { id: "camp-1", name: "C", status: "active", autonomy_level: 0, product_id: null },
        opportunities: {
          id: "opp-x", origin: "exchange", company_id: "c-x", primary_person_id: null,
          outreach_angle: null, status: "qualified",
        },
      },
      error: null,
    },
  });
  const outcome = await advanceOne(new OrgScope(ORG_A, client), "enr-x");
  expectEqual("an Exchange enrollment is stopped", outcome, "stopped");
  expect(
    "no draft is written for it",
    !calls.some((c) => c.table === "messages" && c.verb === "insert"),
    calls.map((c) => `${c.verb}:${c.table}`),
  );
}

console.log("\nexchange matching — hard filters, named dimensions, unknown is null");
{
  const now = new Date("2026-11-23T12:00:00Z");
  const need: MatchNeed = {
    id: "n1", org_id: "buyer", category_id: "gpu", quantity: 200,
    budget_min: null, budget_max: 6_000_000, currency: "EUR", country: "DE",
  };
  const offer = (over: Partial<MatchOffering> = {}): MatchOffering => ({
    id: "o1", org_id: "seller", category_id: "gpu", price_from: 25_000, price_to: 30_000, currency: "EUR",
    moq: 10, availability: "in_stock", availability_as_of: "2026-11-20T00:00:00Z",
    serves_global: false, serves_countries: ["DE", "FR"],
    provider: { claimed_at: "2026-11-01T00:00:00Z", verified_at: "2026-11-02T00:00:00Z" }, ...over,
  });

  expect("a supplier in the same category serving the country is eligible", eligible(need, offer()));
  expect("another category is not", !eligible(need, offer({ category_id: "crm" })));
  expect("a workspace is never matched to itself", !eligible(need, offer({ org_id: "buyer" })));
  expect("a supplier that does not serve the country is not", !eligible(need, offer({ serves_countries: ["US"] })));
  expect("a worldwide supplier is", eligible(need, offer({ serves_countries: [], serves_global: true })));
  expect("an uncategorised need matches nobody", !eligible({ ...need, category_id: null }, offer()));

  const full = scoreMatch(need, offer(), now);
  expectEqual("a full fit scores 100", full.score, 100);
  expect("and says why", full.explanation.includes("serves DE") && full.explanation.includes("verified supplier"), full.explanation);

  const fx = scoreMatch(need, offer({ currency: "USD" }), now);
  expectEqual("a price in another currency is unknown, not guessed", fx.dimensions.budget, null);

  const stale = scoreMatch(need, offer({ availability_as_of: "2026-09-01T00:00:00Z" }), now);
  expectEqual("availability older than 30 days is unknown again", stale.dimensions.availability, null);

  const thin = scoreMatch(
    { ...need, quantity: null, budget_max: null, currency: null, country: null },
    offer({ price_from: null, price_to: null, currency: null, moq: null, availability: null, availability_as_of: null, provider: { claimed_at: null, verified_at: null } }),
    now,
  );
  expectEqual("with too little measured there is no score, not a low one", thin.score, null);
  expectEqual("and the unmeasured dimensions read unknown", thin.dimensions.geography, null);

  const small = scoreMatch(need, offer({ moq: 500 }), now);
  expectEqual("an order below the minimum is a weaker fit", small.dimensions.quantity, 40);
}
{
  /* match_needs: gated by category, writes only engine-owned matches. */
  const gated = fakeClient({
    "select:exchange_needs": {
      data: { id: "n1", org_id: "buyer", category_id: "gpu", quantity: 200, budget_min: null, budget_max: null, currency: null, country: "DE", status: "open", deleted_at: null, exchange_categories: { matching_enabled: false, active: true } },
      error: null,
    },
  });
  setAdminClientForTests(gated.client);
  try {
    const out = await matchNeeds({ scope: new OrgScope(ORG_A, gated.client), payload: { needId: "n1" }, job: { id: "j-m1", org_id: ORG_A, job_name: "match_needs" } as never, now: new Date() });
    const result = out.ok ? (out.result as { gated?: boolean }) : null;
    expect("a category with matching off is gated, and the need stays saved", out.ok && result?.gated === true, out);
    expect("and no offering is even read", !gated.calls.some((c) => c.table === "exchange_offerings"), gated.calls.map((c) => c.verb + ":" + c.table));
  } finally {
    setAdminClientForTests(null);
  }

  const live = fakeClient({
    "select:exchange_needs": {
      data: { id: "n1", org_id: "buyer", category_id: "gpu", quantity: 200, budget_min: null, budget_max: null, currency: null, country: "DE", status: "open", deleted_at: null, exchange_categories: { matching_enabled: true, active: true } },
      error: null,
    },
    "select:exchange_offerings": {
      data: [
        { id: "o1", org_id: "seller", category_id: "gpu", price_from: null, price_to: null, currency: null, moq: 10, availability: null, availability_as_of: null, serves_global: false, serves_countries: ["DE"], exchange_provider_profiles: { claimed_at: "2026-11-01T00:00:00Z", verified_at: null, deleted_at: null } },
        { id: "o2", org_id: "buyer", category_id: "gpu", price_from: null, price_to: null, currency: null, moq: null, availability: null, availability_as_of: null, serves_global: true, serves_countries: [], exchange_provider_profiles: { claimed_at: "2026-11-01T00:00:00Z", verified_at: null, deleted_at: null } },
      ],
      error: null,
    },
    "rpc:exchange_recall_offerings": { data: ["o1", "o2"], error: null },
    "upsert:exchange_matches": { data: null, error: null },
  });
  setAdminClientForTests(live.client);
  try {
    const out = await matchNeeds({ scope: new OrgScope(ORG_A, live.client), payload: { needId: "n1" }, job: { id: "j-m2", org_id: ORG_A, job_name: "match_needs" } as never, now: new Date() });
    const written = live.calls.find((c) => c.table === "exchange_matches" && c.verb === "upsert")?.payload as { offering_id: string }[] | undefined;
    expect("an enabled category is matched", out.ok, out);
    expectEqual("only the other workspace's offering is matched", (written ?? []).map((w) => w.offering_id), ["o1"]);
    expect("matching never touches people, contacts or sequences", !live.calls.some((c) => ["people", "contact_points", "enrollments", "enrichment_records"].includes(c.table)), live.calls.map((c) => c.table));
    const recall = live.calls.find((c) => c.verb === "rpc" && c.table === "exchange_recall_offerings");
    expect("candidates come from text recall over the category (0062)", (recall?.payload as { p_need?: string })?.p_need === "n1", recall);
    const offeringsRead = live.calls.find((c) => c.verb === "select" && c.table === "exchange_offerings");
    expect("and only the recalled offerings are read", !!offeringsRead?.filters.some(([k]) => k === "in:id"), offeringsRead?.filters);
    expect("with no model the measured dimensions stand", (out.ok ? (out.result as { explained?: string }).explained : null) === "no", out);
  } finally {
    setAdminClientForTests(null);
  }
}

console.log("\nschedule_matching — queues what SQL says is due (0068, DN-59)");
{
  const run = async (due: { data: unknown; error: unknown }) => {
    const { client, calls } = fakeClient({ "rpc:exchange_needs_due": due as never, "insert:job_executions": { data: { id: "j" }, error: null } });
    setAdminClientForTests(client);
    try {
      const out = await HANDLERS.schedule_matching({ scope: OrgScope.global() as never, payload: {}, job: {} as never, now: new Date() });
      return { out, keys: calls.filter((c) => c.verb === "insert").map((c) => String((c.payload as { idempotency_key: string }).idempotency_key)) };
    } finally {
      setAdminClientForTests(null);
    }
  };
  expectEqual("each due request is queued under the key SQL gave it", (await run({ data: [{ need_id: "n1", org_id: ORG_A, key: "match_needs:n1:x" }], error: null })).keys, ["match_needs:n1:x"]);
  expectEqual("nothing due queues nothing", (await run({ data: [], error: null })).keys, []);
  expect("an unreadable list is a failed run, not an empty one", !(await run({ data: null, error: { message: "down" } })).out.ok);
}

console.log("\nmatch_needs — a large category is read in pieces (Phase 4 load test)");
{
  const many = Array.from({ length: 250 }, (_, i) => `o${i}`);
  const { client, calls } = fakeClient({
    "select:exchange_needs": { data: { id: "n1", org_id: "buyer", category_id: "gpu", quantity: null, status: "open", deleted_at: null, exchange_categories: { matching_enabled: true, active: true } }, error: null },
    "select:exchange_offerings": { data: [], error: null },
    "rpc:exchange_recall_offerings": { data: many, error: null },
  });
  setAdminClientForTests(client);
  try {
    await matchNeeds({ scope: new OrgScope(ORG_A, client), payload: { needId: "n1" }, job: { id: "j", org_id: ORG_A, job_name: "match_needs" } as never, now: new Date() });
    expectEqual("250 candidates are three reads, none too long for the gateway", calls.filter((c) => c.table === "exchange_offerings").map((c) => (c.filters.find(([k]) => k === "in:id")?.[1] as string[]).length), [100, 100, 50]);
  } finally {
    setAdminClientForTests(null);
  }
}

console.log("\nfirewall (0066) — a cold sequence on another opportunity of an introduced company");
{
  const { client, calls } = fakeClient({
    "select:enrollments": {
      data: {
        id: "enr-s", campaign_id: "camp-1", opportunity_id: "opp-icp", current_step: 0, mailbox_id: null,
        campaigns: { id: "camp-1", name: "C", status: "active", autonomy_level: 3, product_id: null },
        opportunities: { id: "opp-icp", origin: "engine", company_id: "c-x", primary_person_id: null, outreach_angle: null, status: "qualified", companies: { origin: "exchange" } },
      },
      error: null,
    },
  });
  expectEqual("it is stopped", await advanceOne(new OrgScope(ORG_A, client), "enr-s"), "stopped");
  expectEqual("as stopped, with nothing else written", calls.filter((c) => c.verb !== "select").map((c) => [c.verb, c.table, (c.payload as { status?: string }).status]), [["update", "enrollments", "stopped"]]);

  const ranked = fakeClient({ "select:opportunities": { data: { id: "opp-icp", origin: "engine", company_id: "c-x", icp_id: "i", companies: { id: "c-x", origin: "exchange", name: "Buyer", canonical_domain: "buyer.test" } }, error: null } });
  const rank = await rankContactsJob({ scope: new OrgScope(ORG_A, ranked.client), payload: { opportunityId: "opp-icp", discover: true }, job: { id: "j", org_id: ORG_A, job_name: "rank_contacts" } as never, now: new Date() });
  expect("no new contacts are sought there", rank.ok && (rank.result as { firewall?: boolean }).firewall === true && ranked.calls.length === 1, JSON.stringify(rank));
  const person = fakeClient({ "select:people": { data: { id: "p", origin: "engine", company_id: "c-x", companies: { origin: "exchange", canonical_domain: "buyer.test", name: "Buyer" } }, error: null } });
  const enriched = await enrichPerson({ scope: new OrgScope(ORG_A, person.client), payload: { personId: "p" }, job: { id: "j", org_id: ORG_A, job_name: "enrich_person" } as never, now: new Date() });
  expect("nor the people already on file enriched", enriched.ok && (enriched.result as { firewall?: boolean }).firewall === true && person.calls.length === 1, JSON.stringify(enriched));
}

console.log("\nfirewall (0066) — the company behind an Exchange opportunity");
{
  const hosts: string[] = [];
  const savedFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL) => {
    hosts.push(new URL(String(url)).host);
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  try {
    for (const job of ["enrich_company", "research_company", "fetch_company_signals", "profile_company"] as const) {
      const { client, calls } = fakeClient({
        "select:companies": { data: { id: "c-x", origin: "exchange", canonical_domain: "buyer.test", name: "Buyer" }, error: null },
      });
      setAdminClientForTests(client);
      const out = await HANDLERS[job]({
        scope: new OrgScope(ORG_A, client),
        payload: { companyId: "c-x", force: true, refresh: true },
        job: { id: "j-fw66", org_id: ORG_A, job_name: job } as never,
        now: new Date(),
      });
      expect(`${job} refuses, as a success so it is not retried`, out.ok && (out.result as { firewall?: boolean }).firewall === true, JSON.stringify(out));
      expect(
        `${job} reads nothing else and writes nothing`,
        calls.length === 1 && String(calls[0]!.payload).includes("origin"),
        calls.map((c) => `${c.verb}:${c.table}`),
      );
    }
    expectEqual("and no host is contacted", hosts, []);
  } finally {
    globalThis.fetch = savedFetch;
    setAdminClientForTests(null);
  }

  const sweep = fakeClient({});
  setAdminClientForTests(sweep.client);
  try {
    await HANDLERS.schedule_followups({ scope: OrgScope.global() as never, payload: {}, job: {} as never, now: new Date() });
    const reads = sweep.calls.filter((c) => c.verb === "select" && c.table === "companies");
    expect("schedule_followups never picks one for research", reads.length === 2 && reads.every((c) => c.filters.some(([k, v]) => k === "neq:origin" && v === "exchange")), reads.map((c) => c.filters));
    const enrich = sweep.calls.find((c) => c.table === "opportunities" && String(c.payload).includes("companies!inner"));
    expect("nor for enrichment", !!enrich?.filters.some(([k, v]) => k === "neq:companies.origin" && v === "exchange"), enrich?.filters);
  } finally {
    setAdminClientForTests(null);
  }

  const dropped = fakeClient({ "insert:job_executions": { data: null, error: null } });
  const queued = await enqueue({ orgId: ORG_A, name: "enrich_company", payload: { companyId: "c-x" } }, dropped.client);
  expectEqual("a job the database refused is not reported as queued", queued, { id: null, created: false });
}

console.log("\nmatch_needs — paused offerings are cleared, unchanged explanations are not paid for twice (0066)");
{
  const provider = { name: "NW", claimed_at: "2026-11-01T00:00:00Z", verified_at: null, deleted_at: null };
  const offering = (id: string, over: Record<string, unknown> = {}) => ({
    id, org_id: "seller", category_id: "gpu", title: "Cards " + id, description: null, price_from: null, price_to: null, currency: null, moq: 10,
    availability: null, availability_as_of: null, serves_global: false, serves_countries: ["DE"], exchange_provider_profiles: provider, ...over,
  });
  const base = {
    "select:exchange_needs": {
      data: { id: "n1", org_id: "buyer", category_id: "gpu", quantity: 200, budget_min: null, budget_max: null, currency: null, country: "DE", status: "open", deleted_at: null, summary: "Cards", requirement: { must_haves: { value: "authorised partner", kind: "fact" } }, exchange_categories: { name: "GPUs", matching_enabled: true, active: true, attributes: [] } },
      error: null,
    },
    "rpc:exchange_recall_offerings": { data: ["o1"], error: null },
    "upsert:exchange_matches": { data: null, error: null },
    "select:exchange_offering_evidence": { data: [{ id: "e1", offering_id: "o1", kind: "fact", claim: "Authorised partner", source_url: "https://x.test" }], error: null },
  };
  const run = async (over: Record<string, unknown>) => {
    const { client, calls } = fakeClient({ ...base, ...over });
    setAdminClientForTests(client);
    try {
      const out = await matchNeeds({ scope: new OrgScope(ORG_A, client), payload: { needId: "n1" }, job: { id: "j-m3", org_id: ORG_A, job_name: "match_needs" } as never, now: new Date("2026-11-24T00:00:00Z") });
      return { out, calls, written: calls.find((c) => c.verb === "upsert" && c.table === "exchange_matches")?.payload as Record<string, unknown>[] | undefined };
    } finally {
      setAdminClientForTests(null);
    }
  };

  /* o1 recalled; o2 paused, so the active-only read does not return it; o3
     moved to a country it no longer serves; o4 active and fitting but not
     recalled (a suspended supplier). */
  const cleared = await run({
    "select:exchange_matches": { data: [{ id: "m1", offering_id: "o1", explained: null }, { id: "m2", offering_id: "o2", explained: null }, { id: "m3", offering_id: "o3", explained: null }, { id: "m4", offering_id: "o4", explained: null }], error: null },
    "select:exchange_offerings": { data: [offering("o1"), offering("o3", { serves_countries: ["US"] }), offering("o4")], error: null },
  });
  const del = cleared.calls.find((c) => c.verb === "delete" && c.table === "exchange_matches");
  expectEqual("matches for a paused or no-longer-fitting offering are deleted, one merely not recalled is kept", del?.filters.find(([k]) => k === "in:id")?.[1], ["m2", "m3"]);
  expectEqual("and only recalled offerings are written", cleared.written?.map((w) => w.offering_id), ["o1"]);
  const emptied = await run({
    "rpc:exchange_recall_offerings": { data: [], error: null },
    "select:exchange_matches": { data: [{ id: "m2", offering_id: "o2", explained: null }], error: null },
    "select:exchange_offerings": { data: [], error: null },
  });
  expectEqual("also when no offering is left in the category", emptied.calls.find((c) => c.verb === "delete")?.filters.find(([k]) => k === "in:id")?.[1], ["m2"]);
  const unread = await run({ "select:exchange_offerings": { data: null, error: { message: "boom" } }, "select:exchange_matches": { data: [{ id: "m2", offering_id: "o2", explained: null }], error: null } });
  expect("a failed read deletes nothing", !unread.out.ok && !unread.calls.some((c) => c.verb === "delete"), unread.out);

  /* No model is configured here, so an answer can only come from what was stored. */
  const input = {
    needId: "n1",
    need: { summary: "Cards", categoryPath: "GPUs", facts: [], mustHaves: ["authorised partner"] },
    candidates: [{ offeringId: "o1", title: "Cards o1", description: null, provider: "NW", evidence: [{ id: "e1", claim: "Authorised partner", kind: "fact" as const, sourceUrl: "https://x.test" }] }],
  };
  const key = explainKey(input);
  const candidate = { offeringId: "o1", reason: "Authorised.", backing: [{ mustHave: "authorised partner", evidenceId: "e1" }] };
  const stored = (k: string) => ({ "select:exchange_matches": { data: [{ id: "m1", offering_id: "o1", explained: { key: k, candidate } }], error: null }, "select:exchange_offerings": { data: [offering("o1")], error: null } });
  const same = await run(stored(key));
  expectEqual("an unchanged match reuses the stored answer", same.out.ok ? (same.out.result as { explained?: string }).explained : same.out, "unchanged");
  expectEqual("with the same requirement dimension", (same.written?.[0]?.dimensions as { requirement?: number }).requirement, 100);
  expectEqual("the same citations", same.written?.[0]?.cited, ["e1"]);
  expectEqual("and keeps it for the next day", same.written?.[0]?.explained, { key, candidate });
  expect("no quota is read and no model run recorded", !same.calls.some((c) => /quota|ai_runs|usage|rate/.test(c.table)), same.calls.map((c) => c.verb + ":" + c.table));
  const changed = await run({ ...stored(key), "select:exchange_offering_evidence": { data: [{ id: "e1", offering_id: "o1", kind: "fact", claim: "Partner status ended", source_url: "https://x.test" }], error: null } });
  expectEqual("changed evidence is asked about again (here, with no model, left unjudged)", changed.out.ok ? (changed.out.result as { explained?: string }).explained : changed.out, "no");
  expect("the key ignores order and follows content", key === explainKey({ ...input, candidates: [...input.candidates].reverse() }) && key !== explainKey({ ...input, need: { ...input.need, summary: "Other" } }));
  expectEqual("one candidate without a stored answer asks for all of them", reusableExplanations("k", ["a", "b"], new Map([["a", { key: "k", candidate: null }]])), null);
  expectEqual("a stored 'nothing to say' is an answer", reusableExplanations("k", ["a"], new Map([["a", { key: "k", candidate: null }]])), []);
}

console.log("\nexplain_match folded in — requirement from citations, unknown without evidence");
{
  const now = new Date("2026-11-23T12:00:00Z");
  const need: MatchNeed = { id: "n1", org_id: "buyer", category_id: "gpu", quantity: 200, budget_min: null, budget_max: null, currency: null, country: "DE" };
  const base = (id: string): MatchOffering => ({
    id, org_id: "seller", category_id: "gpu", price_from: null, price_to: null, currency: null, moq: 10,
    availability: null, availability_as_of: null, serves_global: false, serves_countries: ["DE"],
    provider: { claimed_at: "2026-11-01T00:00:00Z", verified_at: null },
  });
  const results = [scoreMatch(need, base("o1"), now), scoreMatch(need, base("o2"), now), scoreMatch(need, base("o3"), now)];
  expectEqual("requirement starts unknown, before any model has judged it", results[0]!.dimensions.requirement, null);
  const merged = applyExplanations(
    results,
    [
      { offeringId: "o1", reason: "Authorised partner with H200 stock.", backing: [{ mustHave: "authorised partner", evidenceId: "e1" }, { mustHave: "warranty", evidenceId: null }] },
      { offeringId: "o2", reason: "No evidence published.", backing: [{ mustHave: "authorised partner", evidenceId: null }] },
    ],
    2,
    new Map([["o1", 3], ["o2", 0]]),
  );
  expectEqual("half the must-haves backed is 50", merged[0]!.dimensions.requirement, 50);
  expectEqual("and the score is recomputed with it", merged[0]!.score, Math.round((100 + 100 + 100 + 60 + 50) / 5));
  expectEqual("the cited evidence is kept", merged[0]!.cited, ["e1"]);
  expect("the reason leads the explanation, the measured reasons follow", merged[0]!.explanation.startsWith("Authorised partner") && merged[0]!.explanation.includes("serves DE"), merged[0]!.explanation);
  expectEqual("a supplier with no published evidence is unknown, not 0", merged[1]!.dimensions.requirement, null);
  expectEqual("a candidate the model did not return is unchanged", merged[2], results[2]);
  expectEqual(
    "no must-haves stated: requirement stays unknown",
    applyExplanations(results, [{ offeringId: "o1", reason: "", backing: [] }], 0, new Map([["o1", 3]]))[0]!.dimensions.requirement,
    null,
  );
  expectEqual("must-haves split by line, comma or semicolon", splitMustHaves("authorised partner, warranty;\nCE mark, warranty"), [
    "authorised partner",
    "warranty",
    "CE mark",
  ]);
}

console.log("\nenforce_retention — the Exchange's own schedule runs for everyone (DN-40)");
{
  const { client, calls } = fakeClient({
    "rpc:prune_job_executions": { data: 0, error: null },
    "rpc:exchange_prune": { data: { needs: 2, intake_sessions: 1, reveal_log: 0 }, error: null },
    "select:organizations": { data: [], error: null },
  });
  setAdminClientForTests(client);
  try {
    const out = await enforceRetention({ scope: new OrgScope(ORG_A, client), payload: {}, job: { id: "j-r", org_id: ORG_A, job_name: "enforce_retention" } as never, now: new Date() });
    expect("Exchange data is pruned even when no workspace set a retention policy", calls.some((c) => c.verb === "rpc" && c.table === "exchange_prune"), calls.map((c) => c.verb + ":" + c.table));
    expectEqual("and what it removed is reported", out.ok ? (out.result as { exchange?: { pruned?: unknown } }).exchange?.pruned : null, { needs: 2, intake_sessions: 1, reveal_log: 0 });
    expect("stale introductions and lapsed requests are expired the same day", calls.some((c) => c.verb === "rpc" && c.table === "exchange_expire"), calls.map((c) => c.verb + ":" + c.table));
  } finally {
    setAdminClientForTests(null);
  }
}

console.log("\ncreate_intro_opportunities — an accepted introduction becomes a stated-need opportunity (DN-58)");
{
  const INTRO = "64646464-0064-0064-0064-0000000000a1";
  const base = {
    "select:exchange_intros": {
      data: [{ id: INTRO, need_id: "need-1", buyer_org_id: ORG_A, provider_org_id: ORG_B, decided_at: "2026-11-24T10:00:00Z" }],
      error: null,
    },
    "select:exchange_needs": { data: { summary: "200 H200 cards for Munich", created_at: "2026-11-20T09:00:00Z" }, error: null },
    "select:organizations": (r: { filters: [string, unknown][] }) =>
      r.filters.some(([k, v]) => k === "eq:id" && v === ORG_A)
        ? { data: { name: "Acme GmbH", primary_domain: null, slug: "acme" }, error: null }
        : { data: { name: "Northwind", primary_domain: "northwind.co", slug: "northwind" }, error: null },
    "insert:companies": { data: { id: "co-new" }, error: null },
    "insert:opportunities": { data: { id: "opp-new" }, error: null },
    "insert:evidence": { data: null, error: null },
    "update:exchange_intros": { data: null, error: null },
  };

  const fresh = fakeClient({ ...base, "select:companies": { data: null, error: null }, "select:opportunities": { data: null, error: null } });
  setAdminClientForTests(fresh.client);
  try {
    const out = await createIntroOpportunities({ scope: new OrgScope(ORG_B, fresh.client), payload: {}, job: { id: "j-io", org_id: null, job_name: "create_intro_opportunities" } as never, now: new Date() });
    expect("a new buyer is created as a company and an opportunity", out.ok && (out.result as { created?: number }).created === 1, out);
    const company = [fresh.calls.find((c) => c.verb === "insert" && c.table === "companies")?.payload].flat()[0] as Record<string, unknown>;
    expectEqual("in the supplier's workspace, never the buyer's", company?.org_id, ORG_B);
    expectEqual("a buyer with no domain gets a reserved placeholder, not an invented one", company?.canonical_domain, placeholderDomain(INTRO));
    const opp = [fresh.calls.find((c) => c.verb === "insert" && c.table === "opportunities")?.payload].flat()[0] as Record<string, unknown>;
    expect("the opportunity is an Exchange opportunity, hot, with the buyer's stated need as its reason", opp?.origin === "exchange" && opp?.priority === "hot" && String(opp?.priority_reason).includes("200 H200 cards"), opp);
    const ev = [fresh.calls.find((c) => c.verb === "insert" && c.table === "evidence")?.payload].flat()[0] as Record<string, unknown>;
    expect("its evidence is a fact whose source is the introduction", ev?.kind === "fact" && ev?.source_url === `/northwind/exchange/intros/${INTRO}`, ev);
    const link = fresh.calls.find((c) => c.verb === "update" && c.table === "exchange_intros");
    expectEqual("and the introduction is linked to it", (link?.payload as { opportunity_id?: string })?.opportunity_id, "opp-new");
    expect("no person is created from the buyer", !fresh.calls.some((c) => ["people", "contact_points", "enrichment_records", "enrollments"].includes(c.table)), fresh.calls.map((c) => c.table));
  } finally {
    setAdminClientForTests(null);
  }

  const known = fakeClient({ ...base, "select:companies": { data: { id: "co-known" }, error: null }, "select:opportunities": { data: { id: "opp-engine" }, error: null }, "update:opportunities": { data: null, error: null } });
  setAdminClientForTests(known.client);
  try {
    const out = await createIntroOpportunities({ scope: new OrgScope(ORG_B, known.client), payload: {}, job: { id: "j-io2", org_id: null, job_name: "create_intro_opportunities" } as never, now: new Date() });
    expect("a buyer the supplier already had is reused, not duplicated", out.ok && (out.result as { reused?: number }).reused === 1 && !known.calls.some((c) => c.verb === "insert" && c.table === "opportunities"), out);
    const upd = known.calls.find((c) => c.verb === "update" && c.table === "opportunities");
    expectEqual("and becomes an Exchange opportunity, which stops any cold sequence at them", (upd?.payload as { origin?: string })?.origin, "exchange");
  } finally {
    setAdminClientForTests(null);
  }
}

console.log("\nsend_exchange_notifications — quiet hours, the daily cap, current preferences, one-click unsubscribe");
{
  expect("quiet hours inside a day", inQuietHours(13, 12, 14) && !inQuietHours(14, 12, 14));
  expect("quiet hours across midnight", inQuietHours(23, 22, 7) && inQuietHours(3, 22, 7) && !inQuietHours(12, 22, 7));
  expect("no quiet hours when unset or empty", !inQuietHours(3, null, 7) && !inQuietHours(3, 5, 5));
  expect("alerts off stops alerts but not introduction emails", !allowedNow("match_alert", { exchange_alerts: "off", exchange_emails: true }) && allowedNow("intro_requested", { exchange_alerts: "off", exchange_emails: true }));
  expect("emails off stops conversation emails but not chosen alerts", allowedNow("match_alert", { exchange_alerts: "digest", exchange_emails: false }) && !allowedNow("new_message", { exchange_alerts: "digest", exchange_emails: false }));

  const U1 = "71717171-0071-0071-0071-000000000001";
  const U2 = "71717171-0071-0071-0071-000000000002";
  const U3 = "71717171-0071-0071-0071-000000000003";
  const savedEnv = { k: process.env.RESEND_API_KEY, f: process.env.EMAIL_FROM, s: process.env.NEXT_PUBLIC_SITE_URL, x: process.env.EXCHANGE_EMAIL_FROM, secret: process.env.SUPABASE_SECRET_KEY };
  const savedFetch = globalThis.fetch;
  try {
    // No email provider: queued for the feed, nothing emailed.
    delete process.env.RESEND_API_KEY;
    const quiet = fakeClient({ "rpc:exchange_queue_notifications": { data: { alerts: 1 }, error: null } });
    setAdminClientForTests(quiet.client);
    const out = await sendExchangeNotifications({ scope: new OrgScope(ORG_A, quiet.client), payload: {}, job: { id: "j-x1", org_id: null, job_name: "send_exchange_notifications" } as never, now: new Date() });
    expect("without an email provider, notices are queued for the in-app feed only", out.ok && quiet.calls.some((c) => c.verb === "rpc" && c.table === "exchange_queue_notifications") && !quiet.calls.some((c) => c.table === "profiles"), quiet.calls.map((c) => c.verb + ":" + c.table));
    setAdminClientForTests(null);

    // With one: an instant notice goes out with a one-click unsubscribe from the Exchange sender.
    process.env.RESEND_API_KEY = "re_test";
    process.env.EMAIL_FROM = "Huntloop <hello@example.test>";
    process.env.EXCHANGE_EMAIL_FROM = "Huntloop Exchange <exchange@example.test>";
    process.env.NEXT_PUBLIC_SITE_URL = "https://app.example.test";
    process.env.SUPABASE_SECRET_KEY = "test-secret";
    const sentBodies: Record<string, unknown>[] = [];
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      sentBodies.push(JSON.parse(String(init?.body ?? "{}")));
      return new Response(JSON.stringify({ id: "em_1" }), { status: 200 });
    }) as typeof fetch;
    const now = new Date("2026-11-24T10:00:00Z");
    const rows = [
      { id: "n1", org_id: ORG_A, user_id: U1, kind: "intro_requested", title: "Northwind would like to talk about your request", body: "x", href: "/acme/exchange/intros/i1", hot: false, created_at: now.toISOString() },
      { id: "n2", org_id: ORG_B, user_id: U2, kind: "match_alert", title: "A buyer is looking for GPUs — 100–1K", body: null, href: "/nw/exchange/supplier", hot: true, created_at: now.toISOString() },
      { id: "n3", org_id: ORG_B, user_id: U3, kind: "match_alert", title: "A buyer is looking for GPUs", body: null, href: "/nw/exchange/supplier", hot: true, created_at: now.toISOString() },
    ];
    const live = fakeClient({
      "rpc:exchange_queue_notifications": { data: { alerts: 2 }, error: null },
      "select:exchange_notifications": (r: { filters: [string, unknown][] }) =>
        r.filters.some(([k]) => k === "gte:email_sent_at")
          ? { data: Array.from({ length: 5 }, () => ({ user_id: U3 })), error: null }
          : r.filters.some(([k, v]) => k === "eq:channel" && v === "instant")
            ? { data: rows, error: null }
            : { data: [], error: null },
      "select:profiles": { data: [{ id: U1, email: "buyer@a.test" }, { id: U2, email: "night@b.test" }, { id: U3, email: "busy@b.test" }], error: null },
      "select:notification_preferences": { data: [{ org_id: ORG_B, user_id: U2, exchange_alerts: "instant", exchange_emails: true, digest_hour: 8, timezone: "UTC", quiet_start_hour: 9, quiet_end_hour: 11, last_exchange_digest_on: null }], error: null },
      "select:organizations": { data: [{ id: ORG_A, name: "Acme", slug: "acme" }, { id: ORG_B, name: "Northwind", slug: "nw" }], error: null },
      "select:memberships": { data: [{ org_id: ORG_A, user_id: U1 }, { org_id: ORG_B, user_id: U2 }, { org_id: ORG_B, user_id: U3 }], error: null },
      "update:exchange_notifications": { data: [{ id: "n1" }], error: null },
    });
    setAdminClientForTests(live.client);
    const res = await sendExchangeNotifications({ scope: new OrgScope(ORG_A, live.client), payload: {}, job: { id: "j-x2", org_id: null, job_name: "send_exchange_notifications" } as never, now });
    const result = res.ok ? (res.result as { instant: number; deferred: number; movedToDigest: number }) : null;
    expectEqual("the buyer's introduction email goes out at once", result?.instant, 1);
    expectEqual("a supplier in quiet hours waits", result?.deferred, 1);
    expectEqual("a supplier past five instant alerts today gets the rest in the digest", result?.movedToDigest, 1);
    const mail = sentBodies[0] as { from?: string; to?: string[]; headers?: Record<string, string>; html?: string } | undefined;
    expectEqual("from the Exchange's own sender", mail?.from, "Huntloop Exchange <exchange@example.test>");
    expect("with a one-click unsubscribe header", String(mail?.headers?.["List-Unsubscribe"] ?? "").includes("/api/notifications/exchange-unsubscribe?token=") && mail?.headers?.["List-Unsubscribe-Post"] === "List-Unsubscribe=One-Click", mail?.headers);
    expect("and the link is absolute, into the app", String(mail?.html ?? "").includes("https://app.example.test/acme/exchange/intros/i1"));
    const token = decodeURIComponent(String(mail?.headers?.["List-Unsubscribe"]).split("token=")[1]!.replace(/>$/, ""));
    expectEqual("the unsubscribe token verifies for that person and workspace", verifyExchangeUnsubscribeToken(token), { orgId: ORG_A, userId: U1 });
    expectEqual("and a digest token is not accepted as one", verifyExchangeUnsubscribeToken(token.replace(/\.[^.]+$/, ".forged")), null);

    /* DB-009: somebody removed from the workspace since the notice was written gets nothing. */
    const removed = fakeClient({
      "rpc:exchange_queue_notifications": { data: {}, error: null },
      "select:exchange_notifications": (r: { filters: [string, unknown][] }) =>
        r.filters.some(([k, v]) => k === "eq:channel" && v === "instant") ? { data: [rows[0]], error: null } : { data: [], error: null },
      "select:profiles": { data: [{ id: U1, email: "buyer@a.test" }], error: null },
      "select:notification_preferences": { data: [], error: null },
      "select:organizations": { data: [{ id: ORG_A, name: "Acme", slug: "acme" }], error: null },
      "select:memberships": { data: [], error: null },
      "update:exchange_notifications": { data: [{ id: "n1" }], error: null },
    });
    setAdminClientForTests(removed.client);
    const before = sentBodies.length;
    await sendExchangeNotifications({ scope: new OrgScope(ORG_A, removed.client), payload: {}, job: { id: "j-x3", org_id: null, job_name: "send_exchange_notifications" } as never, now });
    expect("a person no longer in the workspace is not emailed (DB-009)", sentBodies.length === before);
    expect(
      "and the notice is taken off the email queue",
      removed.calls.some((c) => c.table === "exchange_notifications" && c.verb === "update" && (c.payload as { channel?: string })?.channel === "none"),
    );
  } finally {
    setAdminClientForTests(null);
    globalThis.fetch = savedFetch;
    for (const [k, v] of Object.entries({ RESEND_API_KEY: savedEnv.k, EMAIL_FROM: savedEnv.f, NEXT_PUBLIC_SITE_URL: savedEnv.s, EXCHANGE_EMAIL_FROM: savedEnv.x, SUPABASE_SECRET_KEY: savedEnv.secret })) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

