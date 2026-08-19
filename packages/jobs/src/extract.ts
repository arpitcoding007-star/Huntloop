/**
 * Turning a fetched page into documents.
 *
 * A source is a URL. What comes back is one of four shapes, and which one it
 * is decides how many documents the fetch produced:
 *
 *   RSS / Atom   many documents, one per item. The common case, and the one
 *                worth optimising for: a feed is a source that has already
 *                done the work of saying what is new.
 *   JSON Feed    same, in JSON.
 *   HTML         one document — the page itself — plus any feed it advertises,
 *                which the scanner will prefer next time.
 *   anything else  refused, with the content type in the message.
 *
 * ── Why the XML is parsed by hand ────────────────────────────────────────
 *
 * Because the alternative is a dependency, and the thing being parsed is
 * hostile input from an arbitrary host. A general XML parser is a large attack
 * surface — entity expansion, external entity resolution, recursive
 * definitions — and none of it is needed to read a list of items with a title,
 * a link and a date.
 *
 * This reads elements and text and nothing else. It has no notion of an
 * entity declaration, so it cannot be made to expand one; no notion of a
 * DOCTYPE, so it cannot be pointed at a file; and no recursion, so it cannot
 * be made to blow the stack. It is not a conforming XML parser and does not
 * try to be. It is a feed reader.
 */
import { createHash } from "node:crypto";

export interface ExtractedDocument {
  url: string;
  canonicalUrl: string | null;
  title: string | null;
  publishedAt: string | null;
  /** Plain text. Markup is removed rather than sanitised — nothing renders it. */
  text: string;
  contentHash: string;
}

export interface Extraction {
  documents: ExtractedDocument[];
  /**
   * Feed URLs the page advertised.
   *
   * Surfaced rather than followed. A scan that silently switched to a feed it
   * discovered would change what the source *is* without the user's source
   * list reflecting it; the scanner records the suggestion instead.
   */
  discoveredFeeds: string[];
  format: "rss" | "atom" | "jsonfeed" | "html" | "unknown";
}

export class UnreadableContent extends Error {
  constructor(contentType: string) {
    super(
      `This source returned ${contentType || "content with no type"}, which is ` +
        `neither a feed nor a web page. If it is a site, point the source at ` +
        `its RSS or Atom feed instead.`,
    );
    this.name = "UnreadableContent";
  }
}

export function extract(page: {
  url: string;
  contentType: string;
  body: string;
}): Extraction {
  const type = page.contentType.toLowerCase();
  const head = page.body.slice(0, 2000).toLowerCase();

  /* Content type first, sniffing second. Plenty of feeds are served as
     text/plain or application/octet-stream by misconfigured hosts, and
     refusing those would reject working sources on a header nobody controls. */
  if (type.includes("json") || head.trimStart().startsWith("{")) {
    const jsonFeed = extractJsonFeed(page.url, page.body);
    if (jsonFeed) return jsonFeed;
  }

  if (
    type.includes("xml") ||
    head.includes("<rss") ||
    head.includes("<feed") ||
    head.includes("<rdf:rdf")
  ) {
    return extractFeed(page.url, page.body);
  }

  if (type.includes("html") || head.includes("<html") || head.includes("<!doctype html")) {
    return extractHtml(page.url, page.body);
  }

  throw new UnreadableContent(page.contentType);
}

/* ── Feeds ───────────────────────────────────────────────────────────────── */

function extractFeed(baseUrl: string, xml: string): Extraction {
  const isAtom = /<feed[\s>]/i.test(xml.slice(0, 4000));
  const itemTag = isAtom ? "entry" : "item";
  const documents: ExtractedDocument[] = [];

  for (const block of elements(xml, itemTag)) {
    const title = decodeEntities(stripTags(firstText(block, "title") ?? "")).trim();

    /* Atom puts the address in an attribute, RSS in the element's text, and
       plenty of RSS feeds also carry an atom:link. Both are tried, and the
       guid is the last resort — some feeds put the permalink only there. */
    const rawLink =
      (isAtom ? attributeOf(block, "link", "href") : null) ??
      firstText(block, "link") ??
      attributeOf(block, "link", "href") ??
      firstText(block, "guid");

    const url = absolute(rawLink, baseUrl);
    if (!url) continue;

    const published =
      firstText(block, "published") ??
      firstText(block, "updated") ??
      firstText(block, "pubDate") ??
      firstText(block, "dc:date");

    const body =
      firstText(block, "content:encoded") ??
      firstText(block, "content") ??
      firstText(block, "summary") ??
      firstText(block, "description") ??
      "";

    const text = decodeEntities(stripTags(body)).trim();

    documents.push({
      url,
      canonicalUrl: url,
      title: title || null,
      publishedAt: parseDate(published),
      text,
      /* The hash covers what the item *says*, not where it was found. §60 asks
         that the same article reached through two sources be one document, and
         two feeds carrying the same syndicated item differ in their link
         wrapper far more often than in their content. */
      contentHash: hash(`${title}\n${text}`),
    });
  }

  return { documents, discoveredFeeds: [], format: isAtom ? "atom" : "rss" };
}

