import Link from "next/link";
import type { ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { legalIsComplete, missingLegalFacts } from "../../../lib/legal";

/**
 * The chrome the three legal pages share.
 *
 * ── Why the draft banner is loud ─────────────────────────────────────────
 *
 * A half-written policy that looks finished is the failure worth designing
 * against here. Somebody arriving at this page — a reviewer, a customer's
 * procurement team, a regulator — has to be able to tell in one glance
 * whether this document is in force. So the incomplete state is a warning
 * surface at the top, not a footnote, and the page is `noindex` until every
 * `PENDING` in `lib/legal.ts` is filled.
 */
export function LegalPage({
  title,
  updated,
  children,
}: {
  title: string;
  updated: string;
  children: ReactNode;
}) {
  const missing = missingLegalFacts();

  return (
    <main id="main" className="mx-auto max-w-[760px] px-6 py-12">
      <Link
        href="/"
        className="hl-focusable rounded-sm text-[13px] text-fg-muted hover:text-fg-secondary"
      >
        ← Huntloop
      </Link>

      <h1 className="hl-heading mt-6 text-fg">
        {title}
      </h1>
      <p className="mt-2 text-[13px] text-fg-muted">Last updated {updated}</p>

      {!legalIsComplete() && (
        <div className="mt-6 rounded-md border border-warning-border bg-warning-surface p-4">
          <p className="flex items-center gap-2 text-[13px] font-medium text-warning">
            <AlertTriangle className="size-4 shrink-0" strokeWidth={1.75} />
            Draft — not in force
          </p>
          <p className="mt-2 text-[13px] leading-[1.6] text-fg-secondary">
            Everything below describing what the software does is accurate and
            was checked against the source. {missing.length} fact
            {missing.length === 1 ? "" : "s"} that only the business can supply
            {missing.length === 1 ? " is" : " are"} still missing, and
            {missing.length === 1 ? " it is" : " they are"} marked in place
            rather than guessed. This page is excluded from search engines and
            is not linked from the site until they are filled in.
          </p>
        </div>
      )}

      <div className="mt-8 space-y-8">{children}</div>
    </main>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="text-[18px] leading-7 font-semibold text-fg">{title}</h2>
      <div className="mt-3 space-y-3 text-[14px] leading-[1.7] text-fg-secondary">
        {children}
      </div>
    </section>
  );
}

/**
 * A fact nobody has supplied yet, rendered as a visible gap.
 *
 * Deliberately not a blank, an ellipsis, or a plausible placeholder like
 * "Huntloop Ltd, London". Each of those reads as content. This reads as an
 * absence, which is what it is.
 */
export function Pending({ what, why }: { what: string; why: string }) {
  return (
    <span className="inline-flex flex-col gap-0.5 rounded-sm border border-dashed border-warning-border bg-warning-surface px-2 py-1 align-top">
      <span className="font-mono text-[11px] font-medium tracking-[0.04em] text-warning uppercase">
        Requires legal review — {what}
      </span>
      <span className="text-[12px] leading-[1.5] text-fg-muted">{why}</span>
    </span>
  );
}

/** A fact if we have it, a visible gap if we do not. */
export function Fact({
  value,
  what,
  why,
}: {
  value: string | null;
  what: string;
  why: string;
}) {
  if (value) return <>{value}</>;
  return <Pending what={what} why={why} />;
}
