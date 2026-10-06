"use client";

import { useState } from "react";
import { Button, Confirmed } from "@huntloop/ui";
import { Plus } from "lucide-react";
import type { Product } from "../../../../../lib/data/product";
import { ProductForm } from "./ProductForm";

/**
 * Every product the workspace sells (§14.2: the screen managed only the
 * first). Campaigns already choose which product they sell and message
 * drafting reads that product, so a second product is useful today; scoring
 * against several profiles at once is the separate multi-product phase.
 */
export function ProductList({
  org,
  products,
  canWrite,
}: {
  org: string;
  products: Product[];
  canWrite: boolean;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(products[0]?.id ?? null);
  const [creating, setCreating] = useState(products.length === 0);
  const [notice, setNotice] = useState<string | null>(null);

  const selected = creating ? null : (products.find((p) => p.id === selectedId) ?? products[0] ?? null);

  return (
    <div className="space-y-4">
      {(products.length > 1 || (products.length > 0 && canWrite)) && (
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Products">
          {products.map((p) => (
            <button
              key={p.id}
              type="button"
              aria-pressed={!creating && selected?.id === p.id}
              onClick={() => {
                setCreating(false);
                setSelectedId(p.id);
                setNotice(null);
              }}
              className={[
                "hl-focusable h-8 rounded-md border px-3 text-[13px] transition-colors duration-[120ms]",
                !creating && selected?.id === p.id
                  ? "border-brand-border bg-brand-surface text-brand-text"
                  : "border-line bg-surface text-fg-secondary hover:border-brand-border hover:bg-hover hover:text-fg",
              ].join(" ")}
            >
              {p.name}
            </button>
          ))}
          {canWrite && !creating && (
            <Button
              size="sm"
              variant="ghost"
              icon={Plus}
              onClick={() => {
                setCreating(true);
                setNotice(null);
              }}
            >
              Add a product
            </Button>
          )}
        </div>
      )}

      {notice && <Confirmed title={notice} />}

      <ProductForm
        key={creating ? "new" : (selected?.id ?? "none")}
        org={org}
        product={selected}
        canWrite={canWrite}
        onCreated={(id, message) => {
          setSelectedId(id);
          setCreating(false);
          setNotice(message ?? "Product added.");
        }}
        onRemoved={(message) => {
          setSelectedId(products.find((p) => p.id !== selected?.id)?.id ?? null);
          setNotice(message ?? "Product removed.");
        }}
      />

      {creating && products.length > 0 && (
        <Button variant="ghost" onClick={() => setCreating(false)}>
          Cancel
        </Button>
      )}
    </div>
  );
}
