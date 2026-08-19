import { notFound } from "next/navigation";
import { canWrite, currentViewer } from "../../../../../lib/data/membership";
import { listProducts } from "../../../../../lib/data/product";
import { DemoFigures } from "../../DemoFigures";
import { ProductForm } from "./ProductForm";

/**
 * Product — master context §8.
 *
 * Reads through `lib/data/product`, so it satisfies FEAT-DEMO by being real
 * rather than by declaring itself illustrative; the `DemoFigures` banner is
 * rendered only in the configuration where the loader genuinely fell back to
 * the demo row, which is the distinction that check exists to preserve.
 */
export default async function ProductPage({
  params,
}: {
  params: Promise<{ org: string }>;
}) {
  const { org } = await params;

  const viewer = await currentViewer(org);
  if (!viewer) notFound();

  const { data: products, source } = await listProducts(org);

  return (
    <div className="space-y-6">
      {source !== "live" && (
        <DemoFigures what="This is an example product, not the one on your account." />
      )}
      <ProductForm
        org={org}
        product={products[0] ?? null}
        canWrite={canWrite(viewer)}
      />
    </div>
  );
}

export const metadata = { title: "Product" };
