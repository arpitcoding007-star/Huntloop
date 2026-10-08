import Link from "next/link";
import type { AssistantVisibility } from "../../../../lib/data/assistant";

/**
 * What the assistant reads before it answers — the list in
 * `lib/ai/workspace-context.ts`, in plain words, with the two parts a person
 * shapes (their preferences, the team's notes) counted and linked. No record
 * totals: "471 knowledge items" tells nobody what an answer can rest on.
 */
export function WhatItCanSee({
  org,
  visibility,
  focus,
}: {
  org: string;
  visibility: AssistantVisibility;
  /** The open conversation's product focus, if any. */
  focus: string | null;
}) {
  return (
    <section aria-labelledby="what-it-can-see" className="rounded-lg border border-line-subtle bg-surface p-3">
      <h2 id="what-it-can-see" className="text-[11px] font-medium tracking-label text-fg-muted uppercase">
        What it can see
      </h2>
      {focus && (
        <p className="mt-1.5 text-[12px] text-fg-secondary">
          Focused on <span className="font-medium">{focus}</span>: its opportunities only. Performance and
          competitors stay workspace-wide.
        </p>
      )}
      <ul className="mt-2 space-y-1 text-[12px] leading-[1.5] text-fg-secondary">
        <li>Your Needs you queue and the pipeline by stage</li>
        <li>Hot and warm opportunities, and any company you name</li>
        <li>The last 30 days of performance</li>
        <li>Competitors, scoring rules and source health</li>
        <li>
          <Link href={`/${org}/memory`} className="hl-focusable rounded-sm underline underline-offset-2">
            {visibility.workspaceNotes} {visibility.workspaceNotes === 1 ? "note" : "notes"} the team taught it
          </Link>
        </li>
        <li>
          <Link href={`/${org}/settings/you`} className="hl-focusable rounded-sm underline underline-offset-2">
            {visibility.yourPreferences} of your preferences
          </Link>{" "}
          — how you like answers, never cited as facts
        </li>
      </ul>
      <p className="mt-2 text-[12px] leading-[1.5] text-fg-muted">
        Nothing outside this workspace, and nothing a colleague keeps private. It learns: correct an answer
        (&ldquo;shorter&rdquo;, &ldquo;as bullets&rdquo;, &ldquo;from now on…&rdquo;) and it adapts — review what
        it learned under Settings → You.
      </p>
    </section>
  );
}
