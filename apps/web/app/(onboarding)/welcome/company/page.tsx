import { CompanyStep } from "./CompanyStep";
import { captureForViewer } from "../../../../lib/analytics";
import { canonicalizeDomain } from "@huntloop/db/identity";
import { resolveDataSource } from "../../../../lib/data/source";
import { hasOnboardingSchema } from "../../../../lib/data/onboarding-schema";
import { listDiscoverableWorkspaces } from "../../../../lib/data/directory";

/**
 * Step two.
 *
 * `org` is optional here and required by every step after it. That asymmetry
 * is the whole shape of the flow: this is the screen that *creates* the
 * workspace, from the domain the user is about to paste, so it is the only one
 * that can run without one.
 */
export default async function CompanyPage({
  searchParams,
}: {
  searchParams: Promise<{ org?: string; d?: string }>;
}) {
  const { org, d } = await searchParams;
  await captureForViewer("onboarding_step_viewed", { step: "company" });

  /* Carried from `/discover` through signup. Canonicalised rather than passed
     through: it goes straight into an input, and a value that is not a
     hostname has no business being there. Null when it is not one, which the
     step treats exactly as "they arrived without one". */
  const prefill = d ? canonicalizeDomain(d) : null;

  /*
   * Agencies get asked *whose* website this is.
   *
   * Without it the flow has a silent trap: an agency owner types their own
   * domain, Huntloop reads it, and drafts an ICP for selling agency services —
   * a coherent, plausible profile for a business they are not doing here. The
   * question costs one click and is the difference between a workspace that
   * hunts for their client's customers and one that hunts for theirs.
   *
   * Read from the profile rather than passed in the URL: it is a fact about
   * the person, it was answered on the previous screen, and a query parameter
   * would let a refresh lose it.
   */
  /* Only when they have no workspace yet. Somebody returning to step two for
     a workspace they already own is not about to duplicate anything, and the
     panel would just be a list of their colleagues' orgs on a screen about
     their own. */
  const [role, discoverable] = await Promise.all([
    currentRole(),
    org ? Promise.resolve([]) : listDiscoverableWorkspaces(),
  ]);

  return (
    <CompanyStep
      org={org}
      prefill={prefill}
      isAgency={role === "agency"}
      discoverable={discoverable}
    />
  );
}

/** The signed-in person's role, or null before the migration / in demo mode. */
async function currentRole(): Promise<string | null> {
  const { db } = await resolveDataSource();
  if (!db) return null;
  if (!(await hasOnboardingSchema(db))) return null;

  const { data: auth } = await db.auth.getUser();
  if (!auth.user) return null;

  const { data } = await db
    .from("profiles")
    .select("role")
    .eq("id", auth.user.id)
    .maybeSingle();

  return (data as { role?: string } | null)?.role ?? null;
}

export const metadata = { title: "Your company" };
