/**
 * The development-only escape hatch through onboarding.
 *
 * ── What it does ─────────────────────────────────────────────────────────
 *
 * Lets a developer past the onboarding screens' *client-side* completeness
 * gates ("Still needed: a region") and straight into the workspace, so the
 * app itself can be reviewed without first producing a perfect profile. It
 * does not touch authentication, RLS, or any server-side validation: every
 * save still goes through the same Server Action and the same Zod schema.
 *
 * ── Why it cannot reach production ───────────────────────────────────────
 *
 * `process.env.NODE_ENV` is inlined at build time. `next build` always sets it
 * to "production", so in every deployed bundle this is the literal `false`
 * and the branches it guards are removed as dead code — there is no runtime
 * flag an attacker could flip. `next dev` sets "development".
 *
 * Opt out locally with `NEXT_PUBLIC_HUNTLOOP_DEV_BYPASS=0` to see the flow
 * exactly as production enforces it.
 */
export const DEV_BYPASS =
  process.env.NODE_ENV === "development" &&
  process.env.NEXT_PUBLIC_HUNTLOOP_DEV_BYPASS !== "0";
