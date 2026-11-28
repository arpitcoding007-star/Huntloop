/** The schedulers, the backlog cap, learning, analysis and scoring. */
import { OrgScope, setAdminClientForTests } from "../../src/scope.ts";
import { scheduleDiscovery } from "../../src/handlers/schedule-discovery.ts";
import { scheduleFollowups } from "../../src/handlers/schedule-followups.ts";
import { HANDLERS } from "../../src/registry.ts";
import { balanceObservations, ruleFacts } from "../../src/handlers/score-opportunity.ts";
import { assignedEmail } from "../../src/email/templates.ts";
import { loadCompanySignals } from "../../src/handlers/advance-enrollments.ts";
import { RULE_FIELDS } from "@huntloop/db/rules";
import { expect, expectEqual, type Recorded, fakeClient, ORG_A, ORG_B } from "./harness.ts";

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

{
  const m = assignedEmail({ orgName: "Acme", companyName: "<b>North</b>", assignerName: null, url: "https://x.test/acme/opportunities/1" });
  expect("the assignment email links the opportunity and escapes the company", m.html.includes("https://x.test/acme/opportunities/1") && !m.html.includes("<b>North</b>") && m.text.includes("A teammate assigned"));
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

console.log("\nschedule_followups — MAP-001: the producer the orphans never had");
{
  const OPP = "11111111-0034-0034-0034-000000000001";
  const COMPANY = "22222222-0034-0034-0034-000000000002";
  const { client, calls } = fakeClient({
    "select:opportunities": { data: [{ id: OPP, org_id: ORG_A, company_id: COMPANY }], error: null },
    /* FLOW-007: one company never researched and with no opportunity (an
       import), and one that already has an opportunity and must be left. */
    /* The "Research this" read (0040) asks for requested companies; none is
       requested here, so it must not re-research anything. */
    "select:companies": (record: { filters: [string, unknown][] }) =>
      record.filters.some(([f]) => f === "not:research_asked_at")
        ? { data: [], error: null }
        : {
            data: [
              { id: "33333333-0036-0036-0036-000000000003", org_id: ORG_A, opportunities: [] },
              { id: "44444444-0036-0036-0036-000000000004", org_id: ORG_A, opportunities: [{ id: OPP }] },
            ],
            error: null,
          },
    "insert:job_executions": { data: { id: "job_1" }, error: null },
  });
  setAdminClientForTests(client);

  const outcome = await HANDLERS.schedule_followups({
    scope: new OrgScope(ORG_A, client),
    payload: {},
    job: {} as never,
    now: new Date(),
  });

  const enqueued = calls
    .filter((c) => c.table === "job_executions" && c.verb === "insert")
    .map((c) => (Array.isArray(c.payload) ? c.payload[0] : c.payload) as Record<string, unknown>);
  const names = enqueued.map((row) => row.job_name).sort();

  expect("the sweep succeeds", outcome.ok, JSON.stringify(outcome));
  expectEqual(
    "a requested push, an unsearched opportunity, a stale company and an unqualified import each become a job",
    names,
    ["enrich_company", "rank_contacts", "research_company", "sync_hubspot"],
  );
  expect(
    "a company that already has an opportunity is not re-researched",
    !enqueued.some((row) => JSON.stringify(row.payload ?? {}).includes("44444444-0036")),
  );
  expect(
    "and an import is marked requested, so a refused run is retried daily, not every tick",
    calls.some(
      (c) =>
        c.table === "companies" &&
        c.verb === "update" &&
        typeof (c.payload as Record<string, unknown>).research_requested_at === "string",
    ),
  );
  expect(
    "every job carries the org it belongs to",
    enqueued.every((row) => row.org_id === ORG_A),
  );
  const updates = calls.filter((c) => c.table === "opportunities" && c.verb === "update");
  expect(
    "a push request is cleared once its job exists",
    updates.some((c) => (c.payload as Record<string, unknown>).crm_sync_requested_at === null),
  );
  expect(
    "and an opportunity is marked searched, so it costs one search, not one per tick",
    updates.some((c) => typeof (c.payload as Record<string, unknown>).contacts_sought_at === "string"),
  );
  setAdminClientForTests(null);
}

console.log("\nruleFacts — competitor relationships reach the rules");
{
  const facts = ruleFacts({}, [], [], { score: 50, priority: "warm" }, {
    uses: ["Rival"],
    evaluating: [],
    former: ["OldCo"],
  });
  expectEqual("uses", facts["competitors.uses"], ["Rival"]);
  expectEqual("former", facts["competitors.former"], ["OldCo"]);
  expectEqual("and none evaluating is an empty list, not absent", facts["competitors.evaluating"], []);
}

console.log("\nFLOW-103 — hiring and site evidence reach the scorer and the draft");
{
  const research = Array.from({ length: 30 }, (_, i) => ({ field: `research:${i}` }));
  const hiring = Array.from({ length: 3 }, (_, i) => ({ field: `hiring_signal:${i}` }));
  const site = [{ field: "site:pricing" }, { field: "site:careers" }];
  const picked = balanceObservations([...research, ...hiring, ...site]);
  expect("the scorer's view stays at its limit", picked.length === 25, picked.length);
  expect(
    "and newer research no longer crowds out hiring and site facts",
    hiring.every((h) => picked.includes(h)) && site.every((s) => picked.includes(s)),
  );
  expect("research still fills what is left", picked.filter((r) => r.field.startsWith("research")).length === 20);

  const { client, calls } = fakeClient({
    "select:evidence": (r: Recorded) => ({
      data: JSON.stringify(r.filters).includes("hiring_signal")
        ? [{ id: "ev-h", claim: "Hiring a payments lead", kind: "fact", source_url: "https://acme.test/jobs/1", event_date: new Date().toISOString() }]
        : [{ id: "ev-s", claim: "Publishes pricing", kind: "fact", source_url: "https://acme.test/pricing", event_date: null }],
      error: null,
    }),
  });
  const signals = await loadCompanySignals(new OrgScope(ORG_A, client), "c-1");
  expect("the draft is given the company's hiring and site evidence", signals.map((s) => s.id).join() === "ev-h,ev-s", signals);
  expect(
    "and a hiring posting must be recent to count",
    calls.some((c) => c.table === "evidence" && JSON.stringify(c.filters).includes("event_date")),
  );
}

console.log("\nschedule_discovery — a run killed mid-flight no longer blocks its search (ENG-001)");
{
  const world = fakeClient({
    "update:discovery_runs": { data: [{ id: "r1" }], error: null },
    "rpc:claim_due_discovery_queries": { data: [], error: null },
  });
  setAdminClientForTests(world.client);
  const now = new Date("2026-11-24T12:00:00Z");
  const out = await scheduleDiscovery({ scope: new OrgScope(ORG_A, world.client), payload: {}, job: { id: "j-d", org_id: null, job_name: "schedule_discovery" } as never, now });
  const reap = world.calls.find((c) => c.table === "discovery_runs" && c.verb === "update");
  expect("abandoned runs are closed before claiming", Boolean(reap) && (reap!.payload as { status?: string }).status === "failed");
  expect("only runs untouched for 15 minutes", reap?.filters.some(([k, v]) => k === "lt:updated_at" && v === "2026-11-24T11:45:00.000Z") ?? false, JSON.stringify(reap?.filters));
  expectEqual("and the count is reported", out.ok ? (out.result as { abandonedRunsClosed?: number }).abandonedRunsClosed : null, 1);
  setAdminClientForTests(null);
}

console.log("\nschedule_followups — an enrichment asked for is not asked again for a day (ENG-002)");
{
  const world = fakeClient({
    "select:opportunities": (r: { payload?: unknown }) =>
      String(r.payload ?? "").includes("companies!inner(last_enriched_at")
        ? { data: [{ company_id: "co-x", org_id: ORG_A }], error: null }
        : { data: [], error: null },
    "select:companies": { data: [], error: null },
  });
  setAdminClientForTests(world.client);
  const now = new Date("2026-11-24T12:00:00Z");
  await scheduleFollowups({ scope: new OrgScope(ORG_A, world.client), payload: {}, job: { id: "j-f", org_id: null, job_name: "schedule_followups" } as never, now });
  const sweepQuery = world.calls.find((c) => c.table === "opportunities" && String(c.payload ?? "").includes("last_enriched_at"));
  expect(
    "the sweep skips what was asked about in the last day",
    sweepQuery?.filters.some(([k]) => k.startsWith("or:") && k.includes("enrich_requested_at.lt.2026-11-23T12:00:00.000Z")) ?? false,
    JSON.stringify(sweepQuery?.filters),
  );
  expect(
    "and marks what it asks for",
    world.calls.some((c) => c.table === "companies" && c.verb === "update" && (c.payload as { enrich_requested_at?: string })?.enrich_requested_at === now.toISOString()),
  );
  setAdminClientForTests(null);
}

