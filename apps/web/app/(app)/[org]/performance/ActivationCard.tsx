import Link from "next/link";
import { Badge, Card, CardBody, CardHeader } from "@huntloop/ui";
import { CheckCircle2, Circle } from "lucide-react";
import type { ActivationSummary } from "../../../../lib/data/activation";

/**
 * "Is it working?" (ANL-301). The first time each step of the loop happened
 * for this workspace, and the last 30 days of outreach health.
 *
 * Every rate is shown as "—" when its denominator is zero: no sends means the
 * reply rate was not measured, which is different from a reply rate of 0%.
 */

const pct = (r: number | null) => (r === null ? "—" : `${Math.round(r * 100)}%`);
const date = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

export function ActivationCard({ summary }: { summary: ActivationSummary }) {
  const { steps, current } = summary;
  const reached = steps.filter((s) => s.at !== null).length;
  const nextStep = steps.find((s) => s.key === current) ?? null;

  return (
    <Card>
      <CardHeader
        title="Is the loop working?"
        description="When each step first happened in this workspace, and the last 30 days of outreach."
        actions={
          summary.activated ? (
            <Badge variant="success">Activated</Badge>
          ) : (
            <Badge variant="neutral">{`${reached} of ${steps.length} steps`}</Badge>
          )
        }
      />
      <CardBody>
        {/* Sized by the card, not the window: two sidebars leave a 1024 px window a ~550 px card. */}
        <div className="@container">
        <ol aria-label="Steps of the loop" className="grid gap-2 @md:grid-cols-3 @3xl:grid-cols-5">
          {steps.map((s) => {
            const done = s.at !== null;
            const isCurrent = s.key === current;
            return (
              <li
                key={s.key}
                className={[
                  "rounded-md border px-3 py-2",
                  isCurrent ? "border-brand-border bg-brand-surface" : "border-line-subtle",
                ].join(" ")}
              >
                <div className="flex items-center gap-1.5">
                  {done ? (
                    <CheckCircle2 className="size-4 shrink-0 text-success-text" strokeWidth={1.75} aria-hidden />
                  ) : (
                    <Circle className="size-4 shrink-0 text-fg-muted" strokeWidth={1.75} aria-hidden />
                  )}
                  <span className="text-[13px] font-medium text-fg">{s.label}</span>
                </div>
                <p className="mt-1 text-[12px] text-fg-muted">
                  {done ? (
                    <>
                      {date(s.at!)}
                      {s.key !== "signup" && s.daysFromSignup !== null && (
                        <> · day {s.daysFromSignup}</>
                      )}
                    </>
                  ) : (
                    isCurrent ? "Next" : "Not yet"
                  )}
                </p>
              </li>
            );
          })}
        </ol>

        {nextStep && (
          <p className="mt-3 text-[13px] text-fg-secondary">
            <span className="font-medium text-fg">Next: {nextStep.label.toLowerCase()}.</span> {nextStep.next}{" "}
            <Link href={nextStep.href} className="hl-focusable rounded-sm text-brand-text underline underline-offset-2">
              Go there
            </Link>
          </p>
        )}

        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-[13px] @md:grid-cols-3 @3xl:grid-cols-5">
          <div>
            <dt className="text-fg-muted">Sent, 30 days</dt>
            <dd className="hl-tabular text-fg">{summary.sent30d}</dd>
          </div>
          <div>
            <dt className="text-fg-muted">Replies, 30 days</dt>
            <dd className="hl-tabular text-fg">{summary.replies30d}</dd>
          </div>
          <div>
            <dt className="text-fg-muted">Reply rate</dt>
            <dd className="hl-tabular text-fg">{pct(summary.replyRate30d)}</dd>
          </div>
          <div>
            <dt className="text-fg-muted">AI drafts rejected</dt>
            <dd className="hl-tabular text-fg">
              {pct(summary.rejectionRate30d)}
              {summary.drafts30d > 0 && <span className="text-fg-muted"> of {summary.drafts30d}</span>}
            </dd>
          </div>
          <div>
            <dt className="text-fg-muted">Meetings, 30 days</dt>
            <dd className="hl-tabular text-fg">{summary.meetings30d}</dd>
          </div>
        </dl>
        </div>
      </CardBody>
    </Card>
  );
}
