"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Badge, Button } from "@huntloop/ui";
import type { WrittenWith as WrittenWithData } from "../../../lib/data/written-with";
import { dismissAppliedAction, setPreferenceStatusAction } from "./settings/you/actions";

/**
 * "Written with ▸" — the preferences an output was given (K2, `0044`).
 *
 * Every AI output that read preferences says which, and each of the viewer's
 * own has two ways out: **Not here** (this output should not have used it —
 * one contradiction) and **Stop using it** (pause). The workspace's are shown
 * and not switchable from here; a colleague's private ones are counted, never
 * shown.
 */
export function WrittenWith({
  org,
  data,
  subject,
}: {
  org: string;
  data: WrittenWithData | null | undefined;
  subject: { type: "message" | "conversation_message"; id: string };
}) {
  const [done, setDone] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();

  if (!data || (data.items.length === 0 && data.hidden === 0)) return null;
  const total = data.items.length + data.hidden;

  return (
    <details className="text-[12px]">
      <summary className="hl-focusable cursor-pointer rounded-sm text-fg-muted hover:text-fg">
        Written with {total} {total === 1 ? "preference" : "preferences"}
      </summary>
      <ul className="mt-1.5 space-y-1.5 pl-3">
        {data.items.map((item) => (
          <li key={item.id} className="text-fg">
            <span>{item.text}</span>{" "}
            <Badge size="sm" variant={item.origin === "learned" ? "ai" : "neutral"}>
              {item.mine ? (item.origin === "learned" ? "Learned about you" : "Yours") : "Workspace"}
            </Badge>
            {item.mine &&
              (done[item.id] ? (
                <span role="status" className="ml-2 text-fg-muted">{done[item.id]}</span>
              ) : (
                <span className="ml-2 inline-flex gap-1">
                  <Button size="sm" variant="ghost" disabled={pending}
                    onClick={() =>
                      start(async () => {
                        const res = await dismissAppliedAction(org, item.id, subject);
                        setDone((d) => ({ ...d, [item.id]: res.ok ? (res.message ?? "Noted.") : res.error }));
                      })
                    }>
                    Not here
                  </Button>
                  <Button size="sm" variant="ghost" disabled={pending}
                    onClick={() =>
                      start(async () => {
                        const res = await setPreferenceStatusAction(org, item.id, "paused");
                        setDone((d) => ({ ...d, [item.id]: res.ok ? (res.message ?? "Paused.") : res.error }));
                      })
                    }>
                    Stop using it
                  </Button>
                </span>
              ))}
          </li>
        ))}
        {data.hidden > 0 && (
          <li className="text-fg-muted">
            {data.hidden} of the sender&rsquo;s personal {data.hidden === 1 ? "preference" : "preferences"} —
            private to them.
          </li>
        )}
        <li>
          <Link href={`/${org}/settings/you`} className="hl-focusable rounded-sm text-fg-muted underline decoration-dotted underline-offset-2 hover:text-fg">
            Manage your preferences
          </Link>
        </li>
      </ul>
    </details>
  );
}
