"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  ConfirmButton,
  EmptyState,
  Field,
  FormMessage,
  Input,
  QuotaBar,
  SectionLabel,
  Select,
  Textarea,
} from "@huntloop/ui";
import { Mail, Plus, Save, Send, Trash2, Unplug } from "lucide-react";
import type { ProviderId } from "@huntloop/jobs";
import type { Campaign, Mailbox, Outreach, Sequence, SequenceStep } from "../../../../lib/data/outreach";
import {
  createSequenceAction,
  deleteCampaignAction,
  deleteStepAction,
  disconnectMailboxAction,
  listEnrollmentsAction,
  saveCampaignAction,
  saveStepAction,
  setEnrollmentStatusAction,
  type CampaignInput,
  type EnrollmentRow,
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
  providers,
  connectUnavailable,
  notice,
}: {
  org: string;
  outreach: Outreach;
  canWrite: boolean;
  /** Which providers this deployment can actually offer. Possibly none. */
  providers: ProviderId[];
  /** Why connecting is not possible, when it is not. Null when it is. */
  connectUnavailable: string | null;
  /** What the OAuth redirect came back saying, if this is that navigation. */
  notice: Result;
}) {
  const [creating, setCreating] = useState(false);
  /* Seeded from the URL, so the outcome of an OAuth round trip lands in the
     same place every other outcome on this screen does. */
  const [result, setResult] = useState<Result>(notice);

  /* The OAuth outcome is shown once. Leaving it in the URL made every refresh
     announce the connection again (§14.2), so it is removed after it is read. */
  const router = useRouter();
  const pathname = usePathname();
  useEffect(() => {
    if (notice) router.replace(pathname, { scroll: false });
  }, [notice, router, pathname]);

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
              /* One control per provider this deployment can actually offer,
                 rather than one "Connect a mailbox" that then asks which. The
                 choice is between two names the user already recognises, and
                 putting them in the button skips a dialog that would only ever
                 have those two options in it.

                 A plain link, not a form: the flow is a redirect to somebody
                 else's consent screen, and there is nothing to submit. */
              <ConnectControls
                org={org}
                providers={providers}
                unavailable={connectUnavailable}
                canWrite={canWrite}
              />
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
                  <MailboxRow key={m.id} org={org} mailbox={m} canWrite={canWrite} onResult={setResult} />
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
      <p className="text-[11px] font-medium tracking-label text-fg-muted uppercase">
        {label}
      </p>
      <p className="mt-0.5 font-mono text-[18px] text-fg">{value}</p>
    </div>
  );
}

/**
 * Connect a mailbox — one button per provider this deployment can offer.
 *
 * The `pending` variant carries the reason rather than a generic "unavailable",
 * because the three reasons have three different fixes and only one of them is
 * something the person reading it can do. Saying which is missing is the
 * difference between "this is broken" and "an environment variable is unset".
 */
function ConnectControls({
  org,
  providers,
  unavailable,
  canWrite,
}: {
  org: string;
  providers: ProviderId[];
  unavailable: string | null;
  canWrite: boolean;
}) {
  if (!canWrite) return null;

  if (unavailable || providers.length === 0) {
    return (
      <Button
        size="sm"
        variant="secondary"
        icon={Mail}
        pending={unavailable ?? "No mailbox provider is configured on this deployment."}
      >
        Connect a mailbox
      </Button>
    );
  }

  return (
    <div className="flex flex-wrap gap-2">
      {providers.map((provider) => (
        <Button
          key={provider}
          size="sm"
          variant="secondary"
          icon={Mail}
          href={`/api/mailboxes/${provider}/start?org=${encodeURIComponent(org)}`}
        >
          Connect {provider === "gmail" ? "Gmail" : "Outlook"}
        </Button>
      ))}
    </div>
  );
}

