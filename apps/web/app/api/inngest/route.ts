import { NextResponse, type NextRequest } from "next/server";
import { isInngestConfigured, sweep, tick, TICK_DEFAULTS } from "@huntloop/jobs";
import {
  hashSigningKey,
  INNGEST_REQ_VERSION,
  INNGEST_SDK,
  inngestApiOrigin,
  registrationPayload,
  verifyInngestSignature,
} from "../../../lib/inngest";
import { siteUrl } from "../../../lib/site-url";
import { monitorEngineTick } from "../../../lib/engine-monitor";

/**
 * The Inngest entry point.
 *
 * ── Why this exists when Vercel Cron already works ───────────────────────
 *
 * They fail differently, and an operator should be able to choose. Vercel Cron
 * is one timer with no memory: if an invocation is dropped, that tick simply
 * did not happen, and nothing anywhere records that it did not. Inngest keeps
 * a run history, retries the invocation itself, and can be paused — which is
 * worth having once the engine is spending money on a customer's behalf.
 *
 * Both drive the same `tick()` against the same Postgres queue. Nothing about
 * the durability of the work depends on which one is configured, which is the
 * whole point: moving between them is an operations decision, not a migration.
 *
 * ── Why there is no Inngest SDK here ─────────────────────────────────────
 *
 * Because the SDK's job is to define durable step functions, and the durable
 * steps in this system are rows in `job_executions` — claimed under
 * `for update skip locked`, retried with backoff, recovered from a dead worker
 * by `requeue_stalled_jobs`. Adding `inngest` as a dependency to re-express
 * that would create a second definition of "what work is outstanding", and the
 * two would disagree the first time one of them was down.
 *
 * So this route is what Inngest actually needs from us, per its SDK spec
 * (`lib/inngest.ts` holds the protocol and its tests):
 *
 *   PUT   Inngest asks the app to sync. We register one cron function with
 *         `POST <api>/fn/register`, authenticated by the hashed signing key.
 *   POST  Inngest calls that function: signature checked, then sweep + tick.
 *   GET   A short description of what is served, for a person checking.
 *
 * Until 19 Nov 2026 there was no PUT, and the signature was computed in the
 * wrong order with the wrong key bytes, so this path could never have run.
 * Vercel Cron was unaffected.
 *
 * ── When it is not configured ────────────────────────────────────────────
 *
 * 404. Not "200, feature disabled": an endpoint that answers cheerfully while
 * doing nothing is how a scheduler ends up reporting green for a week of ticks
 * that never ran. Vercel Cron remains the default and needs nothing.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** The headers the spec requires on every response to Inngest. */
const PROTOCOL_HEADERS = {
  "x-inngest-sdk": INNGEST_SDK,
  "x-inngest-req-version": INNGEST_REQ_VERSION,
  "cache-control": "no-store",
} as const;

function notFound() {
  return new NextResponse("Not found", { status: 404 });
}

export async function POST(request: NextRequest) {
  if (!isInngestConfigured()) return notFound();

  const body = await request.text();
  const verdict = verifyInngestSignature(
    request.headers.get("x-inngest-signature"),
    body,
    process.env.INNGEST_SIGNING_KEY,
  );
  if (!verdict.ok) {
    /* 500 with no-retry is what the spec asks for. The reason names which
       check failed, never the expected value. */
    return NextResponse.json(
      { name: "Error", message: verdict.reason },
      { status: 500, headers: { ...PROTOCOL_HEADERS, "x-inngest-no-retry": "true" } },
    );
  }

  try {
    /* The same sweep the cron route does, for the same reason: these are the
       only jobs that put periodic work into the queue, and a driver that ticks
       without sweeping runs an engine that never notices anything is due. */
    const report = await monitorEngineTick(async () => {
      await sweep();

      /* JOB-012: the same numbers as the cron route. */
      return tick({
        ...TICK_DEFAULTS,
        deadline: new Date(Date.now() + (maxDuration - 5) * 1000),
        worker: "inngest",
      });
    });

    return NextResponse.json(report, { headers: PROTOCOL_HEADERS });
  } catch (error) {
    /* Retriable: a tick that failed (a database blip, a deploy in progress)
       is safe to run again, because every job is at-least-once. */
    return NextResponse.json(
      { name: "Error", message: error instanceof Error ? error.message : "The tick failed." },
      { status: 500, headers: { ...PROTOCOL_HEADERS, "x-inngest-no-retry": "false" } },
    );
  }
}

/**
 * Sync: Inngest (or a person pressing "Sync" in its dashboard) sends a PUT
 * with no body, and the app registers what it serves.
 *
 * Unauthenticated by design, as in the SDKs: all it can do is re-register
 * the same function at the same configured URL (`registrationPayload` says
 * why the URL never comes from the request).
 */
let lastSync = 0;

export async function PUT() {
  if (!isInngestConfigured()) return notFound();

  /* PANEL-411: anyone may ask, so nobody may make this server call Inngest
     more than once a minute (per instance). */
  if (Date.now() - lastSync < 60_000) {
    return NextResponse.json({ message: "Synced less than a minute ago. Try again shortly." }, { status: 429, headers: { ...PROTOCOL_HEADERS, "retry-after": "60" } });
  }

  const endpoint = new URL("/api/inngest", siteUrl());
  const env = process.env.INNGEST_ENV?.trim();
  const response = await fetch(`${inngestApiOrigin()}/fn/register`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${hashSigningKey(process.env.INNGEST_SIGNING_KEY!.trim())}`,
      "content-type": "application/json",
      "x-inngest-sdk": INNGEST_SDK,
      ...(env ? { "x-inngest-env": env } : {}),
    },
    body: JSON.stringify(registrationPayload(endpoint)),
    signal: AbortSignal.timeout(15_000),
  }).catch((error: unknown) => (error instanceof Error ? error : new Error(String(error))));

  if (response instanceof Error) {
    return NextResponse.json(
      { message: `Could not reach Inngest to register: ${response.message}` },
      { status: 500, headers: PROTOCOL_HEADERS },
    );
  }

  const answer = (await response.json().catch(() => ({}))) as { modified?: boolean; error?: string };
  if (!response.ok) {
    return NextResponse.json(
      { message: `Inngest refused the registration (${response.status}): ${answer.error ?? "no reason given"}` },
      { status: 500, headers: PROTOCOL_HEADERS },
    );
  }

  lastSync = Date.now();
  return NextResponse.json(
    { message: "Successfully registered", modified: Boolean(answer.modified) },
    { status: 200, headers: PROTOCOL_HEADERS },
  );
}

/**
 * What this endpoint serves, for a person checking the deployment. No data
 * and no secret.
 */
export async function GET() {
  if (!isInngestConfigured()) return notFound();
  return NextResponse.json(
    {
      framework: "nextjs",
      appName: "huntloop",
      functionsFound: 1,
      url: new URL("/api/inngest", siteUrl()).toString(),
    },
    { headers: PROTOCOL_HEADERS },
  );
}
