/**
 * The demo workspace — what every screen renders when there is no database
 * (no Supabase credentials, or no schema yet).
 *
 * It was called "Acme" at `/acme`, a template placeholder that read as a real
 * customer's workspace — on a production deployment in demo mode it looked
 * like somebody else's account. It is named for what it is instead.
 *
 * Any slug still renders in demo mode (the fixture takes the slug from the
 * URL), so old `/acme/...` links keep working; this is only where the app
 * *sends* people. No `server-only` import: the sign-in form links here too.
 */
export const DEMO_ORG_SLUG = "demo";
export const DEMO_ORG_NAME = "Demo workspace";
export const DEMO_HOME = `/${DEMO_ORG_SLUG}/dashboard`;
