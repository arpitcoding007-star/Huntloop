"use client";

import Link from "next/link";
import { useState } from "react";
import { Button, Confirmed } from "@huntloop/ui";
import { Plus } from "lucide-react";
import type { Product, ProductStats } from "../../../../../lib/data/product";
import { ProductForm } from "./ProductForm";

/**
 * Every product the workspace sells, as cards you can read at a glance — what
 * it does, who it is for, and how many open opportunities it has — with the
 * editor for the selected one below (§10.2). Products are data, not
 * navigation: a card links to the opportunity list filtered to it rather than
 * to a page of its own.
 */
export function ProductList({
  org,
  products,
  stats = {},
  canWrite,
}: {
  org: string;
  products: Product[];
  /** Profiles and open opportunities per product id. */
  stats?: Record<string, ProductStats>;
  canWrite: boolean;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(products[0]?.id ?? null);
  const [creating, setCreating] = useState(products.length === 0);
  const [notice, setNotice] = useState<string | null>(null);

  const selected = creating ? null : (products.find((p) => p.id === selectedId) ?? products[0] ?? null);

  return (
    <div className="space-y-4">
      {products.length > 0 && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-[11px] font-medium tracking-label text-fg-muted uppercase">
              {products.length === 1 ? "Your product" : `Your products · ${products.length}`}
            </h2>
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
          <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3" aria-label="Products">
            {products.map((p) => {
              const s = stats[p.id];
              const isSelected = !creating && selected?.id === p.id;
              return (
                <li key={p.id}>
                  <article
                    className={[
                      "flex h-full flex-col rounded-lg border p-3 transition-colors duration-[120ms]",
                      isSelected ? "border-brand-border bg-brand-surface" : "border-line-subtle bg-surface",
                    ].join(" ")}
                  >
                    <button
                      type="button"
                      aria-pressed={isSelected}
                      onClick={() => {
                        setCreating(false);
                        setSelectedId(p.id);
                        setNotice(null);
                      }}
                      className="hl-focusable -m-1 rounded-md p-1 text-left"
                    >
                      <span className="block truncate text-[14px] font-medium text-fg">{p.name}</span>
                      {p.website && (
                        <span className="block truncate font-mono text-[11px] text-fg-muted">
                          {p.website.replace(/^https?:\/\//, "").replace(/\/$/, "")}
                        </span>
                      )}
                      <span className="mt-1.5 line-clamp-2 block text-[12px] leading-[1.5] text-fg-secondary">
                        {p.description || "No description yet — what it does is what every fit is judged against."}
                      </span>
                    </button>
                    <dl className="mt-2 space-y-0.5 text-[12px]">
                      <div className="flex min-w-0 gap-1.5">
                        <dt className="shrink-0 text-fg-muted">For</dt>
                        <dd className="min-w-0 truncate text-fg-secondary">
                          {s?.profiles.length ? s.profiles.join(", ") : "No customer profile bound yet"}
                        </dd>
                      </div>
                    </dl>
                    <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 pt-2 text-[12px]">
                      <Link
                        href={`/${org}/opportunities?product=${p.id}`}
                        className="hl-focusable rounded-sm text-brand-text underline-offset-2 hover:underline"
                      >
                        {s?.open ?? 0} open {s?.open === 1 ? "opportunity" : "opportunities"} →
                      </Link>
                      {!s?.profiles.length && (
                        <Link
                          href={`/${org}/settings/icp`}
                          className="hl-focusable rounded-sm text-fg-muted underline-offset-2 hover:underline"
                        >
                          Bind a profile
                        </Link>
                      )}
                    </div>
                  </article>
                </li>
              );
            })}
          </ul>
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
