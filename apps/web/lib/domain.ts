/**
 * Company domain normalization — master context §59.
 *
 * §59 makes the normalized domain the entity-resolution key that keeps one
 * company one row when it arrives from GitHub and from a news article, and
 * 0003 enforces it with `unique (org_id, canonical_domain)`. The migration is
 * explicit that the normalizing is the application's job.
 *
 * So it lives here rather than in either caller. Two modules write companies —
 * the Companies screen and the CSV importer — and a key computed by two
 * functions with slightly different rules is not a key: the same company
 * pasted into the form and imported from a spreadsheet would become two rows,
 * which is exactly the duplication §60 forbids.
 *
 * Deliberately not in a `"use server"` module: every export from one of those
 * has to be an async function, and this is a pure string function that the
 * importer also wants to call per row without a round trip.
 */

/**
 * The bare host, from whatever the user pasted.
 *
 * Lowercased, with scheme, credentials, `www.`, port, path and trailing dot
 * removed. Returns null when nothing domain-shaped survives, which callers
 * report as a field error rather than storing an empty key — every empty key
 * would collide with every other one.
 */
export function normalizeDomain(input: string): string | null {
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) return null;

  const withoutScheme = trimmed.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  const host = withoutScheme.split(/[/?#]/)[0].split("@").pop() ?? "";
  const bare = host.replace(/:\d+$/, "").replace(/^www\./, "").replace(/\.$/, "");

  // At least one dot, no whitespace, nothing but host characters. `localhost`
  // and a bare company name both fail this, and both should: neither
  // identifies a company on the public internet, which is what the column is
  // for. 253 is the DNS maximum for a fully qualified name.
  if (bare.length > 253) return null;
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(bare)) return null;
  return bare;
}
