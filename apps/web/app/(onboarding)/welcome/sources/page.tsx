import { SourcesStep } from "./SourcesStep";
import { captureForViewer } from "../../../../lib/analytics";

export default async function SourcesOnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ org?: string }>;
}) {
  const { org } = await searchParams;
  await captureForViewer("onboarding_step_viewed", { step: "sources" });

  return <SourcesStep org={org ?? "acme"} />;
}

export const metadata = { title: "Sources" };
