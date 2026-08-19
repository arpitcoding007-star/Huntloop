import { NextResponse, type NextRequest } from "next/server";
import { isInngestConfigured, sweep, tick } from "@huntloop/jobs";
import { createHmac, timingSafeEqual } from "node:crypto";

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
 * So this route is what Inngest actually needs from us: a signed HTTP endpoint
 * it can call on a schedule. The dependency is a signature check, and it is
 * eleven lines rather than a package.
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

export async function POST(request: NextRequest) {
  if (!isInngestConfigured()) {
    return new NextResponse("Not found", { status: 404 });
  }

  const body = await request.text();
  const verdict = verifySignature(request.headers.get("x-inngest-signature"), body);
  if (!verdict.ok) {
    return NextResponse.json({ error: verdict.reason }, { status: 401 });
  }

  /* The same sweep the cron route does, for the same reason: these are the
     only jobs that put periodic work into the queue, and a driver that ticks
     without sweeping runs an engine that never notices anything is due. */
  await sweep();

  const report = await tick({
    limit: 5,
    deadline: new Date(Date.now() + (maxDuration - 5) * 1000),
    worker: "inngest",
  });

  return NextResponse.json(report, { headers: { "cache-control": "no-store" } });
}

/**
 * GET is the introspection call Inngest makes to discover what an app serves.
 *
 * It answers with the one function this app exposes, and does not require a
 * signature — the response contains no data, only the shape of the endpoint
 * that is already public knowledge to anyone who read this file.
 */
export async function GET() {
  if (!isInngestConfigured()) {
    return new NextResponse("Not found", { status: 404 });
  }
  return NextResponse.json({
    framework: "nextjs",
    appName: "huntloop",
    functions: [
      {
        id: "huntloop-tick",
        name: "Run one engine tick",
        triggers: [{ cron: "*/5 * * * *" }],
      },
    ],
  });
}

/**
 * Inngest's request signature: `t=<unix>&s=<hmac-sha256 of t+body>`.
 *
 * The timestamp window is the part that is easy to leave out and that makes
 * the check worth having. Without it a valid signed request can be replayed
 * forever, and a replayed tick is a replayed spend.
 */
function verifySignature(
  header: string | null,
  body: string,
): { ok: true } | { ok: false; reason: string } {
  const key = process.env.INNGEST_SIGNING_KEY?.trim();
  if (!key) return { ok: false, reason: "No signing key is configured." };
  if (!header) return { ok: false, reason: "No signature was presented." };

  const params = new URLSearchParams(header);
  const timestamp = params.get("t");
  const signature = params.get("s");
  if (!timestamp || !signature) {
    return { ok: false, reason: "The signature header is malformed." };
  }

  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > 300) {
    return { ok: false, reason: "That signature is outside the five-minute window." };
  }

  // The key is prefixed `signkey-prod-<hex>`; the hex half is the actual key.
  const material = key.includes("-") ? key.slice(key.lastIndexOf("-") + 1) : key;
  const expected = createHmac("sha256", Buffer.from(material, "hex"))
    .update(timestamp)
    .update(body)
    .digest("hex");

  const a = Buffer.from(signature, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: "That signature does not match." };
  }

  return { ok: true };
}
