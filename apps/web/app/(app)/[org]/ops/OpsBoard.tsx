"use client";

import { useState, useTransition } from "react";
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  Freshness,
  FormMessage,
  SectionLabel,
  StatCard,
  StatGrid,
} from "@huntloop/ui";
import { AlertTriangle, Activity, RotateCcw, XCircle } from "lucide-react";
import type { OpsSnapshot } from "../../../../lib/data/ops";
import { cancelJobAction, retryJobAction } from "./actions";

/**
 * What the engine is doing, and what it has given up on.
 *
 * ── Why the dead letters come first ──────────────────────────────────────
 *
 * The page is read under two circumstances: idle curiosity, and "nothing has
 * happened for two days". Only the second one matters, and in that case the
 * answer is almost always in this list. A dashboard that opens with throughput
 * charts and buries the failures below them is optimised for the reading that
 * does not need it.
 *
 * ── Why depth is reported as age ─────────────────────────────────────────
 *
 * A queue of four hundred that is thirty seconds old is healthy; a queue of
 * three that is six hours old is not. `0019`'s view computes the age precisely
 * so a screen does not have to infer health from a count, and this renders the
 * age with the count beside it rather than the other way round.
 */
export function OpsBoard({
  org,
  snapshot,
  canAdmin,
  engineRunning,
  lastTickAt,
  live,
  now,
}: {
  org: string;
  snapshot: OpsSnapshot;
  canAdmin: boolean;
  engineRunning: boolean;
  lastTickAt: string | null;
  live: boolean;
  now: string;
}) {
  const [result, setResult] = useState<
    { ok: true; message?: string } | { ok: false; error: string } | null
  >(null);

  const queued = snapshot.pressure?.queued ?? 0;
  const running = snapshot.pressure?.running ?? 0;
  const oldest = snapshot.health
    .filter((row) => row.status === "queued" && row.oldestDueSeconds !== null)
    .reduce<number | null>(
      (worst, row) => (worst === null || row.oldestDueSeconds! > worst ? row.oldestDueSeconds! : worst),
      null,
    );

  return (
    <div className="space-y-8 p-6 lg:p-8">
      <header>
        <h1 className="text-[24px] leading-8 font-semibold text-fg">Engine</h1>
        <p className="mt-1.5 max-w-[70ch] text-[13px] text-fg-muted">
          Every piece of work this product does is a job. This is what is
          waiting, what is running, and what has been given up on — which is the
          list that explains why something you expected has not happened.
        </p>
      </header>

      {!live && (
        <EmptyState
          icon={Activity}
          title="No engine to report on"
          description="This deployment has no database connected, so there are no jobs to read. Nothing here is fabricated for the demo."
        />
      )}

      {live && (
        <>
          {!engineRunning && (
            /* The most important sentence on the page when it is true. Without
               `CRON_SECRET` the tick endpoint refuses every caller, so work
               queues and is never claimed — and every other panel here would
               look like a backlog rather than like a stopped engine. */
            <Card>
              <CardBody>
                <div className="flex items-start gap-2.5">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" strokeWidth={1.75} />
                  <div>
                    <p className="text-[13px] font-medium text-fg">Nothing is running the queue</p>
                    <p className="mt-1 max-w-[70ch] text-[12px] text-fg-muted">
                      <code className="font-mono">CRON_SECRET</code> is not set on this deployment,
                      so the tick endpoint refuses every request. Work is being queued and nothing is
                      claiming it. Everything below is accurate and will stay frozen until that is
                      set.
                    </p>
                  </div>
                </div>
              </CardBody>
            </Card>
          )}

          <StatGrid>
            <StatCard label="Queued" value={String(queued)} hint={describeBacklog(oldest)} />
            <StatCard label="Running" value={String(running)} />
            <StatCard
              label="Given up on"
              value={String(snapshot.dead.length)}
              tone={snapshot.dead.length > 0 ? "warning" : undefined}
              hint={snapshot.dead.length > 0 ? "listed below" : "nothing failed"}
            />
            <StatCard
              label="Last tick"
              value={lastTickAt ? describeAge(lastTickAt, now) : "never"}
              hint={lastTickAt ? undefined : "the queue has never been drained"}
            />
          </StatGrid>

          <section>
            <SectionLabel>Given up on</SectionLabel>
            <p className="mt-2 max-w-[70ch] text-[12px] text-fg-muted">
              These used every attempt they had. Nothing will retry them on its own — that is what
              being here means. Retrying grants exactly one more attempt, not a fresh three.
            </p>

            <div className="mt-3 space-y-3">
              {snapshot.dead.length === 0 ? (
                <EmptyState
                  icon={Activity}
                  title="Nothing has failed"
                  description="Every job this organisation has run either succeeded or is still being retried."
                />
              ) : (
                snapshot.dead.map((job) => (
                  <Card key={job.id}>
                    <CardHeader
                      title={
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-[13px] text-fg">{job.jobName}</span>
                          <Badge variant="danger">
                            {job.attempts} of {job.maxAttempts} attempts
                          </Badge>
                          <Freshness date={job.updatedAt} now={now} />
                        </span>
                      }
                    />
                    <CardBody>
                      {/* The error verbatim. A constraint in this schema is
                          usually a product rule, and paraphrasing it into
                          "something went wrong" throws away the only
                          explanation there is. */}
                      <p className="font-mono text-[12px] break-words whitespace-pre-wrap text-fg-secondary">
                        {job.error ?? "No error was recorded, which is itself worth investigating."}
                      </p>

                      {Object.keys(job.payload).length > 0 && (
                        <p className="mt-2 font-mono text-[11px] break-words text-fg-muted">
                          {JSON.stringify(job.payload)}
                        </p>
                      )}

                      {canAdmin && (
                        <div className="mt-3 flex flex-wrap items-center gap-2">
                          <RetryButton org={org} jobId={job.id} onResult={setResult} />
                        </div>
                      )}
                    </CardBody>
                  </Card>
                ))
              )}
            </div>
          </section>

          <section>
            <SectionLabel>By job</SectionLabel>
            <p className="mt-2 max-w-[70ch] text-[12px] text-fg-muted">
              One row per kind of work and the state it is in. A large queue that is up to date is
              healthy; a small one that is hours behind is not.
            </p>

            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[520px] text-[13px]">
                <thead>
                  <tr className="border-b border-line text-left text-[11px] tracking-wide text-fg-muted uppercase">
                    <th className="py-2 pr-3 font-medium">Job</th>
                    <th className="py-2 pr-3 font-medium">State</th>
                    <th className="py-2 pr-3 text-right font-medium">Count</th>
                    <th className="py-2 pr-3 font-medium">Backlog</th>
                  </tr>
                </thead>
                <tbody>
                  {snapshot.health.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="py-4 text-fg-muted">
                        This organisation has not run any jobs yet.
                      </td>
                    </tr>
                  ) : (
                    snapshot.health.map((row) => (
                      <tr key={`${row.jobName}:${row.status}`} className="border-b border-line-soft">
                        <td className="py-2 pr-3 font-mono text-fg-secondary">{row.jobName}</td>
                        <td className="py-2 pr-3">
                          <Badge variant={badgeFor(row.status)}>{row.status}</Badge>
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums text-fg">{row.jobs}</td>
                        <td className="py-2 pr-3 text-fg-muted">
                          {row.status === "queued" ? describeBacklog(row.oldestDueSeconds) : "—"}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {snapshot.pressure?.shareOfQueue !== null &&
            snapshot.pressure !== null &&
            snapshot.pressure.shareOfQueue !== undefined &&
            snapshot.pressure.shareOfQueue > 0.8 &&
            queued > 50 && (
              /* `0019` names this as the scaling failure discovery makes likely:
                 one org's backlog is claimed ahead of everybody else's because
                 `claim_job_executions` orders by `run_at`. Nothing is broken and
                 nothing alerts — so it is said out loud here. */
              <Card>
                <CardBody>
                  <p className="text-[13px] font-medium text-fg">
                    This organisation is most of the queue
                  </p>
                  <p className="mt-1 max-w-[70ch] text-[12px] text-fg-muted">
                    {Math.round(snapshot.pressure.shareOfQueue * 100)}% of everything currently
                    queued belongs to this organisation. Work is claimed oldest-first across all
                    tenants, so a backlog this shape delays everyone else until it drains.
                  </p>
                </CardBody>
              </Card>
            )}

          {result && <FormMessage result={result} />}
        </>
      )}
    </div>
  );
}

function RetryButton({
  org,
  jobId,
  onResult,
}: {
  org: string;
  jobId: string;
  onResult: (r: { ok: true; message?: string } | { ok: false; error: string }) => void;
}) {
  const [pending, start] = useTransition();

  return (
    <>
      <Button
        size="sm"
        variant="secondary"
        icon={RotateCcw}
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = await retryJobAction(org, jobId);
            onResult(res.ok ? { ok: true, message: res.message } : { ok: false, error: res.error });
          })
        }
      >
        {pending ? "Queueing…" : "Retry once"}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        icon={XCircle}
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = await cancelJobAction(org, jobId);
            onResult(res.ok ? { ok: true, message: res.message } : { ok: false, error: res.error });
          })
        }
      >
        Cancel
      </Button>
    </>
  );
}

