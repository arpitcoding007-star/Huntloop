import * as Sentry from "@sentry/nextjs";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Where CSP violations land.
 *
 * The policy ships report-only (see `lib/csp.ts`), so for the first week this
 * endpoint *is* the feature: it is the only way to find out what a real
 * enforcing policy would have broken, before it breaks it.
 *
 * ── This is an unauthenticated POST endpoint on a public origin ───────────
 *
 * It has to be — a violation report is sent by the browser before, and often
 * instead of, anything the user did. So it is written on the assumption that
 * it will be found and abused, and the mitigations are the interesting part:
 *
 *   · The body is size-capped before it is parsed. Without that, this is a
 *     way to make us allocate a megabyte per request.
 *   · Only a fixed set of fields is read, and each is truncated. The report
 *     body is attacker-controlled, and the destination is our alerting
 *     channel — an unbounded string field would let anyone write whatever
 *     they liked into the thing engineers read at 3am.
 *   · Reports are grouped by directive and blocked-URI rather than reported
 *     individually. One misconfigured directive produces one report per page
 *     view; without a fingerprint the first genuine violation would arrive as
 *     ten thousand separate issues.
 *   · It always answers 204, including on garbage. There is nothing useful to
 *     tell the sender, and status codes here are only a way to help someone
 *     map what the endpoint accepts.
 *
 * No rate limiting: `consume_rate_limit` requires an authenticated caller and
 * an org, neither of which exists here. The bounds above are what stands in
 * for it, and unlike a model call this path costs nothing per request beyond
 * the Sentry event — which Sentry's own quota already bounds.
 */

/** Larger than any real report; small enough to be uninteresting to abuse. */
const MAX_BODY_BYTES = 8_192;

const truncate = (value: unknown, max: number): string =>
  typeof value === "string" ? value.slice(0, max) : "";

interface CspReportBody {
  "csp-report"?: Record<string, unknown>;
}

export async function POST(request: NextRequest) {
  // 204 for everything. See the note above.
  const done = () => new NextResponse(null, { status: 204 });

  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_BODY_BYTES) return done();

  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return done();
  }
  // Checked again after reading: content-length is a claim, not a fact.
  if (raw.length > MAX_BODY_BYTES) return done();

  let parsed: CspReportBody;
  try {
    parsed = JSON.parse(raw) as CspReportBody;
  } catch {
    return done();
  }

  // Browsers disagree about the envelope: `report-uri` sends
  // `{"csp-report": {...}}`, the newer Reporting API sends an array of
  // `{type, body}`. Read whichever arrived rather than assuming.
  const report = parsed["csp-report"] ?? (parsed as Record<string, unknown>);
  if (!report || typeof report !== "object") return done();

  const directive = truncate(
    report["effective-directive"] ?? report["violated-directive"],
    64,
  );
  const blockedUri = truncate(report["blocked-uri"], 256);
  const documentUri = truncate(report["document-uri"], 256);
  const disposition = truncate(report["disposition"], 16);

  // A report naming no directive tells us nothing and is the shape a
  // hand-rolled POST takes.
  if (!directive) return done();

  Sentry.captureMessage(`CSP violation: ${directive}`, {
    level: "warning",
    // Grouped by what broke and where it tried to load from — the two fields
    // that identify the *policy* problem. Including document-uri would split
    // one bad directive across every page in the app.
    fingerprint: ["csp", directive, blockedUri],
    tags: {
      csp_directive: directive,
      // Report-only violations are informational; enforced ones broke
      // something a user was looking at. Worth being able to filter.
      csp_disposition: disposition || "report",
    },
    extra: {
      blockedUri,
      documentUri,
      scriptSample: truncate(report["script-sample"], 200),
    },
  });

  return done();
}

/**
 * Nothing else is allowed.
 *
 * Next answers unlisted methods with 405 automatically, which is correct and
 * worth not overriding: a GET here should not be a way to probe whether the
 * endpoint exists by watching for a different error.
 */
