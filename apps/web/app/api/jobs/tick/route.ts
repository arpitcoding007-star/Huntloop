import { NextResponse, type NextRequest } from "next/server";
import { cronSecret, sweep, tick } from "@huntloop/jobs";

/**
 * The heartbeat.
 *
 * Vercel Cron calls this on a schedule (see `vercel.json`); it claims a few
 * jobs from `job_executions`, runs them, and reports. Nothing about the work
 * lives here — this is the thing that *starts* a tick, and the queue is in
 * Postgres either way. That separation is what lets the same engine be driven
 * by Inngest instead without changing a handler.
 *
 * ── Why the secret is not optional ───────────────────────────────────────
 *
 * This endpoint runs work for every tenant. An unauthenticated version of it
 * is a way for anyone on the internet to make this deployment fetch arbitrary
 * URLs and spend its Anthropic budget, at whatever rate they can issue
 * requests. So a missing `CRON_SECRET` fails the request rather than skipping
 * the check: the alternative is a deployment that looks like it is working
 * and is wide open, which is the worst of the two failure modes because
 * nothing about it looks wrong.
 *
 * Vercel Cron sends `Authorization: Bearer $CRON_SECRET` automatically when
 * the variable is set on the project, so no configuration beyond the variable
 * itself is needed.
 *
 * ── Why it answers 200 on a job failure ──────────────────────────────────
 *
 * Because the *tick* succeeded. A cron platform reads the status code to
 * decide whether to alert, and a 500 for "one source's feed timed out" trains
 * people to ignore the alert — which is worse than no alert. Job failures are
 * in the body, and in `job_executions.error`, which is where a failure that
 * needs a human is actually looked for.
 */

/* Node, not Edge: the runner reaches `node:dns` and `node:net` to keep a scan
   from being pointed at a private address, and neither exists on Edge. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/**
 * Vercel's cap for a Hobby-plan function is 60s and for Pro is 300s. Asking
 * for 60 is the value that works on both; the runner's own deadline is set
 * from it below, so it stops claiming before the platform stops it.
 */
export const maxDuration = 60;

async function run(request: NextRequest) {
  const secret = cronSecret();
  if (!secret) {
    return NextResponse.json(
      {
        error:
          "CRON_SECRET is not set on this deployment, so the job runner cannot " +
          "authenticate its caller and refuses to run. Set it in the project's " +
          "environment variables — Vercel Cron then sends it automatically.",
      },
      { status: 503 },
    );
  }

  const presented = request.headers.get("authorization") ?? "";
  if (!safeEquals(presented, `Bearer ${secret}`)) {
    /* 404, not 401. A 401 confirms the endpoint exists and is worth guessing
       at, which is the same reasoning the org membership guard uses for its
       404-not-403 decision. */
    return new NextResponse("Not found", { status: 404 });
  }

  /* The sweepers, enqueued rather than called. They are jobs like any other,
     so they are claimed, timed, retried and recorded in `job_executions` — and
     the idempotency keys mean a sweep still running from the last tick is not
     started again. See `sweep()` for why this is not inside `tick()`. */
  await sweep();

  const report = await tick({
    limit: Number(request.nextUrl.searchParams.get("limit") ?? 5),
    // A margin under `maxDuration`, so the runner declines to start a job it
    // cannot finish rather than being killed holding the lock on it.
    deadline: new Date(Date.now() + (maxDuration - 5) * 1000),
    worker: `vercel-${process.env.VERCEL_REGION ?? "local"}`,
  });

  return NextResponse.json(report, {
    // Never cached, at any layer. A cached tick is a tick that did not happen.
    headers: { "cache-control": "no-store" },
  });
}

export const GET = run;
export const POST = run;

/**
 * Constant-time-ish string comparison.
 *
 * `===` on a secret leaks its prefix through timing. The leak is small and the
 * fix is four lines, and the alternative argument — "nobody can measure that
 * over HTTP" — is the kind of claim that stops being true when somebody moves
 * the deployment somewhere with less jitter.
 */
function safeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
