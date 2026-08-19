"use client";

import { useState, useTransition } from "react";
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
  QuotaBar,
  SectionLabel,
  Select,
  Textarea,
} from "@huntloop/ui";
import { Mail, Plus, Save, Send, Trash2 } from "lucide-react";
import type { Campaign, Mailbox, Outreach, Sequence, SequenceStep } from "../../../../lib/data/outreach";
import {
  createSequenceAction,
  deleteCampaignAction,
  deleteStepAction,
  saveCampaignAction,
  saveStepAction,
  type CampaignInput,
} from "./actions";

/**
 * Outreach — master context §46.
 *
 * ── The autonomy ladder is the whole screen ──────────────────────────────
 *
 * Every other field on a campaign is a label. `autonomy_level` decides whether
 * messages leave without a human reading them, so it is rendered as six named
 * choices with what each one does written next to it — not as a 0–5 number
 * whose meaning lives in a spec nobody editing a campaign has open.
 *
 * A campaign is created at level 0 and status draft, by the action rather than
 * by this form, so the safe state is not something the UI is trusted to send.
 */

const AUTONOMY: { level: number; label: string; what: string }[] = [
  { level: 0, label: "Draft only", what: "Nothing sends. Messages are written and wait for you." },
  { level: 1, label: "Approve each", what: "Every message needs your approval before it goes." },
  { level: 2, label: "Approve the first", what: "You approve the opening message; follow-ups go on their own." },
  { level: 3, label: "Approve exceptions", what: "Sends on its own, and stops for anything it is unsure about." },
  { level: 4, label: "Notify only", what: "Sends on its own and tells you afterwards." },
  { level: 5, label: "Autonomous", what: "Sends and adapts without telling you each time." },
];

const STATUSES: CampaignInput["status"][] = ["draft", "active", "paused", "archived"];

type Result = { ok: true; message?: string } | { ok: false; error: string } | null;

