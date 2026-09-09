import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { resolveDataSource } from "../../../lib/data/source";
import { currentViewer } from "../../../lib/data/membership";
import { DataSourceBanner } from "./DataSourceBanner";
import { OrgShell } from "./OrgShell";
import { SetupCard } from "./SetupCard";
import { getOnboardingState } from "../../../lib/data/onboarding";

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

  /* Same reasoning as the banner: rendered once in the layout, the setup card
     cannot be forgotten on a new route. It matters more here than it looks —
     a half-configured workspace behaves differently on *every* screen, not
     just the dashboard, and a user who lands on Opportunities wondering why it
     is empty needs the same explanation as one who lands on the Command
     Center. It returns null once there is nothing left to finish. */
  const onboarding = await getOnboardingState(org);

  return (
    <OrgShell org={org}>
      <DataSourceBanner source={source} />
      {onboarding && <SetupCard state={onboarding} />}
      {children}
    </OrgShell>
  );
}
