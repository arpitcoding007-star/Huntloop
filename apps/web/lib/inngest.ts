import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/**
 * Inngest's wire protocol, the three pieces `/api/inngest` needs.
 *
 * There is still no SDK (see the route's header). What there is now is the
 * protocol as Inngest's SDK spec and both official SDKs (inngest-js,
 * inngestgo) implement it. The earlier version of this check hashed
 * `timestamp + body` with the hex-decoded key, which matches neither: every
 * signed request Inngest sent would have been refused. It also had no PUT
 * handler, so Inngest could never sync the app in the first place.
 *
 * Kept free of `server-only` and of the route so the tests can call it.
 */

export const INNGEST_APP_ID = "huntloop";
export const INNGEST_FUNCTION_ID = "huntloop-tick";
/** Sent on every response and on the register call. `name:vX.Y.Z` per the spec. */
export const INNGEST_SDK = "huntloop:v0.1.0";
export const INNGEST_REQ_VERSION = "2";
const SIGNATURE_WINDOW_SECONDS = 300;

const PREFIX = /^signkey-[\w]+-/;

/** The key with its `signkey-<env>-` prefix removed, as the SDKs do. */
export function stripSigningKeyPrefix(key: string): string {
  return key.replace(PREFIX, "");
}

/**
 * The bearer token for Inngest's API: the prefix kept, the secret replaced by
 * the SHA-256 of its hex-decoded bytes. Never the raw key: Inngest hashes it
 * the same way and compares hashes, so the secret itself never goes over the
 * wire.
 */
export function hashSigningKey(key: string): string {
  const prefix = key.match(PREFIX)?.[0] ?? "";
  return prefix + createHash("sha256").update(Buffer.from(stripSigningKeyPrefix(key), "hex")).digest("hex");
}

/**
 * RFC 8785 (JCS) for the JSON Inngest sends: object keys sorted by code unit,
 * no whitespace. For values that came out of `JSON.parse`, ES number and
 * string serialisation already are JCS's, so sorting keys is the whole job.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .filter((k) => obj[k] !== undefined)
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`)
    .join(",")}}`;
}

function sign(material: string, body: string, timestamp: string): string {
  return createHmac("sha256", material).update(body).update(timestamp).digest("hex");
}

function sameHex(a: string, b: string): boolean {
  const x = Buffer.from(a, "utf8");
  const y = Buffer.from(b, "utf8");
  return x.length === y.length && timingSafeEqual(x, y);
}

export type SignatureVerdict = { ok: true } | { ok: false; reason: string };

/**
 * `X-Inngest-Signature: t=<unix seconds>&s=<hex>` where
 * `s = HMAC-SHA256(key without prefix, as UTF-8; body || t)`.
 *
 * The body is tried as received, then in its JCS form: inngestgo signs the
 * canonical form of a JSON body, and the bytes on the wire are not promised
 * to be canonical. Accepting either weakens nothing, since both need the key.
 *
 * The five-minute window is what stops a captured tick being replayed
 * forever, and a replayed tick is a replayed spend.
 */
export function verifyInngestSignature(
  header: string | null,
  body: string,
  signingKey: string | undefined,
  nowMs: number = Date.now(),
): SignatureVerdict {
  const key = signingKey?.trim();
  if (!key) return { ok: false, reason: "No signing key is configured." };
  if (!header) return { ok: false, reason: "No signature was presented." };

  const params = new URLSearchParams(header);
  const timestamp = params.get("t");
  const signature = params.get("s");
  if (!timestamp || !signature || !/^\d+$/.test(timestamp)) {
    return { ok: false, reason: "The signature header is malformed." };
  }

  if (Math.abs(nowMs / 1000 - Number(timestamp)) > SIGNATURE_WINDOW_SECONDS) {
    return { ok: false, reason: "That signature is outside the five-minute window." };
  }

  const material = stripSigningKeyPrefix(key);
  if (sameHex(signature, sign(material, body, timestamp))) return { ok: true };

  let canonical: string | null = null;
  try {
    canonical = body ? canonicalJson(JSON.parse(body)) : null;
  } catch {
    canonical = null;
  }
  if (canonical !== null && canonical !== body && sameHex(signature, sign(material, canonical, timestamp))) {
    return { ok: true };
  }

  return { ok: false, reason: "That signature does not match." };
}

/**
 * What `/fn/register` is told: one function on a cron, one step, called back
 * at this deployment's own `/api/inngest`.
 *
 * The URL comes from configuration (`siteUrl()`), never from the incoming
 * PUT's Host header. The PUT is unauthenticated by design, and building the
 * callback from its Host would let anyone who can reach the route point
 * Inngest's ticks at a host of their choosing.
 */
export function registrationPayload(endpoint: URL) {
  const url = new URL(endpoint);
  url.search = "";
  const stepUrl = new URL(url);
  stepUrl.searchParams.set("fnId", INNGEST_FUNCTION_ID);
  stepUrl.searchParams.set("stepId", "step");

  return {
    url: url.toString(),
    deployType: "ping",
    appName: INNGEST_APP_ID,
    framework: "nextjs",
    sdk: INNGEST_SDK,
    v: "0.1",
    functions: [
      {
        id: INNGEST_FUNCTION_ID,
        name: "Run one engine tick",
        triggers: [{ cron: "*/5 * * * *" }],
        steps: {
          step: {
            id: "step",
            name: "step",
            runtime: { type: "http", url: stepUrl.toString() },
          },
        },
      },
    ],
  };
}

/** Inngest's API origin; `INNGEST_API_BASE_URL` / `INNGEST_BASE_URL` override it, as in the SDKs. */
export function inngestApiOrigin(): string {
  const raw =
    process.env.INNGEST_API_BASE_URL?.trim() ||
    process.env.INNGEST_BASE_URL?.trim() ||
    "https://api.inngest.com";
  return raw.replace(/\/+$/, "");
}
