/**
 * Memory retrieval — the one place memories are selected by scope.
 *
 * `0004`'s comment on `memories` asks for exactly this: retrieval filters on
 * `(org_id, scope, scope_id)` in `packages/db`, never per call site, so a
 * user-scoped note cannot leak into a colleague's answer because one caller
 * forgot a filter.
 *
 * What applies to a request is the organisation's memories, plus — only when
 * the request is about them — the requesting person's own, the account's
 * (the company) and the opportunity's. Expired memories never apply.
 */

/** The minimal query surface both the tenant and the admin client provide. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = { from: (table: string) => any };

export interface MemoryContext {
  orgId: string;
  /** The person asking. Their user-scoped memories apply to them alone. */
  userId?: string | null;
  /** `companies.id` — account-scoped memories. */
  accountId?: string | null;
  opportunityId?: string | null;
}

export interface ApplicableMemory {
  id: string;
  scope: "organization" | "user" | "account" | "opportunity" | "team";
  content: string;
  source: "user" | "derived";
}

/** Bounded so a workspace with hundreds of notes cannot flood a prompt. */
const LIMIT_PER_SCOPE = 15;

export async function applicableMemories(
  db: Client,
  context: MemoryContext,
): Promise<ApplicableMemory[]> {
  const now = new Date().toISOString();
  const wanted: Array<{ scope: ApplicableMemory["scope"]; id: string | null }> = [
    { scope: "organization", id: null },
  ];
  if (context.userId) wanted.push({ scope: "user", id: context.userId });
  if (context.accountId) wanted.push({ scope: "account", id: context.accountId });
  if (context.opportunityId) wanted.push({ scope: "opportunity", id: context.opportunityId });

  const results = await Promise.all(
    wanted.map(async ({ scope, id }) => {
      let query = db
        .from("memories")
        .select("id, scope, content, source")
        .eq("org_id", context.orgId)
        .eq("scope", scope)
        .eq("kind", "durable")
        .is("deleted_at", null)
        .or(`expires_at.is.null,expires_at.gt.${now}`)
        .order("created_at", { ascending: false })
        .limit(LIMIT_PER_SCOPE);
      query = id === null ? query.is("scope_id", null) : query.eq("scope_id", id);
      const { data } = await query;
      return (data ?? []) as Array<Record<string, unknown>>;
    }),
  );

  return results.flat().map((row): ApplicableMemory => ({
    id: String(row.id),
    scope: row.scope as ApplicableMemory["scope"],
    content: String(row.content ?? "").trim(),
    source: row.source === "derived" ? "derived" : "user",
  })).filter((m) => m.content);
}
