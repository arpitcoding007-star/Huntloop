/**
 * Getting a usable access token for a mailbox row.
 *
 * ── The refresh, and where it belongs ────────────────────────────────────
 *
 * An access token lives about an hour. Every send and every sync therefore
 * starts by asking "is this still valid, and if not, can I get a new one?",
 * and the answer has to be written back — otherwise every call refreshes,
 * which is both slow and a good way to be rate-limited by the provider.
 *
 * That makes this the one place that decrypts a token, and the one place that
 * writes an encrypted one. Every caller works against `authorize()` and never
 * touches `oauth_token_enc` directly, so a handler cannot accidentally hold a
 * decrypted refresh token or store a plain one.
 *
 * ── Why a failed refresh disconnects the mailbox ─────────────────────────
 *
 * Because it is not transient. A refresh token stops working when the user
 * revokes access, changes their password, or an admin removes the app — and
 * none of those resolve by waiting. Marking the row `disconnected` is what
 * makes the outreach screen say "reconnect this mailbox" instead of showing a
 * healthy mailbox whose every send fails.
 */
import { decryptSecret, encryptSecret } from "@huntloop/db";
import type { OrgScope } from "../scope.ts";
import { gmail } from "./gmail.ts";
import { outlook } from "./outlook.ts";
import type { MailboxProvider, ProviderId } from "./provider.ts";

export * from "./provider.ts";
export { gmail } from "./gmail.ts";
export { outlook } from "./outlook.ts";

export function providerFor(id: string): MailboxProvider {
  if (id === "gmail") return gmail;
  if (id === "outlook") return outlook;
  throw new Error(
    `${id} is not a mailbox provider this product implements. SMTP has no way ` +
      `to read replies, so a mailbox connected that way would send into a ` +
      `thread nobody could follow.`,
  );
}

export class MailboxUnavailable extends Error {
  readonly mailboxId: string;

  constructor(mailboxId: string, reason: string) {
    super(reason);
    this.name = "MailboxUnavailable";
    this.mailboxId = mailboxId;
  }
}

export interface AuthorizedMailbox {
  id: string;
  email: string;
  provider: MailboxProvider;
  accessToken: string;
  syncCursor: string | null;
  dailyLimit: number;
}

/**
 * A mailbox with a token that is good right now.
 *
 * Refreshes with two minutes to spare. A token that expires mid-request is a
 * 401 in the middle of a send, and the send is the one operation here that
 * must not be retried blindly — a retry after a partial success sends twice.
 */
export async function authorize(
  scope: OrgScope,
  mailboxId: string,
): Promise<AuthorizedMailbox> {
  const { data: row, error } = await scope
    .select(
      "mailboxes",
      "id, email, provider, status, oauth_token_enc, refresh_token_enc, token_expires_at, sync_cursor, daily_limit",
    )
    .eq("id", mailboxId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) throw new MailboxUnavailable(mailboxId, `That mailbox could not be read: ${error.message}`);
  if (!row) throw new MailboxUnavailable(mailboxId, "That mailbox no longer exists.");
  if (row.status !== "connected") {
    throw new MailboxUnavailable(
      mailboxId,
      `${row.email} is ${row.status}. Reconnect it before anything can be sent from it.`,
    );
  }

  const provider = providerFor(String(row.provider));
  const expiresAt = row.token_expires_at ? new Date(String(row.token_expires_at)) : null;
  const stillGood = expiresAt !== null && expiresAt.getTime() - Date.now() > 120_000;

  if (stillGood && row.oauth_token_enc) {
    return {
      id: String(row.id),
      email: String(row.email),
      provider,
      accessToken: decryptSecret(String(row.oauth_token_enc)),
      syncCursor: row.sync_cursor ?? null,
      dailyLimit: Number(row.daily_limit ?? 0),
    };
  }

  if (!row.refresh_token_enc) {
    await disconnect(
      scope,
      mailboxId,
      "This mailbox has no refresh token, so its access cannot be renewed. Reconnect it.",
    );
    throw new MailboxUnavailable(mailboxId, `${row.email} needs reconnecting.`);
  }

  let refreshed;
  try {
    refreshed = await provider.refresh(decryptSecret(String(row.refresh_token_enc)));
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    await disconnect(scope, mailboxId, reason);
    throw new MailboxUnavailable(
      mailboxId,
      `${row.email} could not be renewed and has been marked disconnected: ${reason}`,
    );
  }

  await scope
    .update("mailboxes", {
      oauth_token_enc: encryptSecret(refreshed.accessToken),
      // Google omits the refresh token on a refresh. Storing null over the one
      // we have would break the mailbox permanently, one hour later.
      ...(refreshed.refreshToken
        ? { refresh_token_enc: encryptSecret(refreshed.refreshToken) }
        : {}),
      token_expires_at: refreshed.expiresAt.toISOString(),
      last_error: null,
    })
    .eq("id", mailboxId);

  return {
    id: String(row.id),
    email: String(row.email),
    provider,
    accessToken: refreshed.accessToken,
    syncCursor: row.sync_cursor ?? null,
    dailyLimit: Number(row.daily_limit ?? 0),
  };
}

export async function disconnect(
  scope: OrgScope,
  mailboxId: string,
  reason: string,
): Promise<void> {
  await scope
    .update("mailboxes", { status: "disconnected", last_error: reason.slice(0, 1000) })
    .eq("id", mailboxId);
}

/**
 * Which mailbox should send this message.
 *
 * The one with the most allowance left today, among those that are connected
 * and have any. Spreading sends across mailboxes rather than exhausting one at
 * a time is a deliverability decision, not a load-balancing one: a domain
 * whose entire day's volume comes from one address at 09:00 looks like exactly
 * what it is.
 *
 * Returns null when every mailbox is full, which is a normal end to a day's
 * sending and is reported as one — the enrollment is parked until tomorrow
 * rather than failed.
 */
export async function pickMailbox(scope: OrgScope): Promise<string | null> {
  const { data } = await scope
    .select("mailboxes", "id, daily_limit, sent_today, sent_today_on")
    .eq("status", "connected")
    .is("deleted_at", null);

  const today = new Date().toISOString().slice(0, 10);
  /* Cast once, here: `scope.select` returns PostgREST's untyped row bag (see the
     note on `Query` in scope.ts), and one annotated boundary is what lets the
     map, filter and sort below infer rather than each taking an `any`. */
  const rows = (data ?? []) as Record<string, unknown>[];
  const candidates = rows
    .map((row) => {
      const usedToday = String(row.sent_today_on ?? "").slice(0, 10) === today
        ? Number(row.sent_today ?? 0)
        : 0;
      return { id: String(row.id), remaining: Number(row.daily_limit ?? 0) - usedToday };
    })
    .filter((m) => m.remaining > 0)
    .sort((a, b) => b.remaining - a.remaining);

  return candidates[0]?.id ?? null;
}

export type { ProviderId };
