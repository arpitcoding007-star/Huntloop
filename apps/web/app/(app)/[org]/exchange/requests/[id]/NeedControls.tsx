"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, ConfirmButton, Field, FormMessage, Select } from "@huntloop/ui";
import { CheckCircle2, Pause, Play, Trash2 } from "lucide-react";
import { VISIBILITY } from "../../../../../../lib/exchange/requirement";
import { deleteNeedAction, reconfirmNeedAction, updateNeedAction } from "../../actions";

type Result = { ok: true; message?: string } | { ok: false; error: string } | null;

export function NeedControls({
  org,
  needId,
  status,
  visibility,
}: {
  org: string;
  needId: string;
  status: string;
  visibility: number;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [result, setResult] = useState<Result>(null);
  const act = (fn: () => Promise<{ ok: true; message?: string } | { ok: false; error: string }>, after?: () => void) =>
    start(async () => {
      const res = await fn();
      setResult(res.ok ? { ok: true, message: res.message } : { ok: false, error: res.error });
      if (res.ok) after?.();
    });

  return (
    <Card>
      <div className="space-y-4">
        <Field label="Who may see it" hint={VISIBILITY.find((v) => v.level === visibility)?.detail}>
          {(p) => (
            <Select
              {...p}
              value={String(visibility)}
              disabled={pending}
              onChange={(e) => act(() => updateNeedAction(org, needId, { visibility: Number(e.target.value) }))}
            >
              {VISIBILITY.map((v) => (
                <option key={v.level} value={v.level}>
                  {v.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <div className="flex flex-wrap gap-2">
          {status === "open" ? (
            <Button size="sm" variant="secondary" icon={Pause} disabled={pending} onClick={() => act(() => updateNeedAction(org, needId, { status: "paused" }))}>
              Pause
            </Button>
          ) : (
            <Button size="sm" variant="secondary" icon={Play} disabled={pending} onClick={() => act(() => updateNeedAction(org, needId, { status: "open" }))}>
              Reopen
            </Button>
          )}
          {(status === "open" || status === "paused" || status === "expired") && (
            <Button size="sm" variant="secondary" icon={CheckCircle2} disabled={pending} onClick={() => act(() => reconfirmNeedAction(org, needId))}>
              Still needed
            </Button>
          )}
          {status !== "fulfilled" && (
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => act(() => updateNeedAction(org, needId, { status: "fulfilled" }))}>
              Mark fulfilled
            </Button>
          )}
        </div>
        <div className="flex items-center gap-2 text-[12px] text-fg-muted">
          <ConfirmButton
            size="sm"
            icon={Trash2}
            label="Remove this request"
            confirmLabel="Remove"
            disabled={pending}
            pending={pending}
            onConfirm={() => act(() => deleteNeedAction(org, needId), () => router.push(`/${org}/exchange`))}
          />
          Remove this request and its matches
        </div>
        <FormMessage result={result} />
      </div>
    </Card>
  );
}
