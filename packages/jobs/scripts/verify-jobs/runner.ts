/** The runner: tick, the sweep, reachability and the queue's heartbeat. */
import { setAdminClientForTests } from "../../src/scope.ts";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { sweep, tick } from "../../src/runner.ts";
import { HANDLERS, type JobHandler } from "../../src/registry.ts";
import { lastSweepSeconds } from "../../src/queue.ts";
import { expect, expectEqual, fakeClient, ORG_A } from "./harness.ts";

/* ── The runner ──────────────────────────────────────────────────────────── */

console.log("\ntick — P1-1: jobs that wait on a provider share the invocation");
{
  const original = { ...HANDLERS };
  const queue = Array.from({ length: 4 }, (_, i) => ({
    id: `p${i}`, org_id: ORG_A, job_name: "scan_source", status: "running", attempts: 1, max_attempts: 3,
    payload: { sourceId: `s${i}` }, run_at: new Date().toISOString(), error: null,
  }));
  const { client } = fakeClient({ "rpc:claim_job_executions": { data: queue, error: null } });
  setAdminClientForTests(client);

  let running = 0;
  let peak = 0;
  (HANDLERS as Record<string, JobHandler>).scan_source = async () => {
    running++;
    peak = Math.max(peak, running);
    await new Promise((r) => setTimeout(r, 30));
    running--;
    return { ok: true, result: {} };
  };

  const report = await tick({ limit: 4, concurrency: 4 });
  expectEqual("all four ran", report.succeeded, 4);
  expectEqual("four at once, not one after another", peak, 4);

  peak = 0;
  await tick({ limit: 4 });
  expectEqual("without a concurrency, one at a time as before", peak, 1);

  /* JOB-012: a full batch with time left is followed by another; a short one
     ends the tick. Two full batches, then two jobs, then never asked again. */
  let claims = 0;
  const { client: draining } = fakeClient({
    get "rpc:claim_job_executions"() {
      claims++;
      return { data: claims <= 2 ? queue : claims === 3 ? queue.slice(0, 2) : queue, error: null };
    },
  });
  setAdminClientForTests(draining);
  const drained = await tick({ limit: 4, concurrency: 4, batches: 5 });
  expectEqual("one tick claims again while batches come back full", drained.claimed, 10);
  expectEqual("and stops at the first short batch", claims, 3);

  Object.assign(HANDLERS, original);
  setAdminClientForTests(null);
}

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
  expect("the report carries the queue's lag", "oldestDueSeconds" in report);
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
  const handedBack = calls.find((c) => c.verb === "update" && (c.payload as { status?: string })?.status === "queued")
    ?.payload as { attempts?: number; run_at?: string; error?: string } | undefined;
  expect(
    "JOB-010: without costing it an attempt, a delay or an error",
    handedBack !== undefined && handedBack.run_at === undefined && handedBack.error === undefined && typeof handedBack.attempts === "number",
    handedBack,
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

/* ── Reachability ────────────────────────────────────────────────────────── */

/*
 * Every registered job has something that puts it in the queue (REC-10 of the
 * spec pack). The registry is a total map by type, which stops a job with no
 * handler; nothing stopped the reverse — a handler with no producer, which
 * passes every test of its own and never runs in production.
 *
 * A producer is a sweeper (the runner's SWEEPERS) or a `name: "<job>"` enqueue
 * anywhere in the engine, the shared packages or the web app. Static on
 * purpose: it reads source, so it needs no database and runs in CI.
 *
 * KNOWN_UNREACHABLE is the spec pack's DEF-04/05/06 as data. The check fails
 * both ways — a new orphan, or a listed job that has gained a producer — so
 * the list cannot quietly go stale. Remove a name in the change that wires it
 * (or deletes it) once DEC-07/08 are decided.
 */
console.log("\nreachability — every job has a producer");

{
  /* enrich_person (rank_contacts) and resolve_entity (discover_companies) are
     wired. purge_contact_data stays: Settings → Data & privacy erases through
     `erase_contact_for_org` directly, so the job has no caller by design. */
  const KNOWN_UNREACHABLE = ["purge_contact_data"];
  const root = fileURLToPath(new URL("../../../../", import.meta.url));

  const runner = readFileSync(new URL("../../src/runner.ts", import.meta.url), "utf8");
  const start = runner.indexOf("const SWEEPERS");
  const sweepers = new Set(
    [...runner.slice(start, runner.indexOf("]);", start)).matchAll(/^\s*"([a-z_]+)",/gm)].map((m) => m[1]!),
  );

  const produced = new Set<string>();
  const scan = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) {
        if (!["node_modules", ".next", "scripts", "e2e"].includes(entry.name)) scan(path);
      } else if (
        /\.tsx?$/.test(entry.name) &&
        !/\.test\.tsx?$/.test(entry.name) &&
        !/^(registry|queue)\.ts$/.test(entry.name)
      ) {
        for (const m of readFileSync(path, "utf8").matchAll(/\bname: "([a-z_]+)"/g)) produced.add(m[1]!);
      }
    }
  };
  for (const dir of ["packages/jobs/src", "packages/db/src", "packages/crm/src", "apps/web/app", "apps/web/lib"]) {
    scan(`${root}${dir}`);
  }

  expect("the runner's sweeper list was found", sweepers.size >= 10, [...sweepers]);
  const unreachable = Object.keys(HANDLERS)
    .filter((name) => !sweepers.has(name) && !produced.has(name))
    .sort();
  expectEqual(
    "the only job nothing enqueues is purge_contact_data (DEF-06)",
    unreachable,
    KNOWN_UNREACHABLE,
  );
}

