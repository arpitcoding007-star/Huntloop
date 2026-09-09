import { redirect } from "next/navigation";
import { SourcesStep } from "./SourcesStep";
import { captureForViewer } from "../../../../lib/analytics";

export default async function SourcesOnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ org?: string }>;
}) {
  const { org } = await searchParams;
  if (!org) redirect("/welcome/company");

  await captureForViewer("onboarding_step_viewed", { step: "sources" });

  return <SourcesStep org={org} />;
}

export const metadata = { title: "Sources" };
