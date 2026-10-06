"use client";

import { useState, useTransition } from "react";
import { Button, Card, CardBody, CardHeader, Field, FormMessage, Input } from "@huntloop/ui";
import { Pencil } from "lucide-react";
import type { GoalProgress } from "../../../../lib/performance/compute";
import { saveGoalsAction } from "./actions";

/**
 * Your pace against the workspace's goals.
 *
 * Pace rather than a percentage of the goal alone: 6 of 20 touches is behind
 * on a Friday and ahead on a Monday, and a bar that ignores the day of the
 * week tells people they are failing at nine in the morning.
 */
export function GoalsCard({
  org,
  goals,
  progress,
  canAdmin,
}: {
  org: string;
  goals: { touchesPerWeek: number | null; meetingsPerMonth: number | null };
  progress: GoalProgress;
  canAdmin: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [touches, setTouches] = useState(goals.touchesPerWeek?.toString() ?? "");
  const [meetings, setMeetings] = useState(goals.meetingsPerMonth?.toString() ?? "");
  const [result, setResult] = useState<{ ok: true; message?: string } | { ok: false; error: string } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();

  return (
    <Card flush>
      <CardHeader
        title="Your pace"
        description="Outbound touches you made this week, and meetings on accounts you own this month."
        actions={
          canAdmin && !editing ? (
            <Button size="sm" variant="ghost" icon={Pencil} onClick={() => setEditing(true)}>
              {goals.touchesPerWeek || goals.meetingsPerMonth ? "Edit goals" : "Set goals"}
            </Button>
          ) : undefined
        }
      />
      <CardBody className="space-y-4">
        <Pace
          label="Touches this week"
          value={progress.touchesThisWeek}
          goal={goals.touchesPerWeek}
          elapsed={progress.weekElapsed}
        />
        <Pace
          label="Meetings this month"
          value={progress.meetingsThisMonth}
          goal={goals.meetingsPerMonth}
          elapsed={progress.monthElapsed}
        />

        {editing && (
          <div className="flex flex-wrap items-end gap-3 rounded-md border border-line bg-canvas p-3">
            <Field label="Touches per week, per person" error={errors.touchesPerWeek} className="w-[200px]">
              {(f) => (
                <Input {...f} type="number" min={1} max={500} value={touches} disabled={pending} onChange={(e) => setTouches(e.target.value)} />
              )}
            </Field>
            <Field label="Meetings per month, per person" error={errors.meetingsPerMonth} className="w-[220px]">
              {(f) => (
                <Input {...f} type="number" min={1} max={200} value={meetings} disabled={pending} onChange={(e) => setMeetings(e.target.value)} />
              )}
            </Field>
            <div className="flex items-center gap-2 pb-0.5">
              <Button
                size="sm"
                variant="primary"
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    const res = await saveGoalsAction(org, {
                      touchesPerWeek: touches.trim() ? Number(touches) : null,
                      meetingsPerMonth: meetings.trim() ? Number(meetings) : null,
                    });
                    setResult(res.ok ? { ok: true, message: res.message } : { ok: false, error: res.error });
                    setErrors(res.ok ? {} : (res.fieldErrors ?? {}));
                    if (res.ok) setEditing(false);
                  })
                }
              >
                {pending ? "Saving…" : "Save"}
              </Button>
              <Button size="sm" variant="ghost" disabled={pending} onClick={() => setEditing(false)}>
                Cancel
              </Button>
            </div>
          </div>
        )}
        <FormMessage result={result} />
      </CardBody>
    </Card>
  );
}

function Pace({
  label,
  value,
  goal,
  elapsed,
}: {
  label: string;
  value: number;
  goal: number | null;
  elapsed: number;
}) {
  if (!goal) {
    return (
      <div>
        <div className="flex items-baseline justify-between">
          <span className="text-[13px] text-fg-secondary">{label}</span>
          <span className="hl-tabular text-[15px] text-fg">{value}</span>
        </div>
        <p className="text-[12px] text-fg-muted">No goal set.</p>
      </div>
    );
  }
  const expected = Math.round(goal * elapsed);
  const ahead = value >= expected;
  const width = Math.min(100, Math.round((value / goal) * 100));
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-[13px] text-fg-secondary">{label}</span>
        <span className="hl-tabular text-[15px] text-fg">
          {value} <span className="text-[12px] text-fg-muted">of {goal}</span>
        </span>
      </div>
      <div
        className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-line-subtle"
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={goal}
        aria-valuenow={value}
      >
        <div className={ahead ? "h-full bg-success" : "h-full bg-warning"} style={{ width: `${width}%` }} />
      </div>
      <p className="mt-1 text-[12px] text-fg-muted">
        {ahead ? "On pace" : "Behind pace"} — about {expected} by now for an even pace.
      </p>
    </div>
  );
}