function MailboxRow({
  org,
  mailbox,
  canWrite,
  onResult,
}: {
  org: string;
  mailbox: Mailbox;
  canWrite: boolean;
  onResult: (r: Result) => void;
}) {
  const [pending, start] = useTransition();
  return (
    <li className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[13px] font-medium text-fg">{mailbox.email}</span>
        <Badge variant="neutral">{mailbox.provider}</Badge>
        <Badge variant={mailbox.status === "connected" ? "success" : "warning"}>
          {mailbox.status}
        </Badge>
        {mailbox.warmupStage && <Badge variant="neutral">warm-up: {mailbox.warmupStage}</Badge>}
        {canWrite && !mailbox.id.startsWith("demo") && (
          <ConfirmButton
            className="ml-auto"
            size="sm"
            icon={Unplug}
            label={`Disconnect ${mailbox.email}`}
            confirmLabel="Disconnect"
            pending={pending}
            onConfirm={() =>
              start(async () => {
                const res = await disconnectMailboxAction(org, mailbox.id);
                onResult(res.ok ? { ok: true, message: res.message } : { ok: false, error: res.error });
              })
            }
          />
        )}
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

        {campaign.enrollmentCount > 0 && !campaign.id.startsWith("demo") && (
          <EnrollmentList org={org} campaignId={campaign.id} canWrite={canWrite} onResult={onResult} />
        )}

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
    <div className="space-y-3 rounded-lg border border-line-subtle bg-canvas px-3 py-3">
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
            <ConfirmButton
              icon={Trash2}
              label="Remove this step"
              confirmLabel="Remove it"
              pending={pending}
              onConfirm={() =>
                start(async () => {
                  const res = await deleteStepAction(org, step.id);
                  onResult(
                    res.ok ? { ok: true, message: res.message } : { ok: false, error: res.error },
                  );
                })
              }
            />
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
            <ConfirmButton
              icon={Trash2}
              label={`Archive ${campaign.name}`}
              confirmLabel="Archive it"
              pending={pending}
              onConfirm={() =>
                start(async () => {
                  const res = await deleteCampaignAction(org, campaign.id);
                  onResult(
                    res.ok ? { ok: true, message: res.message } : { ok: false, error: res.error },
                  );
                  if (res.ok) onDone();
                })
              }
            />
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

const ENROLLMENT_TONE: Record<string, "success" | "warning" | "neutral" | "danger"> = {
  active: "success",
  parked: "warning",
  paused: "neutral",
  stopped: "neutral",
  completed: "neutral",
};

/**
 * Who is in a campaign, opened on demand (§14.2). Parked enrollments say why —
 * the engine parks one when it needs a person (a rejected draft, no address,
 * no mailbox) — and can be resumed or stopped from here.
 */
function EnrollmentList({
  org,
  campaignId,
  canWrite,
  onResult,
}: {
  org: string;
  campaignId: string;
  canWrite: boolean;
  onResult: (r: Result) => void;
}) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<EnrollmentRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const load = () =>
    start(async () => {
      const res = await listEnrollmentsAction(org, campaignId);
      if (res.ok) {
        setRows(res.data);
        setError(null);
      } else setError(res.error);
    });

  const parked = rows?.filter((r) => r.status === "parked").length ?? 0;

  return (
    <div>
      <Button
        size="sm"
        variant="ghost"
        aria-expanded={open}
        onClick={() => {
          setOpen((v) => !v);
          if (!rows) load();
        }}
      >
        {open ? "Hide who's enrolled" : "Show who's enrolled"}
      </Button>
      {open && (
        <div className="mt-2 rounded-md border border-line-subtle">
          {error && <p className="px-3 py-2 text-[13px] text-danger">{error}</p>}
          {!rows && !error && <p className="px-3 py-2 text-[13px] text-fg-muted">Loading…</p>}
          {rows && (
            <>
              {parked > 0 && (
                <p className="border-b border-line-subtle bg-warning-surface px-3 py-2 text-[12px] text-warning-text">
                  {parked} waiting for a person — each says why.
                </p>
              )}
              <ul className="divide-y divide-line-subtle">
                {rows.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                    <Link
                      href={`/${org}/opportunities/${r.opportunityId}`}
                      className="hl-focusable min-w-0 flex-1 rounded-sm text-[13px] text-fg hover:underline"
                    >
                      {r.company}
                    </Link>
                    <Badge variant={ENROLLMENT_TONE[r.status] ?? "neutral"}>{r.status}</Badge>
                    <span className="text-[12px] text-fg-muted">step {r.currentStep + 1}</span>
                    {canWrite && (r.status === "parked" || r.status === "paused") && (
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={pending}
                        onClick={() =>
                          start(async () => {
                            const res = await setEnrollmentStatusAction(org, r.id, "active");
                            onResult(res.ok ? { ok: true, message: res.message } : { ok: false, error: res.error });
                            if (res.ok) load();
                          })
                        }
                      >
                        Resume
                      </Button>
                    )}
                    {canWrite && ["active", "parked", "paused"].includes(r.status) && (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={pending}
                        onClick={() =>
                          start(async () => {
                            const res = await setEnrollmentStatusAction(org, r.id, "stopped");
                            onResult(res.ok ? { ok: true, message: res.message } : { ok: false, error: res.error });
                            if (res.ok) load();
                          })
                        }
                      >
                        Stop
                      </Button>
                    )}
                    {r.parkedReason && (
                      <p className="w-full text-[12px] text-fg-muted">{r.parkedReason}</p>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}
