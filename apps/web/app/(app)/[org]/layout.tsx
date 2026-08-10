import type { ReactNode } from "react";
import { OrgShell } from "./OrgShell";

/**
 * Server wrapper: resolves the async `params` (Next 15) and hands off to
 * the client shell with only a plain string — see OrgShell.tsx for why
 * the nav/icon construction can't happen here.
 *
 * Org resolution and the auth guard belong to Phase 0 (middleware.ts, per
 * the repo structure in plan §4) — this reads only the URL param for now.
 */
export default async function OrgLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ org: string }>;
}) {
  const { org } = await params;

  return <OrgShell org={org}>{children}</OrgShell>;
}
