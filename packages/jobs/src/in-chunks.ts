/**
 * A PostgREST read filtered by `.in()`, in pieces.
 *
 * Every value goes into the URL, and the hosted gateway refuses a long one: a
 * few hundred UUIDs came back as an error nobody read, which each caller took
 * as "no rows" — no bounces, no replies, no preferences. Chunks keep the URL
 * short, and an error is returned rather than swallowed, so a caller decides
 * which way to fail. Same helper as `apps/web/lib/in-chunks.ts`.
 */
export const IN_CHUNK = 100;

export async function inChunks<T>(
  values: readonly string[],
  run: (chunk: string[]) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
): Promise<{ data: T[]; error: { message: string } | null }> {
  const unique = [...new Set(values)];
  const data: T[] = [];
  for (let i = 0; i < unique.length; i += IN_CHUNK) {
    const { data: rows, error } = await run(unique.slice(i, i + IN_CHUNK));
    if (error) return { data: [], error };
    data.push(...((rows ?? []) as T[]));
  }
  return { data, error: null };
}
