"use server";

import { revalidatePath } from "next/cache";
import { FetchRefused, UnreadableContent, extract, fetchPage } from "@huntloop/jobs";
import { fail, mutate, ok, type ActionResult } from "../../../../lib/data/org";
import {
  memoryIngestSchema,
  memorySchema,
  parseForm,
  uuidSchema,
} from "../../../../lib/validation";

/**
 * Memory writes — master context §37, §54, and `0004`.
 *
 * ── The one rule this file has to get right ──────────────────────────────
 *
 * `memories_scope_id_presence`: organization scope takes no subject, and every
 * other scope requires one. It is a check constraint, so a wrong pairing is
 * refused by the database — but it would be refused as a constraint-violation
 * string, and the user would read a Postgres error where an explanation
 * belongs. So the pairing is checked here and reported in the terms the screen
 * uses, and the constraint stays as the thing that makes it true.
 *
 * The reason it matters is not tidiness. A user-scoped memory with a NULL
 * `scope_id` matches *every* user's retrieval filter — one person's private
 * note becomes everybody's context. That is the §37 leak the column exists to
 * prevent.
 *
 * ── Why `source` is always 'user' here ───────────────────────────────────
 *
 * The other value is `derived`, which means the product concluded it. A person
 * typing into a form has not derived anything, and letting this action write
 * `derived` would put hand-written notes into the same bucket the learning
 * loop treats as its own output. §7, applied to our own memory.
 */

export interface MemoryInput {
  id?: string;
  scope: "organization" | "team" | "user" | "account" | "opportunity";
  scopeId: string | null;
  key: string;
  content: string;
}

export async function saveMemoryAction(
  org: string,
  input: MemoryInput,
): Promise<ActionResult<{ id: string }>> {
  const parsed = parseForm(memorySchema, input);
  if (!parsed.ok) return fail(parsed.error, parsed.fieldErrors);
  const value = parsed.value;

  const isOrgScope = value.scope === "organization";
  const scopeId = value.scopeId?.trim() ? value.scopeId.trim() : null;

  if (isOrgScope && scopeId) {
    return fail("An organisation-wide memory has no subject.", {
      scopeId:
        "Leave this empty — organisation scope means the org itself, so there is nothing to point at.",
    });
  }
  if (!isOrgScope && !scopeId) {
    return fail(`A ${value.scope}-scoped memory needs a subject.`, {
      scopeId: `Which ${value.scope} is this about? Without it, this memory would be retrieved for every one of them.`,
    });
  }
  if (scopeId && !uuidSchema.safeParse(scopeId).success) {
    return fail("That subject reference isn't valid.", {
      scopeId: "This has to be the id of the thing the memory is about.",
    });
  }

  return mutate(org, "saveMemory", async ({ db, orgId }) => {
    const row = {
      org_id: orgId,
      scope: value.scope,
      scope_id: scopeId,
      key: value.key || null,
      content: value.content,
      source: "user" as const,
    };

    if (value.id) {
      const { error } = await db
        .from("memories")
        .update(row)
        .eq("id", value.id)
        .eq("org_id", orgId)
        .is("deleted_at", null);
      if (error) return fail(scopeError(error, "saved"));

      revalidatePath(`/${org}/memory`);
      return ok({ id: value.id }, "Memory saved.");
    }

    const { data, error } = await db
      .from("memories")
      .insert(row)
      .select("id")
      .single();
    if (error) return fail(scopeError(error, "created"));

    revalidatePath(`/${org}/memory`);
    return ok({ id: String(data.id) }, "Memory added.");
  });
}

/**
 * The check constraint said plainly.
 *
 * The guards above should make this unreachable. It is here because "should be
 * unreachable" is how a raw `23514` reaches a user — and because the
 * constraint, not the guard, is what actually holds.
 */
function scopeError(error: { code?: string; message: string }, verb: string): string {
  if (error.code === "23514" && /scope_id_presence/.test(error.message)) {
    return "That scope and subject don't go together: an organisation-wide memory takes no subject, and every other scope needs one.";
  }
  return `That memory could not be ${verb}: ${error.message}`;
}

/**
 * Soft delete.
 *
 * `deleted_at` rather than `delete from`, and `memories_retrieval_idx` is a
 * partial index on `deleted_at is null` — so a soft-deleted memory leaves the
 * retrieval path immediately. Keeping the row means a memory removed by
 * mistake is recoverable, which matters more here than elsewhere: nobody can
 * reconstruct what the agent used to know.
 */
export async function deleteMemoryAction(
  org: string,
  id: string,
): Promise<ActionResult<undefined>> {
  return mutate(org, "deleteMemory", async ({ db, orgId }) => {
    const parsed = uuidSchema.safeParse(id);
    if (!parsed.success) return fail("That memory reference isn't valid.");

    const { error } = await db
      .from("memories")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", parsed.data)
      .eq("org_id", orgId);

    if (error) return fail(`That memory could not be removed: ${error.message}`);

    revalidatePath(`/${org}/memory`);
    return ok(undefined, "Memory removed. The agent will stop using it.");
  });
}

/* ── Ingestion ───────────────────────────────────────────────────────────── */

