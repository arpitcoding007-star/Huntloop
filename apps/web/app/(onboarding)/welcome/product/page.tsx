import { ProductStep } from "./ProductStep";

export default async function ProductPage({
  searchParams,
}: {
  searchParams: Promise<{ org?: string }>;
}) {
  const { org } = await searchParams;
  return <ProductStep org={org ?? "acme"} />;
}

export const metadata = { title: "Your company" };
