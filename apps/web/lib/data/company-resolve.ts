import type { TenantClient } from "@huntloop/db";
import { inChunks } from "../in-chunks";

/**
 * Resolve-then-write for `companies` (audit pass 20, RC-5: PANEL-202, 203).
 *
 * `(org_id, canonical_domain)` is unique and *not* partial (0003), so a domain
 * is held by its row for good: live, removed (`deleted_at`) or merged away
 * (`merged_into_id`). Two write paths got this wrong in opposite directions:
 *
 *   · Analyze "Save" upserted, overwriting `name` and `discovered_via` on a
 *     row it did not create, and attaching to removed or merged-away rows.
 *   · CSV import pre-read only live rows, then inserted the rest, so one
 *     removed or merged domain failed the whole file on 23505.
 *
 * The rule here, the same one `saveCompanyAction` follows:
 *
 *   live        → use it, write nothing (provenance belongs to whoever found it)
 *   merged      → use the live survivor; never restore the merged-away row
 *                 (DB-102: its people and opportunities already moved)
 *   removed     → restore it (clear `deleted_at` only)
 *   missing     → insert the caller's row
 */

export type Resolution =
  | { kind: "live"; id: string }
  | { kind: "merged"; id: string; fromId: string }
  | { kind: "restored"; id: string }
  | { kind: "inserted"; id: string }
  | { kind: "unavailable"; reason: string };

interface CompanyKeyRow {
  id: string;
  canonical_domain: string;
  deleted_at: string | null;
  merged_into_id: string | null;
}

const MAX_MERGE_HOPS = 5;

/** The live end of a merge chain, or null when it ends at a removed row. */
async function survivorOf(
  db: TenantClient,
  orgId: string,
  start: string,
): Promise<{ id: string } | null> {
  let id: string | null = start;
  for (let hop = 0; id && hop < MAX_MERGE_HOPS; hop++) {
    const { data, error } = await db
      .from("companies")
      .select("id, deleted_at, merged_into_id")
      .eq("org_id", orgId)
      .eq("id", id)
      .maybeSingle();
    if (error || !data) return null;
    const row = data as { id: string; deleted_at: string | null; merged_into_id: string | null };
    if (row.merged_into_id) {
      id = String(row.merged_into_id);
      continue;
    }
    return row.deleted_at ? null : { id: String(row.id) };
  }
  return null;
}

/**
 * Resolve many domains at once. Returns one entry per domain that already has
 * a row; domains absent from the map have none and may be inserted. Removed,
 * unmerged rows are restored in one update.
 */
export async function resolveExistingCompanies(
  db: TenantClient,
  orgId: string,
  domains: string[],
): Promise<{ resolved: Map<string, Resolution>; error: string | null }> {
  const resolved = new Map<string, Resolution>();
  if (domains.length === 0) return { resolved, error: null };

  const { data, error } = await inChunks(domains, (chunk) =>
    db
      .from("companies")
      .select("id, canonical_domain, deleted_at, merged_into_id")
      .eq("org_id", orgId)
      .in("canonical_domain", chunk),
  );
  if (error) return { resolved, error: error.message };

  const toRestore: string[] = [];
  for (const raw of (data ?? []) as unknown as CompanyKeyRow[]) {
    const domain = String(raw.canonical_domain);
    const id = String(raw.id);
    if (raw.merged_into_id) {
      const survivor = await survivorOf(db, orgId, String(raw.merged_into_id));
      resolved.set(
        domain,
        survivor
          ? { kind: "merged", id: survivor.id, fromId: id }
          : {
              kind: "unavailable",
              reason: `${domain} was merged into a company that has since been removed. Restore that one instead.`,
            },
      );
    } else if (raw.deleted_at) {
      toRestore.push(id);
      resolved.set(domain, { kind: "restored", id });
    } else {
      resolved.set(domain, { kind: "live", id });
    }
  }

  if (toRestore.length > 0) {
    const { error: restoreError } = await inChunks(toRestore, (chunk) =>
      db
        .from("companies")
        .update({ deleted_at: null })
        .eq("org_id", orgId)
        .in("id", chunk)
        .is("merged_into_id", null)
        .select("id"),
    );
    if (restoreError) return { resolved, error: restoreError.message };
  }

  return { resolved, error: null };
}

/**
 * Resolve one domain, inserting `insertRow` only when the domain has no row at
 * all. An existing row is never overwritten.
 */
export async function resolveOrInsertCompany(
  db: TenantClient,
  orgId: string,
  domain: string,
  insertRow: Record<string, unknown>,
): Promise<Resolution> {
  const { resolved, error } = await resolveExistingCompanies(db, orgId, [domain]);
  if (error) return { kind: "unavailable", reason: `That company could not be read: ${error}` };
  const existing = resolved.get(domain);
  if (existing) return existing;

  const { data, error: insertError } = await db
    .from("companies")
    .insert({ ...insertRow, org_id: orgId, canonical_domain: domain })
    .select("id")
    .single();
  if (!insertError && data) return { kind: "inserted", id: String((data as { id: string }).id) };

  /* 23505: someone else inserted it between the read and the write. Read it
     again rather than failing a save the user cannot explain. */
  if (insertError && (insertError as { code?: string }).code === "23505") {
    const again = await resolveExistingCompanies(db, orgId, [domain]);
    const row = again.resolved.get(domain);
    if (row) return row;
  }
  return {
    kind: "unavailable",
    reason: `That company could not be saved: ${insertError?.message ?? "no row returned"}`,
  };
}
