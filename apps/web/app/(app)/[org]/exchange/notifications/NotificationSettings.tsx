"use client";

import { useState, useTransition } from "react";
import { Button, Card, CardHeader, Field, FormMessage, Select } from "@huntloop/ui";
import type { ExchangeCategory, ExchangePrefs } from "../../../../../lib/data/exchange";
import { saveExchangeNotificationsAction } from "../actions";

type Result = { ok: true; message?: string } | { ok: false; error: string } | null;

const ALERTS: { value: ExchangePrefs["alerts"]; label: string; detail: string }[] = [
  { value: "digest", label: "Daily digest", detail: "New matching requests in one email a day, at your digest hour." },
  { value: "instant", label: "Instant for hot requests", detail: "Requests from buyers ready to buy now, as they arrive — at most five a day. The rest go in the digest." },
  { value: "off", label: "Off", detail: "No alert emails. Matching requests still appear on your supplier profile and under Updates." },
];

const HOURS = Array.from({ length: 24 }, (_, h) => h);

export function NotificationSettings({
  org,
  prefs,
  categories,
}: {
  org: string;
  prefs: ExchangePrefs;
  categories: ExchangeCategory[];
}) {
  const [alerts, setAlerts] = useState(prefs.alerts);
  const [picked, setPicked] = useState<Set<string>>(new Set(prefs.categoryIds));
  const [emails, setEmails] = useState(prefs.emails);
  const [quietStart, setQuietStart] = useState(prefs.quietStart === null ? "" : String(prefs.quietStart));
  const [quietEnd, setQuietEnd] = useState(prefs.quietEnd === null ? "" : String(prefs.quietEnd));
  const [pending, start] = useTransition();
  const [result, setResult] = useState<Result>(null);

  const save = () =>
    start(async () => {
      const res = await saveExchangeNotificationsAction(org, {
        alerts,
        categoryIds: [...picked],
        emails,
        quietStart: quietStart === "" ? null : Number(quietStart),
        quietEnd: quietEnd === "" ? null : Number(quietEnd),
      });
      setResult(res.ok ? { ok: true, message: res.message } : { ok: false, error: res.error });
    });

  return (
    <form
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <Card>
        <CardHeader title="Alerts about matching requests" description="For suppliers. Buyers stay anonymous in every alert; you see what their card shows." />
        <fieldset className="mt-3 space-y-2">
          <legend className="sr-only">Alert frequency</legend>
          {ALERTS.map((a) => (
            <label key={a.value} htmlFor={`alerts-${a.value}`} className="flex cursor-pointer items-start gap-3 rounded-md border border-line p-3">
              <input
                id={`alerts-${a.value}`}
                aria-label={a.label}
                type="radio"
                name="alerts"
                className="mt-1"
                checked={alerts === a.value}
                onChange={() => setAlerts(a.value)}
              />
              <span>
                <span className="block text-[14px] font-medium text-fg">{a.label}</span>
                <span className="block text-[12px] text-fg-muted">{a.detail}</span>
              </span>
            </label>
          ))}
        </fieldset>
        {alerts !== "off" && (
          <div className="mt-4">
            <p className="text-[11px] leading-4 font-semibold tracking-label text-fg-muted uppercase">Categories</p>
            {categories.length === 0 ? (
              <p className="mt-1 text-[12px] text-fg-muted">Alerts cover every category you list offerings in. List an offering to choose between them.</p>
            ) : (
              <>
                <p className="mt-1 text-[12px] text-fg-muted">None ticked means all the categories you offer in.</p>
                <div className="mt-2 grid gap-1 sm:grid-cols-2">
                  {categories.map((c) => (
                    <label key={c.id} htmlFor={`cat-${c.id}`} className="flex items-center gap-2 text-[13px] text-fg">
                      <input
                        id={`cat-${c.id}`}
                        aria-label={c.path}
                        type="checkbox"
                        checked={picked.has(c.id)}
                        onChange={(e) =>
                          setPicked((s) => {
                            const next = new Set(s);
                            if (e.target.checked) next.add(c.id);
                            else next.delete(c.id);
                            return next;
                          })
                        }
                      />
                      {c.path}
                    </label>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </Card>

      <Card>
        <CardHeader title="Introductions and messages" description="When a supplier asks to talk, a buyer accepts, a new message arrives, or a request is due to be re-confirmed." />
        <label htmlFor="exchange-emails" className="mt-3 flex items-center gap-2 text-[14px] text-fg">
          <input id="exchange-emails" aria-label="Email me about introductions and messages" type="checkbox" checked={emails} onChange={(e) => setEmails(e.target.checked)} />
          Email me about these
        </label>
      </Card>

      <Card>
        <CardHeader title="Quiet hours" description={`No Exchange email in this window, in your time zone (${prefs.timezone}). What arrives waits until it ends.`} />
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <Field label="From">
            {(p) => (
              <Select {...p} value={quietStart} onChange={(e) => setQuietStart(e.target.value)}>
                <option value="">No quiet hours</option>
                {HOURS.map((h) => (
                  <option key={h} value={h}>
                    {String(h).padStart(2, "0")}:00
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Until">
            {(p) => (
              <Select {...p} value={quietEnd} onChange={(e) => setQuietEnd(e.target.value)}>
                <option value="">No quiet hours</option>
                {HOURS.map((h) => (
                  <option key={h} value={h}>
                    {String(h).padStart(2, "0")}:00
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
      </Card>

      <div className="flex items-center gap-3">
        <Button type="submit" variant="primary" disabled={pending} pending={pending ? "Saving…" : undefined}>
          Save
        </Button>
        <FormMessage result={result} />
      </div>
    </form>
  );
}
