import Link from "next/link";
import { Badge } from "@huntloop/ui";
import type { MergeRecord } from "../../../../lib/data/merge-history";

/** What was merged into what, so an automatic merge is never invisible (PANEL-213). */
export function RecentMerges({ org, merges }: { org: string; merges: MergeRecord[] }) {
  if (!merges.length) return null;
  return (
    <details className="px-6 pt-6 text-[13px] lg:px-8">
      <summary className="hl-focusable cursor-pointer rounded-sm text-fg-secondary">Recent merges ({merges.length})</summary>
      <ul className="mt-2 space-y-2">
        {merges.map((m) => (
          <li key={m.id} className="flex flex-wrap items-center gap-2 text-fg-muted">
            <span>
              {m.loser ?? "A removed company"} into{" "}
              <Link href={`/${org}/companies/${m.winnerId}`} className="hl-focusable rounded-sm text-fg underline underline-offset-2">
                {m.winner}
              </Link>
            </span>
            <Badge variant="neutral">{m.method === "auto" ? "Automatic" : "By a person"}</Badge>
            {m.reverted && <Badge variant="neutral">Undone</Badge>}
            <span>
              {m.mergedAt.slice(0, 10)}
              {m.reason ? ` · ${m.reason}` : ""}
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}
