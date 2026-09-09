import { Badge, Card, CardBody, CardHeader } from "@huntloop/ui";
import type { DiscoveryPreview } from "../../../../../lib/data/discovery-preview";

/**
 * "This is what your profile actually searches for."
 *
 * ── Why this sits under the ICP editor ───────────────────────────────────
 *
 * Because the gap between the two is invisible from either side. The editor
 * shows what somebody typed; the provider query is what runs. Between them,
 * `translateIcp` drops criteria no provider can express and
 * `expandWithLookAlikes` adds attributes derived from the example companies —
 * and until now nothing rendered either.
 *
 * ── The unmapped list is the point, not an apology ───────────────────────
 *
 * A customer whose "hiring a VP of Data" trigger silently vanished would
 * reasonably assume the results honour it. Saying that it is applied at
 * *qualification* rather than at search is more useful than a longer list of
 * filters, and it is the difference between a criterion that was understood
 * and one that was ignored.
 */
export function SearchPreview({ preview }: { preview: DiscoveryPreview | null }) {
  /* No saved search is a real state — a profile with nothing a provider can
     act on never produces one — and it is already explained by the ICP
     editor's own emptiness. A card saying "no search" under a screen that is
     visibly unfinished would be a second voice saying the same thing. */
  if (!preview) return null;

  return (
    <Card flush>
      <CardHeader
        title="What this searches for"
        description="The provider query your profile currently produces."
        actions={
          preview.schedule.enabled ? (
            <Badge variant="neutral">
              {preview.schedule.intervalMinutes === 1440
                ? "Runs daily"
                : preview.schedule.intervalMinutes
                  ? `Every ${Math.round(preview.schedule.intervalMinutes / 60)}h`
                  : "Scheduled"}
            </Badge>
          ) : (
            <Badge variant="warning">Paused</Badge>
          )
        }
      />
      <CardBody className="space-y-4">
        <p className="text-[13px] leading-[1.6] text-fg-secondary">
          {preview.sentence}
        </p>

        {/* What the example companies contributed. Shown because it widens a
            search somebody is paying for using attributes they never typed —
            an expansion nobody can see is one nobody can disagree with. */}
        {preview.addedByExamples.length > 0 && (
          <div className="border-t border-line-subtle pt-3">
            <p className="text-[11px] font-medium tracking-[0.06em] text-fg-muted uppercase">
              Added from your example companies
            </p>
            <ul className="mt-2 space-y-1">
              {preview.addedByExamples.map((added) => (
                <li key={added.field} className="text-[12px] leading-[1.5] text-fg-muted">
                  <span className="text-fg-secondary">{added.field}:</span>{" "}
                  {added.values.join(", ")}
                </li>
              ))}
            </ul>
          </div>
        )}

        {preview.unmapped.length > 0 && (
          <div className="border-t border-line-subtle pt-3">
            <p className="text-[11px] font-medium tracking-[0.06em] text-fg-muted uppercase">
              Not searchable directly
            </p>
            <ul className="mt-2 space-y-1.5">
              {preview.unmapped.map((criterion) => (
                <li
                  key={criterion.field}
                  className="text-[12px] leading-[1.5] text-fg-muted"
                >
                  <span className="text-fg-secondary">
                    {criterion.values.slice(0, 3).join(", ")}
                  </span>
                  {criterion.values.length > 3 && ` +${criterion.values.length - 3}`}
                  {" — "}
                  {criterion.reason}
                  {criterion.handledElsewhere && (
                    <span className="text-fg-secondary"> {criterion.handledElsewhere}</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
