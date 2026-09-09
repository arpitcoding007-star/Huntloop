import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { Badge, Button } from "@huntloop/ui";
import { DomainInput } from "../../DomainInput";
import { APPROACHES, findApproach } from "../approaches";
import { USE_CASES } from "../../for/use-cases";
import { resolveDestination } from "../../../../lib/data/destination";

/**
 * One page per alternative *approach*.
 *
 * See `approaches.ts` for why these compare categories rather than named
 * products, and why every page names the case where the other approach is the
 * right purchase.
 *
 * ── Why the other approach's strengths come first ────────────────────────
 *
 * Because a reader who has already chosen the other thing arrives defensive,
 * and a page that opens by listing its faults confirms they are being sold to.
 * Opening with what it is genuinely better at is both true and the only way
 * the rest of the page gets read — and it forces the comparison to be about a
 * real trade rather than a strawman.
 */
export default async function ComparePage({
  params,
}: {
  params: Promise<{ approach: string }>;
}) {
  const { approach: slug } = await params;
  const approach = findApproach(slug);
  if (!approach) notFound();

  const destination = await resolveDestination();
  if (destination.kind !== "anonymous" && destination.kind !== "demo") {
    redirect(destination.path);
  }

  return (
    <div className="min-h-screen bg-canvas">
      <header className="border-b border-line-subtle">
        <nav
          aria-label="Main"
          className="mx-auto flex max-w-[880px] items-center gap-4 px-6 py-3"
        >
          <Link href="/" className="hl-focusable flex items-center gap-2 rounded-sm">
            <span className="flex size-6 items-center justify-center rounded-md bg-brand-surface text-[13px] font-bold text-brand">
              H
            </span>
            <span className="text-[14px] font-semibold text-fg">Huntloop</span>
          </Link>
          <div className="ml-auto flex items-center gap-1">
            <Link
              href="/login"
              className="hl-focusable rounded-sm px-3 py-1.5 text-[13px] text-fg-secondary hover:text-fg"
            >
              Sign in
            </Link>
            <Button variant="primary" size="sm" href="/signup" linkComponent={Link}>
              Start free
            </Button>
          </div>
        </nav>
      </header>

      <main id="main" className="mx-auto max-w-[880px] px-6 py-14">
        <Badge variant="neutral">Compared to {approach.labelInSentence}</Badge>

        <h1 className="mt-4 text-[34px] leading-[1.15] font-semibold tracking-[-0.02em] text-fg">
          {approach.headline}
        </h1>
        <p className="mt-4 max-w-xl text-[16px] leading-[1.6] text-fg-secondary">
          {approach.subhead}
        </p>

        {/* First, and not grudging. See the header. */}
        <section className="mt-10 rounded-md border border-line-subtle bg-panel p-5">
          <h2 className="text-[15px] font-semibold text-fg">
            {approach.strengths.heading}
          </h2>
          <p className="mt-2 text-[14px] leading-[1.7] text-fg-secondary">
            {approach.strengths.body}
          </p>
        </section>

        <section className="mt-12">
          <h2 className="text-[22px] leading-8 font-semibold text-fg">
            Where they differ
          </h2>

          {/* Wide content scrolls inside its own container rather than making
              the page scroll horizontally. */}
          <div className="mt-5 overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-left">
              <thead>
                <tr className="border-b border-line">
                  <th
                    scope="col"
                    className="w-1/3 py-2 pr-4 text-[12px] font-medium text-fg-muted"
                  >
                    The question
                  </th>
                  <th scope="col" className="px-3 py-2 text-[12px] font-medium text-fg-muted">
                    {approach.label}
                  </th>
                  <th scope="col" className="px-3 py-2 text-[12px] font-semibold text-brand">
                    Huntloop
                  </th>
                </tr>
              </thead>
              <tbody>
                {approach.rows.map((row) => (
                  <tr key={row.question} className="border-b border-line-subtle align-top">
                    <th
                      scope="row"
                      className="py-3 pr-4 text-[13px] font-medium text-fg"
                    >
                      {row.question}
                    </th>
                    <td className="px-3 py-3 text-[13px] leading-[1.6] text-fg-muted">
                      {row.other}
                    </td>
                    <td className="px-3 py-3 text-[13px] leading-[1.6] text-fg-secondary">
                      {row.huntloop}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* The section that makes this a comparison rather than an advert. */}
        <section className="mt-12 rounded-md border border-warning-border bg-warning-surface/40 p-5">
          <h2 className="text-[14px] font-semibold text-warning">
            When to choose {approach.labelInSentence} instead
          </h2>
          <p className="mt-2 max-w-2xl text-[14px] leading-[1.7] text-fg-secondary">
            {approach.chooseOther}
          </p>
        </section>

        <section className="mt-14 flex flex-col items-center text-center">
          <h2 className="text-[26px] leading-9 font-semibold tracking-[-0.01em] text-fg">
            Judge it on your own market
          </h2>
          <p className="mt-2 max-w-lg text-[14px] leading-[1.6] text-fg-secondary">
            Put in your domain and read what it produces. That is worth more
            than any table.
          </p>
          <div className="mt-6 flex w-full justify-center">
            <DomainInput />
          </div>
        </section>

        <nav aria-label="More" className="mt-14 border-t border-line-subtle pt-6">
          <p className="text-[11px] font-medium tracking-[0.06em] text-fg-muted uppercase">
            Also compared to
          </p>
          <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-2">
            {APPROACHES.filter((other) => other.slug !== approach.slug).map((other) => (
              <li key={other.slug}>
                <Link
                  href={`/compare/${other.slug}`}
                  className="hl-focusable rounded-sm text-[13px] text-fg-secondary underline decoration-dotted underline-offset-2 hover:text-fg"
                >
                  {other.label}
                </Link>
              </li>
            ))}
          </ul>

          <p className="mt-5 text-[11px] font-medium tracking-[0.06em] text-fg-muted uppercase">
            Or by what you do
          </p>
          <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-2">
            {USE_CASES.map((useCase) => (
              <li key={useCase.slug}>
                <Link
                  href={`/for/${useCase.slug}`}
                  className="hl-focusable rounded-sm text-[13px] text-fg-secondary underline decoration-dotted underline-offset-2 hover:text-fg"
                >
                  {useCase.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </main>
    </div>
  );
}

/** The four, and only the four. Same reasoning as `/for/[useCase]`. */
export function generateStaticParams() {
  return APPROACHES.map((approach) => ({ approach: approach.slug }));
}

export const dynamicParams = false;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ approach: string }>;
}): Promise<Metadata> {
  const { approach: slug } = await params;
  const approach = findApproach(slug);
  if (!approach) return { title: "Not found" };

  return {
    title: approach.title,
    description: approach.subhead,
    alternates: { canonical: `/compare/${approach.slug}` },
  };
}

/* `resolveDestination` reads cookies, so this cannot be prerendered — a cached
   page would show a signed-in user the marketing site. */
export const dynamic = "force-dynamic";