/* ── The sweep ───────────────────────────────────────────────────────────── */

console.log("\nsweep — B-09: an hourly sweep that already ran this hour is not enqueued again");

{
  const periodic = ["schedule_learning", "send_digests", "schedule_demand", "schedule_preferences", "schedule_matching", "enforce_retention"];
  const { client, calls } = fakeClient({
    /* This period's run exists — finished, so the idempotency index no longer covers it. */
    "select:job_executions": { data: [{ id: "done" }], error: null },
  });
  setAdminClientForTests(client);
  await sweep();
  const enqueued = calls
    .filter((c) => c.table === "job_executions" && c.verb === "insert")
    .map((c) => String((c.payload as Record<string, unknown>).job_name));
  expect("no hourly or daily sweeper is enqueued twice in its period", periodic.every((n) => !enqueued.includes(n)), enqueued);
  expect("the per-tick sweepers still are", enqueued.includes("schedule_sends") && enqueued.includes("schedule_syncs"), enqueued);
  setAdminClientForTests(null);
}

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
      /* 0063: accepted introductions become opportunities. */
      "create_intro_opportunities",
      /* Retention, added with the compliance jobs. Keyed daily rather than
         per-tick — see `DAILY` in the runner. */
      "enforce_retention",
      /* 0042: demand grouping. Hourly; spends at most once a day per org. */
      "schedule_demand",
      /* Added with `0014`. Listed explicitly rather than derived from
         `SWEEPERS`, so adding a cross-tenant job is a deliberate two-line
         change — the set is the most consequential list in the engine, and a
         test that read it from the source would assert nothing about it. */
      "schedule_discovery",
      /* MAP-001: the producer for CRM pushes, contact discovery and
         enrichment refresh. Spends credits, so it is listed by hand. */
      "schedule_followups",
      "schedule_learning",
      /* 0060: Exchange matching. Hourly; no model and no provider spend. */
      "schedule_matching",
      /* 0044: each person's habits. Hourly; the model only for new notes. */
      "schedule_preferences",
      "schedule_recomputes",
      "schedule_scans",
      "schedule_sends",
      /* Added with the signal capability. Same reasoning as `schedule_discovery`
         above: listed here by hand, not derived, because that is what makes
         adding a credit-spending cross-tenant job to the sweep a change this
         test actually has to notice. */
      "schedule_signal_fetches",
      "schedule_syncs",
      /* 0040: product email. Listed by hand like every other sweeper; both
         send nothing without RESEND_API_KEY. */
      "send_digests",
      /* 0064: Exchange notices; queues in SQL, emails only with a provider. */
      "send_exchange_notifications",
      "send_notifications",
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
      .filter(
        (row) =>
          row.job_name !== "schedule_learning" &&
          row.job_name !== "enforce_retention" &&
          row.job_name !== "send_digests" &&
          row.job_name !== "schedule_demand" &&
          row.job_name !== "schedule_preferences" &&
          row.job_name !== "schedule_matching",
      )
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
    "the digest sweep collapses to one an hour — a person's digest hour changes hourly",
    enqueued
      .filter((row) => row.job_name === "send_digests")
      .every((row) => /^send_digests:\d{4}-\d{2}-\d{2}T\d{2}$/.test(String(row.idempotency_key))),
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

console.log("\nlastSweepSeconds — the heartbeat a quiet queue cannot hide (V-15)");
{
  const recent = new Date(Date.now() - 120_000).toISOString();
  const world = fakeClient({ "select:job_executions": { data: { created_at: recent }, error: null } });
  const seconds = await lastSweepSeconds(world.client);
  expect("reads the age of the newest sweep row", typeof seconds === "number" && seconds >= 119 && seconds <= 125, String(seconds));
  const q = world.calls.find((c) => c.table === "job_executions");
  expect("only cross-tenant rows count, since only sweep() writes them", q?.filters.some(([k, v]) => k === "is:org_id" && v === null) ?? false, JSON.stringify(q?.filters));
  expect("newest first", q?.filters.some(([k, v]) => k === "order:created_at" && JSON.stringify(v) === JSON.stringify({ ascending: false })) ?? false, JSON.stringify(q?.filters));

  const empty = fakeClient({ "select:job_executions": { data: null, error: null } });
  expectEqual("no sweep ever is 'never', not zero", await lastSweepSeconds(empty.client), "never");

  const broken = fakeClient({ "select:job_executions": { data: null, error: { message: "boom" } } });
  expectEqual("an unreadable table is null, never healthy", await lastSweepSeconds(broken.client), null);
}

