"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  Field,
  FormMessage,
  Input,
  Select,
} from "@huntloop/ui";
import { Check, Layers, MessageSquareQuote, Plus, RefreshCw, X } from "lucide-react";
import type { Demand, DemandStatement, DemandTheme, ThemeStatus } from "../../../../lib/data/demand";
import {
  assignStatementAction,
  createThemeAction,
  mergeThemeAction,
  renameThemeAction,
  requestGroupingAction,
  setThemeStatusAction,
} from "./actions";

type Result = { ok: true; message?: string } | { ok: false; error: string } | null;

const STATUS_LABEL: Record<ThemeStatus, string> = {
  proposed: "Proposed",
  open: "Open",
  planned: "Planned",
  shipped: "Shipped",
  wont: "Won't do",
  rejected: "Dismissed",
  merged: "Merged",
};

const STATUS_TONE: Record<ThemeStatus, "ai" | "neutral" | "info" | "success" | "warning"> = {
  proposed: "ai",
  open: "neutral",
  planned: "info",
  shipped: "success",
  wont: "warning",
  rejected: "neutral",
  merged: "neutral",
};

const SOURCE_LABEL: Record<DemandStatement["sourceType"], string> = {
  reply: "from a reply",
  outcome: "from a closed deal",
  note: "from a note",
};

export function DemandBoard({ org, demand, canWrite }: { org: string; demand: Demand; canWrite: boolean }) {
  const [result, setResult] = useState<Result>(null);
  const [pending, start] = useTransition();
  const [creating, setCreating] = useState(false);
  const live = demand.themes.filter((t) => t.status !== "proposed");
  const proposed = demand.themes.filter((t) => t.status === "proposed");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        {canWrite && (
          <Button
            variant="secondary"
            icon={RefreshCw}
            disabled={pending || demand.unthemedCount === 0 || Boolean(demand.requestedAt)}
            onClick={() =>
              start(async () => {
                const res = await requestGroupingAction(org);
                setResult(res.ok ? { ok: true, message: res.message } : { ok: false, error: res.error });
              })
            }
          >
            {demand.requestedAt ? "Grouping requested" : "Group new statements"}
          </Button>
        )}
        {canWrite && (
          <Button variant="ghost" icon={Plus} onClick={() => setCreating((v) => !v)}>
            Name a theme yourself
          </Button>
        )}
        <span className="text-[12px] text-fg-muted">
          {demand.unthemedCount} ungrouped
          {demand.lastClusteredAt ? ` · last grouped ${new Date(demand.lastClusteredAt).toLocaleDateString()}` : ""}
        </span>
      </div>

      <FormMessage result={result} />
      {creating && <CreateTheme org={org} onDone={(r) => { setResult(r); if (r?.ok) setCreating(false); }} />}

      {proposed.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-[13px] font-medium text-fg">Proposed — accept, merge or dismiss</h2>
          {proposed.map((t) => (
            <ThemeCard key={t.id} org={org} theme={t} others={live} canWrite={canWrite} onResult={setResult} />
          ))}
        </section>
      )}

      {live.length === 0 && proposed.length === 0 ? (
        <EmptyState
          icon={Layers}
          title="No themes yet"
          description="When prospects reply with a need or an objection, or a deal is closed with a reason, the statement lands here. Once a few have arrived, Huntloop proposes themes for you to accept."
        />
      ) : (
        live.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-[13px] font-medium text-fg">Themes</h2>
            {live.map((t) => (
              <ThemeCard key={t.id} org={org} theme={t} others={live} canWrite={canWrite} onResult={setResult} />
            ))}
          </section>
        )
      )}

      {demand.unthemed.length > 0 && (
        <Card>
          <CardHeader
            title="Not grouped yet"
            description={`${demand.unthemedCount} statement${demand.unthemedCount === 1 ? "" : "s"}. Grouping proposes themes once there are a few.`}
          />
          <CardBody>
            <ul className="divide-y divide-line-subtle">
              {demand.unthemed.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center gap-2 py-2">
                  <Statement org={org} s={s} />
                  {canWrite && live.length > 0 && (
                    <Select
                      aria-label={`Put “${s.statement}” in a theme`}
                      className="ml-auto w-auto"
                      value=""
                      disabled={pending}
                      onChange={(e) =>
                        start(async () => {
                          const res = await assignStatementAction(org, s.id, e.target.value);
                          setResult(res.ok ? { ok: true, message: res.message } : { ok: false, error: res.error });
                        })
                      }
                    >
                      <option value="">Add to theme…</option>
                      {live.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.title}
                        </option>
                      ))}
                    </Select>
                  )}
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}
    </div>
  );
}

function Statement({ org, s }: { org: string; s: DemandStatement }) {
  return (
    <span className="min-w-0 flex-1 text-[13px] text-fg-secondary">
      <MessageSquareQuote className="mr-1 inline size-3.5 text-fg-muted" strokeWidth={1.75} aria-hidden />
      “{s.statement}”
      <span className="text-[12px] text-fg-muted">
        {" "}
        — {s.company ?? "a prospect"}, {SOURCE_LABEL[s.sourceType]}
        {s.opportunityId && (
          <>
            {" · "}
            <Link href={`/${org}/opportunities/${s.opportunityId}`} className="hl-focusable rounded-sm underline underline-offset-2">
              open
            </Link>
          </>
        )}
      </span>
    </span>
  );
}

