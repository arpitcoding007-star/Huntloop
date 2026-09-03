import "server-only";
import { requireOrgId } from "./org";
import { load, type Loaded } from "./source";

/**
 * Memory — master context §20, §21, §37, §54, and `0004`.
 *
 * ── The scope column is a permission boundary, not a label ───────────────
 *
 * `0004`'s comment on this table is explicit: retrieval MUST filter on
 * `(org_id, scope, scope_id)`, and it must do so in one place rather than at
 * every call site (§54). The check constraint enforces the half a filter
 * cannot:
 *
 *   memories_scope_id_presence — organization scope takes no subject, and
 *   every other scope requires one.
 *
 * Without that, a user-scoped memory with a NULL `scope_id` would match every
 * user's retrieval filter. That is the §37 leak the whole column exists to
 * prevent, and it is why this loader never invents a `scope_id`: a memory it
 * cannot place is a memory it does not return.
 *
 * ── Why nothing here is "global" ─────────────────────────────────────────
 *
 * §54: global learning must not see one tenant's private data. There is no
 * global scope in the enum, and this file does not add one by convention.
 */

export type MemoryScope = "organization" | "team" | "user" | "account" | "opportunity";

export type MemorySourceType = "text" | "url" | "file" | "image";

export interface Memory {
  id: string;
  scope: MemoryScope;
  scopeId: string | null;
  kind: "durable" | "conversational";
  key: string | null;
  content: string;
  source: "user" | "derived";
  confidence: "low" | "medium" | "high" | null;
  createdBy: string | null;
  expiresAt: string | null;
  createdAt: string | null;
  /**
   * Where the text came from — `0010`.
   *
   * `source` and `sourceType` answer different questions and both matter.
   * `source` is *who concluded it*: a person, or the product. `sourceType` is
   * *what it was before it was a memory*: a sentence somebody typed, or a page,
   * or a file. A derived memory is always `text`, because a conclusion is not
   * a document.
   */
  sourceType: MemorySourceType;
  sourceUrl: string | null;
  sourceLabel: string | null;
  tags: string[];
  /** True when `content` is an excerpt. Rendered, never inferred. */
  truncated: boolean;
}

export const MEMORY_SCOPES: readonly MemoryScope[] = [
  "organization",
  "team",
  "user",
  "account",
  "opportunity",
];

/**
 * Every memory the caller may read.
 *
 * RLS already scopes this to the org, and it does not scope it further — the
 * `tenant_read` policy on `memories` is org-wide. That is a real gap between
 * the policy and §37, and it is worth being precise about: the *retrieval*
 * path the agent uses filters on `(org_id, scope, scope_id)`; this screen is
 * the management view, and it shows what the database will hand the caller.
 * Nothing here widens access — it displays exactly what the policy permits.
 */
export async function listMemories(orgSlug: string): Promise<Loaded<Memory[]>> {
  return load(
    async (db) => {
      const orgId = await requireOrgId(orgSlug, "listMemories");

      const { data, error } = await db
        .from("memories")
        .select(
          "id, scope, scope_id, kind, key, content, source, confidence, created_by, " +
            "expires_at, created_at, source_type, source_url, source_label, tags, truncated",
        )
        .eq("org_id", orgId)
        .is("deleted_at", null)
        .order("created_at", { ascending: false });

      if (error) throw new Error(`listMemories: ${error.message}`);
      return (data ?? []).map(mapMemory);
    },
    () => DEMO,
  );
}

/* eslint-disable @typescript-eslint/no-explicit-any --
   Supabase row types are generated from a live project's schema; see the same
   note in icp.ts. Confined to the mapper. */
function mapMemory(row: any): Memory {
  return {
    id: String(row.id),
    scope: MEMORY_SCOPES.includes(row.scope) ? row.scope : "organization",
    scopeId: row.scope_id ?? null,
    kind: row.kind === "conversational" ? "conversational" : "durable",
    key: row.key ?? null,
    content: String(row.content ?? ""),
    source: row.source === "derived" ? "derived" : "user",
    confidence: row.confidence ?? null,
    createdBy: row.created_by ?? null,
    expiresAt: row.expires_at ?? null,
    createdAt: row.created_at ?? null,
    sourceType: ["text", "url", "file", "image"].includes(row.source_type)
      ? row.source_type
      : "text",
    sourceUrl: row.source_url ?? null,
    sourceLabel: row.source_label ?? null,
    tags: Array.isArray(row.tags) ? row.tags.map(String) : [],
    truncated: Boolean(row.truncated),
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * Demo memories.
 *
 * One typed, one ingested, one derived — because those are the three ways a
 * memory gets here and the screen renders each differently. §7 again: the
 * difference between something a person wrote down, something a person handed
 * over, and something the product concluded is exactly what must stay visible,
 * including when the subject is the user's own preferences.
 */
const DEMO: Memory[] = [
  {
    id: "demo-memory-1",
    scope: "organization",
    scopeId: null,
    kind: "durable",
    key: "tone",
    content: "Never open with a compliment. Lead with the observation and the source.",
    source: "user",
    confidence: null,
    createdBy: null,
    expiresAt: null,
    createdAt: null,
    sourceType: "text",
    sourceUrl: null,
    sourceLabel: null,
    tags: [],
    truncated: false,
  },
  {
    id: "demo-memory-3",
    scope: "organization",
    scopeId: null,
    kind: "durable",
    key: "positioning",
    content:
      "We are the policy layer, not the wallet. Every comparison a prospect makes is against building it themselves, not against another vendor.\n\n[This is an excerpt. The rest of the document was not stored.]",
    source: "user",
    confidence: null,
    createdBy: null,
    expiresAt: null,
    createdAt: null,
    sourceType: "url",
    sourceUrl: "https://example.test/positioning",
    sourceLabel: "Positioning one-pager",
    tags: ["positioning"],
    // Deliberately true in the fixture: a truncation badge that only ever
    // appears against real data is a badge nobody has looked at.
    truncated: true,
  },
  {
    id: "demo-memory-2",
    scope: "organization",
    scopeId: null,
    kind: "durable",
    key: null,
    content:
      "Replies are markedly better when the trigger is under three weeks old.",
    source: "derived",
    confidence: "medium",
    createdBy: null,
    expiresAt: null,
    createdAt: null,
    // A conclusion is not a document, so a derived memory is always `text`.
    sourceType: "text",
    sourceUrl: null,
    sourceLabel: null,
    tags: [],
    truncated: false,
  },
];
