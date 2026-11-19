import Link from "next/link";
import { Card, CardHeader, Freshness } from "@huntloop/ui";
import type { Changes } from "../../../../lib/data/changes";
import type { ChangesWindow } from "../../../../lib/changes-window";
import { MarkSeen } from "./MarkSeen";

/**
 * "What changed" (debt #13): signals land on a timer, and until now nothing
 * told a returning person what had arrived while they were away.
 *
 * Renders nothing when nothing changed, apart from recording the visit: a
 * card that says "nothing new" every morning is a card people learn to skip.
 */
export function ChangesCard({
  org,
  changes,
  window,
  now,
}: {
  org: string;
  changes: Changes;
  window: ChangesWindow;
  now: Date;
}) {
  const total = changes.opportunities + changes.triggers + changes.replies;
  const seen = <MarkSeen org={org} at={now.toISOString()} />;
  if (total === 0) return seen;

  const stat = (n: number, one: string, many: string, href: string) => (
    <Link
      href={href}
      className="hl-focusable flex flex-col rounded-md px-3 py-2 transition-colors duration-[120ms] hover:bg-hover"
    >
      <span className="hl-tabular text-[20px] leading-7 font-semibold text-fg">{n}</span>
      <span className="text-[12px] text-fg-muted">{n === 1 ? one : many}</span>
    </Link>
  );

  return (
    <>
      {seen}
      <Card flush className="mb-8">
        <CardHeader title="What changed" description={`New ${window.label}.`} />
        <div className="grid grid-cols-3 gap-1 px-2 pb-2">
          {stat(changes.opportunities, "opportunity found", "opportunities found", `/${org}/opportunities`)}
          {stat(changes.triggers, "trigger recorded", "triggers recorded", `/${org}/companies`)}
          {stat(changes.replies, "reply received", "replies received", `/${org}/needs-you`)}
        </div>
        {changes.recent.length > 0 && (
          <ul className="border-t border-line-subtle px-5 py-3">
            {changes.recent.map((r, i) => (
              <li key={`${r.company}-${i}`} className="flex flex-wrap items-center gap-x-2 py-1 text-[13px]">
                {r.companyId ? (
                  <Link href={`/${org}/companies/${r.companyId}`} className="hl-focusable rounded-sm font-medium text-fg hover:underline">
                    {r.company}
                  </Link>
                ) : (
                  <span className="font-medium text-fg">{r.company}</span>
                )}
                <span className="text-fg-secondary">{r.trigger}</span>
                <Freshness date={r.at} now={now} />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
