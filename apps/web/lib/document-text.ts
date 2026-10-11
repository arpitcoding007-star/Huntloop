import { constants as zlibConstants, createInflate, inflateRawSync } from "node:zlib";

/**
 * Plain text out of the documents people actually have — PDF and Word — for
 * Memory ingestion (COMMAND.md §16.3-J). Text only: no images, no layout, no
 * macros, nothing executed. A document that yields no text is reported as
 * such rather than stored empty.
 */

export const MAX_DOCUMENT_BYTES = 4 * 1024 * 1024;

export type DocumentKind = "pdf" | "docx";

export class UnreadableDocument extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnreadableDocument";
  }
}

/** What a file is, by its first bytes and name — never by its declared type. */
export function documentKind(bytes: Uint8Array, filename: string): DocumentKind | null {
  if (bytes.length >= 5 && String.fromCharCode(...bytes.slice(0, 5)) === "%PDF-") return "pdf";
  if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) {
    return /\.docx$/i.test(filename) ? "docx" : null;
  }
  return null;
}

export async function extractDocumentText(bytes: Uint8Array, kind: DocumentKind): Promise<string> {
  const text = kind === "pdf" ? await pdfText(bytes) : docxText(bytes);
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/* ── PDF ────────────────────────────────────────────────────────────────── */

/**
 * What all of a PDF's compressed streams may decode to, together.
 *
 * The 4 MB upload limit bounds the file, not what is inside it: a stream
 * compressed twice (`/Filter [/FlateDecode /FlateDecode]`) turns a few
 * megabytes into gigabytes, and the PDF reader holds a stream's whole decoded
 * output in memory (security audit lead 13). The DOCX path has had the
 * equivalent bound (`MAX_XML_BYTES`) from the start.
 */
export const MAX_PDF_DECODED_BYTES = 64 * 1024 * 1024;
/** Far more pages than anything anybody adds to Memory. */
const MAX_PDF_PAGES = 500;
/** The route keeps 400,000 characters; reading past that is wasted work. */
const MAX_PDF_TEXT = 400_000;
/** Reading stops here even when the limits above have not been reached. */
const PDF_DEADLINE_MS = 20_000;

const PDF_TOO_LARGE = "That PDF expands to more than this reader will open. Paste the part that matters instead.";

async function pdfText(bytes: Uint8Array): Promise<string> {
  await assertPdfWithinLimits(bytes);

  // Loaded on demand: only this path pays for the PDF reader.
  const { getDocumentProxy } = await import("unpdf");
  let pdf: Awaited<ReturnType<typeof getDocumentProxy>> | null = null;
  try {
    pdf = await getDocumentProxy(bytes);
  } catch {
    throw new UnreadableDocument("That PDF could not be read. It may be damaged.");
  }

  try {
    if (pdf.numPages > MAX_PDF_PAGES) {
      throw new UnreadableDocument(
        `That PDF has ${pdf.numPages} pages. Memory reads up to ${MAX_PDF_PAGES} — save the part that matters as its own file.`,
      );
    }
    /* One page at a time, rather than every page at once, so a long document
       stops being read once there is enough text or the time is up. */
    const deadline = Date.now() + PDF_DEADLINE_MS;
    const pages: string[] = [];
    let length = 0;
    for (let n = 1; n <= pdf.numPages && length < MAX_PDF_TEXT; n++) {
      if (Date.now() > deadline) {
        throw new UnreadableDocument("That PDF took too long to read. Paste the part that matters instead.");
      }
      const content = await (await pdf.getPage(n)).getTextContent();
      const text = content.items
        .map((item) => ("str" in item ? item.str + (item.hasEOL ? "\n" : "") : ""))
        .join("");
      pages.push(text);
      length += text.length;
    }
    // The same joining `unpdf`'s `extractText(…, { mergePages: true })` does.
    return pages
      .join("\n")
      .replace(/[^\S\n]+/g, " ")
      .replace(/ ?\n ?/g, "\n")
      .replace(/\n{3,}/g, "\n\n");
  } catch (e) {
    if (e instanceof UnreadableDocument) throw e;
    throw new UnreadableDocument("That PDF could not be read. It may be damaged.");
  } finally {
    // What `unpdf` itself does once it is finished with a document it opened.
    await pdf.loadingTask.destroy().catch(() => undefined);
  }
}

/**
 * Refuses a PDF whose streams decode past `MAX_PDF_DECODED_BYTES`, before the
 * PDF reader sees it.
 *
 * Every `stream … endstream` in the file is decoded through its filter chain
 * here, counting as it goes and stopping at the budget, so nothing larger than
 * the budget is ever held. A stream whose data is damaged partway counts what
 * decoded before the damage, which is what the PDF reader would also keep.
 *
 * Refused outright, because they cannot be measured here: an encrypted
 * document (its streams are ciphertext until the reader decrypts them), a
 * filter given by reference instead of by name, and LZW, an old compression
 * that can expand as much as Flate.
 */
export async function assertPdfWithinLimits(bytes: Uint8Array, budget = MAX_PDF_DECODED_BYTES): Promise<void> {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = buf.toString("latin1");

  if (/\/Encrypt\s*(?:<<|\d+\s+\d+\s+R)/.test(text)) {
    throw new UnreadableDocument("That PDF is password-protected. Save a copy without protection, or paste the text instead.");
  }

  let remaining = budget;
  const keyword = /stream\r?\n/g;
  for (let m = keyword.exec(text); m; m = keyword.exec(text)) {
    if (text.startsWith("end", m.index - 3)) continue;
    const start = m.index + m[0].length;
    const end = text.indexOf("endstream", start);
    if (end < 0) break;
    keyword.lastIndex = end + "endstream".length;

    // The stream's dictionary: from its `N 0 obj` to the keyword.
    const header = text.slice(Math.max(text.lastIndexOf("obj", m.index), m.index - 65_536), m.index);
    const filters = pdfFilters(header);
    /* An encoded stream is given the rest of the file, not the span up to the
       next `endstream`: every filter that expands stops at its own end marker,
       and those bytes could otherwise include a decoy `endstream` that made
       the bomb behind it look short. */
    let data: Buffer = filters.length ? buf.subarray(start) : buf.subarray(start, end);
    for (const filter of filters) {
      data = await decodeStage(filter, data, remaining);
    }
    remaining -= data.length;
    if (remaining < 0) throw new UnreadableDocument(PDF_TOO_LARGE);
  }
}

/** A stream dictionary's `/Filter`, as names in order, with `#xx` escapes decoded. */
function pdfFilters(header: string): string[] {
  const at = header.lastIndexOf("/Filter");
  if (at < 0) return [];
  const value = /^\/Filter\s*(\[[^\]]*\]|\/[^\s/<>[\]()]+)/.exec(header.slice(at));
  if (!value) throw new UnreadableDocument("That PDF could not be read safely. Paste the text instead.");
  return [...value[1]!.matchAll(/\/([^\s/<>[\]()]+)/g)].map((n) =>
    n[1]!.replace(/#([0-9a-fA-F]{2})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16))),
  );
}

/** One filter of a chain, decoded with its output held to `limit` bytes. */
async function decodeStage(filter: string, input: Buffer, limit: number): Promise<Buffer> {
  switch (filter) {
    case "FlateDecode":
    case "Fl":
      return inflateBounded(input, limit);
    case "ASCIIHexDecode":
    case "AHx":
      return asciiHex(input);
    case "ASCII85Decode":
    case "A85":
      return ascii85(input);
    case "RunLengthDecode":
    case "RL":
      return runLength(input, limit);
    case "LZWDecode":
    case "LZW":
      throw new UnreadableDocument("That PDF uses an old compression this reader does not open. Paste the text instead.");
    default: {
      // Image codecs (DCT, JPX, CCITT, JBIG2) and anything unknown: text
      // extraction never decodes them, so their size is what is in the file,
      // up to the stream's end.
      const end = input.indexOf("endstream", 0, "latin1");
      return end < 0 ? input : input.subarray(0, end);
    }
  }
}

/**
 * Inflate, counting, and stopping past `limit`. Truncated or damaged data
 * yields whatever decoded before the damage, as the PDF reader's own inflater
 * would, rather than nothing.
 */
function inflateBounded(input: Buffer, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    const inflate = createInflate({ finishFlush: zlibConstants.Z_SYNC_FLUSH });
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
    };
    inflate.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        inflate.destroy();
        settle(() => reject(new UnreadableDocument(PDF_TOO_LARGE)));
        return;
      }
      chunks.push(chunk);
    });
    inflate.on("error", () => settle(() => resolve(Buffer.concat(chunks))));
    inflate.on("end", () => settle(() => resolve(Buffer.concat(chunks))));
    inflate.end(input);
  });
}

