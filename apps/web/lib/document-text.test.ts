import { deflateRawSync, deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  assertPdfWithinLimits,
  documentKind,
  docxText,
  extractDocumentText,
  UnreadableDocument,
} from "./document-text";

/** A minimal one-entry zip, deflated, as a .docx carries its body. */
function zipWith(name: string, content: string): Uint8Array {
  const data = deflateRawSync(Buffer.from(content, "utf8"));
  const nameBuf = Buffer.from(name, "utf8");
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(Buffer.byteLength(content), 22);
  local.writeUInt16LE(nameBuf.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(Buffer.byteLength(content), 24);
  central.writeUInt16LE(nameBuf.length, 28);
  central.writeUInt32LE(0, 42);
  const centralOffset = local.length + nameBuf.length + data.length;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(central.length + nameBuf.length, 12);
  eocd.writeUInt32LE(centralOffset, 16);
  return new Uint8Array(Buffer.concat([local, nameBuf, data, central, nameBuf, eocd]));
}

const DOC =
  '<w:document><w:body><w:p><w:r><w:t>Never open with a compliment.</w:t></w:r></w:p>' +
  "<w:p><w:r><w:t>Price &amp; packaging</w:t><w:tab/><w:t>is fixed.</w:t></w:r></w:p></w:body></w:document>";

describe("documentKind", () => {
  it("knows a PDF by its header, whatever its name", () => {
    expect(documentKind(new TextEncoder().encode("%PDF-1.7\n"), "notes.txt")).toBe("pdf");
  });
  it("knows a .docx by being a zip with that name", () => {
    expect(documentKind(zipWith("word/document.xml", DOC), "playbook.docx")).toBe("docx");
    expect(documentKind(zipWith("word/document.xml", DOC), "archive.zip")).toBeNull();
  });
});

describe("docx", () => {
  it("reads paragraphs, tabs and entities", async () => {
    const text = await extractDocumentText(zipWith("word/document.xml", DOC), "docx");
    expect(text).toBe("Never open with a compliment.\nPrice & packaging\tis fixed.");
  });
  it("refuses a zip with no document body", () => {
    expect(() => docxText(zipWith("other.xml", "<x/>"))).toThrow(UnreadableDocument);
  });
});

/** The smallest well-formed PDF with one line of text, xref offsets computed. */
function minimalPdf(line: string, encode?: { filter: string; data: Buffer }): Uint8Array {
  const plain = `BT /F1 12 Tf 72 720 Td (${line}) Tj ET`;
  /* Built in latin1 so a compressed stream's bytes survive the round trip. */
  const stream = encode ? encode.data.toString("latin1") : plain;
  const dict = encode ? `/Length ${encode.data.length} /Filter ${encode.filter}` : `/Length ${plain.length}`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< ${dict} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) pdf += `${String(o).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new Uint8Array(Buffer.from(pdf, "latin1"));
}

describe("pdf", () => {
  it("reads the text of a PDF", async () => {
    const text = await extractDocumentText(minimalPdf("Lead with the observation."), "pdf");
    expect(text).toContain("Lead with the observation.");
  });
  it("reads a compressed content stream", async () => {
    const content = Buffer.from("BT /F1 12 Tf 72 720 Td (Compressed and fine.) Tj ET");
    const text = await extractDocumentText(
      minimalPdf("", { filter: "/FlateDecode", data: deflateSync(content) }),
      "pdf",
    );
    expect(text).toContain("Compressed and fine.");
  });
  it("says so when a PDF cannot be read", async () => {
    await expect(extractDocumentText(new TextEncoder().encode("%PDF-1.4 garbage"), "pdf")).rejects.toThrow(
      UnreadableDocument,
    );
  });
});

/* Security audit lead 13: the upload limit bounds the file, not what its
   streams decode to. Budgets are shrunk here so the tests stay fast. */
describe("pdf decompression limits", () => {
  const bomb = (bytes: number) => deflateSync(deflateSync(Buffer.alloc(bytes, 0x41)));

  it("refuses a stream compressed twice past the budget, before the reader runs", async () => {
    const pdf = minimalPdf("", { filter: "[/FlateDecode /FlateDecode]", data: bomb(8 * 1024 * 1024) });
    expect(pdf.length).toBeLessThan(64 * 1024);
    await expect(assertPdfWithinLimits(pdf, 1024 * 1024)).rejects.toThrow(/expands to more/);
  });
  it("sees through filter names written with escapes", async () => {
    const pdf = minimalPdf("", { filter: "[/Fl#61teDecode /FlateDecode]", data: bomb(8 * 1024 * 1024) });
    await expect(assertPdfWithinLimits(pdf, 1024 * 1024)).rejects.toThrow(/expands to more/);
  });
  it("decodes a hex-wrapped bomb rather than counting its hex", async () => {
    const hex = Buffer.from(bomb(8 * 1024 * 1024).toString("hex") + ">", "latin1");
    const pdf = minimalPdf("", { filter: "[/ASCIIHexDecode /FlateDecode /FlateDecode]", data: hex });
    await expect(assertPdfWithinLimits(pdf, 1024 * 1024)).rejects.toThrow(/expands to more/);
  });
  it("lets an ordinary document through", async () => {
    const content = deflateSync(Buffer.from("BT /F1 12 Tf 72 720 Td (Fine.) Tj ET"));
    await expect(assertPdfWithinLimits(minimalPdf("", { filter: "/FlateDecode", data: content }))).resolves.toBeUndefined();
  });
  it("refuses what it cannot measure", async () => {
    const encrypted = Buffer.from(minimalPdf("x")).toString("latin1").replace("/Root 1 0 R", "/Root 1 0 R /Encrypt 9 0 R");
    await expect(assertPdfWithinLimits(new Uint8Array(Buffer.from(encrypted, "latin1")))).rejects.toThrow(/password-protected/);
    await expect(
      assertPdfWithinLimits(minimalPdf("", { filter: "/LZWDecode", data: Buffer.from("x") })),
    ).rejects.toThrow(/old compression/);
    await expect(
      assertPdfWithinLimits(minimalPdf("", { filter: "9 0 R", data: Buffer.from("x") })),
    ).rejects.toThrow(UnreadableDocument);
  });
});
