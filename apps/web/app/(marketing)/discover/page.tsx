import Link from "next/link";
import { redirect } from "next/navigation";
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  ClaimBadge,
  ErrorState,
  Freshness,
} from "@huntloop/ui";
import { ArrowRight, Lock } from "lucide-react";
import { discoverAction } from "./actions";
import { DomainInput } from "../DomainInput";
import { resolveDestination } from "../../../lib/data/destination";

/**
 * "Here's what we understood about you" — before there is an account.
 *
 * ── Why the research runs on the server render ───────────────────────────
 *
 * Because the visitor arrived here by pressing a button that said "see what
 * Huntloop finds", and a page that then shows them a second button to press is
 * a page that has wasted their intent. The work starts on arrival.
 *
 * It is a `page` rather than a client component with an effect for the same
 * reason: an effect would run twice under StrictMode and, more importantly,
 * would render an empty shell first — which on the one screen a stranger sees
 * is the difference between "this product works" and "this product is
 * loading".
 *
 * ── What is shown and what is held back ──────────────────────────────────
 *
 * Everything Huntloop *understood* is shown in full, cited, with the claim
 * kinds visible. That is the demonstration, and holding it back would leave
 * nothing to demonstrate.
 *
 * What is held back is the part that costs money to produce and is the actual
 * product: the customer profile built from it, the companies matching that
 * profile, and the contacts at them. Those need an account because they need a
 * tenant to bill and a place to store the result — not as a growth tactic, but
 * because there is genuinely nowhere to put them.
 */
