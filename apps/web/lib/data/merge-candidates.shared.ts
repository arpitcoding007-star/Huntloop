/* Shared with the client: no server-only imports here. */

/**
 * Possible duplicates `resolve_entity` proposed and nobody has decided (Phase 3.3).
 *
 * Only `pending` rows. A merged or rejected pair is settled and never shown
 * again — re-showing a rejected pair is how a review queue becomes noise.
 */
export interface MergeCandidate {
  id: string;
  matchedOn: string;
  confidence: string;
  a: { id: string; name: string; domain: string; country: string | null };
  b: { id: string; name: string; domain: string; country: string | null };
}

/** What the resolver matched on, said in words. */
export const MATCH_REASONS: Record<string, string> = {
  provider_id: "Same company id at the data provider",
  domain: "Same website domain",
  redirect: "One website redirects to the other",
  normalized_name: "Same name once punctuation and suffixes are removed",
  name_and_country: "Similar name in the same country",
};

type Side = { id: string; name: string | null; canonical_domain: string | null; country: string | null; deleted_at: string | null };

function side(raw: unknown): Side | null {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v && typeof v === "object" ? (v as Side) : null;
}

export function mapCandidate(row: Record<string, unknown>): MergeCandidate | null {
  const a = side(row.a);
  const b = side(row.b);
  /* A pair where either side was removed since is not a decision anyone needs to make. */
  if (!a || !b || a.deleted_at || b.deleted_at) return null;
  const pick = (s: Side) => ({ id: s.id, name: s.name ?? s.canonical_domain ?? "Unnamed", domain: s.canonical_domain ?? "", country: s.country });
  return {
    id: String(row.id),
    matchedOn: String(row.matched_on),
    confidence: String(row.confidence),
    a: pick(a),
    b: pick(b),
  };
}
