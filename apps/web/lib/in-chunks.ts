/**
 * Run a PostgREST read filtered by `.in(column, values)` in chunks (debt #20).
 *
 * `.in()` puts every value in the query string. A 1,000-row CSV import read
 * its domains, emails and company ids that way, which is a 20–40 KB URL:
 * past what the hosted gateway accepts, so the largest imports (exactly the
 * ones the cap allows) failed with "URI too long" before touching a row.
 * A chunk of 100 keeps even UUIDs under ~4 KB.
 *
 * Chunks run one after another: a large import is rare, and ten sequential
 * reads are kinder to a shared database than ten at once.
 */
export const IN_CHUNK = 100;

export async function inChunks<T>(
  values: readonly string[],
  run: (chunk: string[]) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  size: number = IN_CHUNK,
): Promise<{ data: T[]; error: { message: string } | null }> {
  const unique = [...new Set(values)];
  const data: T[] = [];
  for (let i = 0; i < unique.length; i += size) {
    const { data: rows, error } = await run(unique.slice(i, i + size));
    if (error) return { data: [], error };
    data.push(...(rows ?? []));
  }
  return { data, error: null };
}
