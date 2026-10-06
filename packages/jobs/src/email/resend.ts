
/**
 * Transactional email through Resend — the product's own mail (invitations,
 * join requests, the daily digest). Prospect outreach never goes through here:
 * it is sent from the customer's own connected mailbox, so it lands as them.
 *
 * Plain `fetch` against Resend's REST API rather than its SDK: one endpoint,
 * no extra dependency, and the request is short enough to read in full.
 *
 * ── Failing soft, saying so ──────────────────────────────────────────────
 *
 * Every send returns a result rather than throwing. The thing that triggered
 * the email — an invitation, an approval — has already happened and must not
 * be undone because a notification could not be delivered; the caller tells
 * the person what did and did not go out instead.
 */

export type SendResult =
  | { ok: true; id: string }
  | { ok: false; reason: "unconfigured" | "rejected" | "unreachable"; detail?: string };

export interface EmailMessage {
  to: string | string[];
  subject: string;
  html: string;
  text: string;
  /** Resend de-duplicates sends with the same key for 24 hours. */
  idempotencyKey?: string;
  replyTo?: string;
  /** Extra headers, e.g. `List-Unsubscribe` on the digest. */
  headers?: Record<string, string>;
  /** Tags for Resend's dashboard; ASCII letters, numbers, `_` and `-` only. */
  tags?: Record<string, string>;
}

const ENDPOINT = "https://api.resend.com/emails";
const TIMEOUT_MS = 10_000;

export function emailConfig(): { apiKey: string; from: string; replyTo: string | null } | null {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.EMAIL_FROM?.trim();
  if (!apiKey || !from) return null;
  return { apiKey, from, replyTo: process.env.EMAIL_REPLY_TO?.trim() || null };
}

/** Whether product email can be sent on this deployment. */
export function isEmailConfigured(): boolean {
  return emailConfig() !== null;
}

export async function sendEmail(message: EmailMessage): Promise<SendResult> {
  const config = emailConfig();
  if (!config) return { ok: false, reason: "unconfigured" };

  const body = {
    from: config.from,
    to: Array.isArray(message.to) ? message.to : [message.to],
    subject: message.subject,
    html: message.html,
    text: message.text,
    ...(message.replyTo || config.replyTo ? { reply_to: message.replyTo ?? config.replyTo } : {}),
    ...(message.headers ? { headers: message.headers } : {}),
    ...(message.tags
      ? { tags: Object.entries(message.tags).map(([name, value]) => ({ name, value })) }
      : {}),
  };

  try {
    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.apiKey}`,
        "content-type": "application/json",
        ...(message.idempotencyKey ? { "idempotency-key": message.idempotencyKey } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });

    if (!response.ok) {
      // Resend's error body names the problem (unverified domain, bad key);
      // it goes to the log, never to the person who triggered the send.
      const detail = await response.text().catch(() => "");
      console.error(`[email] Resend refused a send (${response.status}): ${detail.slice(0, 500)}`);
      return { ok: false, reason: "rejected", detail: `HTTP ${response.status}` };
    }

    const json = (await response.json().catch(() => ({}))) as { id?: string };
    return { ok: true, id: String(json.id ?? "") };
  } catch (error) {
    console.error("[email] Resend could not be reached", error);
    return { ok: false, reason: "unreachable" };
  }
}
