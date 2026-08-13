import { SourcesStep } from "./SourcesStep";

export default async function SourcesOnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ org?: string }>;
}) {
  const { org } = await searchParams;
  return <SourcesStep org={org ?? "acme"} />;
}

export const metadata = { title: "Sources" };
