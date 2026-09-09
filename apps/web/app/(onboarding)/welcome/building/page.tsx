import { redirect } from "next/navigation";
import { BuildingStep } from "./BuildingStep";
import { captureForViewer } from "../../../../lib/analytics";

export default async function BuildingPage({
  searchParams,
}: {
  searchParams: Promise<{ org?: string }>;
}) {
  const { org } = await searchParams;
  if (!org) redirect("/welcome/company");

  await captureForViewer("onboarding_step_viewed", { step: "building" });

  return <BuildingStep org={org} />;
}

export const metadata = { title: "Building your workspace" };
