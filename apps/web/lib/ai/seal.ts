import "server-only";
import { createHmac, hkdfSync, timingSafeEqual } from "node:crypto";

/**
 * A server signature over a verdict the model actually produced.
 *
 * ── Why this exists (pass 14: RT-001, RT-002, TRUST-007) ─────────────────
 *
 * The analyze screen round-trips its verdict through the browser so that the
 * row saved is the verdict the user read — re-running the model on save would
 * store a different answer. But `saveQualificationAction` then trusted that
 * payload wholesale: claims marked `fact`, their source URLs, the score. Two
 * things followed.
 *
 *   · With no model configured, `qualify()` returns a worked example — a
 *     HOT 91 with a "fact" quoted from `https://<the domain you typed>/blog`.
 *     The screen labelled it, and still offered "Save as an opportunity",
 *     which filed an invented, sourced fact as real data.
 *   · Any member could call the action directly with any claims at all.
 *
 * A seal fixes both without changing the trade. `analyzeUrlAction` signs a
 * live verdict; save verifies the signature over exactly what comes back and
 * refuses anything unsigned (a worked example) or altered.
 *
 * ── The key ──────────────────────────────────────────────────────────────
 *
 * Derived with HKDF from the server-only Supabase secret key, under a label
 * used for nothing else. The derivation is one-way, so the seal key reveals
 * nothing about the secret, and no new environment variable has to be set in
 * every deployment. Without that secret there is no database to save into
 * either, so "no key" and "nothing to seal for" are the same state.
 */

/** How long a verdict stays savable. A day covers a user who reads it tomorrow. */
export const SEAL_TTL_MS = 24 * 3600_000;

function sealKey(): Buffer | null {
  const material =
    process.env.SUPABASE_SECRET_KEY?.trim() || process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!material) return null;
  return Buffer.from(hkdfSync("sha256", material, "huntloop", "verdict-seal-v1", 32));
}

/**
 * JSON with object keys sorted, so the signature does not depend on the order
 * a serializer happened to emit them in. `undefined` members are dropped, as
 * JSON.stringify does, so a round trip that loses them still verifies.
 */
export function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
}

function mac(key: Buffer, org: string, issuedAt: number, verdict: unknown): string {
  return createHmac("sha256", key)
    .update(`${org}\n${issuedAt}\n${canonical(verdict)}`)
    .digest("hex");
}

/** Null when there is no key — the caller then offers no save. */
export function sealVerdict(org: string, verdict: unknown, now = Date.now()): string | null {
  const key = sealKey();
  if (!key) return null;
  return `${now}.${mac(key, org, now, verdict)}`;
}

export function verifyVerdict(
  org: string,
  verdict: unknown,
  seal: unknown,
  now = Date.now(),
): boolean {
  const key = sealKey();
  if (!key || typeof seal !== "string") return false;

  const match = /^(\d{1,15})\.([0-9a-f]{64})$/.exec(seal);
  if (!match) return false;

  const issuedAt = Number(match[1]);
  if (!(issuedAt <= now && now - issuedAt <= SEAL_TTL_MS)) return false;

  const expected = Buffer.from(mac(key, org, issuedAt, verdict), "hex");
  const given = Buffer.from(match[2]!, "hex");
  return expected.length === given.length && timingSafeEqual(expected, given);
}
