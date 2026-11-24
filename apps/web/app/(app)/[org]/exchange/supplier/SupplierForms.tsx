"use client";

import { useState, useTransition } from "react";
import { Badge, Button, Card, CardHeader, ConfirmButton, EmptyState, Field, FormMessage, Input, Note, Select, Textarea } from "@huntloop/ui";
import { Package, Pencil, Plus, Trash2 } from "lucide-react";
import type { EvidenceView, ExchangeCategory, OfferingView, ProviderProfile, SupplierView } from "../../../../../lib/data/exchange";
import { AVAILABILITY_LABEL, formatPriceRange, placeLabel } from "../../../../../lib/exchange/format";
import { COUNTRY_CODES, countryName, CURRENCIES } from "../../../../../lib/exchange/requirement";
import {
  addEvidenceAction,
  deleteEvidenceAction,
  deleteOfferingAction,
  saveOfferingAction,
  saveProviderProfileAction,
} from "../actions";

type Result = { ok: true; message?: string } | { ok: false; error: string } | null;

export function ProfileForm({ org, profile, canEdit }: { org: string; profile: ProviderProfile | null; canEdit: boolean }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<Result>(null);

  return (
    <Card>
      <CardHeader
        title="Profile"
        description={profile ? "How buyers see your business." : "Create the profile buyers will see next to your offerings."}
      />
      <form
        className="mt-4 space-y-4"
        action={(form) =>
          start(async () => {
            const res = await saveProviderProfileAction(org, form);
            setResult(res.ok ? { ok: true, message: res.message } : { ok: false, error: res.error });
          })
        }
      >
        {profile && <input type="hidden" name="id" value={profile.id} />}
        <fieldset disabled={!canEdit || pending} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" required>
              {(p) => <Input {...p} name="name" defaultValue={profile?.name ?? ""} maxLength={200} />}
            </Field>
            <Field label="Kind">
              {(p) => (
                <Select {...p} name="kind" defaultValue={profile?.kind ?? "company"}>
                  <option value="company">Company</option>
                  <option value="individual">Individual</option>
                </Select>
              )}
            </Field>
            <Field label="Website domain" hint="e.g. example.com">
              {(p) => <Input {...p} name="domain" defaultValue={profile?.domain ?? ""} />}
            </Field>
            <Field label="Based in">
              {(p) => (
                <Select {...p} name="country" defaultValue={profile?.country ?? ""}>
                  <option value="">Not stated</option>
                  {COUNTRY_CODES.map((c) => (
                    <option key={c} value={c}>
                      {countryName(c)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
          <Field label="About">
            {(p) => <Textarea {...p} name="description" rows={3} defaultValue={profile?.description ?? ""} maxLength={2000} />}
          </Field>
        </fieldset>
        <FormMessage result={result} />
        {canEdit ? (
          <Button type="submit" variant="primary" disabled={pending} pending={pending ? "Saving…" : undefined}>
            {profile ? "Save profile" : "Create profile"}
          </Button>
        ) : (
          <p className="text-[12px] text-fg-muted">Only an owner or admin can change the supplier profile.</p>
        )}
      </form>
    </Card>
  );
}

export function OfferingsEditor({
  org,
  offerings,
  categories,
  products,
  canEdit,
}: {
  org: string;
  offerings: OfferingView[];
  categories: ExchangeCategory[];
  products: SupplierView["products"];
  canEdit: boolean;
}) {
  const [editing, setEditing] = useState<OfferingView | "new" | null>(null);
  const [result, setResult] = useState<Result>(null);
  const [pending, start] = useTransition();

  return (
    <Card>
      <CardHeader
        title="Offerings"
        description="Only active offerings are matched. Stated availability is trusted for 30 days, then reads unknown until you update it."
        actions={
          canEdit && editing === null ? (
            <Button size="sm" variant="secondary" icon={Plus} onClick={() => setEditing("new")}>
              Add offering
            </Button>
          ) : undefined
        }
      />
      <div className="mt-4 space-y-3">
        <FormMessage result={result} />
        {editing !== null && (
          <OfferingForm
            org={org}
            offering={editing === "new" ? null : editing}
            categories={categories}
            products={products}
            onDone={(r) => {
              setResult(r);
              if (r?.ok) setEditing(null);
            }}
            onCancel={() => setEditing(null)}
          />
        )}
        {offerings.length === 0 && editing === null ? (
          <EmptyState icon={Package} title="No offerings yet" description="Add what you sell, where you deliver, and at what price." />
        ) : (
          offerings.map((o) => {
            const category = categories.find((c) => c.id === o.categoryId);
            const stale =
              o.availabilityAsOf && Date.now() - new Date(o.availabilityAsOf).getTime() > 30 * 86_400_000;
            return (
              <div key={o.id} className="rounded-md border border-line p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[14px] font-semibold text-fg">{o.title}</p>
                    <p className="mt-0.5 text-[12px] text-fg-muted">
                      {o.categoryPath ?? "Uncategorised"}
                      {formatPriceRange(o.priceFrom, o.priceTo, o.currency) ? ` · ${formatPriceRange(o.priceFrom, o.priceTo, o.currency)}` : ""}
                      {o.moq !== null ? ` · min. order ${o.moq.toLocaleString("en")}` : ""}
                      {` · ${o.servesGlobal ? "worldwide" : o.servesCountries.map((c) => placeLabel(c)).join(", ") || "no delivery area stated"}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={o.status === "active" ? "success" : "neutral"}>
                      {o.status === "active" ? "Listed" : o.status === "paused" ? "Paused" : "Draft"}
                    </Badge>
                    {o.availability && (
                      <Badge variant={stale ? "warning" : "info"}>
                        {AVAILABILITY_LABEL[o.availability] ?? o.availability}
                        {stale ? " · out of date" : ""}
                      </Badge>
                    )}
                    {category && !category.matchingEnabled && o.status === "active" && (
                      <Badge variant="warning">Matching not open yet</Badge>
                    )}
                  </div>
                </div>
                <EvidenceEditor org={org} offeringId={o.id} evidence={o.evidence} canEdit={canEdit} />
                {canEdit && (
                  <div className="mt-3 flex items-center gap-2">
                    <Button size="sm" variant="ghost" icon={Pencil} disabled={pending} onClick={() => setEditing(o)}>
                      Edit
                    </Button>
                    <ConfirmButton
                      size="sm"
                      icon={Trash2}
                      label={`Remove ${o.title}`}
                      confirmLabel="Remove"
                      disabled={pending}
                      pending={pending}
                      onConfirm={() =>
                        start(async () => {
                          const res = await deleteOfferingAction(org, o.id);
                          setResult(res.ok ? { ok: true, message: res.message } : { ok: false, error: res.error });
                        })
                      }
                    />
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </Card>
  );
}

function OfferingForm({
  org,
  offering,
  categories,
  products,
  onDone,
  onCancel,
}: {
  org: string;
  offering: OfferingView | null;
  categories: ExchangeCategory[];
  products: SupplierView["products"];
  onDone: (r: Result) => void;
  onCancel: () => void;
}) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<Result>(null);
  const [categoryId, setCategoryId] = useState(offering?.categoryId ?? "");
  const [productId, setProductId] = useState(offering?.productId ?? "");
  const [title, setTitle] = useState(offering?.title ?? "");
  const [description, setDescription] = useState(offering?.description ?? "");
  const regulated = categories.find((c) => c.id === categoryId)?.regulated;

  return (
    <form
      className="space-y-4 rounded-md border border-line-strong p-4"
      action={(form) =>
        start(async () => {
          const res = await saveOfferingAction(org, form);
          const r: Result = res.ok ? { ok: true, message: res.message } : { ok: false, error: res.error };
          setResult(r);
          onDone(r);
        })
      }
    >
      {offering && <input type="hidden" name="id" value={offering.id} />}
      {products.length > 0 && (
        <Field label="From one of your products" hint="Fills the title and description from what Huntloop already knows about it. Edit before saving.">
          {(p) => (
            <Select
              {...p}
              name="product_id"
              value={productId}
              onChange={(e) => {
                setProductId(e.target.value);
                const product = products.find((x) => x.id === e.target.value);
                if (product) {
                  if (!title.trim()) setTitle(product.name);
                  if (!description.trim() && product.description) setDescription(product.description);
                }
              }}
            >
              <option value="">Not linked to a product</option>
              {products.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Title" required>
          {(p) => <Input {...p} name="title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />}
        </Field>
        <Field label="Category">
          {(p) => (
            <Select {...p} name="category_id" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">Choose a category…</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.path}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      {regulated && (
        <Note tone="warning">
          This is a regulated category. Listing here means you hold the licences and meet the export rules that apply to it.
        </Note>
      )}
      <Field label="Description">
        {(p) => (
          <Textarea {...p} name="description" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={4000} />
        )}
      </Field>
      <div className="grid gap-4 sm:grid-cols-4">
        <Field label="Pricing">
          {(p) => (
            <Select {...p} name="price_model" defaultValue={offering?.priceModel ?? ""}>
              <option value="">Not stated</option>
              <option value="fixed">Fixed price</option>
              <option value="range">Price range</option>
              <option value="quote">On quote</option>
              <option value="subscription">Subscription</option>
              <option value="hourly">Hourly</option>
            </Select>
          )}
        </Field>
        <Field label="Price from">
          {(p) => <Input {...p} name="price_from" inputMode="decimal" defaultValue={offering?.priceFrom ?? ""} />}
        </Field>
        <Field label="Price to">
          {(p) => <Input {...p} name="price_to" inputMode="decimal" defaultValue={offering?.priceTo ?? ""} />}
        </Field>
        <Field label="Currency">
          {(p) => (
            <Select {...p} name="currency" defaultValue={offering?.currency ?? ""}>
              <option value="">None</option>
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Minimum order">
          {(p) => <Input {...p} name="moq" inputMode="decimal" defaultValue={offering?.moq ?? ""} />}
        </Field>
        <Field label="Availability" hint="Dated today when saved.">
          {(p) => (
            <Select {...p} name="availability" defaultValue={offering?.availability ?? ""}>
              <option value="">Not stated</option>
              {Object.entries(AVAILABILITY_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Status">
          {(p) => (
            <Select {...p} name="status" defaultValue={offering?.status ?? "draft"}>
              <option value="draft">Draft — not matched</option>
              <option value="active">Listed — matched with buyers</option>
              <option value="paused">Paused</option>
            </Select>
          )}
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-[auto_1fr] sm:items-end">
        <label className="flex items-center gap-2 text-[13px] text-fg">
          <input type="checkbox" name="serves_global" defaultChecked={offering?.servesGlobal ?? false} />
          Serves worldwide
        </label>
        <Field label="Or the countries you serve" hint="Two-letter codes, e.g. DE, FR, US.">
          {(p) => <Input {...p} name="serves_countries" defaultValue={offering?.servesCountries.join(", ") ?? ""} />}
        </Field>
      </div>
      <FormMessage result={result?.ok ? null : result} />
      <div className="flex gap-2">
        <Button type="submit" variant="primary" disabled={pending} pending={pending ? "Saving…" : undefined}>
          {offering ? "Save offering" : "Add offering"}
        </Button>
        <Button type="button" variant="ghost" disabled={pending} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/**
 * Public proof behind one offering (DN-26). A "published" fact links the page
 * that shows it; without a page it is saved as the supplier's own claim, and
 * buyers see it labelled that way. Matching cites these against a buyer's
 * must-haves.
 */
function EvidenceEditor({
  org,
  offeringId,
  evidence,
  canEdit,
}: {
  org: string;
  offeringId: string;
  evidence: EvidenceView[];
  canEdit: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const [pending, start] = useTransition();
  const [result, setResult] = useState<Result>(null);
  const [kind, setKind] = useState<"fact" | "inference">("fact");

  return (
    <div className="mt-3 border-t border-line-subtle pt-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[12px] font-semibold text-fg-muted">
          Evidence {evidence.length ? `(${evidence.length})` : "— none yet"}
        </p>
        {canEdit && !adding && (
          <Button size="sm" variant="ghost" icon={Plus} onClick={() => setAdding(true)}>
            Add evidence
          </Button>
        )}
      </div>
      {evidence.length > 0 && (
        <ul className="mt-2 space-y-1 text-[12px]">
          {evidence.map((e) => (
            <li key={e.id} className="flex flex-wrap items-center gap-2">
              <Badge variant={e.kind === "fact" ? "success" : "neutral"}>{e.kind === "fact" ? "Published" : "Your claim"}</Badge>
              <span className="text-fg">{e.claim}</span>
              {e.sourceUrl && (
                <a href={e.sourceUrl} target="_blank" rel="noopener noreferrer nofollow" className="hl-focusable text-brand underline">
                  {e.sourceTitle ?? "source"}
                </a>
              )}
              {canEdit && (
                <ConfirmButton
                  size="sm"
                  icon={Trash2}
                  label={`Remove evidence: ${e.claim}`}
                  confirmLabel="Remove"
                  disabled={pending}
                  pending={pending}
                  onConfirm={() =>
                    start(async () => {
                      const res = await deleteEvidenceAction(org, e.id);
                      setResult(res.ok ? { ok: true, message: res.message } : { ok: false, error: res.error });
                    })
                  }
                />
              )}
            </li>
          ))}
        </ul>
      )}
      {adding && (
        <form
          className="mt-3 space-y-3"
          action={(form) =>
            start(async () => {
              const res = await addEvidenceAction(org, form);
              setResult(res.ok ? { ok: true, message: res.message } : { ok: false, error: res.error });
              if (res.ok) setAdding(false);
            })
          }
        >
          <input type="hidden" name="offering_id" value={offeringId} />
          <Field label="What it shows" hint="e.g. Listed as an NVIDIA Elite partner; 3-year warranty on all cards.">
            {(p) => <Input {...p} name="claim" maxLength={500} />}
          </Field>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Kind">
              {(p) => (
                <Select {...p} name="kind" value={kind} onChange={(e) => setKind(e.target.value === "inference" ? "inference" : "fact")}>
                  <option value="fact">Published on a page</option>
                  <option value="inference">Our own claim</option>
                </Select>
              )}
            </Field>
            <Field label="Page address" hint={kind === "fact" ? "Required for a published fact." : "Optional."}>
              {(p) => <Input {...p} name="source_url" inputMode="url" placeholder="https://" />}
            </Field>
            <Field label="Page title">
              {(p) => <Input {...p} name="source_title" maxLength={200} />}
            </Field>
          </div>
          <div className="flex gap-2">
            <Button type="submit" size="sm" variant="primary" disabled={pending} pending={pending ? "Saving…" : undefined}>
              Save evidence
            </Button>
            <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => setAdding(false)}>
              Cancel
            </Button>
          </div>
        </form>
      )}
      <FormMessage result={result} className="mt-2" />
    </div>
  );
}
