import { ProductStep } from "./ProductStep";
import { captureForViewer } from "../../../../lib/analytics";

export default async function ProductPage({
  searchParams,
}: {
  searchParams: Promise<{ org?: string }>;
}) {
  const { org } = await searchParams;
  await captureForViewer("onboarding_step_viewed", { step: "product" });

  return <ProductStep org={org ?? "acme"} />;
}

export const metadata = { title: "Your company" };
