import { redirect } from "next/navigation";
import { IcpStep } from "./IcpStep";
import { getSavedIcpFields } from "../../../../lib/data/onboarding";

/**
 * Step four.
 *
 * No `onboarding_step_viewed` here: the draft action records it, because the
 * step is not meaningfully "viewed" until the profile has been drafted and
 * there is something to review. Recording it on render would count every
 * abandoned load as a view of a screen the user never saw the content of.
 */
export default async function IcpPage({
  searchParams,
}: {
  searchParams: Promise<{ org?: string }>;
}) {
  const { org } = await searchParams;
  if (!org) redirect("/welcome/company");

  // Coming back to this step edits the saved profile rather than redrafting it.
  const saved = await getSavedIcpFields(org);

  return <IcpStep org={org} saved={saved} />;
}

export const metadata = { title: "Ideal customer" };
