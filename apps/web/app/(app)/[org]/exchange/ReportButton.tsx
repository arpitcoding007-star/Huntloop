"use client";

import { useState, useTransition } from "react";
import { Button, Field, FormMessage, Select, Textarea } from "@huntloop/ui";
import { Flag } from "lucide-react";
import { REPORT_REASONS, type ReportSubject } from "../../../../lib/exchange/report";
import { reportAction } from "./actions";

type Result = { ok: true; message?: string } | { ok: false; error: string } | null;

/**
 * Report something on the Exchange (build plan DN-32). Quiet by design — a
 * small link, not a button competing with the real actions — and honest about
 * what happens next: a person reads it, nothing is decided automatically, and
 * the other side is not told who reported them.
 */
export function ReportButton({ org, subject, subjectId, label = "Report" }: { org: string; subject: ReportSubject; subjectId: string; label?: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [detail, setDetail] = useState("");
  const [pending, start] = useTransition();
  const [result, setResult] = useState<Result>(null);

  if (result?.ok) return <FormMessage result={result} />;
  if (!open) {
    return (
      <Button type="button" size="sm" variant="ghost" icon={Flag} onClick={() => setOpen(true)}>
        {label}
      </Button>
    );
  }
  return (
    <form
      className="mt-2 w-full space-y-2 rounded-md border border-line p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!reason) return;
        start(async () => {
          const res = await reportAction(org, subject, subjectId, reason, detail);
          setResult(res.ok ? { ok: true, message: res.message } : { ok: false, error: res.error });
        });
      }}
    >
      <Field label="What is wrong?">
        {(p) => (
          <Select {...p} value={reason} onChange={(e) => setReason(e.target.value)}>
            <option value="">Choose…</option>
            {REPORT_REASONS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field label="Anything that helps us check (optional)">
        {(p) => <Textarea {...p} rows={2} maxLength={1000} value={detail} onChange={(e) => setDetail(e.target.value)} />}
      </Field>
      <div className="flex gap-2">
        <Button type="submit" size="sm" variant="danger" disabled={pending || !reason} pending={pending ? "Sending…" : undefined}>
          Send report
        </Button>
        <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
      <FormMessage result={result} />
    </form>
  );
}