export default async function DiscoverPage({
  searchParams,
}: {
  searchParams: Promise<{ d?: string }>;
}) {
  const { d } = await searchParams;

  /* A signed-in visitor has a workspace and does not need the teaser — they
     need their own research step, which saves. `demo` is excluded for the same
     reason it is on the landing page: a deployment with no database is where
     this screen most needs to be reviewable. */
  const destination = await resolveDestination();
  if (destination.kind !== "anonymous" && destination.kind !== "demo") {
    redirect(destination.path);
  }

  if (!d) redirect("/");

  const state = await discoverAction(d);

  return (
    <div className="min-h-screen bg-canvas">
      <header className="border-b border-line-subtle">
        <div className="mx-auto flex max-w-[820px] items-center gap-2 px-6 py-3">
          <Link href="/" className="hl-focusable flex items-center gap-2 rounded-sm">
            <span className="flex size-6 items-center justify-center rounded-md bg-brand-surface text-[13px] font-bold text-brand">
              H
            </span>
            <span className="text-[14px] font-semibold text-fg">Huntloop</span>
          </Link>
          <div className="ml-auto">
            <Button variant="secondary" size="sm" href="/login" linkComponent={Link}>
              Sign in
            </Button>
          </div>
        </div>
      </header>

      <main id="main" className="mx-auto max-w-[820px] px-6 py-12">
        {state.error || !state.understanding ? (
          <>
            <h1 className="text-[26px] leading-8 font-semibold text-fg">
              {state.refused ? "Let's do this with an account" : "That didn't work"}
            </h1>
            <ErrorState
              className="mt-6"
              title={
                state.refused === "rate_limited"
                  ? "You've used up the anonymous lookups"
                  : state.refused
                    ? "Not available without an account"
                    : "We couldn't read that site"
              }
              description={state.error ?? "Something went wrong reading that address."}
            />
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <Button
                variant="primary"
                size="lg"
                icon={ArrowRight}
                href={`/signup${state.domain ? `?d=${encodeURIComponent(state.domain)}` : ""}`}
                linkComponent={Link}
              >
                Create a free account
              </Button>
              <span className="text-[13px] text-fg-muted">Or try another address:</span>
            </div>
            <div className="mt-4">
              <DomainInput size="md" />
            </div>
          </>
        ) : (
          <>
            <h1 className="text-[26px] leading-8 font-semibold text-fg">
              Here&rsquo;s what we understood about{" "}
              {state.understanding.companyName}
            </h1>
            <p className="mt-1.5 max-w-lg text-[14px] leading-[1.6] text-fg-muted">
              Read from {state.domain}. Facts name the page they came from;
              conclusions are labelled as conclusions.
            </p>

            {/* A cached reading is a claim about freshness, so it is stated.
                Presenting a three-week-old reading as if it happened just now
                would be a small lie on the page whose entire argument is that
                we do not tell them. */}
            {state.cached && state.researchedAt && (
              <p className="mt-3 flex items-center gap-2 text-[12px] text-fg-muted">
                <Freshness date={state.researchedAt} label="Read" />
                <span>
                  Someone already looked this up, so you&rsquo;re seeing the
                  saved reading rather than a fresh one.
                </span>
              </p>
            )}

            {state.isLive === false && (
              <p
                role="status"
                className="mt-4 rounded-md border border-warning-border bg-warning-surface px-3 py-2 text-[13px] leading-[1.5] text-fg-secondary"
              >
                <span className="font-medium text-warning">
                  This is a worked example, not a reading of your site.
                </span>{" "}
                No model is connected to this deployment, so nothing fetched{" "}
                {state.domain}. The shape is real; the content is not.
              </p>
            )}

            <Card flush className="mt-6">
              <CardHeader
                title={state.understanding.companyName}
                description={state.understanding.canonicalDomain}
              />
              <CardBody className="space-y-5">
                {state.understanding.findings.map((f) => (
                  <div key={f.field}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[11px] font-medium tracking-[0.06em] text-fg-muted uppercase">
                        {f.label}
                      </span>
                      <ClaimBadge kind={f.kind} confidence={f.confidence ?? undefined} />
                    </div>
                    <p className="mt-1.5 text-[14px] leading-[1.6] text-fg-secondary">
                      {f.value}
                    </p>
                    {f.kind === "fact" && f.sourceUrl && (
                      <a
                        href={f.sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hl-focusable mt-1 inline-block truncate rounded-sm font-mono text-[12px] text-fg-muted underline decoration-dotted underline-offset-2 hover:text-fg-secondary"
                      >
                        {f.sourceUrl}
                      </a>
                    )}
                  </div>
                ))}
              </CardBody>
            </Card>

            {/* The wall, and it says what is behind it rather than teasing.
                A blurred fake list of companies would be the exact thing this
                product refuses to do — presenting something that does not
                exist as if it does. */}
            <div className="mt-6 rounded-md border border-brand-border bg-brand-surface/30 p-5">
              <div className="flex items-start gap-3">
                <Lock aria-hidden className="mt-0.5 size-4 shrink-0 text-brand" strokeWidth={1.75} />
                <div className="min-w-0">
                  <h2 className="text-[15px] font-semibold text-fg">
                    Next: who you should be selling to
                  </h2>
                  <p className="mt-1.5 text-[13px] leading-[1.6] text-fg-secondary">
                    From this reading, Huntloop drafts your ideal customer
                    profile — segments, size, geography, and the buying triggers
                    worth watching — then searches for companies that match it
                    and tells you how many there are. That part needs an account,
                    because it costs real provider credits and has to be stored
                    somewhere that belongs to you.
                  </p>
                  <p className="mt-2 text-[13px] leading-[1.6] text-fg-muted">
                    You won&rsquo;t retype any of this. It carries over.
                  </p>
                  <div className="mt-4 flex flex-wrap items-center gap-3">
                    <Button
                      variant="primary"
                      size="lg"
                      icon={ArrowRight}
                      href={`/signup?d=${encodeURIComponent(state.domain ?? "")}`}
                      linkComponent={Link}
                    >
                      Continue with a free account
                    </Button>
                    <Badge variant="neutral">No card</Badge>
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}

export const metadata = {
  title: "What we found",
  /* Never indexed. Every URL under here is somebody's company domain in a
     query string, and a crawlable index of them is a public list of who has
     been evaluating Huntloop. */
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";