function ThemeCard({
  org,
  theme,
  others,
  canWrite,
  onResult,
}: {
  org: string;
  theme: DemandTheme;
  others: DemandTheme[];
  canWrite: boolean;
  onResult: (r: Result) => void;
}) {
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(theme.title);
  const [mergeInto, setMergeInto] = useState("");
  const act = (fn: () => Promise<{ ok: true; message?: string } | { ok: false; error: string }>) =>
    start(async () => {
      const res = await fn();
      onResult(res.ok ? { ok: true, message: res.message } : { ok: false, error: res.error });
    });

  const targets = others.filter((o) => o.id !== theme.id);

  return (
    <Card>
      <CardBody className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          {editing ? (
            <form
              className="flex flex-1 flex-wrap items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                act(async () => {
                  const res = await renameThemeAction(org, { id: theme.id, title, description: theme.description ?? "" });
                  if (res.ok) setEditing(false);
                  return res;
                });
              }}
            >
              <Input aria-label="Theme name" value={title} onChange={(e) => setTitle(e.target.value)} className="min-w-[220px] flex-1" />
              <Button type="submit" size="sm" variant="primary" disabled={pending}>
                Save
              </Button>
            </form>
          ) : (
            <span className="text-[14px] font-medium text-fg">{theme.title}</span>
          )}
          <Badge variant={STATUS_TONE[theme.status]}>{STATUS_LABEL[theme.status]}</Badge>
          <Badge variant="neutral">{theme.kind}</Badge>
          {canWrite && !editing && (
            <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
              Rename
            </Button>
          )}
        </div>

        {theme.description && <p className="text-[13px] text-fg-secondary">{theme.description}</p>}

        <p className="text-[12px] text-fg-muted">
          {theme.signals} statement{theme.signals === 1 ? "" : "s"} · {theme.opportunities} deal
          {theme.opportunities === 1 ? "" : "s"}
          {theme.lostDeals ? ` · ${theme.lostDeals} lost or ruled out` : ""}
          {theme.valueAtStakeCents ? ` · $${Math.round(theme.valueAtStakeCents / 100).toLocaleString()} recorded value at stake` : ""}
        </p>

        {theme.examples.length > 0 && (
          <ul className="space-y-1">
            {theme.examples.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-2">
                <Statement org={org} s={s} />
                {canWrite && (
                  <button
                    type="button"
                    aria-label={`Take “${s.statement}” out of this theme`}
                    className="hl-focusable rounded-sm text-fg-muted hover:text-fg"
                    onClick={() => act(() => assignStatementAction(org, s.id, null))}
                  >
                    <X className="size-3.5" strokeWidth={1.75} />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}

        {canWrite && (
          <div className="flex flex-wrap items-center gap-2 border-t border-line-subtle pt-3">
            {theme.status === "proposed" ? (
              <>
                <Button size="sm" variant="primary" icon={Check} disabled={pending} onClick={() => act(() => setThemeStatusAction(org, theme.id, "open"))}>
                  Accept
                </Button>
                <Button size="sm" variant="ghost" icon={X} disabled={pending} onClick={() => act(() => setThemeStatusAction(org, theme.id, "rejected"))}>
                  Dismiss
                </Button>
              </>
            ) : (
              <Select
                aria-label={`Status of ${theme.title}`}
                className="w-auto"
                value={theme.status}
                disabled={pending}
                onChange={(e) => act(() => setThemeStatusAction(org, theme.id, e.target.value))}
              >
                {(["open", "planned", "shipped", "wont"] as const).map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABEL[s]}
                  </option>
                ))}
              </Select>
            )}
            {targets.length > 0 && (
              <div className="flex items-center gap-1.5">
                <Select
                  aria-label={`Merge ${theme.title} into`}
                  className="w-auto"
                  value={mergeInto}
                  disabled={pending}
                  onChange={(e) => setMergeInto(e.target.value)}
                >
                  <option value="">Merge into…</option>
                  {targets.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.title}
                    </option>
                  ))}
                </Select>
                {mergeInto && (
                  <Button size="sm" variant="secondary" disabled={pending} onClick={() => act(() => mergeThemeAction(org, theme.id, mergeInto))}>
                    Merge
                  </Button>
                )}
              </div>
            )}
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function CreateTheme({ org, onDone }: { org: string; onDone: (r: Result) => void }) {
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<"request" | "objection" | "blocker">("request");
  const [pending, start] = useTransition();
  return (
    <Card>
      <CardBody className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-[1fr_180px]">
          <Field label="Theme">
            {(a) => <Input {...a} value={title} placeholder="Salesforce integration" onChange={(e) => setTitle(e.target.value)} />}
          </Field>
          <Field label="Kind">
            {(a) => (
              <Select {...a} value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
                <option value="request">Request</option>
                <option value="objection">Objection</option>
                <option value="blocker">Blocker</option>
              </Select>
            )}
          </Field>
        </div>
        <Button
          variant="primary"
          disabled={pending || !title.trim()}
          onClick={() =>
            start(async () => {
              const res = await createThemeAction(org, { title, kind, signalIds: [] });
              onDone(res.ok ? { ok: true, message: res.message } : { ok: false, error: res.error });
            })
          }
        >
          Create
        </Button>
      </CardBody>
    </Card>
  );
}
