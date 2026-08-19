import "server-only";
import type { TenantClient } from "@huntloop/db";
import { requireOrgId } from "./org";
import { load, type Loaded } from "./source";

/**
 * The per-opportunity conversation — `conversations` from `0004`, §19 and §21.
 *
 * ── Why there is no org-wide read here ───────────────────────────────────
 *
 * §21 makes a salesperson's own agent conversation personal rather than shared
 * by default, and `0004` enforces it: `conversation_owner` is the one policy in
 * the schema keyed on `auth.uid()` rather than on org membership. So this
 * module does not take a user id and does not filter by one — RLS already
 * returns exactly the caller's own conversation, and a `user_id` filter here
 * would be a second, weaker copy of a rule Postgres is already applying.
 *
 * A manager who needs oversight gets it through a reviewed, audited path, not
 * by this loader quietly widening.
 *
 * ── Why the whole thing is loaded, not a page of it ──────────────────────
 *
 * A conversation about one opportunity is a handful of turns. Paginating it
 * would be machinery for a case that does not arise, and the cap that does
 * matter — how much of it is replayed to the model — belongs at the boundary
 * that pays for it, which is `lib/ai/agent.ts`.
 */

export interface ConversationTurn {
  id: string;
  role: "user" | "assistant";
  content: string;
  /**
   * §62 rule 4: what the assistant's answer rested on, as the claims
   * themselves. Empty for a question, and for an answer that established
   * nothing — which is a legitimate answer.
   *
   * Stored as evidence ids and resolved to text on read. The column is `uuid[]`
   * and should stay that way: storing the claim string would freeze a copy of
   * it, so a claim later superseded would go on being quoted in the
   * conversation as though it still stood.
   */
  citedClaims: string[];
  createdAt: string | null;
}

export async function getConversation(
  orgSlug: string,
  opportunityId: string,
): Promise<Loaded<ConversationTurn[]>> {
  return load(
    async (db) => {
      const orgId = await requireOrgId(orgSlug, "getConversation");

      const { data: conversation, error } = await db
        .from("conversations")
        .select("id")
        .eq("org_id", orgId)
        .eq("opportunity_id", opportunityId)
        .is("deleted_at", null)
        .maybeSingle();

      if (error) throw new Error(`getConversation: ${error.message}`);
      /* No conversation is the normal state for an opportunity nobody has
         asked about. Not an error, and not an empty conversation row created
         speculatively — the first question creates it. */
      if (!conversation) return [];

      const { data, error: messagesError } = await db
        .from("conversation_messages")
        .select("id, role, content, cited_evidence_ids, created_at")
        .eq("org_id", orgId)
        .eq("conversation_id", conversation.id)
        .order("created_at", { ascending: true });

      if (messagesError) throw new Error(`getConversation: ${messagesError.message}`);

      const rows = ((data ?? []) as Record<string, unknown>[])
        /* `system` is stored by the schema's check constraint but never
           rendered: it is not part of what a person said or was told. */
        .filter((row) => row.role === "user" || row.role === "assistant");

      const claims = await claimsFor(
        db,
        orgId,
        rows.flatMap((row) =>
          Array.isArray(row.cited_evidence_ids) ? row.cited_evidence_ids.map(String) : [],
        ),
      );

      return rows.map((row) => ({
        id: String(row.id),
        role: row.role as "user" | "assistant",
        content: String(row.content ?? ""),
        citedClaims: (Array.isArray(row.cited_evidence_ids) ? row.cited_evidence_ids : [])
          .map((id) => claims.get(String(id)))
          /* An id with no row behind it is evidence that was hard-deleted. It
             is dropped rather than rendered as a blank citation, which would
             read as a claim with no text. */
          .filter((claim): claim is string => Boolean(claim)),
        createdAt: (row.created_at as string | null) ?? null,
      }));
    },
    /* Empty in demo mode. A scripted conversation would be putting words in a
       colleague's mouth on the one screen §21 makes personal. */
    () => [],
  );
}

/**
 * Evidence ids → the claims they carry, in one round trip.
 *
 * Batched over the whole conversation rather than issued per message, which is
 * the N+1 a citation list would otherwise grow. Soft-deleted rows are still
 * resolved: a claim that has been retired was true of the answer at the time it
 * was given, and blanking the citation would make an old answer look ungrounded
 * rather than superseded.
 */
async function claimsFor(
  db: TenantClient,
  orgId: string,
  ids: string[],
): Promise<Map<string, string>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();

  const { data } = await db
    .from("evidence")
    .select("id, claim")
    .eq("org_id", orgId)
    .in("id", unique);

  return new Map(
    ((data ?? []) as Record<string, unknown>[]).map((row) => [
      String(row.id),
      String(row.claim ?? ""),
    ]),
  );
}
