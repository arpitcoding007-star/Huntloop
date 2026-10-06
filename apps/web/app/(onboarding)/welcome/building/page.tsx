import { redirect } from "next/navigation";
import { BuildingStep } from "./BuildingStep";
import { captureForViewer } from "../../../../lib/analytics";
import { isEngineRunning } from "../../../../lib/data/engine";

export default async function BuildingPage({
  searchParams,
}: {
  searchParams: Promise<{ org?: string }>;
}) {
  const { org } = await searchParams;
  if (!org) redirect("/welcome/company");

  await captureForViewer("onboarding_step_viewed", { step: "building" });

  return <BuildingStep org={org} engineConfigured={isEngineRunning()} />;
}

export const metadata = { title: "Building your workspace" };
