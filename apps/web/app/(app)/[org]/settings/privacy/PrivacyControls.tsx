"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  Field,
  FormMessage,
  Input,
  Note,
} from "@huntloop/ui";
import { AlertTriangle, Download, Trash2 } from "lucide-react";
import {
  deleteOrganizationAction,
  deleteOwnAccountAction,
  eraseContactAction,
  exportContactAction,
  exportOrganizationAction,
} from "./actions";

type Result = { ok: true; message?: string } | { ok: false; error: string } | null;

/**
 * The data-rights screen.
 *
 * ── Why this one screen breaks the undo convention ───────────────────────
 *
 * Everywhere else in the product a destructive action is a single click
 * followed by an undo, because everything else is a soft delete and undo
 * suits a soft delete better than a confirm does. Two of the four actions
 * here are different in kind:
 *
 *   · An erasure is somebody exercising a right. Offering to undo it would
 *     be offering to un-honour a legal request, and a mis-click that
 *     silently restored a person's data would be the worse failure.
 *   · Deleting a workspace ends it for every member, not just the clicker.
 *
 * So both take typed confirmation. The two exports take none, because they
 * do nothing but produce a file.
 */
export function PrivacyControls({
  org,
  canAdmin,
  canOwn,
  retentionDays,
  live,
}: {
  org: string;
  canAdmin: boolean;
  canOwn: boolean;
  retentionDays: number | null;
  live: boolean;
}) {
  return (
    <div className="space-y-6">
      {!canAdmin && (
        <Note>
          Only an owner or an admin can export or erase data. You can see what
          the controls are, but not use them.
        </Note>
      )}

      <AboutPeople org={org} canAdmin={canAdmin} live={live} retentionDays={retentionDays} />
      <AboutWorkspace org={org} canAdmin={canAdmin} live={live} />
      <DangerZone org={org} canOwn={canOwn} live={live} />
    </div>
  );
}

/* ── Rights belonging to the people in your database ─────────────────────── */

function AboutPeople({
  org,
  canAdmin,
  live,
  retentionDays,
}: {
  org: string;
  canAdmin: boolean;
  live: boolean;
  retentionDays: number | null;
}) {
  const [email, setEmail] = useState("");
  const [confirm, setConfirm] = useState("");
  const [result, setResult] = useState<Result>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();

  const disabled = !canAdmin || !live || pending;
  /* Erasure needs the address typed twice — once to name the subject, once
     to confirm. Comparing them case-insensitively because an email is
     case-insensitive and rejecting "Dana@" against "dana@" would be the form
     being pedantic in the place it can least afford to be. */
  const confirmed = confirm.trim().toLowerCase() === email.trim().toLowerCase() && email.trim() !== "";

  function run(fn: "export" | "erase") {
    setResult(null);
    setFieldErrors({});
    start(async () => {
      if (fn === "export") {
        const res = await exportContactAction(org, email);
        if (res.ok) {
          download(res.data.json, res.data.filename);
          setResult({ ok: true, message: `Downloaded ${res.data.filename}.` });
        } else {
          setResult({ ok: false, error: res.error });
          setFieldErrors(res.fieldErrors ?? {});
        }
        return;
      }

      const res = await eraseContactAction(org, email);
      if (res.ok) {
        setResult({ ok: true, message: res.message });
        setEmail("");
        setConfirm("");
      } else {
        setResult({ ok: false, error: res.error });
        setFieldErrors(res.fieldErrors ?? {});
      }
    });
  }

  return (
    <Card>
      <CardHeader
        title="Requests from people in your database"
        description="Someone you have researched or contacted asking for their data, or asking to be forgotten."
      />
      <CardBody className="space-y-5">
        <Field label="Email address" error={fieldErrors.email}>
          {(a) => (
            <Input
              {...a}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={disabled}
              placeholder="them@theircompany.com"
            />
          )}
        </Field>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            icon={Download}
            onClick={() => run("export")}
            disabled={disabled || !email.trim()}
          >
            Export everything held
          </Button>
          <span className="text-[12px] text-fg-muted">
            A JSON file: their record, every contact point, message headers,
            which providers were asked, and whether they are suppressed.
          </span>
        </div>

        <div className="space-y-3 rounded-md border border-danger-border bg-danger-surface p-4">
          <p className="flex items-center gap-2 text-[13px] font-medium text-danger">
            <AlertTriangle className="size-4" strokeWidth={1.75} />
            Erasure cannot be undone
          </p>
          <p className="text-[12px] leading-[1.6] text-fg-secondary">
            Contact points, enrichment records and the person row are deleted;
            message bodies are redacted. The suppression record is deliberately
            kept as a one-way hash of the address — without it, erasing someone
            would make them contactable again, which is the opposite of what
            they asked for.
          </p>
          <Field label="Retype the address to confirm" error={fieldErrors.confirmation}>
            {(a) => (
              <Input
                {...a}
                type="email"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                disabled={disabled}
                placeholder="them@theircompany.com"
              />
            )}
          </Field>
          <Button
            variant="danger"
            icon={Trash2}
            onClick={() => run("erase")}
            disabled={disabled || !confirmed}
          >
            {pending ? "Working…" : "Erase permanently"}
          </Button>
        </div>

        <p className="text-[12px] leading-[1.6] text-fg-muted">
          {retentionDays === null ? (
            <>
              No retention window is set, so contact details are kept
              indefinitely. Set one under{" "}
              <Link
                href={`/${org}/settings`}
                className="hl-focusable rounded-sm text-brand-text underline underline-offset-2"
              >
                Organisation
              </Link>{" "}
              and details for people you have never messaged are deleted
              automatically once they pass it.
            </>
          ) : (
            <>
              Contact details for people you have never messaged are deleted
              automatically after {retentionDays} days. Change that under{" "}
              <Link
                href={`/${org}/settings`}
                className="hl-focusable rounded-sm text-brand-text underline underline-offset-2"
              >
                Organisation
              </Link>
              .
            </>
          )}
        </p>

        <FormMessage result={result} />
      </CardBody>
    </Card>
  );
}