function badgeFor(status: string): "neutral" | "success" | "warning" | "danger" {
  if (status === "succeeded") return "success";
  if (status === "failed") return "danger";
  if (status === "running") return "warning";
  return "neutral";
}

/**
 * How long a backlog has been waiting, as a sentence.
 *
 * A queue of four hundred that is thirty seconds old is healthy; a queue of
 * three that is six hours old is not. `0019`'s view computes the age precisely
 * so a screen does not have to infer health from a count.
 *
 * Here rather than beside the loader because the loader is `server-only` and
 * this is rendered by a client component. Types cross that boundary — they are
 * erased — and functions do not.
 */
function describeBacklog(seconds: number | null): string {
  if (seconds === null) return "nothing waiting";
  if (seconds < 90) return "up to date";
  if (seconds < 3600) return `${Math.round(seconds / 60)} minutes behind`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)} hours behind`;
  return `${Math.round(seconds / 86_400)} days behind`;
}

/**
 * How long ago something happened, in the units that matter here.
 *
 * `elapsedLabel` from the UI package rounds to whole days, which is right for
 * an evidence date and useless for a queue tick: "today" is its answer whether
 * the engine ran nine seconds ago or nine hours ago, and the difference between
 * those two is the entire question this screen exists to answer.
 */
function describeAge(at: string, now: string): string {
  const seconds = Math.max(0, (new Date(now).getTime() - new Date(at).getTime()) / 1000);
  if (seconds < 90) return "just now";
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)}h ago`;
  return `${Math.round(seconds / 86_400)}d ago`;
}
