/**
 * Gmail, through the REST API.
 *
 * ── Why not googleapis ───────────────────────────────────────────────────
 *
 * The official client is ~40 MB installed and generates a surface covering
 * every Google API. This file uses four endpoints. On a serverless deployment
 * the package size is cold-start latency on every invocation of every route in
 * the same bundle, paid to avoid writing sixty lines of fetch.
 *
 * ── Sync, and why it is history-based ───────────────────────────────────
 *
 * `users.history.list` answers "what changed since historyId X" in one call,
 * which is the difference between a sync that costs one request and one that
 * lists and diffs the whole inbox every five minutes. The catch is that
 * history expires — Google keeps roughly a week — so an expired cursor comes
 * back as 404 and the code falls back to a bounded recent list rather than
 * failing. A mailbox that was disconnected for a fortnight should resume, not
 * refuse.
 */
import {
  addressOf,
  buildMime,
  type IncomingMessage,
  type MailboxProvider,
  type OAuthTokens,
  type SyncResult,
} from "./provider.ts";

const AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN = "https://oauth2.googleapis.com/token";
const API = "https://gmail.googleapis.com/gmail/v1/users/me";

/**
 * The narrowest scopes that do the job.
 *
 * `gmail.send` cannot read. `gmail.readonly` cannot delete or modify. The
 * tempting `gmail.modify` would cover both and also grants deletion, which is
 * a thing this product never does and should therefore never be able to do.
 */
const SCOPES = [
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/userinfo.email",
];

export const gmail: MailboxProvider = {
  id: "gmail",

  authorizeUrl(state, redirectUri) {
    const url = new URL(AUTH);
    url.searchParams.set("client_id", required("GOOGLE_CLIENT_ID"));
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", SCOPES.join(" "));
    // `offline` is what produces a refresh token at all; `consent` forces the
    // screen even on a re-authorisation, which is the only way to get a *new*
    // refresh token when the old one has been revoked.
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("prompt", "consent");
    url.searchParams.set("state", state);
    return url.toString();
  },

  async exchangeCode(code, redirectUri) {
    const body = new URLSearchParams({
      code,
      client_id: required("GOOGLE_CLIENT_ID"),
      client_secret: required("GOOGLE_CLIENT_SECRET"),
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    });
    const tokens = await token(body);
    return { ...tokens, email: await profileEmail(tokens.accessToken) };
  },

  async refresh(refreshToken) {
    const body = new URLSearchParams({
      refresh_token: refreshToken,
      client_id: required("GOOGLE_CLIENT_ID"),
      client_secret: required("GOOGLE_CLIENT_SECRET"),
      grant_type: "refresh_token",
    });
    const tokens = await token(body);
    return { ...tokens, email: await profileEmail(tokens.accessToken) };
  },

  async send(accessToken, message) {
    const from = await profileEmail(accessToken);
    const mime = buildMime(from, message);

    const response = await call(`${API}/messages/send`, accessToken, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        raw: Buffer.from(mime, "utf8").toString("base64url"),
        ...(message.threadId ? { threadId: message.threadId } : {}),
      }),
    });

    const sent = (await response.json()) as { id?: string; threadId?: string };
    if (!sent.id) {
      /* §78: record the failure, never falsely mark a message as sent. The
         database enforces the same thing — `messages_sent_has_provider_id`
         refuses a sent_at without a provider id — so this throw is what keeps
         the two agreeing rather than hitting a constraint later. */
      throw new Error("Gmail accepted the request but returned no message id.");
    }

    return {
      providerMessageId: sent.id,
      providerThreadId: sent.threadId ?? null,
      messageIdHeader: await messageIdOf(accessToken, sent.id),
    };
  },

  async sync(accessToken, cursor) {
    if (cursor) {
      const incremental = await syncFromHistory(accessToken, cursor);
      if (incremental) return incremental;
      // History expired. Fall through to the bounded list below.
    }
    return syncRecent(accessToken);
  },
};

/* ── OAuth ───────────────────────────────────────────────────────────────── */