/* ── The customer's own data ─────────────────────────────────────────────── */

function AboutWorkspace({
  org,
  canAdmin,
  live,
}: {
  org: string;
  canAdmin: boolean;
  live: boolean;
}) {
  const [result, setResult] = useState<Result>(null);
  const [pending, start] = useTransition();

  return (
    <Card>
      <CardHeader
        title="Your own data"
        description="Everything this workspace holds that you put in, or that Huntloop concluded from it."
      />
      <CardBody className="space-y-4">
        <Button
          variant="secondary"
          icon={Download}
          disabled={!canAdmin || !live || pending}
          onClick={() => {
            setResult(null);
            start(async () => {
              const res = await exportOrganizationAction(org);
              if (res.ok) {
                download(res.data.json, res.data.filename);
                setResult({ ok: true, message: `Downloaded ${res.data.filename}.` });
              } else setResult({ ok: false, error: res.error });
            });
          }}
        >
          {pending ? "Preparing…" : "Export this workspace"}
        </Button>
        <p className="text-[12px] leading-[1.6] text-fg-muted">
          Companies, opportunities, your ICPs, products and memories in full.
          Evidence, messages, people and AI run records are counted rather than
          included because they are large — the export says so itself, and any
          of them can be produced separately on request.
        </p>
        <FormMessage result={result} />
      </CardBody>
    </Card>
  );
}

/* ── Ending things ───────────────────────────────────────────────────────── */

function DangerZone({ org, canOwn, live }: { org: string; canOwn: boolean; live: boolean }) {
  const [orgConfirm, setOrgConfirm] = useState("");
  const [accountConfirm, setAccountConfirm] = useState("");
  const [result, setResult] = useState<Result>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();

  return (
    <Card>
      <CardHeader
        title="Deleting things"
        description="Both of these end access for real. Neither is offered with an undo."
      />
      <CardBody className="space-y-6">
        <div className="space-y-3 rounded-md border border-danger-border bg-danger-surface p-4">
          <p className="text-[13px] font-medium text-danger">Delete this workspace</p>
          <p className="text-[12px] leading-[1.6] text-fg-secondary">
            Every member loses access, all outreach stops, and every scheduled
            source is disabled. {canOwn ? "" : "Only an owner can do this. "}
            The data is retained for the recovery window in our retention
            policy and then removed.
          </p>
          <Field label={`Type ${org} to confirm`} error={fieldErrors.confirmation}>
            {(a) => (
              <Input
                {...a}
                value={orgConfirm}
                onChange={(e) => setOrgConfirm(e.target.value)}
                disabled={!canOwn || !live || pending}
                placeholder={org}
              />
            )}
          </Field>
          <Button
            variant="danger"
            icon={Trash2}
            disabled={!canOwn || !live || pending || orgConfirm.trim() !== org}
            onClick={() => {
              setResult(null);
              setFieldErrors({});
              start(async () => {
                const res = await deleteOrganizationAction(org, orgConfirm);
                if (res.ok) {
                  /* Hard navigation rather than router.push: every loader in
                     the app filters `deleted_at is null`, so a client-side
                     transition would render this screen against a workspace
                     that no longer resolves. */
                  window.location.href = "/orgs";
                } else {
                  setResult({ ok: false, error: res.error });
                  setFieldErrors(res.fieldErrors ?? {});
                }
              });
            }}
          >
            Delete workspace
          </Button>
        </div>

        <div className="space-y-3 rounded-md border border-danger-border bg-danger-surface p-4">
          <p className="text-[13px] font-medium text-danger">Delete your account</p>
          <p className="text-[12px] leading-[1.6] text-fg-secondary">
            Removes your sign-in and your membership of every workspace. If you
            are the only owner of a workspace that still exists, this is refused
            and says which one — delete it or make somebody else an owner first.
          </p>
          <Field label="Type “delete my account” to confirm" error={fieldErrors.confirmation}>
            {(a) => (
              <Input
                {...a}
                value={accountConfirm}
                onChange={(e) => setAccountConfirm(e.target.value)}
                disabled={!live || pending}
                placeholder="delete my account"
              />
            )}
          </Field>
          <Button
            variant="danger"
            icon={Trash2}
            disabled={
              !live || pending || accountConfirm.trim().toLowerCase() !== "delete my account"
            }
            onClick={() => {
              setResult(null);
              setFieldErrors({});
              start(async () => {
                const res = await deleteOwnAccountAction(accountConfirm);
                if (res.ok) window.location.href = "/login";
                else {
                  setResult({ ok: false, error: res.error });
                  setFieldErrors(res.fieldErrors ?? {});
                }
              });
            }}
          >
            Delete my account
          </Button>
        </div>

        <FormMessage result={result} />
      </CardBody>
    </Card>
  );
}

/**
 * Hand the browser a file.
 *
 * A blob URL rather than a route handler: the export is produced by a Server
 * Action for one admin looking at one screen, and a URL that re-fetches
 * somebody's complete dossier on every visit is a thing worth not creating.
 * The object URL is revoked immediately — the download has already started by
 * the time `click()` returns.
 */
function download(json: string, filename: string): void {
  const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
