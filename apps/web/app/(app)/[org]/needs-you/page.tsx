import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, CardBody, EmptyState } from "@huntloop/ui";
import { CheckCircle2 } from "lucide-react";
import { currentViewer } from "../../../../lib/data/membership";
import { defaultOwnership, getNeedsYou } from "../../../../lib/data/needs-you";
import { getOnboardingState } from "../../../../lib/data/onboarding";
import { personalize } from "../../../../lib/data/personalization";
import type { OwnershipFilter } from "../../../../lib/needs-you/rank";
import { DemoFigures } from "../DemoFigures";
import { NeedsYouList } from "./NeedsYouList";
import { ClearSnoozesButton } from "./ClearSnoozesButton";

/**
 * "Needs you" — the whole queue. COMMAND.md §16.3-B.
 *
 * The dashboard rail shows the top five; this is where the rest live, grouped
 * by the kind of work so a person can clear conversations before follow-ups
 * before workspace housekeeping. The filter is a link, not a toggle in state,
 * so a manager can send a colleague "/needs-you?filter=unassigned".
 */

const FILTERS: { value: OwnershipFilter; label: string }[] = [
  { value: "mine", label: "Mine" },
  { value: "unassigned", label: "Unassigned" },
  { value: "everyone", label: "Everyone" },
];

export default async function NeedsYouPage({
  params,
  searchParams,
}: {
  params: Promise<{ org: string }>;
  searchParams: Promise<{ filter?: string }>;
}) {
  const { org } = await params;
  const { filter: requested } = await searchParams;

  const viewer = await currentViewer(org);
  if (!viewer) notFound();

  const onboarding = await getOnboardingState(org);
  const fallback = defaultOwnership(
    personalize(onboarding?.role ?? null, onboarding?.goals ?? [], org).defaultFilter,
  );
  const filter: OwnershipFilter = FILTERS.some((f) => f.value === requested)
    ? (requested as OwnershipFilter)
    : fallback;

  const { data, source } = await getNeedsYou(org, filter);

  return (
    <div className="mx-auto w-full max-w-[1100px] px-6 py-8 lg:px-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="hl-heading text-fg">Needs you</h1>
          <p className="mt-1 max-w-[640px] text-[13px] text-fg-muted">
            What deserves a person next, ranked by how urgent and how valuable it is. Every item
            says why it is here. Accounts a sequence is already following up are left to the
            sequence; anything gone quiet after {data.quietAfterBusinessDays} business days without
            a reply shows up here.
          </p>
        </div>
        <nav aria-label="Whose work" className="flex rounded-md border border-line bg-surface p-0.5">
          {FILTERS.map((f) => (
            <Link
              key={f.value}
              href={`/${org}/needs-you?filter=${f.value}`}
              aria-current={filter === f.value ? "page" : undefined}
              className={[
                "hl-focusable rounded-[5px] px-3 py-1.5 text-[13px] transition-colors duration-[120ms]",
                filter === f.value
                  ? "bg-brand-surface font-medium text-brand-text"
                  : "text-fg-muted hover:text-fg-secondary",
              ].join(" ")}
            >
              {f.label}
            </Link>
          ))}
        </nav>
      </header>

      {source !== "live" && (
        <div className="mt-6">
          <DemoFigures what="This queue is built from example opportunities, not your workspace." />
        </div>
      )}

      <div className="mt-6">
        {data.items.length === 0 ? (
          <Card>
            <CardBody>
              <EmptyState
                icon={CheckCircle2}
                title="Nothing needs you right now"
                description={
                  filter === "mine"
                    ? "Nothing on the accounts you own is waiting on you. Switch to Everyone to see the rest of the workspace."
                    : "No replies are waiting, nothing is due, and nothing has gone quiet. New items appear here as they happen."
                }
              />
            </CardBody>
          </Card>
        ) : (
          <NeedsYouList org={org} items={data.items} grouped />
        )}
      </div>

      {data.snoozedCount > 0 && (
        <div className="mt-6 flex flex-wrap items-center gap-3 text-[13px] text-fg-muted">
          <span>
            {data.snoozedCount} {data.snoozedCount === 1 ? "item is" : "items are"} snoozed and will
            come back on their own.
          </span>
          <ClearSnoozesButton org={org} />
        </div>
      )}
    </div>
  );
}

export const metadata = { title: "Needs you" };
