import { redirect } from "next/navigation";
import { GoalsStep } from "./GoalsStep";
import { captureForViewer } from "../../../../lib/analytics";

export default async function GoalsPage({
  searchParams,
}: {
  searchParams: Promise<{ org?: string }>;
}) {
  const { org } = await searchParams;

  /* Every step after `company` needs a workspace, and arriving without one
     means a deep link or a lost query string rather than a state the flow can
     recover from. Sending them back to the step that creates one is the only
     useful response — the alternative is a screen whose save button cannot
     work and does not say why. */
  if (!org) redirect("/welcome/company");

  await captureForViewer("onboarding_step_viewed", { step: "goals" });

  return <GoalsStep org={org} />;
}

export const metadata = { title: "Your goals" };
