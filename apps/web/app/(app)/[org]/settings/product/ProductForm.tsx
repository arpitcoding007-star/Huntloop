"use client";

import { useState, useTransition } from "react";
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  Field,
  FormMessage,
  Input,
  ListInput,
  Textarea,
  joinList,
  splitList,
} from "@huntloop/ui";
import { Save, Trash2 } from "lucide-react";
import type { Product } from "../../../../../lib/data/product";
import { deleteProductAction, saveProductAction } from "./actions";

/**
 * The product editor — master context §8.
 *
 * Controlled inputs plus `useTransition` rather than `useActionState`: the
 * delete button and the save button are two actions against one form, and
 * `useActionState` binds a form to exactly one. The pending flag has to cover
 * both or the second one looks inert while it runs.
 *
 * `canWrite` is passed rather than inferred. A viewer gets the same screen
 * with the controls replaced by an explanation — hiding the form entirely
 * would leave them unable to read the product their opportunities are scored
 * against, which is information they are entitled to.
 */
export function ProductForm({
  org,
  product,
  canWrite,
}: {
  org: string;
  product: Product | null;
  canWrite: boolean;
}) {
  const [name, setName] = useState(product?.name ?? "");
  const [website, setWebsite] = useState(product?.website ?? "");
  const [description, setDescription] = useState(product?.description ?? "");
  const [valueProps, setValueProps] = useState(joinList(product?.valueProps));
  const [proofPoints, setProofPoints] = useState(joinList(product?.proofPoints));

  const [result, setResult] = useState<
    { ok: true; message?: string } | { ok: false; error: string } | null
  >(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();

  function save() {
    setResult(null);
    setFieldErrors({});
    start(async () => {
      const res = await saveProductAction(org, {
        id: product?.id && !product.id.startsWith("demo-") ? product.id : undefined,
        name,
        website,
        description,
        valueProps: splitList(valueProps),
        proofPoints: splitList(proofPoints),
      });
      if (res.ok) setResult({ ok: true, message: res.message });
      else {
        setResult({ ok: false, error: res.error });
        setFieldErrors(res.fieldErrors ?? {});
      }
    });
  }

  function remove() {
    if (!product?.id) return;
    setResult(null);
    start(async () => {
      const res = await deleteProductAction(org, product.id);
      setResult(res.ok ? { ok: true, message: res.message } : { ok: false, error: res.error });
    });
  }

  return (
    <Card>
      <CardHeader
        title={product ? "Your product" : "Describe your product"}
        description="Everything downstream is judged against this — the ICP, what counts as a fit, and every why-now."
        actions={
          canWrite && product ? (
            <Button
              variant="ghost"
              size="sm"
              icon={Trash2}
              onClick={remove}
              disabled={pending}
            >
              Remove
            </Button>
          ) : null
        }
      />
      <CardBody className="space-y-5">
        {!canWrite && (
          <p className="rounded-md border border-line bg-surface px-3 py-2 text-[13px] text-fg-muted">
            Your role is read-only. You can see what your opportunities are scored
            against, but not change it.
          </p>
        )}

        <Field label="Name" required error={fieldErrors.name}>
          {(a) => (
            <Input
              {...a}
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={!canWrite || pending}
              placeholder="What you sell"
            />
          )}
        </Field>

        <Field
          label="Website"
          hint="Used when researching how you're positioned."
          error={fieldErrors.website}
        >
          {(a) => (
            <Input
              {...a}
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
              disabled={!canWrite || pending}
              placeholder="https://example.com"
            />
          )}
        </Field>

        <Field
          label="What it does"
          hint="Plain language. This is the sentence every qualification judgement is made against."
          error={fieldErrors.description}
        >
          {(a) => (
            <Textarea
              {...a}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={!canWrite || pending}
              rows={3}
            />
          )}
        </Field>

        <Field
          label="Value propositions"
          hint="One per line."
          error={fieldErrors.valueProps}
        >
          {(a) => (
            <ListInput
              {...a}
              value={valueProps}
              onChange={(e) => setValueProps(e.target.value)}
              disabled={!canWrite || pending}
              rows={4}
            />
          )}
        </Field>

        <Field
          label="Proof points"
          hint="Customers, numbers, results — one per line. Outreach cites these rather than inventing them."
          error={fieldErrors.proofPoints}
        >
          {(a) => (
            <ListInput
              {...a}
              value={proofPoints}
              onChange={(e) => setProofPoints(e.target.value)}
              disabled={!canWrite || pending}
              rows={4}
            />
          )}
        </Field>

        <FormMessage result={result} />

        {canWrite && (
          <div className="flex items-center gap-2">
            <Button variant="primary" icon={Save} onClick={save} disabled={pending}>
              {pending ? "Saving…" : product ? "Save changes" : "Create product"}
            </Button>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
