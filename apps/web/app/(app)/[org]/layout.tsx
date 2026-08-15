import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { resolveDataSource } from "../../../lib/data/source";
import { currentViewer } from "../../../lib/data/membership";
import { DataSourceBanner } from "./DataSourceBanner";
import { OrgShell } from "./OrgShell";

/**
 * Resolves `params` (async in Next 15) and enforces membership of the org in
 * the URL before rendering anything inside it.
 *
 * `notFound()` — not a 403 — when the user isn't a member. "That organization
 * exists, but you may not see it" tells anyone who can guess a slug which
 * companies are Huntloop customers. A 404 tells them nothing, and costs a
 * legitimate user nothing either, because a legitimate user is a member.
 *
 * This is a convenience check, not the security boundary. The boundary is RLS
 * in Postgres: even if this layout were removed, a query would return zero
 * rows for a non-member. Deleting this would leak nothing but an empty page.
 */
export default async function OrgLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ org: string }>;
}) {
  const { org } = await params;

  const { source } = await resolveDataSource();

  /* `currentViewer` wraps `resolveMembership` and is React-cached, so the
     pages inside this layout can ask what the caller may do without paying for
     a second `auth.getUser()` plus join. Returns a `demo` viewer rather than
     null when there is no database — see the module for why that is a third
     state and not a shade of the other two. */
  const viewer = await currentViewer(org);
  if (!viewer) notFound();
  // db === null means either no credentials or no schema yet — both are demo
  // mode, and both are normal states during setup. Membership cannot be
  // checked against a `memberships` table that does not exist, and 404ing here
  // would make "you have one migration left to run" look like "the app is
  // broken". The DataSourceBanner on every page says which state this is.

  /* The banner lives here rather than on each page: rendered once, it cannot
     be forgotten on a new route, and forgetting it is precisely the failure
     it exists to prevent — a screen of demo data with nothing saying so. */
  return (
    <OrgShell org={org}>
      <DataSourceBanner source={source} />
      {children}
    </OrgShell>
  );
}
