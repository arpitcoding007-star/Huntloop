import { IcpStep } from "./IcpStep";
import { captureForViewer } from "../../../../lib/analytics";

export default async function IcpPage({
  searchParams,
}: {
  searchParams: Promise<{ org?: string }>;
}) {
  const { org } = await searchParams;
  await captureForViewer("onboarding_step_viewed", { step: "icp" });

  return <IcpStep org={org ?? "acme"} />;
}

export const metadata = { title: "Ideal customer" };
