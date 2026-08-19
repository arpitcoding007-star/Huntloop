/**
 * Retrieving a page from the open web, on behalf of a customer's org.
 *
 * ── Why this is not just `fetch()` ───────────────────────────────────────
 *
 * The URL being fetched came from a text box. Somebody types it, or a model
 * recommends it, or — worst — it arrives inside a page we already fetched.
 * That makes every request here server-side request forgery with extra steps
 * unless four things are true, and none of them is `fetch`'s default:
 *
 *   1. The scheme is http or https. `file:`, `data:` and `gopher:` are all
 *      things `fetch` will happily do in Node.
 *   2. The host does not resolve into the deployment's own network. A scan of
 *      `http://169.254.169.254/` is a scan of the cloud metadata endpoint, and
 *      a scan of `http://localhost:5432/` is a port probe of our own database.
 *   3. The response is bounded. A source that streams forever is a source that
 *      exhausts the worker's memory, and "the feed was 4 GB" is not a failure
 *      anyone debugs quickly.
 *   4. Redirects are re-checked. A public URL that 302s to 127.0.0.1 defeats
 *      any check performed only on the URL we were given.
 *
 * ── What it deliberately does not do ─────────────────────────────────────
 *
 * Render JavaScript. A headless browser is a different order of dependency and
 * a different order of attack surface, and the sources this product is aimed
 * at — feeds, job boards, filings, release notes — are overwhelmingly served
 * as markup. A page that needs a browser reports as unfetchable, which is a
 * true statement the user can act on by choosing a feed URL instead.
 */
import { isIP } from "node:net";
import { lookup } from "node:dns/promises";

export class FetchRefused extends Error {
  /** True when retrying could plausibly succeed. */
  readonly retryable: boolean;

  constructor(message: string, retryable: boolean) {
    super(message);
    this.name = "FetchRefused";
    this.retryable = retryable;
  }
}

export interface FetchedPage {
  /** After redirects. This is what gets stored and deduplicated on. */
  url: string;
  status: number;
  contentType: string;
  body: string;
  /** True when the body was cut off at the cap rather than ending naturally. */
  truncated: boolean;
}

export interface FetchOptions {
  timeoutMs?: number;
  maxBytes?: number;
  /** Sent as If-None-Match, so an unchanged feed costs a 304 and no body. */
  etag?: string | null;
  accept?: string;
}

const DEFAULT_TIMEOUT_MS = 15_000;
/**
 * 4 MB.
 *
 * Chosen against real feeds rather than as a round number: a busy RSS feed
 * with full-text content runs to a few hundred kB, and a heavy HTML article
 * page with inlined SVG can reach one or two MB. Anything past four is not a
 * document, and truncating it still leaves the head — which is where the
 * title, the metadata and the first entries are.
 */
const DEFAULT_MAX_BYTES = 4 * 1024 * 1024;

/**
 * Identifies the crawler and says where to complain.
 *
 * A crawler that does not identify itself is one a site operator can only
 * block by IP, which is a worse outcome for both parties than being asked to
 * slow down.
 */
const USER_AGENT =
  "HuntloopBot/1.0 (+https://github.com/huntloop; sales-signal monitoring)";

/**
 * Hostnames that never leave this machine, and the address ranges behind them.
 *
 * Checked on the resolved address rather than the name, because `nip.io` and a
 * thousand services like it will resolve any name you like to any address you
 * like. Name-based blocklists do not work; this one is on the answer.
 */
function isPrivateAddress(address: string): boolean {
  if (isIP(address) === 6) {
    const v6 = address.toLowerCase();
    if (v6 === "::1" || v6 === "::") return true;
    // Unique-local (fc00::/7) and link-local (fe80::/10).
    if (v6.startsWith("fc") || v6.startsWith("fd") || v6.startsWith("fe8")) return true;
    if (v6.startsWith("fe9") || v6.startsWith("fea") || v6.startsWith("feb")) return true;
    // IPv4-mapped — ::ffff:127.0.0.1 is still 127.0.0.1.
    const mapped = v6.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped?.[1]) return isPrivateAddress(mapped[1]);
    return false;
  }

  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return true;
  const [a = 0, b = 0] = parts;

  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true; // link-local, incl. cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
  if (a >= 224) return true; // multicast and reserved
  return false;
}

