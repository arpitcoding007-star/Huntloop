"use client";

import { useState, useTransition } from "react";
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Field,
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
  saveSourceAction,
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
  now,
}: {
  org: string;
  sources: HuntSources;
  canWrite: boolean;
  /** The server's clock, so every relative age is measured from one instant. */
  now: string;
}) {
  const [adding, setAdding] = useState(false);
  const [result, setResult] = useState<
    { ok: true; message?: string } | { ok: false; error: string } | null
  >(null);
  const [suggesting, startSuggest] = useTransition();

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
          {/* Still honest about what does not exist: nothing reads these on a
              timer, and a live-looking "Scan now" would promise the scheduled
              hunt this product is built around (audit UX-01). */}
          <Button
            icon={RefreshCw}
            variant="secondary"
            pending="Scheduled scanning isn't built yet — nothing reads these sources on a timer."
          >
            Scan now
          </Button>
          {canWrite && (
            <Button icon={Plus} variant="primary" onClick={() => setAdding((a) => !a)}>
              Add a source
            </Button>
          )}
        </div>
      </header>

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

function SourceRow({
  org,
  source,
  canWrite,
  now,
  onResult,
}: {
  org: string;
  source: HuntSource;
  canWrite: boolean;
  now: string;
  onResult: (r: Result) => void;
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
            {source.evidenceCount === 0
              ? "No evidence attributed yet"
              : `${source.evidenceCount} pieces of evidence`}
          </span>
        </div>
        {source.lastError && (
          <p className="mt-1 text-[12px] text-fg-muted">{source.lastError}</p>
        )}
      </div>

      <StatusDot variant={meta.variant} label={meta.label} />

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
                onResult(
                  res.ok ? { ok: true, message: res.message } : { ok: false, error: res.error },
                );
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
