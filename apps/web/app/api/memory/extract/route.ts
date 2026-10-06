import { NextResponse, type NextRequest } from "next/server";
import { canWrite, currentViewer } from "../../../../lib/data/membership";
import {
  documentKind,
  extractDocumentText,
  MAX_DOCUMENT_BYTES,
  UnreadableDocument,
} from "../../../../lib/document-text";
import { orgSlugSchema } from "../../../../lib/validation";

/**
 * Text out of an uploaded PDF or Word file, for Memory (§16.3-J).
 *
 * A route rather than a Server Action because a document is binary and can be
 * several megabytes, past a Server Action's body limit. It extracts and
 * returns text and stores nothing: the person reviews it on the Memory screen
 * and saves through `ingestMemoryAction`, exactly as with a pasted file.
 *
 * Members who can write only — the same rule as saving the memory.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function refuse(error: string, status = 400) {
  return NextResponse.json({ error }, { status, headers: { "cache-control": "no-store" } });
}

export async function POST(request: NextRequest) {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_DOCUMENT_BYTES + 64 * 1024) {
    return refuse("That file is over 4 MB. Save a shorter version, or paste the part that matters.", 413);
  }

  const form = await request.formData().catch(() => null);
  if (!form) return refuse("That upload could not be read.");

  const org = orgSlugSchema.safeParse(form.get("org"));
  if (!org.success) return refuse("That workspace isn't valid.");
  const viewer = await currentViewer(org.data);
  if (!viewer) return refuse("Not found.", 404);
  if (!canWrite(viewer)) return refuse("Your role is read-only, so you cannot add to Memory.", 403);

  const file = form.get("file");
  if (!(file instanceof File)) return refuse("Choose a file.");
  if (file.size > MAX_DOCUMENT_BYTES) {
    return refuse("That file is over 4 MB. Save a shorter version, or paste the part that matters.", 413);
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const kind = documentKind(bytes, file.name);
  if (!kind) return refuse("Only PDF and Word (.docx) files are read here. Text and CSV files are read in the browser.");

  try {
    const text = await extractDocumentText(bytes, kind);
    if (!text) {
      return refuse(
        kind === "pdf"
          ? "That PDF has no text layer — it is probably scanned images. Paste the text instead."
          : "That Word file has no text in it.",
      );
    }
    return NextResponse.json(
      { text: text.slice(0, 400_000), filename: file.name.slice(0, 255), kind },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (e) {
    return refuse(e instanceof UnreadableDocument ? e.message : "That file could not be read.");
  }
}
