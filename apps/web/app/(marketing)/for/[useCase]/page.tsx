import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { Badge, Button, Card, CardBody } from "@huntloop/ui";
import { Check } from "lucide-react";
import { DomainInput } from "../../DomainInput";
import { USE_CASES, findUseCase } from "../use-cases";
import { resolveDestination } from "../../../../lib/data/destination";

/**
 * One page per audience.
 *
 * ── Why these are static and enumerated ──────────────────────────────────
 *
 * `generateStaticParams` returns the four slugs and `dynamicParams` is off, so
 * `/for/anything-else` is a 404 rather than a rendered page about a use case
 * nobody wrote. That is the difference between four pages and an infinite
 * surface of near-duplicates — see the header of `use-cases.ts` for why the
 * generator version was rejected.
 *
 * ── Why every page carries a caveat ──────────────────────────────────────
 *
 * Because a page whose only job is to make an audience feel understood will
 * say yes to everything, and this product's position is that it does not. Each
 * one names the case where Huntloop is the wrong tool, in the customer's own
 * terms. It costs some conversions and buys the only thing worth more: the
 * reader believing the rest of the page.
 */
export default async function UseCasePage({
  params,
}: {
  params: Promise<{ useCase: string }>;
}) {
  const { useCase: slug } = await params;
  const useCase = findUseCase(slug);
  if (!useCase) notFound();

  /* Signed-in visitors go to their workspace, exactly as on the landing page.
     A marketing page is a wall between somebody and their work. Demo stays,
     because a deployment with no database is where this most needs reviewing. */
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
        <Badge variant="neutral">{useCase.label}</Badge>

        <h1 className="mt-4 text-[36px] leading-[1.15] font-semibold tracking-[-0.02em] text-fg">
          {useCase.headline}
        </h1>
        <p className="mt-4 max-w-xl text-[16px] leading-[1.6] text-fg-secondary">
          {useCase.subhead}
        </p>

        <div className="mt-8">
          <DomainInput size="md" />
        </div>

        <section className="mt-14">
          <h2 className="text-[22px] leading-8 font-semibold text-fg">
            {useCase.problem.heading}
          </h2>
          <p className="mt-3 max-w-2xl text-[15px] leading-[1.7] text-fg-secondary">
            {useCase.problem.body}
          </p>
        </section>

        <section className="mt-12">
          <h2 className="text-[22px] leading-8 font-semibold text-fg">
            How Huntloop fits
          </h2>
          <div className="mt-5 space-y-3">
            {useCase.fit.map((item) => (
              <Card key={item.heading} flush>
                <CardBody>
                  <div className="flex items-start gap-2.5">
                    <Check
                      aria-hidden
                      className="mt-0.5 size-4 shrink-0 text-brand"
                      strokeWidth={2.5}
                    />
                    <div className="min-w-0">
                      <h3 className="text-[14px] font-semibold text-fg">
                        {item.heading}
                      </h3>
                      <p className="mt-1 text-[13px] leading-[1.6] text-fg-muted">
                        {item.body}
                      </p>
                    </div>
                  </div>
                </CardBody>
              </Card>
            ))}
          </div>
        </section>

        {/* The thing that makes this a page rather than a landing variant: a
            profile shape somebody can act on before signing up. */}
        <section className="mt-12">
          <h2 className="text-[22px] leading-8 font-semibold text-fg">
            A profile that works for this
          </h2>
          <p className="mt-2 max-w-2xl text-[14px] leading-[1.6] text-fg-muted">
            Huntloop drafts yours from your website and shows which sentence
            each line came from. This is the shape it aims for.
          </p>
          <dl className="mt-5 divide-y divide-line-subtle rounded-md border border-line-subtle bg-panel">
            {useCase.profile.map((row) => (
              <div key={row.label} className="flex flex-wrap gap-x-4 gap-y-1 px-4 py-3">
                <dt className="w-40 shrink-0 text-[12px] font-medium tracking-[0.06em] text-fg-muted uppercase">
                  {row.label}
                </dt>
                <dd className="min-w-0 flex-1 text-[13px] leading-[1.6] text-fg-secondary">
                  {row.value}
                </dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="mt-12 rounded-md border border-warning-border bg-warning-surface/40 p-5">
          <h2 className="text-[14px] font-semibold text-warning">
            Where Huntloop is the wrong tool
          </h2>
          <p className="mt-2 max-w-2xl text-[14px] leading-[1.7] text-fg-secondary">
            {useCase.caveat}
          </p>
        </section>

        <section className="mt-14 flex flex-col items-center text-center">
          <h2 className="text-[26px] leading-9 font-semibold tracking-[-0.01em] text-fg">
            See what it finds for you
          </h2>
          <p className="mt-2 max-w-lg text-[14px] leading-[1.6] text-fg-secondary">
            Put in your domain. Two minutes, no card.
          </p>
          <div className="mt-6 flex w-full justify-center">
            <DomainInput />
          </div>
        </section>

        <nav aria-label="Other use cases" className="mt-14 border-t border-line-subtle pt-6">
          <p className="text-[11px] font-medium tracking-[0.06em] text-fg-muted uppercase">
            Also for
          </p>
          <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-2">
            {USE_CASES.filter((other) => other.slug !== useCase.slug).map((other) => (
              <li key={other.slug}>
                <Link
                  href={`/for/${other.slug}`}
                  className="hl-focusable rounded-sm text-[13px] text-fg-secondary underline decoration-dotted underline-offset-2 hover:text-fg"
                >
                  {other.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </main>
    </div>
  );
}

/**
 * The four, and only the four.
 *
 * `dynamicParams = false` is what makes this an enumeration rather than a
 * template: `/for/dentists` 404s instead of rendering a page about a use case
 * nobody wrote. Without it the route is an infinite surface of near-duplicates,
 * which is the exact pattern `use-cases.ts` argues against.
 */
export function generateStaticParams() {
  return USE_CASES.map((useCase) => ({ useCase: useCase.slug }));
}

export const dynamicParams = false;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ useCase: string }>;
}): Promise<Metadata> {
  const { useCase: slug } = await params;
  const useCase = findUseCase(slug);
  if (!useCase) return { title: "Not found" };

  return {
    title: useCase.title,
    description: useCase.subhead,
    alternates: { canonical: `/for/${useCase.slug}` },
  };
}

/* `resolveDestination` reads cookies, so this cannot be prerendered — a cached
   page would show a signed-in user the marketing site. */
export const dynamic = "force-dynamic";
