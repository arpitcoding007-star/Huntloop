"use client";

import { useState, useTransition } from "react";
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Field,
  Confirmed,
  FormMessage,
  Freshness,
  Input,
  SectionLabel,
  Select,
  StatusDot,
} from "@huntloop/ui";
import { AlertTriangle, Pause, Plus, RefreshCw, Save, Sparkles, Trash2 } from "lucide-react";
import type { HuntSource, HuntSources, SourceStatus } from "../../../../lib/data/hunt-source";
import type { SourceInput } from "./actions";
import {
  deleteSourceAction,
  restoreSourceAction,
  saveSourceAction,
  scanSourceNowAction,
  setScanIntervalAction,
  setSourceEnabledAction,
  suggestSourcesAction,
} from "./actions";

/**
 * Source management — master context §10, §58.
 *
 * §10 is explicit that the user accepts, removes and adds sources, and that
 * Huntloop's role is to *recommend* based on the ICP. So recommendations sit
 * in their own section with an accept action rather than being silently
 * switched on: a hunt the user did not choose the inputs for is a hunt they
 * cannot reason about, and §77 Principle 7 makes that control a requirement.
 *
 * The failure state is the other half. §58 says a source that fails must not
 * fail the hunt — it is marked unavailable, retried, and surfaced. A source
 * list that only ever shows green is lying by omission on the day it matters.
 *
 * ── What changed when this stopped being fixtures ────────────────────────
 *
 * The list, the statuses and the recommendations are now rows. Two numbers
 * that used to be here are gone rather than ported: "22 opportunities
 * produced" per source was invented, and the real quantity behind it —
 * evidence attributed to the source — is 0 for everything, because nothing
 * scans yet. Showing the true zero is the point. A fabricated 22 makes a
 * source list that has never run look like one that is working, which is the
 * §7 failure aimed at ourselves.
 */

const STATUS_META: Record<
  SourceStatus,
  { label: string; variant: "success" | "warning" | "danger" }
> = {
  ok: { label: "Healthy", variant: "success" },
  degraded: { label: "Degraded", variant: "warning" },
  unavailable: { label: "Unavailable", variant: "danger" },
};

const KIND_LABELS: Record<string, string> = {
  news: "News",
  blog: "Blog",
  jobs: "Jobs",
  social: "Social",
  github: "Code",
  funding: "Funding",
  regulatory: "Regulatory",
  community: "Community",
  podcast: "Podcast",
  custom: "Custom",
};

