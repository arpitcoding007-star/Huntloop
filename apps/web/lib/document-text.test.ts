import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { documentKind, docxText, extractDocumentText, UnreadableDocument } from "./document-text";

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
function minimalPdf(line: string): Uint8Array {
  const stream = `BT /F1 12 Tf 72 720 Td (${line}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
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
  return new TextEncoder().encode(pdf);
}

describe("pdf", () => {
  it("reads the text of a PDF", async () => {
    const text = await extractDocumentText(minimalPdf("Lead with the observation."), "pdf");
    expect(text).toContain("Lead with the observation.");
  });
  it("says so when a PDF cannot be read", async () => {
    await expect(extractDocumentText(new TextEncoder().encode("%PDF-1.4 garbage"), "pdf")).rejects.toThrow(
      UnreadableDocument,
    );
  });
});
