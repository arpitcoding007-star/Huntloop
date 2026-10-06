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
import { Check, Plus, Swords, X } from "lucide-react";
import type { CompetitorSummary } from "../../../../lib/data/competitor-intel";
import { addCompetitorAction, setCompetitorStatusAction } from "./actions";

type Result = { ok: true; message?: string } | { ok: false; error: string } | null;

export const TIER_LABEL: Record<string, string> = {
  direct: "Direct",
  adjacent: "Adjacent",
  incumbent: "Incumbent",
  diy: "Built in-house",
};

export function CompetitorList({
  org,
  competitors,
  canWrite,
}: {
  org: string;
  competitors: CompetitorSummary[];
  canWrite: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const [result, setResult] = useState<Result>(null);
  const [pending, start] = useTransition();

  const proposed = competitors.filter((c) => c.status === "proposed");
  const active = competitors.filter((c) => c.status === "active");
  const dismissed = competitors.filter((c) => c.status === "dismissed");

  const setStatus = (id: string, status: "active" | "dismissed") =>
    start(async () => {
      const res = await setCompetitorStatusAction(org, id, status);
      setResult(res.ok ? { ok: true, message: res.message } : { ok: false, error: res.error });
    });

  return (
    <div className="space-y-6">
      {canWrite && (
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary" icon={Plus} onClick={() => setAdding((a) => !a)}>
            Add a competitor
          </Button>
        </div>
      )}

      {adding && canWrite && (
        <AddForm
          org={org}
          onDone={(message) => {
            setAdding(false);
            setResult({ ok: true, message });
          }}
        />
      )}

      <FormMessage result={result} />

      {proposed.length > 0 && (
        <Card>
          <CardHeader
            title="Proposed"
            description="Named in what your sources said about prospects. Nothing counts until you accept it."
          />
          <CardBody>
            <ul className="divide-y divide-line-subtle">
              {proposed.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center gap-3 py-2.5">
                  <Link
                    href={`/${org}/competitors/${c.id}`}
                    className="hl-focusable min-w-0 flex-1 rounded-sm text-[13px] font-medium text-fg hover:underline"
                  >
                    {c.name}
                    {c.domain && <span className="ml-2 font-normal text-fg-muted">{c.domain}</span>}
                  </Link>
                  {canWrite && (
                    <div className="flex gap-2">
                      <Button size="sm" variant="secondary" icon={Check} disabled={pending} onClick={() => setStatus(c.id, "active")}>
                        Accept
                      </Button>
                      <Button size="sm" variant="ghost" icon={X} disabled={pending} onClick={() => setStatus(c.id, "dismissed")}>
                        Dismiss
                      </Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}

      {active.length === 0 && proposed.length === 0 ? (
        <EmptyState
          icon={Swords}
          title="No competitors yet"
          description="Add the companies you lose deals to. Huntloop reads their site, finds where they show up among your prospects, and lets your scoring rules act on it."
        />
      ) : (
        active.length > 0 && (
          <Card flush>
            <CardHeader title="Your competitors" description={`${active.length} on the list`} />
            <CardBody>
              <ul className="divide-y divide-line-subtle">
                {active.map((c) => (
                  <li key={c.id} className="py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={`/${org}/competitors/${c.id}`}
                        className="hl-focusable rounded-sm text-[14px] font-medium text-fg hover:underline"
                      >
                        {c.name}
                      </Link>
                      {c.tier && <Badge variant="neutral">{TIER_LABEL[c.tier]}</Badge>}
                      {!c.lastResearchedAt && <Badge variant="warning">Not researched</Badge>}
                      {c.researchRequestedAt && <Badge variant="info">Research queued</Badge>}
                      {c.prospectCustomers && <Badge variant="brand">Prospecting their customers</Badge>}
                    </div>
                    {c.positioning && (
                      <p className="mt-1 line-clamp-2 text-[13px] text-fg-secondary">{c.positioning}</p>
                    )}
                    <p className="mt-1 text-[12px] text-fg-muted">
                      {summarize(c)}
                    </p>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
        )
      )}

      {dismissed.length > 0 && (
        <details className="rounded-md border border-line-subtle bg-surface px-4 py-3">
          <summary className="hl-focusable cursor-pointer text-[13px] text-fg-secondary">
            Dismissed ({dismissed.length})
          </summary>
          <ul className="mt-2 space-y-1.5">
            {dismissed.map((c) => (
              <li key={c.id} className="flex items-center gap-3 text-[13px] text-fg-muted">
                <span className="flex-1">{c.name}</span>
                {canWrite && (
                  <Button size="sm" variant="ghost" disabled={pending} onClick={() => setStatus(c.id, "active")}>
                    Restore
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function summarize(c: CompetitorSummary): string {
  const parts: string[] = [];
  if (c.signals.uses) parts.push(`${c.signals.uses} prospect${c.signals.uses === 1 ? "" : "s"} use them`);
  if (c.signals.evaluating) parts.push(`${c.signals.evaluating} evaluating`);
  if (c.signals.former) parts.push(`${c.signals.former} left them`);
  if (c.losses) parts.push(`${c.losses} deal${c.losses === 1 ? "" : "s"} lost to them`);
  return parts.length ? parts.join(" · ") : "No evidence among your prospects yet";
}

function AddForm({ org, onDone }: { org: string; onDone: (message?: string) => void }) {
  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");
  const [tier, setTier] = useState("");
  const [result, setResult] = useState<Result>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();

  return (
    <Card>
      <CardHeader title="Add a competitor" description="Their website is what research reads." />
      <CardBody className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Name" required error={errors.name}>
            {(a) => <Input {...a} value={name} onChange={(e) => setName(e.target.value)} placeholder="Rival Inc" />}
          </Field>
          <Field label="Website" error={errors.domain}>
            {(a) => <Input {...a} value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="rival.com" />}
          </Field>
          <Field label="How directly" error={errors.tier}>
            {(a) => (
              <Select {...a} value={tier} onChange={(e) => setTier(e.target.value)}>
                <option value="">Not sure yet</option>
                {Object.entries(TIER_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        <div className="flex gap-2">
          <Button
            variant="primary"
            disabled={pending || !name.trim()}
            onClick={() =>
              start(async () => {
                setResult(null);
                setErrors({});
                const res = await addCompetitorAction(org, { name, domain, tier });
                if (res.ok) onDone(res.message);
                else {
                  setResult({ ok: false, error: res.error });
                  setErrors(res.fieldErrors ?? {});
                }
              })
            }
          >
            {pending ? "Adding…" : "Add"}
          </Button>
        </div>
        <FormMessage result={result} />
      </CardBody>
    </Card>
  );
}