export function SourceManager({
  org,
  sources,
  canWrite,
  engineRunning,
  inngestDriving,
  lastTickAt,
  now,
}: {
  org: string;
  sources: HuntSources;
  canWrite: boolean;
  /**
   * Whether anything drains the queue on this deployment.
   *
   * Passed down rather than read here, because it comes from a server-only
   * environment variable. It decides whether "Scan now" is a control or an
   * explanation — a button that queues work into a queue nobody reads is
   * worse than a disabled one, because it reports success and the user waits.
   */
  engineRunning: boolean;
  /**
   * Whether Inngest is wired to drive the tick.
   *
   * Unlike `CRON_SECRET`, this one does imply a schedule: `/api/inngest`
   * refuses to serve unless both keys are present, and Inngest calls it on a
   * cadence it owns.
   */
  inngestDriving: boolean;
  /**
   * When the engine last did something for this org, or null if never.
   *
   * The observed fact, as opposed to the two configuration flags above. A row
   * in `job_executions` exists because a tick created it — see `lastTickAt`.
   */
  lastTickAt: string | null;
  /** The server's clock, so every relative age is measured from one instant. */
  now: string;
}) {
  /* Configured is not the same as running, and this is the difference.
     Inngest owns a schedule, so its presence is enough; otherwise the only
     honest evidence that something calls the tick is that something has. */
  const engineDriven = inngestDriving || lastTickAt !== null;

  const [adding, setAdding] = useState(false);
  /* The last removal, kept so it can be undone. One at a time: a stack of
     undos is a thing nobody reads, and the offer only makes sense for the
     action just taken. */
  const [removed, setRemoved] = useState<{ id: string; name: string } | null>(null);
  const [undoing, startUndo] = useTransition();

  const [result, setResult] = useState<
    { ok: true; message?: string } | { ok: false; error: string } | null
  >(null);
  const [suggesting, startSuggest] = useTransition();
  const [scanning, startScan] = useTransition();

  const { monitored, recommended } = sources;
  const failing = monitored.filter((s) => s.status !== "ok");

  return (
    <div className="mx-auto w-full max-w-[1200px] px-6 py-8 lg:px-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[30px] leading-9 font-semibold text-fg">Sources</h1>
          <p className="mt-1 text-[13px] text-fg-muted">
            {org} · {monitored.length} monitored · where Huntloop looks for signals
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* The scanner exists now, and this either starts it or says why it
              cannot. Every source is brought forward at once rather than one
              at a time: the person pressing this wants a hunt, not a source. */}
          {canWrite &&
            (engineDriven ? (
              <Button
                icon={RefreshCw}
                variant="secondary"
                disabled={scanning || monitored.length === 0}
                onClick={() =>
                  startScan(async () => {
                    setResult(null);
                    const outcomes = await Promise.all(
                      monitored.map((s) => scanSourceNowAction(org, s.id)),
                    );
                    const failed = outcomes.find((o) => !o.ok);
                    if (failed && !failed.ok) {
                      setResult({ ok: false, error: failed.error });
                      return;
                    }
                    const queued = outcomes.filter(
                      (o) => o.ok && o.data.queued,
                    ).length;
                    setResult({
                      ok: true,
                      message:
                        queued === 0
                          ? "Everything was already queued. The next tick reads them."
                          : `${queued} source${queued === 1 ? "" : "s"} queued. They are read on the next tick, within about five minutes.`,
                    });
                  })
                }
              >
                {scanning ? "Queueing…" : "Scan now"}
              </Button>
            ) : (
              <Button
                icon={RefreshCw}
                variant="secondary"
                pending={
                  engineRunning
                    ? "CRON_SECRET is set, so /api/jobs/tick would accept a caller — but nothing has called it and no job has ever run here. A queued scan would sit in the queue. Connect Inngest, or point a scheduler at it."
                    : "Nothing is running the scanner on this deployment. CRON_SECRET is not set, so /api/jobs/tick refuses every request and a queued scan would never be picked up."
                }
              >
                Scan now
              </Button>
            ))}
          {canWrite && (
            <Button icon={Plus} variant="primary" onClick={() => setAdding((a) => !a)}>
              Add a source
            </Button>
          )}
        </div>
      </header>

      {/* The state that explains every zero on this screen. Shown above the
          source list rather than beside one source, because it is a property of
          the deployment: with nothing draining the queue, every source reads
          "never scanned" and no amount of looking at an individual row says
          why.

          Two states, not one, and the second is the one that used to be
          missing. `CRON_SECRET` being set means `/api/jobs/tick` would accept
          a caller — it has never meant one exists. While a cron sat in
          `vercel.json` those were the same thing in practice; that cron is
          gone (OPS-04), so "configured and nothing is calling it" is now the
          ordinary state and the screen has to be able to say it. */}
      {monitored.length > 0 && !engineDriven && (
        <div className="mt-6 flex items-start gap-2.5 rounded-md border border-line bg-surface px-4 py-3">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-fg-muted" strokeWidth={1.75} />
          <div>
            <p className="text-[13px] text-fg">
              Nothing is reading these sources on a timer.
            </p>
            {engineRunning ? (
              <p className="mt-0.5 text-[12px] text-fg-secondary">
                <code className="font-mono">CRON_SECRET</code> is set, so{" "}
                <code className="font-mono">/api/jobs/tick</code> would accept a
                caller — but nothing has called it, and no job has ever run for
                this workspace. Setting the secret makes the endpoint reachable;
                it does not schedule anything. Connect Inngest, or point a
                scheduler at it.
              </p>
            ) : (
              <p className="mt-0.5 text-[12px] text-fg-secondary">
                The scanner runs from <code className="font-mono">/api/jobs/tick</code>,
                which refuses every request until <code className="font-mono">CRON_SECRET</code>{" "}
                is set on this deployment. Until then these sources are a list,
                not a hunt.
              </p>
            )}
          </div>
        </div>
      )}

      {/* §58, stated where it changes what the numbers mean: a degraded source
          silently returning fewer results would make the hunt look complete. */}
      {failing.length > 0 && (
        <div className="mt-6 flex items-start gap-2.5 rounded-md border border-warning-border bg-warning-surface px-4 py-3">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" strokeWidth={1.75} />
          <div>
            <p className="text-[13px] text-warning">
              {failing.length} of {monitored.length} sources are not returning full
              results.
            </p>
            <p className="mt-0.5 text-[12px] text-fg-secondary">
              The hunt continued without them and will retry. Treat this
              cycle&rsquo;s results as incomplete rather than as an empty market.
            </p>
          </div>
        </div>
      )}

      {adding && (
        <div className="mt-6">
          <SourceForm
            org={org}
            canWrite={canWrite}
            onDone={() => setAdding(false)}
          />
        </div>
      )}

      {removed && (
        <Confirmed
          className="mt-6"
          title={`${removed.name} removed.`}
          description="It stops being scanned, and the evidence it already produced stays where it is."
          pending={undoing}
          onUndo={() =>
            startUndo(async () => {
              const res = await restoreSourceAction(org, removed.id);
              setRemoved(null);
              if (!res.ok) setResult({ ok: false, error: res.error });
            })
          }
        />
      )}

      <FormMessage result={result} className="mt-6" />

      <section className="mt-8">
        <SectionLabel>Monitored</SectionLabel>
        <Card flush className="mt-3">
          {monitored.length === 0 ? (
            <CardBody>
              <p className="text-[13px] text-fg-muted">
                Nothing is being monitored. Add a source, or accept one of the
                suggestions below — until then a hunt has nowhere to look.
              </p>
            </CardBody>
          ) : (
            <ul className="divide-y divide-line-subtle">
              {monitored.map((s) => (
                <SourceRow
                  key={s.id}
                  org={org}
                  source={s}
                  canWrite={canWrite}
                  now={now}
                  onResult={setResult}
                  onRemoved={(id, name) => {
                    setResult(null);
                    setRemoved({ id, name });
                  }}
                />
              ))}
            </ul>
          )}
        </Card>
      </section>

      <section className="mt-8">
        <Card flush>
          <CardHeader
            title={
              <span className="flex items-center gap-2">
                <Sparkles className="size-4 text-ai" strokeWidth={1.75} />
                Recommended for your ICP
              </span>
            }
            description="Suggested, not enabled. Nothing is scanned until you accept it."
            actions={
              canWrite ? (
                <Button
                  size="sm"
                  variant="secondary"
                  icon={Sparkles}
                  disabled={suggesting}
                  onClick={() =>
                    startSuggest(async () => {
                      setResult(null);
                      const res = await suggestSourcesAction(org);
                      setResult(
                        res.ok
                          ? { ok: true, message: res.message }
                          : { ok: false, error: res.error },
                      );
                    })
                  }
                >
                  {suggesting ? "Asking…" : "Suggest sources"}
                </Button>
              ) : null
            }
          />
          <CardBody>
            {recommended.length === 0 ? (
              <p className="text-[13px] text-fg-muted">
                No suggestions waiting. Ask for some, or add your own with
                &ldquo;Add a source&rdquo;.
              </p>
            ) : (
              <ul className="space-y-3">
                {recommended.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[13px] font-medium text-fg">{r.name}</span>
                        <Badge variant="neutral">{KIND_LABELS[r.kind] ?? r.kind}</Badge>
                        {r.recommendedBy === "user" && (
                          <Badge variant="neutral">Paused by you</Badge>
                        )}
                      </div>
                      {r.url && (
                        <p className="mt-0.5 truncate font-mono text-[12px] text-fg-muted">
                          {r.url}
                        </p>
                      )}
                    </div>
                    <RecommendationActions
                      org={org}
                      source={r}
                      canWrite={canWrite}
                      onResult={setResult}
                    />
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </section>
    </div>
  );
}

type Result = { ok: true; message?: string } | { ok: false; error: string } | null;

/**
 * The intervals a source can be read on.
 *
 * A closed list, matching `scanIntervalSchema`, because every entry is a
 * sentence a user can reason about — and because the floor exists for
 * somebody else's benefit. This crawler reads other people's servers, and the
 * quickest way to be blocked by all of them is a free-text field where 1 is
 * a valid answer.
 */
const SCAN_INTERVALS: [number, string][] = [
  [15, "Every 15 min"],
  [60, "Hourly"],
  [360, "Every 6 hours"],
  [1440, "Daily"],
  [10080, "Weekly"],
];

function SourceRow({
  org,
  source,
  canWrite,
  now,
  onResult,
  onRemoved,
}: {
  org: string;
  source: HuntSource;
  canWrite: boolean;
  now: string;
  onResult: (r: Result) => void;
  /** Removal is reported separately, because it is the one with an undo. */
  onRemoved: (id: string, name: string) => void;
}) {
  const [pending, start] = useTransition();
  const meta = STATUS_META[source.status];

  return (
    <li className="flex flex-wrap items-center gap-3 px-5 py-3.5">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-[13px] font-medium text-fg">{source.name}</span>
          <Badge variant="neutral">{KIND_LABELS[source.kind] ?? source.kind}</Badge>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
          {source.lastScannedAt ? (
            <Freshness date={source.lastScannedAt} now={new Date(now)} label="Scanned" />
          ) : (
            <span className="text-[12px] text-fg-muted">Never scanned</span>
          )}
          <span className="text-[12px] text-fg-muted">
            {/* Both numbers, because the difference between them is the
                diagnosis. "40 documents, 0 claims" is a source being read that
                publishes nothing this ICP cares about — a reason to drop it.
                "0 documents" is a source that is not being read at all, which
                is a reason to look at its error instead. */}
            {source.documentCount === 0
              ? "Nothing read yet"
              : `${source.documentCount} document${source.documentCount === 1 ? "" : "s"} · ${
                  source.evidenceCount === 0
                    ? "no evidence yet"
                    : `${source.evidenceCount} pieces of evidence`
                }`}
          </span>
        </div>
        {source.lastError && (
          <p className="mt-1 text-[12px] text-fg-muted">{source.lastError}</p>
        )}
      </div>

      <StatusDot variant={meta.variant} label={meta.label} />

      {canWrite && (
        <label className="flex items-center gap-2">
          {/* The interval is per source because sources differ by an order of
              magnitude in how often they change: a job board is worth reading
              hourly, a regulatory register is not, and reading the register
              hourly spends money to re-fetch the same page. */}
          <span className="sr-only">How often to read {source.name}</span>
          <Select
            value={String(source.scanIntervalMinutes)}
            disabled={pending}
            className="mt-0 h-8 w-[130px]"
            onChange={(e) =>
              start(async () => {
                const res = await setScanIntervalAction(org, source.id, Number(e.target.value));
                onResult(
                  res.ok ? { ok: true, message: res.message } : { ok: false, error: res.error },
                );
              })
            }
          >
            {SCAN_INTERVALS.map(([minutes, label]) => (
              <option key={minutes} value={minutes}>
                {label}
              </option>
            ))}
          </Select>
        </label>
      )}

      {canWrite && (
        <>
          <Button
            size="sm"
            variant="ghost"
            icon={Pause}
            aria-label={`Pause ${source.name}`}
            disabled={pending}
            onClick={() =>
              start(async () => {
                const res = await setSourceEnabledAction(org, source.id, false);
                onResult(
                  res.ok ? { ok: true, message: res.message } : { ok: false, error: res.error },
                );
              })
            }
          />
          <Button
            size="sm"
            variant="ghost"
            icon={Trash2}
            aria-label={`Remove ${source.name}`}
            disabled={pending}
            onClick={() =>
              start(async () => {
                const res = await deleteSourceAction(org, source.id);
                if (res.ok) {
                  /* UX-14: reported as a confirmation with an undo rather than
                     through the ordinary result banner. Removal and a save are
                     not the same event and should not read the same. */
                  onRemoved(source.id, source.name);
                } else {
                  onResult({ ok: false, error: res.error });
                }
              })
            }
          />
        </>
      )}
    </li>
  );
}

function RecommendationActions({
  org,
  source,
  canWrite,
  onResult,
}: {
  org: string;
  source: HuntSource;
  canWrite: boolean;
  onResult: (r: Result) => void;
}) {
  const [pending, start] = useTransition();
  if (!canWrite) return null;

  return (
    <div className="flex items-center gap-2">
      <Button
        size="sm"
        variant="secondary"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = await deleteSourceAction(org, source.id);
            onResult(
              res.ok ? { ok: true, message: res.message } : { ok: false, error: res.error },
            );
          })
        }
      >
        Dismiss
      </Button>
      <Button
        size="sm"
        variant="primary"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = await setSourceEnabledAction(org, source.id, true);
            onResult(
              res.ok ? { ok: true, message: res.message } : { ok: false, error: res.error },
            );
          })
        }
      >
        Accept
      </Button>
    </div>
  );
}

