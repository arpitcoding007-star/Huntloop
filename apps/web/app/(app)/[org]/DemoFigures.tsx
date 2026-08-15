import { FlaskConical } from "lucide-react";

/**
 * States that *this screen's* figures are invented, in every configuration.
 *
 * Distinct from `DataSourceBanner`, and the distinction is the point.
 *
 * The banner answers "is this deployment connected to a database?" and
 * disappears when the answer is yes. That was sufficient while nothing was
 * connected. It stopped being sufficient the moment a real project was
 * migrated and seeded (FEAT-02): the opportunity screens began reading it, the
 * banner correctly went quiet — and the Command Center went on rendering `12
 * hot`, `180 discovered` and `2 meetings`, hard-coded, now with nothing at all
 * saying so.
 *
 * That is precisely the failure `DataSourceBanner`'s own comment warns about:
 * §7 pointed at ourselves, "a dashboard rendering invented pipeline numbers
 * with no marking". A connected database made it worse rather than better,
 * because it removed the only marking there was.
 *
 * So this one does not take a `DataSource` and has no quiet state. A screen
 * renders it when its numbers do not come from the database, and stops
 * rendering it on the commit that wires it up — which is a change a reviewer
 * can see, unlike a banner that silently stops appearing.
 */
export function DemoFigures({ what }: { what: string }) {
  return (
    <div
      role="status"
      className="mx-auto flex w-full max-w-[1600px] flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-warning-border bg-warning-surface px-4 py-2.5"
    >
      <FlaskConical className="size-3.5 shrink-0 text-warning" strokeWidth={1.75} />
      <span className="text-[12px] font-medium text-warning">
        Illustrative figures.
      </span>
      <span className="text-[12px] text-fg-secondary">
        {what} Nothing on this screen describes a real company, and none of it
        is read from your database.
      </span>
    </div>
  );
}
