import { IcpStep } from "./IcpStep";

export default async function IcpPage({
  searchParams,
}: {
  searchParams: Promise<{ org?: string }>;
}) {
  const { org } = await searchParams;
  return <IcpStep org={org ?? "acme"} />;
}

export const metadata = { title: "Ideal customer · Huntloop" };
