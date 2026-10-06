import { createHmac, hkdfSync, timingSafeEqual } from "node:crypto";

/**
 * The one-click "stop these emails" link in the daily digest.
 *
 * The person following it may not be signed in — that is the point of one
 * click — so the link itself has to prove which preference it may change. It
 * carries the org and user ids and an HMAC over them, keyed from the service
 * key with HKDF (the same derivation the verdict seal uses, with its own
 * label), so it cannot be forged and cannot be pointed at somebody else.
 *
 * It only ever turns the digest *off*. A leaked link can do nothing worse
 * than stop one person's daily email, which they can turn back on in
 * Settings.
 */

function key(): Buffer | null {
  const material =
    process.env.SUPABASE_SECRET_KEY?.trim() || process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!material) return null;
  return Buffer.from(hkdfSync("sha256", material, "huntloop", "digest-unsubscribe-v1", 32));
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function mac(k: Buffer, orgId: string, userId: string): string {
  return createHmac("sha256", k).update(`${orgId}\n${userId}`).digest("base64url");
}

/** `<org>.<user>.<mac>`, or null when no key is configured. */
export function digestUnsubscribeToken(orgId: string, userId: string): string | null {
  const k = key();
  if (!k) return null;
  return `${orgId}.${userId}.${mac(k, orgId, userId)}`;
}

/** The ids a token was issued for, or null when it is not a valid token. */
export function verifyDigestUnsubscribeToken(token: string): { orgId: string; userId: string } | null {
  const k = key();
  if (!k) return null;
  const [orgId, userId, signature, extra] = token.split(".");
  if (extra !== undefined || !orgId || !userId || !signature) return null;
  if (!UUID.test(orgId) || !UUID.test(userId)) return null;
  const expected = Buffer.from(mac(k, orgId, userId));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  return { orgId, userId };
}
