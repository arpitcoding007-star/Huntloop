"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  ConfirmButton,
  Field,
  FormMessage,
  Input,
  Select,
  Textarea,
} from "@huntloop/ui";
import { RefreshCw, Save, Trash2 } from "lucide-react";
import type { CompetitorDetail } from "../../../../../lib/data/competitor-intel";
import {
  deleteCompetitorAction,
  requestCompetitorResearchAction,
  setCompetitorStatusAction,
  updateCompetitorAction,
} from "../actions";
import { TIER_LABEL } from "../CompetitorList";

type Result = { ok: true; message?: string } | { ok: false; error: string } | null;

/**
 * What a person owns about a competitor: its name and site, how directly it
 * competes, the two positioning sentences outreach may lean on, and whether to
 * go after the customers it names. Research is a separate, metered request.
 */
export function CompetitorEditor({
  org,
  competitor,
  canWrite,
  canSpend,
}: {
  org: string;
  competitor: CompetitorDetail;
  canWrite: boolean;
  canSpend: boolean;
}) {
  const router = useRouter();
  const [name, setName] = useState(competitor.name);
  const [domain, setDomain] = useState(competitor.domain ?? "");
  const [tier, setTier] = useState<string>(competitor.tier ?? "");
  const [ours, setOurs] = useState(competitor.ourAdvantage ?? "");
  const [theirs, setTheirs] = useState(competitor.theirAdvantage ?? "");
  const [prospect, setProspect] = useState(competitor.prospectCustomers);
  const [result, setResult] = useState<Result>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  const demo = competitor.id.startsWith("demo-");
  const disabled = !canWrite || pending || demo;

  const run = (fn: () => Promise<{ ok: true; message?: string } | { ok: false; error: string; fieldErrors?: Record<string, string> }>) =>
    start(async () => {
      setResult(null);
      setErrors({});
      const res = await fn();
      if (res.ok) setResult({ ok: true, message: res.message });
      else {
        setResult({ ok: false, error: res.error });
        setErrors(res.fieldErrors ?? {});
      }
    });

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title="Research" />
        <CardBody className="space-y-3">
          <p className="text-[13px] text-fg-secondary">
            {competitor.researchRequestedAt
              ? "Queued. It runs on the engine's next pass."
              : competitor.lastResearchedAt
                ? `Last read ${new Date(competitor.lastResearchedAt).toLocaleDateString()}.`
                : "Never read."}
          </p>
          {canSpend && competitor.status === "active" && (
            <Button
              variant="secondary"
              icon={RefreshCw}
              disabled={pending || demo || !competitor.domain || Boolean(competitor.researchRequestedAt)}
              onClick={() => run(() => requestCompetitorResearchAction(org, competitor.id))}
            >
              {competitor.lastResearchedAt ? "Research again" : "Research"}
            </Button>
          )}
          {!competitor.domain && (
            <p className="text-[12px] text-fg-muted">Add their website below first — research reads their own site.</p>
          )}
          {competitor.prospected > 0 && (
            <p className="text-[12px] text-fg-muted">
              {competitor.prospected} compan{competitor.prospected === 1 ? "y" : "ies"} found among the customers they name.
            </p>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Your positioning"
          description="Written by you, never by a model. Outreach names a direct competitor only when a prospect uses them and you have said why you win."
        />
        <CardBody className="space-y-4">
          <Field label="Name" required error={errors.name}>
            {(a) => <Input {...a} value={name} disabled={disabled} onChange={(e) => setName(e.target.value)} />}
          </Field>
          <Field label="Website" error={errors.domain}>
            {(a) => (
              <Input {...a} value={domain} disabled={disabled} placeholder="rival.com" onChange={(e) => setDomain(e.target.value)} />
            )}
          </Field>
          <Field label="How directly they compete" error={errors.tier}>
            {(a) => (
              <Select {...a} value={tier} disabled={disabled} onChange={(e) => setTier(e.target.value)}>
                <option value="">Not sure yet</option>
                {Object.entries(TIER_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Where we win" hint="One or two sentences you'd stand behind in a call." error={errors.ourAdvantage}>
            {(a) => <Textarea {...a} rows={3} value={ours} disabled={disabled} onChange={(e) => setOurs(e.target.value)} />}
          </Field>
          <Field label="Where they win" hint="Honest, so the agent never claims otherwise." error={errors.theirAdvantage}>
            {(a) => <Textarea {...a} rows={3} value={theirs} disabled={disabled} onChange={(e) => setTheirs(e.target.value)} />}
          </Field>
          <label className="flex items-start gap-2.5 text-[13px] text-fg">
            <input
              type="checkbox"
              checked={prospect}
              disabled={disabled}
              onChange={(e) => setProspect(e.target.checked)}
              className="mt-0.5 size-4 accent-[var(--color-brand)]"
            />
            <span>
              Go after their customers
              <span className="mt-0.5 block text-[12px] text-fg-muted">
                Customers they name on their own site become companies to research, using your
                provider credits. Nobody is contacted automatically.
              </span>
            </span>
          </label>

          {canWrite && (
            <Button
              variant="primary"
              icon={Save}
              disabled={disabled || !name.trim()}
              onClick={() =>
                run(() =>
                  updateCompetitorAction(org, {
                    id: competitor.id,
                    name,
                    domain,
                    tier,
                    ourAdvantage: ours,
                    theirAdvantage: theirs,
                    prospectCustomers: prospect,
                  }),
                )
              }
            >
              {pending ? "Saving…" : "Save"}
            </Button>
          )}
          <FormMessage result={result} />
        </CardBody>
      </Card>

      {canWrite && !demo && (
        <div className="flex flex-wrap gap-2">
          {competitor.status !== "active" ? (
            <Button variant="secondary" disabled={pending} onClick={() => run(() => setCompetitorStatusAction(org, competitor.id, "active"))}>
              {competitor.status === "proposed" ? "Accept" : "Restore"}
            </Button>
          ) : (
            <Button variant="ghost" disabled={pending} onClick={() => run(() => setCompetitorStatusAction(org, competitor.id, "dismissed"))}>
              Dismiss
            </Button>
          )}
          <ConfirmButton
            icon={Trash2}
            label={`Remove ${competitor.name}`}
            confirmLabel="Remove for good"
            disabled={pending}
            onConfirm={() =>
              start(async () => {
                const res = await deleteCompetitorAction(org, competitor.id);
                if (res.ok) router.push(`/${org}/competitors`);
                else setResult({ ok: false, error: res.error });
              })
            }
          />
        </div>
      )}
    </div>
  );
}