const KINDS: SourceInput["kind"][] = [
  "news",
  "blog",
  "jobs",
  "social",
  "github",
  "funding",
  "regulatory",
  "community",
  "podcast",
  "custom",
];

function SourceForm({
  org,
  canWrite,
  onDone,
}: {
  org: string;
  canWrite: boolean;
  onDone: () => void;
}) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<SourceInput["kind"]>("news");
  const [url, setUrl] = useState("");

  const [result, setResult] = useState<Result>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();

  return (
    <Card>
      <CardHeader
        title="Add a source"
        description="Something you want read on every hunt. It is enabled straight away — you asked for it, so there is nothing to accept."
      />
      <CardBody className="space-y-5">
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Name" required error={fieldErrors.name}>
            {(a) => (
              <Input
                {...a}
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={!canWrite || pending}
                placeholder="The Block"
              />
            )}
          </Field>

          <Field label="Kind" error={fieldErrors.kind}>
            {(a) => (
              <Select
                {...a}
                value={kind}
                onChange={(e) => setKind(e.target.value as SourceInput["kind"])}
                disabled={!canWrite || pending}
              >
                {KINDS.map((k) => (
                  <option key={k} value={k}>
                    {KIND_LABELS[k]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>

        <Field
          label="URL"
          hint="Where to read it. Leave blank for a source that has no single address."
          error={fieldErrors.url}
        >
          {(a) => (
            <Input
              {...a}
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              disabled={!canWrite || pending}
              placeholder="https://www.theblock.co"
            />
          )}
        </Field>

        <FormMessage result={result} />

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="primary"
            icon={Save}
            disabled={pending}
            onClick={() => {
              setResult(null);
              setFieldErrors({});
              start(async () => {
                const res = await saveSourceAction(org, { name, kind, url, icpId: "" });
                if (res.ok) {
                  setResult({ ok: true, message: res.message });
                  onDone();
                } else {
                  setResult({ ok: false, error: res.error });
                  setFieldErrors(res.fieldErrors ?? {});
                }
              });
            }}
          >
            {pending ? "Adding…" : "Add source"}
          </Button>
          <Button variant="ghost" onClick={onDone} disabled={pending}>
            Cancel
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}
