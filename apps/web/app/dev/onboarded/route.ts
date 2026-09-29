import { NextResponse, type NextRequest } from "next/server";
import { resolveDestination } from "../../../lib/data/destination";

/**
 * Development only: straight to the post-onboarding workspace.
 *
 * ── What it does ─────────────────────────────────────────────────────────
 *
 * Sends a developer to the dashboard they would reach after onboarding, by
 * the same resolver the auth callback uses — it writes nothing, skips no
 * authentication and no RLS, and invents no state:
 *
 *   · no database (demo mode)  → the demo workspace's real dashboard
 *   · signed out               → /login, then back here
 *   · one workspace            → its dashboard, even if setup is unfinished
 *                                (the workspace is usable before setup; the
 *                                SetupCard says what is missing)
 *   · several                  → the workspace picker
 *   · none yet                 → /welcome, because there is no workspace to
 *                                open and faking one would be mock state
 *
 * ── Why it cannot reach production ───────────────────────────────────────
 *
 * `next build` inlines NODE_ENV as "production", so in every deployed or
 * locally built bundle the first line answers 404 and the rest is dead code.
 * The proxy also 404s this path on the production deployment
 * (HIDDEN_IN_PRODUCTION), so there are two independent locks.
 */
export async function GET(request: NextRequest) {
  if (process.env.NODE_ENV !== "development") {
    return new NextResponse("Not found", { status: 404 });
  }

  const destination = await resolveDestination();
  const to =
    destination.kind === "anonymous"
      ? `/login?next=${encodeURIComponent("/dev/onboarded")}`
      : destination.path;

  return NextResponse.redirect(new URL(to, request.nextUrl.origin));
}

export const dynamic = "force-dynamic";
