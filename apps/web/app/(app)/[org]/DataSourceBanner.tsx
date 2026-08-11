import { Database, FlaskConical } from "lucide-react";
import type { DataSource } from "../../../lib/data/source";

/**
 * States, in the product itself, that a screen is showing demo data.
 *
 * Huntloop's whole argument is that an unverified claim must never be
 * presented as established (§7). A dashboard rendering invented pipeline
 * numbers with no marking is exactly that failure, pointed at ourselves — and
 * it is the easy mistake to make, because fixtures are indistinguishable from
 * real data once they look plausible enough to demo.
 *
 * The two non-live states get different copy because they need different
 * actions: one is "you have no credentials", the other is "you have
 * credentials and one command left to run".
 *
 * Renders nothing when the data is live, so it costs nothing in production.
 */
export function DataSourceBanner({ source }: { source: DataSource }) {
  if (source === "live") return null;

  const noSchema = source === "no-schema";
  const Icon = noSchema ? Database : FlaskConical;

  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-warning-border bg-warning-surface px-6 py-2 lg:px-8"
    >
      <Icon className="size-3.5 shrink-0 text-warning" strokeWidth={1.75} />
      <span className="text-[12px] font-medium text-warning">Demo data.</span>
      <span className="text-[12px] text-fg-secondary">
        {noSchema ? (
          <>
            Supabase is connected, but the migrations haven&rsquo;t been applied
            yet — so there are no tables to read. Run them from{" "}
            <span className="font-mono text-[11px] text-fg">
              packages/db/migrations
            </span>{" "}
            in order.
          </>
        ) : (
          <>
            Supabase isn&rsquo;t configured, so this screen is showing fixtures.
            Nothing here describes a real company.
          </>
        )}
      </span>
    </div>
  );
}
