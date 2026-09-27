"use client";

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
  Textarea,
} from "@huntloop/ui";
import { Save } from "lucide-react";
import type { Organization } from "../../../../lib/data/organization";
import { saveOrgSettingsAction } from "./actions";

/**
 * The organisation editor — §38's tenant root, as a form.
 *
 * Same shape as `ProductForm`: controlled inputs plus `useTransition`, and
 * `canAdmin` passed in rather than inferred so a member sees the screen with
 * an explanation instead of a 404. What an organisation is called is
 * information every member is entitled to read; changing it is not.
 *
 * The slug is rendered as text, not as a disabled input. A disabled field
 * still looks like a field, and it invites the question "why can't I edit
 * this?" without answering it — the sentence underneath does.
 */
export function OrgSettingsForm({
  org,
  organization,
  canAdmin,
}: {
  org: string;
  organization: Organization | null;
  canAdmin: boolean;
}) {
  const [name, setName] = useState(organization?.name ?? "");
  const [postalAddress, setPostalAddress] = useState(
    organization?.postalAddress ?? "",
  );
  const [retention, setRetention] = useState(
    organization?.contactRetentionDays === null ||
      organization?.contactRetentionDays === undefined
      ? ""
      : String(organization.contactRetentionDays),
  );

  const [result, setResult] = useState<
    { ok: true; message?: string } | { ok: false; error: string } | null
  >(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();

  function save() {
    setResult(null);
    setFieldErrors({});
    start(async () => {
      const res = await saveOrgSettingsAction(org, {
        name,
        postalAddress: postalAddress.trim() || null,
        /* Empty means "keep everything", which is a real answer and not the
           same as zero — so it travels as null rather than as 0. */
        contactRetentionDays: retention.trim() === "" ? null : Number(retention),
      });
      if (res.ok) setResult({ ok: true, message: res.message });
      else {
        setResult({ ok: false, error: res.error });
        setFieldErrors(res.fieldErrors ?? {});
      }
    });
  }

  return (
    <Card>
      <CardHeader
        title="Organisation"
        description="What this workspace is called, and the address it lives at."
      />
      <CardBody className="space-y-5">
        {!canAdmin && (
          <Note>
            Only an owner or an admin can rename the organisation. You can see
            what it is called, but not change it.
          </Note>
        )}

        <Field label="Name" required error={fieldErrors.name}>
          {(a) => (
            <Input
              {...a}
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={!canAdmin || pending}
              placeholder="Your company"
            />
          )}
        </Field>

        <div>
          <p className="text-[11px] font-medium tracking-label text-fg-muted uppercase">
            Address
          </p>
          <p className="mt-1.5 font-mono text-[13px] text-fg">
            /{organization?.slug ?? org}
          </p>
          <p className="mt-1.5 text-[12px] text-fg-muted">
            Fixed. It is the first segment of every link in this workspace, so
            changing it would break bookmarks and anything already shared.
          </p>
        </div>

        {/* Both fields below back promises the product was already making in
            public and could not keep. Grouped under a rule so they read as
            obligations rather than as preferences. */}
        <div className="space-y-5 border-t border-line-subtle pt-5">
          <Field
            label="Postal address"
            error={fieldErrors.postalAddress}
            hint="Required before this workspace can send. Every commercial email has to carry the sender's physical address, and it is added to the footer of each one."
          >
            {(a) => (
              <Textarea
                {...a}
                rows={3}
                value={postalAddress}
                onChange={(e) => setPostalAddress(e.target.value)}
                disabled={!canAdmin || pending}
                placeholder={"Acme Ltd\n1 Example Street\nLondon EC1A 1BB"}
              />
            )}
          </Field>

          <Field
            label="Contact retention"
            error={fieldErrors.contactRetentionDays}
            hint="Days to keep contact details for people you have never messaged. Leave empty to keep everything — nothing is deleted until you set a window. Minimum 30 days."
          >
            {(a) => (
              <Input
                {...a}
                type="number"
                inputMode="numeric"
                min={30}
                max={3650}
                value={retention}
                onChange={(e) => setRetention(e.target.value)}
                disabled={!canAdmin || pending}
                placeholder="Keep everything"
              />
            )}
          </Field>

          {retention.trim() !== "" && (
            <p className="rounded-md border border-warning-border bg-warning-surface px-3 py-2 text-[12px] leading-[1.5] text-fg-secondary">
              With a window set, contact details and enrichment for people you
              have never messaged are deleted once they pass it. Companies,
              opportunities and anyone you have contacted are never touched.
            </p>
          )}
        </div>

        <FormMessage result={result} />

        {canAdmin && (
          <div className="flex items-center gap-2">
            <Button variant="primary" icon={Save} onClick={save} disabled={pending}>
              {pending ? "Saving…" : "Save changes"}
            </Button>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
