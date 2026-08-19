/**
 * What a mailbox provider has to be able to do, and who can do it.
 *
 * Three verbs, and no more, because three is what outreach needs: exchange an
 * authorization code for tokens, send a message, and list what has arrived
 * since last time. Everything else a mail API offers — labels, drafts,
 * calendars — is surface this product does not use and should not be able to
 * reach with a customer's credentials.
 *
 * ── Why the scopes are narrow and named here ─────────────────────────────
 *
 * Because the consent screen shows them to the customer, and "Huntloop wants
 * to read, compose, send and permanently delete all your email" is both untrue
 * and the reason people abandon the connection. `gmail.send` plus
 * `gmail.readonly` is what the product does; `gmail.modify` would be easier
 * and would ask for the ability to delete.
 *
 * ── What is not here ─────────────────────────────────────────────────────
 *
 * SMTP. `mailboxes.provider` allows it and nothing implements it, deliberately:
 * SMTP has no way to read replies, so a mailbox connected that way would send
 * into a thread nobody could follow — and the inbox is half of what makes the
 * outreach in this product different from a mail-merge.
 */

export type ProviderId = "gmail" | "outlook";

export interface OAuthTokens {
  accessToken: string;
  /** Absent on a re-consent that reuses an existing grant. Keep the old one. */
  refreshToken: string | null;
  expiresAt: Date;
  /** The address the tokens belong to, read from the provider, never guessed. */
  email: string;
}

export interface OutgoingMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
  /** RFC 5322 Message-ID of the message being replied to, if any. */
  inReplyTo?: string | null;
  /** Provider thread id, so a reply lands in the same conversation. */
  threadId?: string | null;
  /** One-click unsubscribe, per RFC 8058. */
  unsubscribeUrl?: string | null;
}

export interface SentMessage {
  providerMessageId: string;
  providerThreadId: string | null;
  /** The Message-ID header the provider assigned, for matching replies. */
  messageIdHeader: string | null;
}

export interface IncomingMessage {
  providerMessageId: string;
  providerThreadId: string | null;
  messageIdHeader: string | null;
  inReplyTo: string | null;
  from: string;
  to: string;
  subject: string;
  text: string;
  receivedAt: string;
}

export interface SyncResult {
  messages: IncomingMessage[];
  /** Opaque. Stored in `mailboxes.sync_cursor` and handed back next time. */
  cursor: string | null;
}

export interface MailboxProvider {
  id: ProviderId;
  /** Where to send the browser to start consent. */
  authorizeUrl(state: string, redirectUri: string): string;
  exchangeCode(code: string, redirectUri: string): Promise<OAuthTokens>;
  refresh(refreshToken: string): Promise<OAuthTokens>;
  send(accessToken: string, message: OutgoingMessage): Promise<SentMessage>;
  sync(accessToken: string, cursor: string | null): Promise<SyncResult>;
}

export function isProviderConfigured(id: ProviderId): boolean {
  if (id === "gmail") {
    return Boolean(process.env.GOOGLE_CLIENT_ID?.trim() && process.env.GOOGLE_CLIENT_SECRET?.trim());
  }
  return Boolean(
    process.env.MICROSOFT_CLIENT_ID?.trim() && process.env.MICROSOFT_CLIENT_SECRET?.trim(),
  );
}

/** Which providers this deployment can actually offer. Possibly none. */
export function configuredProviders(): ProviderId[] {
  return (["gmail", "outlook"] as ProviderId[]).filter(isProviderConfigured);
}

/**
 * An RFC 5322 message, assembled by hand.
 *
 * Both providers accept a raw MIME message, and both offer a structured JSON
 * alternative that cannot express `In-Reply-To` or `List-Unsubscribe` without
 * dropping to raw headers anyway. One code path that produces one format is
 * easier to reason about than two that diverge on the headers that decide
 * whether a reply threads.
 *
 * `List-Unsubscribe` and `List-Unsubscribe-Post` together are RFC 8058's
 * one-click unsubscribe. Gmail and Yahoo require them of bulk senders, and
 * they are the difference between a recipient unsubscribing and a recipient
 * pressing "report spam" — which costs the sending domain far more.
 */
export function buildMime(from: string, message: OutgoingMessage): string {
  const boundary = `hl_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  const headers: string[] = [
    `From: ${from}`,
    `To: ${message.to}`,
    `Subject: ${encodeHeader(message.subject)}`,
    `MIME-Version: 1.0`,
  ];

  if (message.inReplyTo) {
    headers.push(`In-Reply-To: ${message.inReplyTo}`);
    // Both, because clients differ on which one they thread by. Sending only
    // In-Reply-To threads in Gmail and starts a new conversation in Outlook.
    headers.push(`References: ${message.inReplyTo}`);
  }

  if (message.unsubscribeUrl) {
    headers.push(`List-Unsubscribe: <${message.unsubscribeUrl}>`);
    headers.push(`List-Unsubscribe-Post: List-Unsubscribe=One-Click`);
  }

  if (!message.html) {
    headers.push(`Content-Type: text/plain; charset="UTF-8"`);
    return `${headers.join("\r\n")}\r\n\r\n${message.text}`;
  }

  headers.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);

  return [
    headers.join("\r\n"),
    "",
    `--${boundary}`,
    `Content-Type: text/plain; charset="UTF-8"`,
    "",
    message.text,
    `--${boundary}`,
    `Content-Type: text/html; charset="UTF-8"`,
    "",
    message.html,
    `--${boundary}--`,
    "",
  ].join("\r\n");
}

/**
 * RFC 2047 encoding for a header that is not pure ASCII.
 *
 * Without it a subject containing an em dash or an accented name arrives as
 * mojibake — which looks exactly like the output of a badly built bulk sender,
 * because it usually is.
 */
function encodeHeader(value: string): string {
  // eslint-disable-next-line no-control-regex -- the point is to detect non-ASCII
  if (/^[\x00-\x7F]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

/** `Dana Whitfield <dana@acme.com>` → `dana@acme.com`. */
export function addressOf(value: string | undefined | null): string {
  if (!value) return "";
  const angled = /<([^>]+)>/.exec(value);
  return (angled?.[1] ?? value).trim().toLowerCase();
}
