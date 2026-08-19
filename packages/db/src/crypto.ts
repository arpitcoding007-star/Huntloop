/**
 * Application-layer encryption for the two columns that hold somebody else's
 * credentials: `mailboxes.oauth_token_enc` and `mailboxes.refresh_token_enc`.
 *
 * ── Why encrypt at all, when the database is already private ─────────────
 *
 * Because these are not our secrets. A refresh token for a customer's Gmail
 * account grants read and send on their real mailbox, indefinitely, and it
 * survives every rotation of our own credentials. RLS protects it from other
 * tenants; encryption protects it from a backup file, a log line, a snapshot
 * shared with support, and a PostgREST misconfiguration — all of which are
 * ways rows leave a database without anyone breaching it.
 *
 * `0004` named the columns `_enc` precisely so that a plain token assigned to
 * one is obvious in review. This is the other half of that decision.
 *
 * ── The construction, and why each part is there ─────────────────────────
 *
 * AES-256-GCM, from `node:crypto`. No dependency, and authenticated: a
 * ciphertext that has been altered fails to decrypt rather than decrypting to
 * something else. That matters more than confidentiality here — a token is
 * about to be presented to Google, and a corrupted one should fail loudly on
 * our side rather than as a mysterious 401 on theirs.
 *
 * A random 12-byte IV per encryption, stored alongside. Reusing an IV under
 * GCM is not a weakness, it is a break: two messages under the same key and IV
 * leak their XOR and the authentication key. Deriving it from the row id would
 * be exactly that mistake, because a token gets re-encrypted on every refresh.
 *
 * A version prefix, so the format can change without a migration that has to
 * decrypt everything first.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const VERSION = "v1";
const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;

export class EncryptionUnavailable extends Error {
  constructor() {
    super(
      "MAILBOX_ENCRYPTION_KEY is not set, so mailbox tokens cannot be stored. " +
        "It must be 32 bytes, hex-encoded — generate one with `openssl rand -hex 32`. " +
        "Without it, connecting a mailbox is refused rather than storing a token in plain text.",
    );
    this.name = "EncryptionUnavailable";
  }
}

/**
 * Whether tokens can be stored at all.
 *
 * Checked before the OAuth flow starts rather than after the callback. A user
 * who has already authorised Google and *then* meets this error has granted
 * access to their mailbox for nothing, and has to go and revoke it.
 */
export function isEncryptionConfigured(): boolean {
  try {
    key();
    return true;
  } catch {
    return false;
  }
}

function key(): Buffer {
  const raw = process.env.MAILBOX_ENCRYPTION_KEY?.trim();
  if (!raw) throw new EncryptionUnavailable();

  const bytes = /^[0-9a-f]{64}$/i.test(raw)
    ? Buffer.from(raw, "hex")
    : Buffer.from(raw, "base64");

  // Length is checked rather than padded or hashed. A short key silently
  // stretched is a key that is not 256 bits while everything says it is.
  if (bytes.length !== 32) throw new EncryptionUnavailable();
  return bytes;
}

/** `v1.<iv>.<tag>.<ciphertext>`, all base64url. Safe in a text column. */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    VERSION,
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

/**
 * The inverse. Throws on anything it cannot authenticate.
 *
 * Deliberately does not return null on failure. A caller that got null would
 * reach for a fallback — an empty string, a retry, a "reconnect" flow — and
 * the one thing that must not happen is a send that proceeds with a token
 * nobody could verify. Failing here surfaces as the mailbox needing to be
 * reconnected, which is the truthful outcome.
 */
export function decryptSecret(encoded: string): string {
  const parts = encoded.split(".");
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error(`Cannot read this secret: it is not ${VERSION} format.`);
  }

  const [, ivPart, tagPart, cipherPart] = parts as [string, string, string, string];
  const decipher = createDecipheriv(ALGORITHM, key(), Buffer.from(ivPart, "base64url"));
  decipher.setAuthTag(Buffer.from(tagPart, "base64url"));

  return Buffer.concat([
    decipher.update(Buffer.from(cipherPart, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}
