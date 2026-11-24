"use client";

import { useState, useTransition } from "react";
import { Badge, Button, Card, CardHeader, ConfirmButton, EmptyState, Field, FormMessage, Input, Note, Select, Textarea } from "@huntloop/ui";
import { Package, Pencil, Plus, Trash2 } from "lucide-react";
import type { ExchangeCategory, OfferingView, ProviderProfile } from "../../../../../lib/data/exchange";
import { AVAILABILITY_LABEL, formatPriceRange, placeLabel } from "../../../../../lib/exchange/format";
import { COUNTRY_CODES, countryName, CURRENCIES } from "../../../../../lib/exchange/requirement";
import { deleteOfferingAction, saveOfferingAction, saveProviderProfileAction } from "../actions";

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
  canEdit,
}: {
  org: string;
  offerings: OfferingView[];
  categories: ExchangeCategory[];
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
  onDone,
  onCancel,
}: {
  org: string;
  offering: OfferingView | null;
  categories: ExchangeCategory[];
  onDone: (r: Result) => void;
  onCancel: () => void;
}) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<Result>(null);
  const [categoryId, setCategoryId] = useState(offering?.categoryId ?? "");
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
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Title" required>
          {(p) => <Input {...p} name="title" defaultValue={offering?.title ?? ""} maxLength={200} />}
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
        {(p) => <Textarea {...p} name="description" rows={3} defaultValue={offering?.description ?? ""} maxLength={4000} />}
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
