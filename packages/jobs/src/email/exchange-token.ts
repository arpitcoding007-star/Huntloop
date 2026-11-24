/**
 * The one-click unsubscribe token for Exchange emails (build plan DN-81).
 *
 * The same construction as `digest-token.ts`, under its own key: an HMAC of
 * the workspace and person, keyed from the service secret with a different
 * HKDF label. A separate label means a digest link cannot switch off Exchange
 * email or the reverse — each link does exactly what its email says.
 */
import { createHmac, hkdfSync, timingSafeEqual } from "node:crypto";

function key(): Buffer | null {
  const material = process.env.SUPABASE_SECRET_KEY?.trim() || process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!material) return null;
  return Buffer.from(hkdfSync("sha256", material, "huntloop", "exchange-unsubscribe-v1", 32));
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function mac(k: Buffer, orgId: string, userId: string): string {
  return createHmac("sha256", k).update(`${orgId}\n${userId}`).digest("base64url");
}

export function exchangeUnsubscribeToken(orgId: string, userId: string): string | null {
  const k = key();
  if (!k) return null;
  return `${orgId}.${userId}.${mac(k, orgId, userId)}`;
}

export function verifyExchangeUnsubscribeToken(token: string): { orgId: string; userId: string } | null {
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
