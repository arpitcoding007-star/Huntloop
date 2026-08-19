/**
 * Outlook and Microsoft 365, through Graph.
 *
 * The same three verbs as `gmail.ts`, and the same reasoning about scopes and
 * dependencies. Two things differ enough to be worth naming:
 *
 * **The tenant in the authority URL.** `/common/` accepts both work accounts
 * and personal Microsoft accounts, which is what a sales team actually has.
 * Pinning a specific tenant id would work for one customer and refuse every
 * other, and the failure reads as "your account does not exist".
 *
 * **Delta instead of history.** Graph's delta link is a whole URL rather than
 * an opaque id, and it embeds the query it was created from — so it is stored
 * as the cursor and re-fetched verbatim. Building a new URL from it would drop
 * the token and silently resync everything.
 */
import {
  addressOf,
  buildMime,
  type IncomingMessage,
  type MailboxProvider,
  type OAuthTokens,
} from "./provider.ts";

const AUTHORITY = "https://login.microsoftonline.com/common/oauth2/v2.0";
const GRAPH = "https://graph.microsoft.com/v1.0";

/**
 * `offline_access` is what produces a refresh token; without it the connection
 * dies in an hour and the user is asked to reconnect forever. `Mail.Send` and
 * `Mail.Read` are the two the product uses — `Mail.ReadWrite` would also cover
 * both and would grant deletion, which this product never does.
 */
const SCOPES = ["offline_access", "User.Read", "Mail.Send", "Mail.Read"];

export const outlook: MailboxProvider = {
  id: "outlook",

  authorizeUrl(state, redirectUri) {
    const url = new URL(`${AUTHORITY}/authorize`);
    url.searchParams.set("client_id", required("MICROSOFT_CLIENT_ID"));
    url.searchParams.set("response_type", "code");
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("response_mode", "query");
    url.searchParams.set("scope", SCOPES.join(" "));
    url.searchParams.set("state", state);
    return url.toString();
  },

  async exchangeCode(code, redirectUri) {
    const tokens = await token(
      new URLSearchParams({
        code,
        client_id: required("MICROSOFT_CLIENT_ID"),
        client_secret: required("MICROSOFT_CLIENT_SECRET"),
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
        scope: SCOPES.join(" "),
      }),
    );
    return { ...tokens, email: await profileEmail(tokens.accessToken) };
  },

  async refresh(refreshToken) {
    const tokens = await token(
      new URLSearchParams({
        refresh_token: refreshToken,
        client_id: required("MICROSOFT_CLIENT_ID"),
        client_secret: required("MICROSOFT_CLIENT_SECRET"),
        grant_type: "refresh_token",
        scope: SCOPES.join(" "),
      }),
    );
    return { ...tokens, email: await profileEmail(tokens.accessToken) };
  },

  /**
   * Send, in two steps rather than one.
   *
   * `/sendMail` is one call and returns 202 with an empty body — no message id,
   * no thread id, nothing to record. `messages_sent_has_provider_id` in `0004`
   * refuses a `sent_at` without a provider id, and that constraint is §78
   * written down: a message cannot claim to have been sent without proof.
   *
   * So: create a draft, which returns the id, then send that draft. One extra
   * round trip buys a message this system can find again when the reply
   * arrives.
   */
  async send(accessToken, message) {
    const from = await profileEmail(accessToken);
    const mime = buildMime(from, message);

    const created = await call(`${GRAPH}/me/messages`, accessToken, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: Buffer.from(mime, "utf8").toString("base64"),
    });

    const draft = (await created.json()) as {
      id?: string;
      conversationId?: string;
      internetMessageId?: string;
    };
    if (!draft.id) throw new Error("Graph created no draft to send.");

    await call(`${GRAPH}/me/messages/${draft.id}/send`, accessToken, { method: "POST" });

    return {
      providerMessageId: draft.id,
      providerThreadId: draft.conversationId ?? null,
      messageIdHeader: draft.internetMessageId ?? null,
    };
  },

  async sync(accessToken, cursor) {
    /* The cursor is a whole URL Graph gave us, re-fetched verbatim. Rebuilding
       it from its parts drops the delta token and resyncs the mailbox from the
       beginning — silently, and looking like a burst of new replies. */
    const url =
      cursor ??
      `${GRAPH}/me/mailFolders/inbox/messages/delta?$select=id,conversationId,internetMessageId,` +
        `subject,from,toRecipients,receivedDateTime,body&$top=50`;

    const response = await call(url, accessToken);
    const json = (await response.json()) as {
      value?: GraphMessage[];
      "@odata.deltaLink"?: string;
      "@odata.nextLink"?: string;
    };

    return {
      messages: (json.value ?? []).map(toIncoming).filter((m): m is IncomingMessage => Boolean(m)),
      // nextLink means "more pages now"; deltaLink means "nothing more until
      // next time". Storing either works: both resume where this left off.
      cursor: json["@odata.nextLink"] ?? json["@odata.deltaLink"] ?? cursor,
    };
  },
};

/* ── OAuth ───────────────────────────────────────────────────────────────── */

async function token(body: URLSearchParams): Promise<Omit<OAuthTokens, "email">> {
  const response = await fetch(`${AUTHORITY}/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `Microsoft refused the token request (${response.status}): ${detail.slice(0, 300)}`,
    );
  }

  const json = (await response.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };
  if (!json.access_token) throw new Error("Microsoft returned no access token.");

  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? null,
    expiresAt: new Date(Date.now() + (json.expires_in ?? 3600) * 1000),
  };
}

async function profileEmail(accessToken: string): Promise<string> {
  const response = await call(`${GRAPH}/me?$select=mail,userPrincipalName`, accessToken);
  const json = (await response.json()) as { mail?: string; userPrincipalName?: string };
  /* `mail` is null for accounts with no Exchange licence, where the UPN is the
     address. Preferring `mail` and falling back is what makes personal
     accounts and work accounts both connect. */
  const email = json.mail ?? json.userPrincipalName;
  if (!email) throw new Error("Microsoft returned no address for this account.");
  return email.toLowerCase();
}

/* ── Reading ─────────────────────────────────────────────────────────────── */

interface GraphMessage {
  id?: string;
  conversationId?: string;
  internetMessageId?: string;
  subject?: string;
  from?: { emailAddress?: { address?: string } };
  toRecipients?: { emailAddress?: { address?: string } }[];
  receivedDateTime?: string;
  body?: { contentType?: string; content?: string };
}

function toIncoming(message: GraphMessage): IncomingMessage | null {
  if (!message.id) return null;

  const body = message.body?.content ?? "";
  const text =
    message.body?.contentType === "html"
      ? body
          .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ")
          .trim()
      : body;

  return {
    providerMessageId: message.id,
    providerThreadId: message.conversationId ?? null,
    messageIdHeader: message.internetMessageId ?? null,
    /* Graph does not return In-Reply-To on the default projection, and asking
       for `internetMessageHeaders` costs a second request per message. The
       conversation id is the primary matching key here and is always present,
       so the fallback is left null rather than paid for. */
    inReplyTo: null,
    from: addressOf(message.from?.emailAddress?.address),
    to: addressOf(message.toRecipients?.[0]?.emailAddress?.address),
    subject: message.subject ?? "",
    text,
    receivedAt: message.receivedDateTime ?? new Date().toISOString(),
  };
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
    throw new Error(`Graph ${response.status}: ${detail.slice(0, 300)}`);
  }
  return response;
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is not set, so Outlook cannot be connected on this deployment.`);
  }
  return value;
}
