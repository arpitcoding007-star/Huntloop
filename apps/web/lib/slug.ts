/**
 * Organisation slugs.
 *
 * Lives outside the server-action file for two reasons: a `"use server"`
 * module may only export async functions, and the sign-up form needs to run
 * this synchronously on every keystroke to preview the URL.
 */

/**
 * URL-safe, lowercase, no leading/trailing or doubled dashes.
 *
 * Length is capped at 48 because the slug becomes a path segment and appears
 * in the breadcrumb; past that it stops being readable in either.
 */
export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize("NFKD")
      // Strip the combining marks NFKD leaves behind, so "Ünïcödé Corp"
      // becomes "unicode-corp" rather than losing the accented letters.
      //
      // \p{M} rather than a hand-written range: it covers every combining
      // mark, and it is ASCII in the source — the range form is literally
      // invisible in an editor and one careless paste from being wrong.
      //
      // Deliberately not chased further: ligatures that don't decompose (Æ, Ø,
      // ß) lose the letter rather than transliterating, so "Æther" slugs to
      // "ther". Fixing that needs a transliteration table, and the form shows
      // the slug before the user commits to it.
      .replace(/\p{M}/gu, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48)
  );
}

/** Slugs that would collide with real routes if used as an org name. */
export const RESERVED_SLUGS = new Set([
  "welcome",
  "login",
  "signup",
  "auth",
  "admin",
  "api",
  "kitchen-sink",
  "settings",
  "new",
]);