function extractJsonFeed(baseUrl: string, body: string): Extraction | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;

  const items = (parsed as { items?: unknown }).items;
  if (!Array.isArray(items)) return null;

  const documents: ExtractedDocument[] = [];
  for (const raw of items) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    const url = absolute(str(item.url) ?? str(item.external_url) ?? str(item.id), baseUrl);
    if (!url) continue;

    const title = str(item.title)?.trim() ?? null;
    const text = decodeEntities(
      stripTags(str(item.content_text) ?? str(item.content_html) ?? str(item.summary) ?? ""),
    ).trim();

    documents.push({
      url,
      canonicalUrl: url,
      title,
      publishedAt: parseDate(str(item.date_published) ?? str(item.date_modified)),
      text,
      contentHash: hash(`${title ?? ""}\n${text}`),
    });
  }

  return { documents, discoveredFeeds: [], format: "jsonfeed" };
}

/* ── HTML ────────────────────────────────────────────────────────────────── */

function extractHtml(baseUrl: string, html: string): Extraction {
  const title =
    decodeEntities(stripTags(firstText(html, "title") ?? "")).trim() ||
    metaContent(html, "og:title") ||
    null;

  const canonical =
    absolute(linkHref(html, "canonical"), baseUrl) ??
    absolute(metaContent(html, "og:url"), baseUrl);

  const published =
    metaContent(html, "article:published_time") ??
    metaContent(html, "datePublished") ??
    attributeOf(html, "time", "datetime");

  const text = readableText(html);

  const discoveredFeeds = [
    ...new Set(
      [
        ...findLinks(html, "application/rss+xml"),
        ...findLinks(html, "application/atom+xml"),
        ...findLinks(html, "application/feed+json"),
      ]
        .map((href) => absolute(href, baseUrl))
        .filter((v): v is string => Boolean(v)),
    ),
  ];

  return {
    documents: [
      {
        url: baseUrl,
        canonicalUrl: canonical ?? baseUrl,
        title,
        publishedAt: parseDate(published),
        text,
        contentHash: hash(`${title ?? ""}\n${text}`),
      },
    ],
    discoveredFeeds,
    format: "html",
  };
}

/**
 * The prose on a page, with the furniture removed.
 *
 * Not a readability implementation — those score candidate containers and are
 * a project of their own. This drops the four element types that are reliably
 * not prose (script, style, nav, footer) and flattens the rest. On an article
 * page that is close to the real thing; on a homepage it produces a soup of
 * link text, which is the correct outcome, because a homepage is not a
 * document and the scanner should be pointed at the feed instead.
 */
function readableText(html: string): string {
  return decodeEntities(
    html
      // `head` first: the title is extracted separately, and leaving it here
      // would put it at the top of the body text of every page — where the
      // signal extractor would then be able to quote it back as an excerpt.
      .replace(/<head\b[\s\S]*?<\/head>/i, " ")
      .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<nav\b[\s\S]*?<\/nav>/gi, " ")
      .replace(/<footer\b[\s\S]*?<\/footer>/gi, " ")
      .replace(/<svg\b[\s\S]*?<\/svg>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      // Block boundaries become newlines so paragraphs do not run together.
      .replace(/<\/(p|div|section|article|li|h[1-6]|tr|br)\s*>/gi, "\n")
      .replace(/<br\s*\/?>/gi, "\n"),
  )
    .replace(/<[^>]*>/g, " ")
    .replace(/[ \t\u00a0]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

/* ── The minimal reader ──────────────────────────────────────────────────── */

/** Every `<tag>…</tag>` block, non-nested, in document order. */
function* elements(xml: string, tag: string): Generator<string> {
  const open = new RegExp(`<${tag}(?:\\s[^>]*)?>`, "gi");
  const close = `</${tag}`;
  let match: RegExpExecArray | null;

  while ((match = open.exec(xml)) !== null) {
    const start = match.index + match[0].length;
    const end = xml.toLowerCase().indexOf(close, start);
    if (end === -1) return;
    yield xml.slice(start, end);
    open.lastIndex = end;
  }
}

function firstText(xml: string, tag: string): string | null {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)</${escaped}\\s*>`, "i").exec(
    xml,
  );
  if (!match?.[1]) return null;
  return unwrapCdata(match[1]);
}

function attributeOf(xml: string, tag: string, attribute: string): string | null {
  const match = new RegExp(`<${tag}\\b[^>]*\\b${attribute}\\s*=\\s*["']([^"']+)["']`, "i").exec(
    xml,
  );
  return match?.[1] ?? null;
}

function metaContent(html: string, name: string): string | null {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match =
    new RegExp(
      `<meta\\b[^>]*(?:property|name|itemprop)\\s*=\\s*["']${escaped}["'][^>]*content\\s*=\\s*["']([^"']*)["']`,
      "i",
    ).exec(html) ??
    new RegExp(
      `<meta\\b[^>]*content\\s*=\\s*["']([^"']*)["'][^>]*(?:property|name|itemprop)\\s*=\\s*["']${escaped}["']`,
      "i",
    ).exec(html);
  const value = match?.[1]?.trim();
  return value ? decodeEntities(value) : null;
}

function linkHref(html: string, rel: string): string | null {
  const match = new RegExp(
    `<link\\b[^>]*rel\\s*=\\s*["'][^"']*\\b${rel}\\b[^"']*["'][^>]*href\\s*=\\s*["']([^"']+)["']`,
    "i",
  ).exec(html);
  return match?.[1] ?? null;
}

function findLinks(html: string, type: string): string[] {
  const out: string[] = [];
  const escaped = type.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`<link\\b[^>]*type\\s*=\\s*["']${escaped}["'][^>]*>`, "gi");
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) {
    const href = /href\s*=\s*["']([^"']+)["']/i.exec(match[0])?.[1];
    if (href) out.push(href);
  }
  return out;
}

