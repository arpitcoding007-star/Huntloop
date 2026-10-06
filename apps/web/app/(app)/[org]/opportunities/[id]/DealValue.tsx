"use client";

import { useState, useTransition } from "react";
import { Button, Card, CardBody, CardHeader, Field, FormMessage, Input } from "@huntloop/ui";
import { setDealValueAction } from "./brief-actions";

/**
 * Optional deal value (0040). Typed by a person, never estimated: it is what
 * Performance sums for pipeline value, so a number nobody said would be a
 * number nobody can defend.
 */
export function DealValue({
  org,
  opportunityId,
  cents,
  canWrite,
}: {
  org: string;
  opportunityId: string;
  cents: number | null;
  canWrite: boolean;
}) {
  const [value, setValue] = useState(cents === null ? "" : String(Math.round(cents / 100)));
  const [result, setResult] = useState<{ ok: true; message?: string } | { ok: false; error: string } | null>(null);
  const [pending, start] = useTransition();
  const demo = opportunityId.startsWith("demo") || !/^[0-9a-f-]{36}$/i.test(opportunityId);

  return (
    <Card flush>
      <CardHeader title="Deal value" description="Optional. What this would be worth if it closes." />
      <CardBody className="space-y-3">
        {canWrite && !demo ? (
          <>
            <Field label="Amount (USD)">
              {(a) => (
                <Input
                  {...a}
                  inputMode="decimal"
                  placeholder="25000 or 25k"
                  value={value}
                  disabled={pending}
                  onChange={(e) => setValue(e.target.value)}
                />
              )}
            </Field>
            <Button
              size="sm"
              variant="secondary"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const res = await setDealValueAction(org, opportunityId, value);
                  if (res.ok) {
                    setValue(res.data.cents === null ? "" : String(Math.round(res.data.cents / 100)));
                    setResult({ ok: true, message: res.message });
                  } else setResult({ ok: false, error: res.error });
                })
              }
            >
              {pending ? "Saving…" : "Save value"}
            </Button>
            <FormMessage result={result} />
          </>
        ) : (
          <p className="text-[13px] text-fg-secondary">
            {cents === null ? "Not set." : `$${Math.round(cents / 100).toLocaleString()}`}
          </p>
        )}
      </CardBody>
    </Card>
  );
}
