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
  /*
   * Every value below lands on a header line, and a CR or LF inside one ends
   * that line and starts another: `hello\r\nBcc: x@y` adds a recipient that
   * no suppression check ever saw (security audit lead 8). The subject can
   * come from a model, an inbound email or a member's edit, so its control
   * characters become spaces. The addresses and the unsubscribe URL have no
   * legitimate reason to contain one, so they are refused outright.
   */
  if (!isSingleAddress(addressOf(from))) throw new Error("buildMime: the sender is not a single email address.");
  if (!isSingleAddress(message.to)) throw new Error("buildMime: the recipient is not a single email address.");
  const headers: string[] = [
    `From: ${headerText(from)}`,
    `To: ${message.to.trim()}`,
    `Subject: ${encodeHeader(headerText(message.subject))}`,
    `MIME-Version: 1.0`,
  ];

  // A Message-ID is one `<…>` token. Anything else is dropped rather than
  // sent: the reply loses its threading, which is recoverable.
  const inReplyTo = message.inReplyTo?.trim();
  if (inReplyTo && MESSAGE_ID.test(inReplyTo)) {
    headers.push(`In-Reply-To: ${inReplyTo}`);
    // Both, because clients differ on which one they thread by. Sending only
    // In-Reply-To threads in Gmail and starts a new conversation in Outlook.
    headers.push(`References: ${inReplyTo}`);
  }

  if (message.unsubscribeUrl) {
    // eslint-disable-next-line no-control-regex -- the point is to refuse controls
    if (!/^https?:\/\/[^\s<>"\x00-\x1f\x7f]+$/.test(message.unsubscribeUrl)) {
      throw new Error("buildMime: the unsubscribe URL is not a plain URL.");
    }
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

// eslint-disable-next-line no-control-regex -- a Message-ID has no controls or spaces
const MESSAGE_ID = /^<[^<>\s\x00-\x1f\x7f]+>$/;

/**
 * One address and nothing else: no display name, no list, no whitespace and
 * no control characters. What `To:` carries, and all `can_contact` judged.
 */
export function isSingleAddress(value: string | null | undefined): boolean {
  const v = (value ?? "").trim();
  // eslint-disable-next-line no-control-regex -- the point is to refuse controls
  return v.length <= 254 && /^[^\s@<>,;:"\x00-\x1f\x7f]+@[^\s@<>,;:"\x00-\x1f\x7f]+\.[^\s@<>,;:"\x00-\x1f\x7f]+$/.test(v);
}

/** Header text on one line: control characters (CR and LF among them) become spaces. */
export function headerText(value: string): string {
  // eslint-disable-next-line no-control-regex -- the point is to remove controls
  return value.replace(/[\x00-\x1f\x7f]+/g, " ").replace(/ {2,}/g, " ").trim();
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
