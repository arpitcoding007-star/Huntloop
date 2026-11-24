/** What the jump-to palette finds besides pages. */
export interface RecordHit {
  label: string;
  href: string;
  group: string;
}

/** Below this, a search matches most of the workspace. */
export const SEARCH_MIN = 2;

/** A literal "contains" pattern: what a person types is never a wildcard. */
export function likePattern(query: string): string {
  return `%${query.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}
