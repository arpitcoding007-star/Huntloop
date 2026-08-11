/**
 * Environment access, in one place so a missing key fails at startup with a
 * sentence rather than at 3am with `undefined is not a valid URL`.
 *
 * Note the two-name lookup on the publishable key. Supabase renamed the
 * browser-safe key from `anon` to `publishable` when it moved off the legacy
 * JWT format; projects created either side of that change carry different
 * names, and `.env.example` in this repo uses the new one.
 */

function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `Missing environment variable ${name}. Copy .env.example to ` +
        `apps/web/.env.local and fill it in — see README "Local development".`,
    );
  }
  return value;
}

export function supabaseUrl(): string {
  return required("NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL);
}

/** Browser-safe. Carries no privileges beyond what RLS grants the session. */
export function supabasePublishableKey(): string {
  return required(
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}

/**
 * Server-only. Bypasses RLS entirely — see the warning in `admin.ts`. Read
 * from exactly one place so a grep for this function name finds every use.
 */
export function supabaseSecretKey(): string {
  return required(
    "SUPABASE_SECRET_KEY",
    process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY,
  );
}