/**
 * How much of a document becomes a memory.
 *
 * `memories.content` is read into every qualification and every message this
 * org ever runs. Eight thousand characters is already two pages in front of
 * every prompt forever, and the marginal value of the ninth page is negative:
 * it dilutes the guidance somebody actually meant.
 *
 * The reference system Huntloop is a second draft of truncated fetched pages
 * at ten thousand characters and told nobody — not the caller, not the user,
 * not the row. `memories.truncated` in `0010` exists so this one says so, and
 * the screen renders it. "This is the whole document" and "this is the first
 * two pages of it" are different claims and §7 does not let the second be
 * presented as the first.
 */
const MAX_INGESTED_CHARS = 8_000;

/**
 * Turn a URL or an uploaded document into an organisation memory.
 *
 * ── Why the fetch goes through `@huntloop/jobs` ──────────────────────────
 *
 * `fetchPage` is SSRF-checked: `assertFetchable` refuses private ranges, link-
 * local addresses and non-HTTP schemes, and it re-checks after every redirect.
 * This action is a public POST endpoint that takes a URL from the caller and
 * makes the server request it, which is the textbook shape of the vulnerability
 * — so it uses the hardened fetcher the scanner already uses rather than a
 * second, softer one written here. There is exactly one fetch path in this
 * product, and that is the point.
 *
 * ── Why `content` is not accepted from the caller ────────────────────────
 *
 * A caller who could supply both `source_url` and `content` could store a
 * memory that claims to have come from a page it did not come from. The
 * provenance columns are only worth having if nothing can forge them, so the
 * URL case extracts its own text. The file case does take text — a browser
 * cannot hand a server a file any other way — and is labelled `file` rather
 * than `url` precisely because its provenance is "somebody uploaded this",
 * which is a weaker and honestly-stated claim.
 */
export async function ingestMemoryAction(
  org: string,
  input: {
    sourceType: "url" | "file";
    url?: string;
    filename?: string;
    text?: string;
    tags: string[];
    key?: string;
  },
): Promise<ActionResult<{ id: string; truncated: boolean; characters: number }>> {
  const parsed = parseForm(memoryIngestSchema, input);
  if (!parsed.ok) return fail(parsed.error, parsed.fieldErrors);
  const value = parsed.value;

  let content = "";
  let sourceUrl: string | null = null;
  let sourceLabel: string | null = null;

  if (value.sourceType === "url") {
    if (!value.url) {
      return fail("Which page should Huntloop read?", { url: "Paste a link." });
    }

    try {
      const page = await fetchPage(value.url);
      const extraction = extract(page);
      /* The extractor returns one document for a page and many for a feed.
         Joining them is right for a feed pointed at deliberately — somebody
         ingesting a changelog wants the entries — and the titles are kept so
         the resulting memory reads as a document rather than as a wall. */
      content = extraction.documents
        .map((doc) => (doc.title ? `${doc.title}\n${doc.text}` : doc.text))
        .join("\n\n")
        .trim();
      sourceUrl = page.url;
      sourceLabel = extraction.documents[0]?.title ?? null;
    } catch (e) {
      if (e instanceof FetchRefused) {
        return fail(e.message, { url: e.message });
      }
      if (e instanceof UnreadableContent) {
        return fail(e.message, { url: e.message });
      }
      return fail(
        `That page could not be read: ${e instanceof Error ? e.message : String(e)}`,
      );
    }

    if (!content) {
      /* A page that fetched fine and yielded nothing is a real outcome — a
         JavaScript-rendered app, usually — and it must not become an empty
         memory that silently contributes nothing to every future prompt. */
      return fail(
        "That page fetched, but there was no readable text in it. Sites that render " +
          "in the browser often look like this. Paste the text instead.",
        { url: "No readable text." },
      );
    }
  } else {
    content = (value.text ?? "").trim();
    if (!content) {
      return fail("That file had no readable text in it.", { text: "Nothing to store." });
    }
    sourceLabel = value.filename ?? null;
  }

  const characters = content.length;
  const truncated = characters > MAX_INGESTED_CHARS;
  if (truncated) {
    /* Cut at a paragraph where one is close, so the stored text ends at a
       thought rather than mid-word — and marked in the content itself as well
       as in the column, because the column is not in the prompt and the model
       reading this should know it is holding an excerpt. */
    const cut = content.slice(0, MAX_INGESTED_CHARS);
    const lastBreak = cut.lastIndexOf("\n\n");
    content =
      (lastBreak > MAX_INGESTED_CHARS * 0.6 ? cut.slice(0, lastBreak) : cut).trimEnd() +
      "\n\n[This is an excerpt. The rest of the document was not stored.]";
  }

  return mutate(org, "ingestMemory", async ({ db, orgId }) => {
    const { data, error } = await db
      .from("memories")
      .insert({
        org_id: orgId,
        scope: "organization",
        scope_id: null,
        kind: "durable",
        key: value.key || null,
        content,
        /* `user`, not `derived`. A person chose this document and asked for it
           to be remembered; the product concluded nothing. `derived` is what
           the learning loop writes, and keeping them apart is the whole reason
           the column exists. */
        source: "user",
        source_type: value.sourceType,
        source_url: sourceUrl,
        source_label: sourceLabel,
        tags: value.tags,
        truncated,
      })
      .select("id")
      .single();

    if (error) return fail(`That could not be saved: ${error.message}`);

    revalidatePath(`/${org}/memory`);
    return ok(
      { id: String(data.id), truncated, characters },
      truncated
        ? `Stored the first ${MAX_INGESTED_CHARS.toLocaleString()} characters of ${characters.toLocaleString()}. The excerpt is marked as one.`
        : `Stored ${characters.toLocaleString()} characters.`,
    );
  });
}