export function OutreachManager({
  org,
  outreach,
  canWrite,
}: {
  org: string;
  outreach: Outreach;
  canWrite: boolean;
}) {
  const [creating, setCreating] = useState(false);
  const [result, setResult] = useState<Result>(null);

  const { campaigns, mailboxes } = outreach;
  const live = campaigns.filter((c) => c.status === "active");

  return (
    <div className="space-y-8">
      {/* Stated at the top because it is the answer to "is anything emailing
          people right now?", and that should not require reading a list. */}
      <div className="flex flex-wrap gap-x-6 gap-y-2">
        <Figure label="Campaigns" value={campaigns.length} />
        <Figure label="Active" value={live.length} />
        <Figure
          label="Sending without approval"
          value={live.filter((c) => c.autonomyLevel >= 3).length}
        />
      </div>

      <FormMessage result={result} />

      <section>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SectionLabel>Campaigns</SectionLabel>
          {canWrite && !creating && (
            <Button size="sm" variant="secondary" icon={Plus} onClick={() => setCreating(true)}>
              New campaign
            </Button>
          )}
        </div>

        {creating && (
          <div className="mt-3">
            <CampaignForm
              org={org}
              campaign={null}
              canWrite={canWrite}
              onDone={() => setCreating(false)}
              onResult={setResult}
            />
          </div>
        )}

        <div className="mt-3 space-y-4">
          {campaigns.length === 0 && !creating ? (
            <Card>
              <CardBody>
                <EmptyState
                  icon={Send}
                  title="No campaigns yet"
                  description="A campaign is a sequence plus the opportunities enrolled in it. New ones start as a draft at autonomy 0, so nothing sends until you say so."
                />
              </CardBody>
            </Card>
          ) : (
            campaigns.map((c) => (
              <CampaignCard
                key={c.id}
                org={org}
                campaign={c}
                canWrite={canWrite}
                onResult={setResult}
              />
            ))
          )}
        </div>
      </section>

      <section>
        <SectionLabel>Mailboxes</SectionLabel>
        <Card className="mt-3">
          <CardHeader
            title="Where mail goes out from"
            description="A campaign cannot send without one."
            actions={
              /* Connecting a mailbox is an OAuth flow against Gmail or
                 Outlook, plus somewhere to encrypt the tokens. None of that
                 exists, so the control says so rather than rendering live
                 (NAV-03). */
              <Button
                size="sm"
                variant="secondary"
                icon={Mail}
                pending="Connecting a mailbox isn't built yet — it needs an OAuth flow and somewhere to encrypt the tokens."
              >
                Connect a mailbox
              </Button>
            }
          />
          <CardBody>
            {mailboxes.length === 0 ? (
              <p className="text-[13px] text-fg-muted">
                No mailbox is connected, so nothing can send yet. Campaigns can
                still be written and reviewed.
              </p>
            ) : (
              <ul className="space-y-3">
                {mailboxes.map((m) => (
                  <MailboxRow key={m.id} mailbox={m} />
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </section>
    </div>
  );
}

function Figure({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p className="text-[11px] font-medium tracking-[0.06em] text-fg-muted uppercase">
        {label}
      </p>
      <p className="mt-0.5 font-mono text-[18px] text-fg">{value}</p>
    </div>
  );
}

function MailboxRow({ mailbox }: { mailbox: Mailbox }) {
  return (
    <li className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[13px] font-medium text-fg">{mailbox.email}</span>
        <Badge variant="neutral">{mailbox.provider}</Badge>
        <Badge variant={mailbox.status === "connected" ? "success" : "warning"}>
          {mailbox.status}
        </Badge>
        {mailbox.warmupStage && <Badge variant="neutral">warm-up: {mailbox.warmupStage}</Badge>}
      </div>
      <QuotaBar
        label="Sent today"
        used={mailbox.sentToday}
        limit={mailbox.dailyLimit}
      />
    </li>
  );
}

function CampaignCard({
  org,
  campaign,
  canWrite,
  onResult,
}: {
  org: string;
  campaign: Campaign;
  canWrite: boolean;
  onResult: (r: Result) => void;
}) {
  const [editing, setEditing] = useState(false);
  const autonomy = AUTONOMY[campaign.autonomyLevel] ?? AUTONOMY[0];

  if (editing) {
    return (
      <CampaignForm
        org={org}
        campaign={campaign}
        canWrite={canWrite}
        onDone={() => setEditing(false)}
        onResult={onResult}
      />
    );
  }

  return (
    <Card>
      <CardHeader
        title={campaign.name}
        description={`${autonomy.label} — ${autonomy.what}`}
        actions={
          canWrite ? (
            <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
              Edit
            </Button>
          ) : null
        }
      />
      <CardBody className="space-y-5">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={campaign.status === "active" ? "success" : "neutral"}>
            {campaign.status}
          </Badge>
          <Badge variant={campaign.autonomyLevel >= 3 ? "warning" : "neutral"}>
            autonomy {campaign.autonomyLevel}
          </Badge>
          <span className="text-[12px] text-fg-muted">
            {campaign.enrollmentCount === 0
              ? "Nobody enrolled"
              : `${campaign.enrollmentCount} enrolled`}
          </span>
        </div>

        <SequenceList
          org={org}
          campaign={campaign}
          canWrite={canWrite}
          onResult={onResult}
        />
      </CardBody>
    </Card>
  );
}

function SequenceList({
  org,
  campaign,
  canWrite,
  onResult,
}: {
  org: string;
  campaign: Campaign;
  canWrite: boolean;
  onResult: (r: Result) => void;
}) {
  const [name, setName] = useState("");
  const [pending, start] = useTransition();

  return (
    <div className="space-y-4">
      {campaign.sequences.length === 0 ? (
        <p className="text-[13px] text-fg-muted">
          No sequence yet. A campaign with no sequence has nothing to send.
        </p>
      ) : (
        campaign.sequences.map((s) => (
          <SequenceEditor
            key={s.id}
            org={org}
            sequence={s}
            canWrite={canWrite}
            onResult={onResult}
          />
        ))
      )}

      {canWrite && (
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Add a sequence" className="min-w-[220px] flex-1">
            {(a) => (
              <Input
                {...a}
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={pending}
                placeholder="First touch"
              />
            )}
          </Field>
          <Button
            variant="secondary"
            icon={Plus}
            disabled={pending || !name.trim()}
            pending={!name.trim() ? "Give the sequence a name first." : undefined}
            onClick={() =>
              start(async () => {
                const res = await createSequenceAction(org, campaign.id, name);
                onResult(
                  res.ok ? { ok: true, message: res.message } : { ok: false, error: res.error },
                );
                if (res.ok) setName("");
              })
            }
          >
            Add
          </Button>
        </div>
      )}
    </div>
  );
}

function SequenceEditor({
  org,
  sequence,
  canWrite,
  onResult,
}: {
  org: string;
  sequence: Sequence;
  canWrite: boolean;
  onResult: (r: Result) => void;
}) {
  const [adding, setAdding] = useState(false);

  return (
    <div className="rounded-md border border-line bg-surface px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[13px] font-medium text-fg">
          {sequence.name}{" "}
          <span className="font-normal text-fg-muted">v{sequence.version}</span>
        </span>
        {canWrite && !adding && (
          <Button size="sm" variant="ghost" icon={Plus} onClick={() => setAdding(true)}>
            Add step
          </Button>
        )}
      </div>

      <ol className="mt-3 space-y-3">
        {sequence.steps.map((step) => (
          <li key={step.id}>
            <StepEditor
              org={org}
              sequenceId={sequence.id}
              step={step}
              canWrite={canWrite}
              onResult={onResult}
            />
          </li>
        ))}
      </ol>

      {adding && (
        <div className="mt-3">
          <StepEditor
            org={org}
            sequenceId={sequence.id}
            step={null}
            nextPosition={sequence.steps.length}
            canWrite={canWrite}
            onResult={onResult}
            onDone={() => setAdding(false)}
          />
        </div>
      )}

      {sequence.steps.length === 0 && !adding && (
        <p className="mt-2 text-[12px] text-fg-muted">No steps yet.</p>
      )}
    </div>
  );
}

function StepEditor({
  org,
  sequenceId,
  step,
  nextPosition = 0,
  canWrite,
  onResult,
  onDone,
}: {
  org: string;
  sequenceId: string;
  step: SequenceStep | null;
  nextPosition?: number;
  canWrite: boolean;
  onResult: (r: Result) => void;
  onDone?: () => void;
}) {
  const [kind, setKind] = useState<SequenceStep["kind"]>(step?.kind ?? "email");
  const [delayHours, setDelayHours] = useState(String(step?.delayHours ?? 0));
  const [subject, setSubject] = useState(step?.subject ?? "");
  const [body, setBody] = useState(step?.body ?? "");
  const [open, setOpen] = useState(step === null);
  const [pending, start] = useTransition();

  const position = step?.position ?? nextPosition;

  if (!open && step) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[12px] text-fg-muted">{position + 1}</span>
        <Badge variant="neutral">{step.kind}</Badge>
        {step.kind === "wait" ? (
          <span className="text-[13px] text-fg-secondary">
            wait {step.delayHours} hours
          </span>
        ) : (
          <span className="min-w-0 flex-1 truncate text-[13px] text-fg-secondary">
            {step.subject || "No subject"}
          </span>
        )}
        {canWrite && (
          <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
            Edit
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-md border border-line-subtle bg-canvas px-3 py-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Step">
          {(a) => (
            <Select
              {...a}
              value={kind}
              onChange={(e) => setKind(e.target.value as SequenceStep["kind"])}
              disabled={!canWrite || pending}
            >
              <option value="email">Email</option>
              <option value="wait">Wait</option>
              <option value="condition">Condition</option>
            </Select>
          )}
        </Field>

        <Field label="Position">
          {(a) => (
            <Input {...a} value={String(position + 1)} disabled readOnly />
          )}
        </Field>

        <Field label="Delay (hours)">
          {(a) => (
            <Input
              {...a}
              type="number"
              min={0}
              value={delayHours}
              onChange={(e) => setDelayHours(e.target.value)}
              disabled={!canWrite || pending}
            />
          )}
        </Field>
      </div>

      {/* Only an email step has anything to write. A wait step with a subject
          box would invite filling it in and then silently discard it. */}
      {kind === "email" && (
        <>
          <Field label="Subject">
            {(a) => (
              <Input
                {...a}
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                disabled={!canWrite || pending}
              />
            )}
          </Field>
          <Field
            label="Body"
            hint="Every personalised claim has to name the evidence behind it before this can send (§62)."
          >
            {(a) => (
              <Textarea
                {...a}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                disabled={!canWrite || pending}
                rows={4}
              />
            )}
          </Field>
        </>
      )}

      {canWrite && (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="primary"
            icon={Save}
            disabled={pending}
            onClick={() =>
              start(async () => {
                const res = await saveStepAction(org, {
                  id: step?.id && !step.id.startsWith("demo-") ? step.id : undefined,
                  sequenceId,
                  position,
                  kind,
                  delayHours: Number(delayHours) || 0,
                  subject,
                  body,
                });
                onResult(
                  res.ok ? { ok: true, message: res.message } : { ok: false, error: res.error },
                );
                if (res.ok) {
                  setOpen(false);
                  onDone?.();
                }
              })
            }
          >
            {pending ? "Saving…" : "Save step"}
          </Button>

          {step && (
            <Button
              size="sm"
              variant="ghost"
              icon={Trash2}
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const res = await deleteStepAction(org, step.id);
                  onResult(
                    res.ok ? { ok: true, message: res.message } : { ok: false, error: res.error },
                  );
                })
              }
            >
              Remove
            </Button>
          )}

          <Button
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={() => {
              setOpen(false);
              onDone?.();
            }}
          >
            Cancel
          </Button>
        </div>
      )}
    </div>
  );
}

function CampaignForm({
  org,
  campaign,
  canWrite,
  onDone,
  onResult,
}: {
  org: string;
  campaign: Campaign | null;
  canWrite: boolean;
  onDone: () => void;
  onResult: (r: Result) => void;
}) {
  const [name, setName] = useState(campaign?.name ?? "");
  const [autonomyLevel, setAutonomyLevel] = useState(campaign?.autonomyLevel ?? 0);
  const [status, setStatus] = useState<CampaignInput["status"]>(
    (campaign?.status as CampaignInput["status"]) ?? "draft",
  );
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();

  const chosen = AUTONOMY[autonomyLevel] ?? AUTONOMY[0];

  return (
    <Card>
      <CardHeader
        title={campaign ? `Edit ${campaign.name}` : "New campaign"}
        description={
          campaign
            ? "Changing the autonomy level changes whether messages leave without you."
            : "Created as a draft at autonomy 0. Nothing sends until you change both."
        }
        actions={
          campaign && canWrite ? (
            <Button
              size="sm"
              variant="ghost"
              icon={Trash2}
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const res = await deleteCampaignAction(org, campaign.id);
                  onResult(
                    res.ok ? { ok: true, message: res.message } : { ok: false, error: res.error },
                  );
                  if (res.ok) onDone();
                })
              }
            >
              Archive
            </Button>
          ) : null
        }
      />
      <CardBody className="space-y-5">
        <Field label="Name" required error={fieldErrors.name}>
          {(a) => (
            <Input
              {...a}
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={!canWrite || pending}
              placeholder="Agent infrastructure — Q3"
            />
          )}
        </Field>

        {campaign && (
          <>
            <Field
              label="Autonomy"
              hint={chosen.what}
              error={fieldErrors.autonomyLevel}
            >
              {(a) => (
                <Select
                  {...a}
                  value={String(autonomyLevel)}
                  onChange={(e) => setAutonomyLevel(Number(e.target.value))}
                  disabled={!canWrite || pending}
                >
                  {AUTONOMY.map((l) => (
                    <option key={l.level} value={l.level}>
                      {l.level} — {l.label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>

            <Field label="Status" error={fieldErrors.status}>
              {(a) => (
                <Select
                  {...a}
                  value={status}
                  onChange={(e) => setStatus(e.target.value as CampaignInput["status"])}
                  disabled={!canWrite || pending}
                >
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </>
        )}

        {canWrite && (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="primary"
              icon={Save}
              disabled={pending}
              onClick={() =>
                start(async () => {
                  setFieldErrors({});
                  const res = await saveCampaignAction(org, {
                    id: campaign?.id && !campaign.id.startsWith("demo-") ? campaign.id : undefined,
                    name,
                    icpId: "",
                    productId: "",
                    autonomyLevel,
                    status,
                  });
                  onResult(
                    res.ok ? { ok: true, message: res.message } : { ok: false, error: res.error },
                  );
                  if (res.ok) onDone();
                  else setFieldErrors(res.fieldErrors ?? {});
                })
              }
            >
              {pending ? "Saving…" : campaign ? "Save campaign" : "Create campaign"}
            </Button>
            <Button variant="ghost" onClick={onDone} disabled={pending}>
              Cancel
            </Button>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
