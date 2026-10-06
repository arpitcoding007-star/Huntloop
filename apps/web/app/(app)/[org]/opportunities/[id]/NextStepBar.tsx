"use client";

import { useState, useTransition } from "react";
import { Button, Field, FormMessage, Input, SectionLabel } from "@huntloop/ui";
import { CalendarClock, Check, Pencil, X } from "lucide-react";
import type { NextAction } from "../../../../../lib/needs-you/next-action";
import { clearNextStepAction, setNextStepAction } from "./activity-actions";

/**
 * "What next" — directly under the verdict. COMMAND.md §16.3-C.
 *
 * Two layers, in a fixed order of authority: the person's own next step when
 * they have set one, otherwise the derived recommendation. Either way the
 * facts it rests on are listed beside it ("Based on"), so the recommendation
 * can be checked against the page rather than taken on trust.
 */

const TONE: Record<NextAction["tone"], string> = {
  neutral: "border-line-subtle bg-surface",
  info: "border-brand-border bg-brand-surface",
  warning: "border-warning-border bg-warning-surface",
  success: "border-success-border bg-success-surface",
};

type Result = { ok: true; message?: string } | { ok: false; error: string } | null;

export function NextStepBar({
  org,
  opportunityId,
  action,
  nextStep,
  canWrite,
}: {
  org: string;
  opportunityId: string;
  action: NextAction;
  nextStep: { text: string; dueAt: string | null } | null;
  canWrite: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [result, setResult] = useState<Result>(null);
  const [pending, start] = useTransition();

  const finish = (done: boolean) =>
    start(async () => {
      const res = await clearNextStepAction(org, opportunityId, done);
      setResult(res.ok ? { ok: true, message: res.message } : { ok: false, error: res.error });
    });

  return (
    <div className={`mt-5 rounded-lg border px-4 py-3 ${TONE[action.tone]}`}>
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
        <SectionLabel>{nextStep ? "Next step" : "Recommended"}</SectionLabel>
        <div className="min-w-0 flex-1">
          <p className="text-[14px] text-fg">{action.text}</p>
          {action.inputs.length > 0 && (
            <p className="mt-1 text-[12px] text-fg-muted">
              <span className="font-medium">Based on:</span> {action.inputs.join(" · ")}
            </p>
          )}
        </div>
        {canWrite && !editing && (
          <div className="flex shrink-0 flex-wrap items-center gap-1.5">
            {nextStep ? (
              <>
                <Button size="sm" variant="secondary" icon={Check} disabled={pending} onClick={() => finish(true)}>
                  Done
                </Button>
                <Button size="sm" variant="ghost" icon={Pencil} disabled={pending} onClick={() => setEditing(true)}>
                  Edit
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  icon={X}
                  disabled={pending}
                  onClick={() => finish(false)}
                  aria-label="Clear the next step"
                >
                  Clear
                </Button>
              </>
            ) : (
              <Button size="sm" variant="secondary" icon={CalendarClock} onClick={() => setEditing(true)}>
                Set next step
              </Button>
            )}
          </div>
        )}
      </div>

      {editing && (
        <NextStepForm
          org={org}
          opportunityId={opportunityId}
          initial={nextStep}
          onDone={(res) => {
            if (res) setResult(res);
            if (!res || res.ok) setEditing(false);
          }}
        />
      )}
      <FormMessage result={result} className="mt-2" />
    </div>
  );
}

/** Today's date in the viewer's zone, as `<input type="date">` wants it. */
function localDate(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** A local calendar date → the end of the working morning that day, as an instant. */
export function dueInstant(date: string): string | null {
  if (!date) return null;
  const [y, m, d] = date.split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d, 9, 0, 0).toISOString();
}

export function NextStepForm({
  org,
  opportunityId,
  initial,
  onDone,
}: {
  org: string;
  opportunityId: string;
  initial: { text: string; dueAt: string | null } | null;
  onDone: (result: Result) => void;
}) {
  const [text, setText] = useState(initial?.text ?? "");
  const [date, setDate] = useState(
    initial?.dueAt ? localDateOf(initial.dueAt) : localDate(2),
  );
  const [pending, start] = useTransition();
  const [errors, setErrors] = useState<Record<string, string>>({});

  return (
    <div className="mt-3 flex flex-wrap items-end gap-3">
      <Field label="Next step" error={errors.text} className="min-w-[240px] flex-1">
        {(field) => (
          <Input
            {...field}
            value={text}
            maxLength={280}
            disabled={pending}
            placeholder="Send the security brief"
            onChange={(e) => setText(e.target.value)}
          />
        )}
      </Field>
      <Field label="Due" error={errors.dueAt} className="w-[170px]">
        {(field) => (
          <Input {...field} type="date" value={date} disabled={pending} onChange={(e) => setDate(e.target.value)} />
        )}
      </Field>
      <div className="flex items-center gap-2 pb-0.5">
        <Button
          size="sm"
          variant="primary"
          disabled={pending}
          pending={text.trim() ? undefined : "Say what the next step is."}
          onClick={() =>
            start(async () => {
              const res = await setNextStepAction(org, opportunityId, { text, dueAt: dueInstant(date) });
              if (!res.ok) setErrors(res.fieldErrors ?? {});
              onDone(res.ok ? { ok: true, message: res.message } : { ok: false, error: res.error });
            })
          }
        >
          {pending ? "Saving…" : "Save"}
        </Button>
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => onDone(null)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function localDateOf(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