/** Up to the filter's own end marker; these two only ever shrink their input. */
function upTo(input: Buffer, marker: string): string {
  const end = input.indexOf(marker, 0, "latin1");
  return input.toString("latin1", 0, end < 0 ? input.length : end);
}

function asciiHex(input: Buffer): Buffer {
  const hex = upTo(input, ">").replace(/[^0-9a-fA-F]/g, "");
  return Buffer.from(hex.length % 2 ? `${hex}0` : hex, "hex");
}

function ascii85(input: Buffer): Buffer {
  const src = upTo(input, "~>").replace(/\s/g, "");
  const out: number[] = [];
  let group: number[] = [];
  const flush = (count: number) => {
    let value = 0;
    for (let i = 0; i < 5; i++) value = value * 85 + (group[i] ?? 84);
    for (let i = 0; i < count - 1; i++) out.push((value >>> (24 - 8 * i)) & 0xff);
    group = [];
  };
  for (const ch of src) {
    if (ch === "z" && group.length === 0) {
      out.push(0, 0, 0, 0);
      continue;
    }
    const code = ch.charCodeAt(0) - 33;
    if (code < 0 || code > 84) continue;
    group.push(code);
    if (group.length === 5) flush(5);
  }
  if (group.length > 1) flush(group.length);
  return Buffer.from(out);
}

