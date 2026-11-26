"use client";

import { useId, useState, useTransition } from "react";
import { ImageUp, Save, Trash2 } from "lucide-react";
import { Avatar, Button, Card, CardBody, CardHeader, Field, FormMessage, Input, Select } from "@huntloop/ui";
import { resizeToAvatar } from "../../../../../lib/avatar-resize";
import { ROLE_OPTIONS } from "../../../../../lib/onboarding/steps";
import { changeEmailAction, savePictureAction, saveProfileAction } from "./profile-actions";

type Result = { ok: true; message?: string } | { ok: false; error: string } | null;

export function ProfileForm({
  org,
  profile,
  live,
}: {
  org: string;
  profile: { fullName: string; role: string | null; email: string; avatarUrl: string | null };
  live: boolean;
}) {
  const [name, setName] = useState(profile.fullName);
  const [role, setRole] = useState(profile.role ?? "founder");
  const [email, setEmail] = useState(profile.email);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [result, setResult] = useState<Result>(null);
  const [pending, start] = useTransition();
  /* The picture: what is stored, and a resized one waiting to be saved. */
  const [picture, setPicture] = useState<string | null>(profile.avatarUrl);
  const [chosen, setChosen] = useState<string | null>(null);
  const fileId = useId();

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
    <Card id="profile">
      <CardHeader title="Your profile" description="Your name is shown to your team and used to sign drafts." />
      <CardBody className="space-y-4">
        <div className="flex flex-wrap items-center gap-4">
          <Avatar initials={name || profile.email || "You"} src={chosen ?? picture} className="size-16 text-[18px]" />
          <div className="min-w-[220px] flex-1 space-y-2">
            <div className="flex flex-wrap gap-2">
              {/* A real file input inside a visible label styled as the
                  secondary button: reachable and named for keyboard and
                  screen-reader users, with the focus ring drawn on the label. */}
              <label
                htmlFor={fileId}
                className={[
                  "inline-flex h-9 cursor-pointer items-center gap-2 rounded-[8px] border border-line bg-surface px-3 text-[13px] font-medium text-fg",
                  "hover:border-brand-border hover:bg-hover has-[:focus-visible]:shadow-[var(--hl-focus-ring)]",
                  !live || pending ? "pointer-events-none opacity-50" : "",
                ].join(" ")}
              >
                <input
                  id={fileId}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="sr-only"
                  disabled={!live || pending}
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (!file) return;
                    setResult(null);
                    try {
                      setChosen(await resizeToAvatar(file));
                    } catch (err) {
                      setChosen(null);
                      setResult({ ok: false, error: err instanceof Error ? err.message : "That picture could not be read." });
                    }
                  }}
                />
                <ImageUp aria-hidden className="size-4 shrink-0" strokeWidth={1.75} />
                {picture || chosen ? "Choose another picture" : "Choose a picture"}
              </label>
              {chosen && (
                <Button
                  variant="primary"
                  icon={Save}
                  disabled={pending}
                  onClick={() =>
                    run(async () => {
                      const res = await savePictureAction(org, chosen);
                      if (res.ok) {
                        setPicture(chosen);
                        setChosen(null);
                      }
                      return res;
                    })
                  }
                >
                  Save picture
                </Button>
              )}
              {chosen ? (
                <Button disabled={pending} onClick={() => setChosen(null)}>
                  Cancel
                </Button>
              ) : (
                picture && (
                  <Button
                    icon={Trash2}
                    disabled={!live || pending}
                    onClick={() =>
                      run(async () => {
                        const res = await savePictureAction(org, null);
                        if (res.ok) setPicture(null);
                        return res;
                      })
                    }
                  >
                    Remove picture
                  </Button>
                )
              )}
            </div>
            <p className="text-[12px] text-fg-muted">
              Shown to your team. Cropped to a square and stored small; location and camera details are removed.
            </p>
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Your name" required error={errors.fullName}>
            {(a) => <Input {...a} value={name} maxLength={120} disabled={!live || pending} onChange={(e) => setName(e.target.value)} />}
          </Field>
          <Field label="Kind of work" hint="Orders your home screen. It hides nothing." error={errors.role}>
            {(a) => (
              <Select {...a} value={role} disabled={!live || pending} onChange={(e) => setRole(e.target.value)}>
                {ROLE_OPTIONS.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        <Button variant="primary" icon={Save} disabled={!live || pending} onClick={() => run(() => saveProfileAction(org, { fullName: name, role }))}>
          Save profile
        </Button>
        <div className="flex flex-wrap items-center gap-3 border-t border-line-subtle pt-4">
          <Field label="Sign-in email" hint="You confirm a new address by email before it changes." error={errors.email} className="min-w-[260px] flex-1">
            {(a) => <Input {...a} type="email" value={email} disabled={!live || pending} onChange={(e) => setEmail(e.target.value)} />}
          </Field>
          <Button disabled={!live || pending || !email.trim() || email.trim().toLowerCase() === profile.email.toLowerCase()} onClick={() => run(() => changeEmailAction(org, { email }))}>
            Change email
          </Button>
        </div>
        <FormMessage result={result} />
      </CardBody>
    </Card>
  );
}