function unwrapCdata(value: string): string {
  const cdata = /<!\[CDATA\[([\s\S]*?)\]\]>/.exec(value);
  return cdata?.[1] ?? value;
}

function stripTags(value: string): string {
  return unwrapCdata(value).replace(/<[^>]*>/g, " ");
}

/**
 * The five XML entities, plus numeric references and the handful of named
 * HTML ones that appear in real feed titles.
 *
 * Not the full HTML entity table — that is 2,231 names, and the ones missing
 * here degrade to leaving the source text visible, which is legible. `&amp;`
 * is unescaped last so that `&amp;lt;` survives as `&lt;` rather than
 * collapsing to `<`.
 */
const NAMED: Record<string, string> = {
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  mdash: "—",
  ndash: "–",
  hellip: "…",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
};

function decodeEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => safeCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => safeCodePoint(parseInt(dec, 10)))
    .replace(/&([a-z]+);/gi, (whole, name) => NAMED[String(name).toLowerCase()] ?? whole)
    .replace(/&amp;/g, "&");
}

function safeCodePoint(code: number): string {
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return "";
  try {
    return String.fromCodePoint(code);
  } catch {
    return "";
  }
}

function absolute(href: string | null | undefined, base: string): string | null {
  const value = href?.trim();
  if (!value) return null;
  try {
    const url = new URL(value, base);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

/**
 * A date, or null.
 *
 * Null is a real answer and is stored as one: `source_documents.published_at`
 * is nullable, and a feed with no date on its items is common. Substituting
 * the fetch time would make every item look brand new, which is exactly the
 * claim §81 says must not be made from an absence.
 */
function parseDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const parsed = new Date(value.trim());
  if (Number.isNaN(parsed.getTime())) return null;
  // A date far in the future is a parse artefact, not news.
  if (parsed.getTime() > Date.now() + 7 * 24 * 3600_000) return null;
  return parsed.toISOString();
}

function str(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

export function hash(value: string): string {
  return createHash("sha256").update(value.trim()).digest("hex").slice(0, 40);
}

/** The dedup key for a page's address. Matches `0008`'s `url_hash`. */
export function urlHash(url: string): string {
  return createHash("md5").update(canonicalize(url)).digest("hex");
}

/**
 * The address, with the parts that do not identify the page removed.
 *
 * Tracking parameters are the whole reason this exists: the same article
 * arriving from a newsletter and from a feed differs only in `utm_source`, and
 * without this each one is a separate document, a separate model call, and a
 * separate line in the evidence list.
 */
export function canonicalize(raw: string): string {
  try {
    const url = new URL(raw);
    url.hash = "";
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|ref$|ref_|source$|fbclid$|gclid$|mc_cid$|mc_eid$)/i.test(key)) {
        url.searchParams.delete(key);
      }
    }
    // A trailing slash on a path is the same page as without one.
    if (url.pathname.length > 1 && url.pathname.endsWith("/")) {
      url.pathname = url.pathname.slice(0, -1);
    }
    return url.toString();
  } catch {
    return raw;
  }
}