/** Throws unless this URL is one we are willing to send a request to. */
export async function assertFetchable(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new FetchRefused(`${raw} is not a URL.`, false);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new FetchRefused(
      `${url.protocol} is not a scheme this crawler will follow. Only http and https.`,
      false,
    );
  }

  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses: string[] = [];

  if (isIP(host)) {
    addresses.push(host);
  } else {
    try {
      const resolved = await lookup(host, { all: true });
      addresses.push(...resolved.map((r) => r.address));
    } catch {
      throw new FetchRefused(`${host} does not resolve.`, true);
    }
  }

  if (addresses.length === 0) {
    throw new FetchRefused(`${host} resolves to no addresses.`, true);
  }

  /* Every address, not the first. A host with one public and one private A
     record would otherwise pass the check and then be connected to on
     whichever the OS picked. */
  for (const address of addresses) {
    if (isPrivateAddress(address)) {
      throw new FetchRefused(
        `${host} resolves to ${address}, which is inside a private network. ` +
          `This crawler only reads the public web.`,
        false,
      );
    }
  }

  return url;
}

export async function fetchPage(
  raw: string,
  options: FetchOptions = {},
): Promise<FetchedPage> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;

  let url = await assertFetchable(raw);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    /* `redirect: "manual"` so each hop is re-checked. Following automatically
       would let a public URL redirect us onto 127.0.0.1 after the only check
       had already passed. Five hops is more than any legitimate feed needs. */
    let response: Response | null = null;
    for (let hop = 0; hop < 5; hop++) {
      response = await fetch(url, {
        redirect: "manual",
        signal: controller.signal,
        headers: {
          "user-agent": USER_AGENT,
          accept: options.accept ?? "application/rss+xml, application/atom+xml, application/json;q=0.9, text/html;q=0.8, */*;q=0.5",
          ...(options.etag ? { "if-none-match": options.etag } : {}),
        },
      });

      if (response.status < 300 || response.status >= 400) break;

      const location = response.headers.get("location");
      if (!location) break;
      url = await assertFetchable(new URL(location, url).toString());
      response = null;
    }

    if (!response) {
      throw new FetchRefused(`${raw} redirected more than five times.`, false);
    }

    if (response.status === 304) {
      return { url: url.toString(), status: 304, contentType: "", body: "", truncated: false };
    }

    if (response.status >= 400) {
      /* 4xx is usually the source's answer and 5xx is usually its weather.
         The distinction decides whether `record_source_failure` should keep
         retrying, and getting it wrong either abandons a working source after
         one bad afternoon or retries a 404 forever. */
      throw new FetchRefused(
        `${url.host} answered ${response.status}.`,
        response.status >= 500 || response.status === 429 || response.status === 408,
      );
    }

    const contentType = response.headers.get("content-type") ?? "";
    const { text, truncated } = await readCapped(response, maxBytes);

    return { url: url.toString(), status: response.status, contentType, body: text, truncated };
  } catch (error) {
    if (error instanceof FetchRefused) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new FetchRefused(`${raw} did not respond within ${timeoutMs / 1000}s.`, true);
    }
    throw new FetchRefused(
      `${raw} could not be read: ${error instanceof Error ? error.message : String(error)}`,
      true,
    );
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Reads the body, stopping at the cap.
 *
 * Streaming rather than `response.text()`, because `text()` buffers the whole
 * body before anyone can look at its length — so a cap applied afterwards
 * protects nothing. Content-Length is not trusted either: it is optional, and
 * a chunked response does not carry one.
 */
async function readCapped(
  response: Response,
  maxBytes: number,
): Promise<{ text: string; truncated: boolean }> {
  const reader = response.body?.getReader();
  if (!reader) return { text: "", truncated: false };

  const decoder = new TextDecoder("utf-8", { fatal: false });
  const chunks: string[] = [];
  let total = 0;
  let truncated = false;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;

    total += value.byteLength;
    if (total > maxBytes) {
      const keep = value.subarray(0, value.byteLength - (total - maxBytes));
      chunks.push(decoder.decode(keep, { stream: true }));
      truncated = true;
      await reader.cancel();
      break;
    }
    chunks.push(decoder.decode(value, { stream: true }));
  }

  chunks.push(decoder.decode());
  return { text: chunks.join(""), truncated };
}