async function token(body: URLSearchParams): Promise<Omit<OAuthTokens, "email">> {
  const response = await fetch(TOKEN, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Google refused the token request (${response.status}): ${detail.slice(0, 300)}`);
  }

  const json = (await response.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };
  if (!json.access_token) throw new Error("Google returned no access token.");

  return {
    accessToken: json.access_token,
    // Absent on a refresh, and on a re-consent that reuses an existing grant.
    // The caller keeps the one it already has rather than storing null over it.
    refreshToken: json.refresh_token ?? null,
    expiresAt: new Date(Date.now() + (json.expires_in ?? 3600) * 1000),
  };
}

/**
 * The address these tokens belong to, from the provider.
 *
 * Never taken from what the user typed. A mailbox row whose `email` disagrees
 * with the account behind its tokens sends as someone else and matches replies
 * to nobody — and the user is the one party who cannot check which account the
 * consent screen actually used.
 */
async function profileEmail(accessToken: string): Promise<string> {
  const response = await call(`${API}/profile`, accessToken);
  const json = (await response.json()) as { emailAddress?: string };
  if (!json.emailAddress) throw new Error("Google returned no address for this account.");
  return json.emailAddress.toLowerCase();
}

/* ── Sending and reading ─────────────────────────────────────────────────── */

async function messageIdOf(accessToken: string, id: string): Promise<string | null> {
  try {
    const response = await call(
      `${API}/messages/${id}?format=metadata&metadataHeaders=Message-Id`,
      accessToken,
    );
    const json = (await response.json()) as {
      payload?: { headers?: { name: string; value: string }[] };
    };
    const header = json.payload?.headers?.find((h) => h.name.toLowerCase() === "message-id");
    return header?.value ?? null;
  } catch {
    /* Not fatal. The Message-ID is the *fallback* path for matching a reply —
       the provider thread id is the primary one, and it is already recorded.
       Failing the send here would undo a message that has genuinely gone. */
    return null;
  }
}

async function syncFromHistory(
  accessToken: string,
  cursor: string,
): Promise<SyncResult | null> {
  const url = new URL(`${API}/history`);
  url.searchParams.set("startHistoryId", cursor);
  url.searchParams.set("historyTypes", "messageAdded");
  url.searchParams.set("maxResults", "100");

  const response = await fetch(url, {
    headers: { authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(20_000),
  });

  // 404 means the history id is older than Google keeps. Not an error — the
  // caller falls back to a recent list, which is how a mailbox that was
  // disconnected for a fortnight resumes instead of refusing.
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`Gmail history failed (${response.status}).`);
  }

  const json = (await response.json()) as {
    history?: { messagesAdded?: { message?: { id?: string } }[] }[];
    historyId?: string;
  };

  const ids = new Set<string>();
  for (const entry of json.history ?? []) {
    for (const added of entry.messagesAdded ?? []) {
      if (added.message?.id) ids.add(added.message.id);
    }
  }

  return {
    messages: await hydrate(accessToken, [...ids]),
    cursor: json.historyId ?? cursor,
  };
}

/**
 * The fallback, and the first sync.
 *
 * `newer_than:7d` bounds it. Without a bound, connecting a mailbox with
 * 200,000 messages would fetch all of them, and the useful ones are the
 * replies to outreach that has just been sent.
 */
async function syncRecent(accessToken: string): Promise<SyncResult> {
  const url = new URL(`${API}/messages`);
  url.searchParams.set("q", "in:inbox newer_than:7d");
  url.searchParams.set("maxResults", "50");

  const response = await call(url.toString(), accessToken);
  const json = (await response.json()) as { messages?: { id: string }[] };

  const profile = await call(`${API}/profile`, accessToken);
  const { historyId } = (await profile.json()) as { historyId?: string };

  return {
    messages: await hydrate(accessToken, (json.messages ?? []).map((m) => m.id)),
    cursor: historyId ?? null,
  };
}

/**
 * Message ids → messages, one request each.
 *
 * Sequential rather than parallel, and capped. Gmail's per-user rate limit is
 * generous but not unlimited, and a burst of fifty parallel requests from a
 * serverless function is the shape that triggers it — at which point the whole
 * sync fails rather than one message being slow.
 */
async function hydrate(accessToken: string, ids: string[]): Promise<IncomingMessage[]> {
  const out: IncomingMessage[] = [];

  for (const id of ids.slice(0, 50)) {
    try {
      const response = await call(`${API}/messages/${id}?format=full`, accessToken);
      const json = (await response.json()) as GmailMessage;
      const message = toIncoming(json);
      if (message) out.push(message);
    } catch {
      // One unreadable message does not fail the sync. The rest are real
      // replies somebody is waiting on.
      continue;
    }
  }

  return out;
}

interface GmailPart {
  mimeType?: string;
  body?: { data?: string };
  parts?: GmailPart[];
}

interface GmailMessage {
  id?: string;
  threadId?: string;
  internalDate?: string;
  payload?: GmailPart & { headers?: { name: string; value: string }[] };
}

function toIncoming(message: GmailMessage): IncomingMessage | null {
  if (!message.id) return null;

  const headers = new Map(
    (message.payload?.headers ?? []).map((h) => [h.name.toLowerCase(), h.value]),
  );

  return {
    providerMessageId: message.id,
    providerThreadId: message.threadId ?? null,
    messageIdHeader: headers.get("message-id") ?? null,
    inReplyTo: headers.get("in-reply-to") ?? null,
    from: addressOf(headers.get("from")),
    to: addressOf(headers.get("to")),
    subject: headers.get("subject") ?? "",
    text: plainText(message.payload),
    receivedAt: new Date(Number(message.internalDate ?? Date.now())).toISOString(),
  };
}

/**
 * The plain-text body, preferring `text/plain` over HTML.
 *
 * Depth-first through the MIME tree, because a reply from a modern client is
 * `multipart/alternative` inside `multipart/mixed` and the text part is two
 * levels down. Falls back to stripping the HTML: a reply that exists only as
 * HTML is still a reply, and refusing to read it would lose exactly the
 * messages sent from a phone.
 */
function plainText(part: GmailPart | undefined): string {
  if (!part) return "";

  if (part.mimeType === "text/plain" && part.body?.data) {
    return Buffer.from(part.body.data, "base64url").toString("utf8");
  }

  for (const child of part.parts ?? []) {
    const found = plainText(child);
    if (found) return found;
  }

  if (part.mimeType === "text/html" && part.body?.data) {
    return Buffer.from(part.body.data, "base64url")
      .toString("utf8")
      .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  return "";
}

/* ── Plumbing ────────────────────────────────────────────────────────────── */

async function call(url: string, accessToken: string, init: RequestInit = {}) {
  const response = await fetch(url, {
    ...init,
    headers: { ...(init.headers ?? {}), authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(20_000),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Gmail ${response.status} on ${new URL(url).pathname}: ${detail.slice(0, 300)}`);
  }
  return response;
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(
      `${name} is not set, so Gmail cannot be connected on this deployment.`,
    );
  }
  return value;
}