function runLength(input: Buffer, limit: number): Buffer {
  const out: number[] = [];
  for (let i = 0; i < input.length; ) {
    const n = input[i]!;
    if (n === 128) break;
    if (n < 128) {
      for (let k = 0; k <= n && i + 1 + k < input.length; k++) out.push(input[i + 1 + k]!);
      i += n + 2;
    } else {
      const byte = input[i + 1] ?? 0;
      for (let k = 0; k < 257 - n; k++) out.push(byte);
      i += 2;
    }
    if (out.length > limit) throw new UnreadableDocument(PDF_TOO_LARGE);
  }
  return Buffer.from(out);
}

/* ── DOCX: a zip with the body in word/document.xml ─────────────────────── */

const MAX_XML_BYTES = 20 * 1024 * 1024;

/** The body text of a .docx, paragraphs on their own lines. */
export function docxText(bytes: Uint8Array): string {
  const xml = zipEntry(Buffer.from(bytes), "word/document.xml");
  if (!xml) throw new UnreadableDocument("That Word file has no document body.");
  return decodeEntities(
    xml
      .toString("utf8")
      .replace(/<w:tab\/>/g, "\t")
      .replace(/<w:br\/>/g, "\n")
      .replace(/<\/w:p>/g, "\n")
      .replace(/<[^>]+>/g, ""),
  );
}

/**
 * One file out of a zip archive, by name. Reads the central directory (the
 * authoritative index), then the entry's local header, then inflates it.
 * Bounded: an entry claiming more than `MAX_XML_BYTES` is refused, which is
 * what stops a zip bomb.
 */
export function zipEntry(zip: Buffer, name: string): Buffer | null {
  // End of central directory: signature 0x06054b50, within the last 64 KiB.
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65_557); i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new UnreadableDocument("That file is not a readable Word document.");

  const entries = zip.readUInt16LE(eocd + 10);
  let p = zip.readUInt32LE(eocd + 16);
  for (let n = 0; n < entries && p + 46 <= zip.length; n++) {
    if (zip.readUInt32LE(p) !== 0x02014b50) break;
    const method = zip.readUInt16LE(p + 10);
    const compressed = zip.readUInt32LE(p + 20);
    const size = zip.readUInt32LE(p + 24);
    const nameLength = zip.readUInt16LE(p + 28);
    const extraLength = zip.readUInt16LE(p + 30);
    const commentLength = zip.readUInt16LE(p + 32);
    const localOffset = zip.readUInt32LE(p + 42);
    const entryName = zip.toString("utf8", p + 46, p + 46 + nameLength);

    if (entryName === name) {
      if (size > MAX_XML_BYTES) throw new UnreadableDocument("That Word file is too large to read.");
      if (zip.readUInt32LE(localOffset) !== 0x04034b50) throw new UnreadableDocument("That Word file is damaged.");
      const start =
        localOffset + 30 + zip.readUInt16LE(localOffset + 26) + zip.readUInt16LE(localOffset + 28);
      const data = zip.subarray(start, start + compressed);
      if (method === 0) return Buffer.from(data);
      if (method === 8) {
        try {
          return inflateRawSync(data, { maxOutputLength: MAX_XML_BYTES });
        } catch {
          throw new UnreadableDocument("That Word file could not be decompressed.");
        }
      }
      throw new UnreadableDocument("That Word file uses a compression this reader does not support.");
    }
    p += 46 + nameLength + extraLength + commentLength;
  }
  return null;
}

function decodeEntities(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, "&");
}
