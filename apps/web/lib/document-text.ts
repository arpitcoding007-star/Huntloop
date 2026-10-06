import { inflateRawSync } from "node:zlib";

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

async function pdfText(bytes: Uint8Array): Promise<string> {
  try {
    // Loaded on demand: only this path pays for the PDF reader.
    const { extractText, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(bytes);
    const { text } = await extractText(pdf, { mergePages: true });
    return Array.isArray(text) ? text.join("\n\n") : String(text ?? "");
  } catch {
    throw new UnreadableDocument("That PDF could not be read. It may be encrypted or damaged.");
  }
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
