"use client";

import { useEffect, useState, useTransition } from "react";
import { Button, Card, CardBody, CardHeader, Field, FormMessage, Note, Select } from "@huntloop/ui";
import { Save } from "lucide-react";
import type { NotificationPreferences } from "../../../../lib/data/notifications";
import { saveNotificationPreferencesAction } from "./notification-actions";

/**
 * Your own email for this workspace: the daily "Needs you" summary. It is
 * sent only on days something needs you, at the hour you choose in your own
 * time zone, and every one carries a one-click way to stop it.
 */
export function NotificationsForm({
  org,
  preferences,
  timeZones,
  emailConfigured,
  demo,
}: {
  org: string;
  preferences: NotificationPreferences;
  timeZones: string[];
  emailConfigured: boolean;
  demo: boolean;
}) {
  const [daily, setDaily] = useState(preferences.dailyDigest);
  const [hour, setHour] = useState(preferences.digestHour);
  const [zone, setZone] = useState(preferences.timezone);
  const [result, setResult] = useState<{ ok: true; message?: string } | { ok: false; error: string } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();

  /* The browser's own zone, offered once: most people never think to set one.
     Read after mount, so the server render and the first client render agree. */
  const [browserZone, setBrowserZone] = useState<string | null>(null);
  useEffect(() => {
    setBrowserZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
  }, []);

  return (
    <Card id="notifications">
      <CardHeader
        title="Your email"
        description="Just for you, in this workspace. Nobody else's settings change."
      />
      <CardBody className="space-y-4">
        {!emailConfigured && (
          <Note tone="warning">
            This deployment has no email service connected yet, so nothing is sent. Your choices
            are kept and apply as soon as it is.
          </Note>
        )}

        <label className="flex items-start gap-2.5 text-[13px] text-fg">
          <input
            type="checkbox"
            checked={daily}
            disabled={pending || demo}
            onChange={(e) => setDaily(e.target.checked)}
            className="mt-0.5 size-4 accent-[var(--color-brand)]"
          />
          <span>
            Daily “Needs you” summary
            <span className="mt-0.5 block text-[12px] text-fg-muted">
              The top of your queue — replies waiting, drafts to approve, follow-ups due. Only on
              days something needs you.
            </span>
          </span>
        </label>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Send after" error={errors.digestHour}>
            {(a) => (
              <Select
                {...a}
                value={String(hour)}
                disabled={pending || demo || !daily}
                onChange={(e) => setHour(Number(e.target.value))}
              >
                {Array.from({ length: 24 }, (_, h) => (
                  <option key={h} value={h}>
                    {String(h).padStart(2, "0")}:00
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field
            label="Time zone"
            hint={
              browserZone && browserZone !== zone && timeZones.includes(browserZone) ? (
                <button
                  type="button"
                  className="hl-focusable rounded-sm underline underline-offset-2"
                  onClick={() => setZone(browserZone)}
                >
                  Use {browserZone}
                </button>
              ) : undefined
            }
            error={errors.timezone}
          >
            {(a) => (
              <Select {...a} value={zone} disabled={pending || demo || !daily} onChange={(e) => setZone(e.target.value)}>
                {timeZones.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>

        <Button
          variant="primary"
          icon={Save}
          disabled={pending || demo}
          onClick={() =>
            start(async () => {
              setResult(null);
              setErrors({});
              const res = await saveNotificationPreferencesAction(org, {
                dailyDigest: daily,
                digestHour: hour,
                timezone: zone,
              });
              if (res.ok) setResult({ ok: true, message: res.message });
              else {
                setResult({ ok: false, error: res.error });
                setErrors(res.fieldErrors ?? {});
              }
            })
          }
        >
          {pending ? "Saving…" : "Save"}
        </Button>
        <FormMessage result={result} />
      </CardBody>
    </Card>
  );
}
