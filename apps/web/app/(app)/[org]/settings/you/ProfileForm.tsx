"use client";

import { useState, useTransition } from "react";
import { Save } from "lucide-react";
import { Button, Card, CardBody, CardHeader, Field, FormMessage, Input, Select } from "@huntloop/ui";
import { ROLE_OPTIONS } from "../../../../../lib/onboarding/steps";
import { changeEmailAction, saveProfileAction } from "./profile-actions";

type Result = { ok: true; message?: string } | { ok: false; error: string } | null;

export function ProfileForm({
  org,
  profile,
  live,
}: {
  org: string;
  profile: { fullName: string; role: string | null; email: string };
  live: boolean;
}) {
  const [name, setName] = useState(profile.fullName);
  const [role, setRole] = useState(profile.role ?? "founder");
  const [email, setEmail] = useState(profile.email);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [result, setResult] = useState<Result>(null);
  const [pending, start] = useTransition();

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
