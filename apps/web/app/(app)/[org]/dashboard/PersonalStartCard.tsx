import Link from "next/link";
import { ArrowRight, FileUp, Search } from "lucide-react";
import { Button } from "@huntloop/ui";

/**
 * A personal workspace's way into the parts that need a company (K1).
 *
 * Nothing here is unfinished setup — a personal workspace is complete the
 * moment it exists — so this is not `SetupCard` and it is not in the layout.
 * It offers what the workspace can do now, and the one thing it cannot do
 * until it knows what the person sells: search the market for them.
 */
export function PersonalStartCard({ org }: { org: string }) {
  return (
    <section aria-labelledby="personal-start-heading" className="mb-6 rounded-md border border-line bg-surface p-4">
      <h2 id="personal-start-heading" className="text-[14px] font-semibold text-fg">
        Your workspace is ready
      </h2>
      <p className="mt-0.5 max-w-2xl text-[13px] leading-[1.6] text-fg-muted">
        Research any company, or bring a list you already have. When you want Huntloop to
        find companies for you too, tell it what you sell. That takes about two minutes.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="sm" icon={Search} href={`/${org}/analyze`} linkComponent={Link}>
          Research a company
        </Button>
        <Button variant="secondary" size="sm" icon={FileUp} href={`/${org}/imports`} linkComponent={Link}>
          Import a list
        </Button>
        <Button
          variant="ghost"
          size="sm"
          icon={ArrowRight}
          href={`/welcome/company?org=${org}`}
          linkComponent={Link}
        >
          Find customers for me
        </Button>
      </div>
    </section>
  );
}
