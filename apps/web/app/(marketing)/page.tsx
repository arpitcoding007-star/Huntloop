import Link from "next/link";
import { redirect } from "next/navigation";
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  ClaimBadge,
  PriorityBadge,
  ScorePill,
} from "@huntloop/ui";
import {
  Binoculars,
  BrainCircuit,
  Check,
  Database,
  Mail,
  Minus,
  Radar,
  Scale,
  Send,
  Target,
  Users,
} from "lucide-react";
import { DomainInput } from "./DomainInput";
import { describeLimit, listPlans } from "../../lib/data/plans";
import { resolveDestination } from "../../lib/data/destination";
import type { UseCase } from "./for/use-cases";

/**
 * The front door.
 *
 * ── What was here before ─────────────────────────────────────────────────
 *
 * `redirect("/login")`, with a comment saying a landing page is where this
 * file goes when one lands. The sitemap and the Open Graph `url` already
 * pointed at it, so the entire top of the funnel was a sign-in box whose
 * subtitle was the only marketing copy in the product.
 *
 * ── The position, and why it is narrow ───────────────────────────────────
 *
 * The category is crowded and Huntloop's actual difference is one thing: **it
 * shows its work.** Every score decomposes into the rules that produced it,
 * every claim cites the page it was read on, an inference is labelled as an
 * inference, and the system refuses rather than fabricates. That is unusual
 * enough to be the whole position, and it is the only claim on this page that
 * a competitor cannot copy by writing different words.
 *
 * So the page is not framed as an "AI SDR". That promises autonomy the product
 * deliberately does not take — a person approves every message — and it invites
 * the one comparison Huntloop loses. It is framed as a research analyst for
 * your pipeline: discovery is a feature, *explained* discovery is the product.
 *
 * ── Why a signed-in visitor never sees it ────────────────────────────────
 *
 * Because for them it is a wall between them and their work. `/` is the URL
 * people type and the one their browser autocompletes, so it has to be the
 * fastest route into the workspace for anybody who already has one.
 */
export default async function LandingPage() {
  const destination = await resolveDestination();

  /*
   * Signed-in visitors go where they were going. Everyone else gets the page.
   *
   * `demo` is deliberately in the second group. It is tempting to send a
   * deployment with no database straight to the fixture workspace — there is
   * nothing to sign in to, so the sign-up CTA cannot work — but doing that
   * makes the landing page unreachable on exactly the setup every reviewer and
   * every fresh checkout runs, which is where it most needs looking at. The
   * page is static content and renders correctly with no database; the demo
   * workspace stays one click away through the sign-in screen, which already
   * links to it and already explains why.
   */
  if (destination.kind !== "anonymous" && destination.kind !== "demo") {
    redirect(destination.path);
  }

  const { data: plans } = await listPlans();

  return (
    <div className="min-h-screen bg-canvas">
      <Nav />

      <main id="main">
        <Hero />
        <Loop />
        <WhyNow />
        <Scoring />
        <UseCases />
        <Comparison />
        <Proof />
        <Integrations />
        <Pricing plans={plans} />
        <Faq />
        <FinalCta />
      </main>

      <Footer />
    </div>
  );
}

/* ── 1 · Nav ─────────────────────────────────────────────────────────────── */

function Nav() {
  return (
    <header className="sticky top-0 z-30 border-b border-line-subtle bg-canvas/90 backdrop-blur">
      <nav
        aria-label="Main"
        className="mx-auto flex max-w-[1100px] items-center gap-6 px-6 py-3"
      >
        <Link href="/" className="hl-focusable flex items-center gap-2 rounded-sm">
          <span className="flex size-6 items-center justify-center rounded-md bg-brand-surface text-[13px] font-bold text-brand">
            H
          </span>
          <span className="text-[14px] font-semibold text-fg">Huntloop</span>
        </Link>

        <div className="ml-auto flex items-center gap-1">
          {/* Only anchors to sections that exist on this page. A nav that links
              to a Docs site nobody has written is the `NAV-02` failure the
              product's own audit script exists to catch, and shipping it on
              the marketing page would be the same mistake with more traffic. */}
          <a
            href="#how"
            className="hl-focusable hidden rounded-sm px-3 py-1.5 text-[13px] text-fg-secondary hover:text-fg sm:block"
          >
            How it works
          </a>
          <a
            href="#use-cases"
            className="hl-focusable hidden rounded-sm px-3 py-1.5 text-[13px] text-fg-secondary hover:text-fg sm:block"
          >
            Use cases
          </a>
          <a
            href="#pricing"
            className="hl-focusable hidden rounded-sm px-3 py-1.5 text-[13px] text-fg-secondary hover:text-fg sm:block"
          >
            Pricing
          </a>
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
  );
}

/* ── 2 · Hero ────────────────────────────────────────────────────────────── */

function Hero() {
  return (
    <section className="mx-auto max-w-[1100px] px-6 pt-16 pb-12 sm:pt-24">
      <div className="grid items-start gap-12 min-[1000px]:grid-cols-[minmax(0,1fr)_420px]">
        <div>
          <Badge variant="neutral">Discover → Qualify → Enrich → Reach out → Track → Learn</Badge>

          <h1 className="mt-4 text-[40px] leading-[1.1] font-semibold tracking-[-0.02em] text-fg sm:text-[52px]">
            Know who needs you
            <br />
            before you reach out.
          </h1>

          <p className="mt-5 max-w-xl text-[17px] leading-[1.6] text-fg-secondary">
            Huntloop watches your market, finds the companies that just became a
            fit, tells you why — with sources — and drafts the outreach. You
            approve.
          </p>

          {/* The proof line. Stated this high because it is the position, not a
              feature, and a visitor who reads only the top of the page should
              leave with it. */}
          <p className="mt-4 max-w-xl text-[14px] leading-[1.6] text-fg-muted">
            Every score shows its working. Every claim names its source. When we
            don&rsquo;t know, we say so.
          </p>

          <div className="mt-8">
            <DomainInput />
          </div>
        </div>

        {/* The card is the pitch, not an illustration. It is built from the same
            components the product renders, so what a visitor sees here is
            literally what they get. */}
        <div className="min-[1000px]:pt-8">
          <SampleOpportunity />
        </div>
      </div>
    </section>
  );
}

/**
 * One opportunity card, as the product renders it.
 *
 * ── Why this company and this evidence ───────────────────────────────────
 *
 * It is a **worked example, and it says so**. Every figure is invented, and
 * the caption underneath states that in plain words rather than in a footnote.
 *
 * The alternative — a real company with real cited evidence — is more
 * persuasive and is not ours to publish: it would mean putting a named
 * third party on a marketing page as somebody's prospect, scored, with a
 * "why now" attached. A product whose position is honesty does not open with
 * that.
 */
function SampleOpportunity() {
  return (
    <div>
      <Card flush>
        <CardHeader
          title="Northwind Systems"
          description="northwind.example"
          actions={
            <div className="flex items-center gap-2">
              <PriorityBadge
                priority="hot"
                reason="Raised 11 days ago and is hiring for the exact function this product replaces."
              />
              <ScorePill
                score={87}
                confidence="high"
                explanation="Strong fit on segment, size and technology; the trigger is recent and first-party."
              />
            </div>
          }
        />
        <CardBody className="space-y-3">
          <div>
            <p className="text-[11px] font-medium tracking-[0.06em] text-fg-muted uppercase">
              Why now
            </p>
            <p className="mt-1 text-[13px] leading-[1.6] text-fg-secondary">
              Announced a Series B 11 days ago and opened two roles for
              infrastructure engineers in the week after.
            </p>
          </div>

          <div className="space-y-2 border-t border-line-subtle pt-3">
            <div className="flex items-start gap-2">
              <ClaimBadge kind="fact" confidence="high" />
              <p className="min-w-0 flex-1 text-[12px] leading-[1.5] text-fg-secondary">
                Raised a $24m Series B.{" "}
                <span className="font-mono text-fg-muted underline decoration-dotted underline-offset-2">
                  northwind.example/blog/series-b
                </span>
              </p>
            </div>
            <div className="flex items-start gap-2">
              <ClaimBadge kind="inference" confidence="medium" />
              <p className="min-w-0 flex-1 text-[12px] leading-[1.5] text-fg-secondary">
                Likely to be replacing their in-house tooling this quarter.
              </p>
            </div>
            <div className="flex items-start gap-2">
              <ClaimBadge kind="unknown" />
              <p className="min-w-0 flex-1 text-[12px] leading-[1.5] text-fg-secondary">
                Whether budget is allocated. Nothing on the site says.
              </p>
            </div>
          </div>
        </CardBody>
      </Card>

      <p className="mt-2 text-[11px] leading-[1.5] text-fg-muted">
        A worked example. Northwind is not a real company and these figures are
        invented — the layout, the claim labels and the citations are exactly
        what the product renders.
      </p>
    </div>
  );
}

/* ── 3 · The loop ────────────────────────────────────────────────────────── */

const STAGES = [
  {
    icon: Radar,
    name: "Discover",
    text: "Search your market for companies matching your profile, and watch the sources where they show up.",
  },
  {
    icon: Scale,
    name: "Qualify",
    text: "Judge each one against your ICP. Huntloop is willing to answer no, and says why.",
  },
  {
    icon: Users,
    name: "Enrich",
    text: "Work out who to talk to, and how to reach them — with the provider's own confidence, never a guess dressed up.",
  },
  {
    icon: Send,
    name: "Reach out",
    text: "Draft a message grounded in why this company, right now. Nothing sends without you.",
  },
  {
    icon: Target,
    name: "Track",
    text: "Replies classified, threads kept, outcomes recorded against the opportunity that produced them.",
  },
  {
    icon: BrainCircuit,
    name: "Learn",
    text: "Which triggers actually convert, which messages get replies, and what your profile should say next.",
  },
];

function Loop() {
  return (
    <section id="how" className="border-y border-line-subtle bg-panel">
      <div className="mx-auto max-w-[1100px] px-6 py-16">
        <h2 className="text-[28px] leading-9 font-semibold tracking-[-0.01em] text-fg">
          One loop, not six tools
        </h2>
        <p className="mt-2 max-w-2xl text-[15px] leading-[1.6] text-fg-secondary">
          Each stage feeds the next, and the last one feeds the first. That is
          the whole design — what you learn from a reply changes who gets found
          next week.
        </p>

        <ol className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {STAGES.map((stage, i) => (
            <li
              key={stage.name}
              className="rounded-md border border-line-subtle bg-surface p-4"
            >
              <div className="flex items-center gap-2">
                <stage.icon
                  aria-hidden
                  className="size-4 text-brand"
                  strokeWidth={1.75}
                />
                <span className="text-[13px] font-semibold text-fg">
                  {i + 1}. {stage.name}
                </span>
              </div>
              <p className="mt-2 text-[13px] leading-[1.6] text-fg-muted">
                {stage.text}
              </p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

/* ── 4 · Why now — the differentiator ────────────────────────────────────── */

function WhyNow() {
  return (
    <section className="mx-auto max-w-[1100px] px-6 py-16">
      <h2 className="text-[28px] leading-9 font-semibold tracking-[-0.01em] text-fg">
        Every claim, or we don&rsquo;t make it
      </h2>
      <p className="mt-2 max-w-2xl text-[15px] leading-[1.6] text-fg-secondary">
        Most tools give you a number and a confident sentence. Huntloop shows
        you the three different kinds of thing it knows, and never lets them
        look alike.
      </p>

      <div className="mt-8 grid gap-4 sm:grid-cols-3">
        <Card flush>
          <CardBody>
            <ClaimBadge kind="fact" confidence="high" />
            <p className="mt-2 text-[13px] leading-[1.6] text-fg-secondary">
              Something a page actually said, with a link to the page. A fact
              without a source is rejected by the database — it is a constraint,
              not a convention.
            </p>
          </CardBody>
        </Card>
        <Card flush>
          <CardBody>
            <ClaimBadge kind="inference" confidence="medium" />
            <p className="mt-2 text-[13px] leading-[1.6] text-fg-secondary">
              A conclusion Huntloop drew. Labelled as one, carrying how sure it
              is, and never quietly promoted to a fact.
            </p>
          </CardBody>
        </Card>
        <Card flush>
          <CardBody>
            <ClaimBadge kind="unknown" />
            <p className="mt-2 text-[13px] leading-[1.6] text-fg-secondary">
              What we could not establish. Shown rather than omitted, because an
              absent gap looks exactly like a filled one.
            </p>
          </CardBody>
        </Card>
      </div>

      <div className="mt-6 rounded-md border border-line-subtle bg-panel p-5">
        <p className="text-[14px] leading-[1.7] text-fg-secondary">
          <span className="font-medium text-fg">
            It also knows when something happened, separately from when we saw
            it.
          </span>{" "}
          A six-month-old funding round found yesterday is still six months old.
          Most tools store one date and present stale news as a fresh trigger.
        </p>
      </div>
    </section>
  );
}

/* ── 5 · Scoring ─────────────────────────────────────────────────────────── */

function Scoring() {
  return (
    <section className="border-y border-line-subtle bg-panel">
      <div className="mx-auto grid max-w-[1100px] gap-10 px-6 py-16 lg:grid-cols-2">
        <div>
          <h2 className="text-[28px] leading-9 font-semibold tracking-[-0.01em] text-fg">
            Not a black-box number
          </h2>
          <p className="mt-3 text-[15px] leading-[1.7] text-fg-secondary">
            A score is only useful if you can argue with it. Huntloop&rsquo;s
            breaks down into the dimensions it measured, the rules you wrote, and
            the evidence that moved each one — and it says <em>unknown</em> where
            it has nothing, rather than scoring a zero that looks like a
            judgement.
          </p>
          <p className="mt-3 text-[15px] leading-[1.7] text-fg-secondary">
            The rules are yours. You write them, weight them, and see which ones
            fired on any given company. When the learning loop proposes a change,
            it shows you what would have happened differently.
          </p>
        </div>

        <div className="space-y-2">
          {[
            ["ICP fit", 92, "Segment, size and geography all match."],
            ["Timing", 88, "Funding 11 days ago."],
            ["Pain evidence", 74, "Two job posts describe the problem."],
            ["Budget signal", null, "Nothing published."],
          ].map(([label, value, note]) => (
            <div
              key={String(label)}
              className="flex items-center gap-3 rounded-md border border-line-subtle bg-surface px-3 py-2.5"
            >
              <span className="w-28 shrink-0 text-[12px] text-fg-secondary">
                {String(label)}
              </span>
              <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-active">
                {typeof value === "number" && (
                  <div
                    className="h-full rounded-full bg-brand"
                    style={{ width: `${value}%` }}
                  />
                )}
              </div>
              <span className="hl-tabular w-16 shrink-0 text-right text-[12px] text-fg-muted">
                {typeof value === "number" ? value : "unknown"}
              </span>
              {/* The note is the whole point of a breakdown: a bar with a
                  number on it is still a number nobody can argue with. */}
              <span className="hidden min-w-0 flex-1 truncate text-[12px] text-fg-muted sm:block">
                {String(note)}
              </span>
            </div>
          ))}
          <p className="pt-1 text-[12px] leading-[1.5] text-fg-muted">
            An unmeasured dimension stays unknown. Scoring it zero would be an
            invented finding, and it would drag the total down as if we had
            looked and found nothing.
          </p>
        </div>
      </div>
    </section>
  );
}

/* ── 6 · Use cases ───────────────────────────────────────────────────────── */

/**
 * The four audiences, each with a page of its own.
 *
 * Titles and blurbs are local rather than imported from `for/use-cases.ts` on
 * purpose: this is a summary written to sit in a grid, and the page it links
 * to opens with a different, longer sentence. Sharing one string would make
 * the card read like the top of the page it links to, which is the commonest
 * way a "learn more" link stops being worth clicking.
 *
 * The *slugs* are shared, because those are an identity rather than copy. A
 * page renamed there must not leave a dead link here, and `dynamicParams =
 * false` on that route means a stale slug is a hard 404 rather than a soft
 * landing — so the `satisfies` below is what keeps them in step.
 */
const LANDING_USE_CASES = [
  {
    slug: "founder-led-sales",
    title: "Founder-led sales",
    body: "You are the pipeline and you have four hours a week for it. Huntloop is the research team you cannot hire yet: it arrives with a short list and the reason for each name.",
  },
  {
    slug: "outbound-teams",
    title: "Outbound teams",
    body: "Stop paying people to build lists. Start the day with a ranked queue where every entry already answers why this company and why now.",
  },
  {
    slug: "agencies",
    title: "Agencies and consultants",
    body: "One workspace per client, each with its own profile, sources and pipeline. Switch between them without a second login.",
  },
  {
    slug: "account-based",
    title: "Account-based",
    body: "Bring your target list. Huntloop watches all of it and tells you the week an account becomes reachable, instead of you checking.",
  },
] as const satisfies readonly { slug: UseCase["slug"]; title: string; body: string }[];

function UseCases() {
  return (
    <section id="use-cases" className="mx-auto max-w-[1100px] px-6 py-16">
      <h2 className="text-[28px] leading-9 font-semibold tracking-[-0.01em] text-fg">
        Who it&rsquo;s for
      </h2>
      <div className="mt-8 grid gap-3 sm:grid-cols-2">
        {LANDING_USE_CASES.map((useCase) => (
          <Card key={useCase.slug} flush>
            <CardBody>
              <h3 className="text-[15px] font-semibold text-fg">{useCase.title}</h3>
              <p className="mt-1.5 text-[13px] leading-[1.6] text-fg-muted">
                {useCase.body}
              </p>
              <div className="mt-3">
                <Link
                  href={`/for/${useCase.slug}`}
                  className="hl-focusable rounded-sm text-[13px] text-brand-text underline decoration-dotted underline-offset-2"
                >
                  How it works for {useCase.title.toLowerCase()}
                </Link>
              </div>
            </CardBody>
          </Card>
        ))}
      </div>
    </section>
  );
}

/* ── 7 · Comparison ──────────────────────────────────────────────────────── */

/**
 * A small, fair table.
 *
 * No competitor is named and no strawman is built. The rows are the five
 * things Huntloop genuinely does differently, and the columns are honest about
 * what the other two categories are *for* — a list tool is not trying to
 * explain anything, and saying otherwise would be the kind of overclaim that
 * poisons the honesty position the whole page rests on.
 */
const COMPARISON: { row: string; huntloop: boolean; list: boolean; sdr: "yes" | "no" | "some" }[] = [
  { row: "Every claim cites a source", huntloop: true, list: false, sdr: "no" },
  { row: "Facts and inferences shown differently", huntloop: true, list: false, sdr: "no" },
  { row: "Score decomposes into rules you wrote", huntloop: true, list: false, sdr: "some" },
  { row: "Refuses when it isn't sure", huntloop: true, list: false, sdr: "no" },
  { row: "Your profile is versioned, so scores are comparable", huntloop: true, list: false, sdr: "no" },
  { row: "Finds companies you don't know about", huntloop: true, list: true, sdr: "yes" },
  { row: "Sends without you approving", huntloop: false, list: false, sdr: "yes" },
];

function Comparison() {
  return (
    <section className="border-y border-line-subtle bg-panel">
      <div className="mx-auto max-w-[1100px] px-6 py-16">
        <h2 className="text-[28px] leading-9 font-semibold tracking-[-0.01em] text-fg">
          What&rsquo;s actually different
        </h2>
        <p className="mt-2 max-w-2xl text-[15px] leading-[1.6] text-fg-secondary">
          Not a feature count. These are the five things that change whether you
          can trust what you are reading — plus the one thing Huntloop
          deliberately will not do.
        </p>

        {/* Wide content scrolls inside its own container rather than making the
            page scroll horizontally. */}
        <div className="mt-8 overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse text-left">
            <thead>
              <tr className="border-b border-line">
                <th scope="col" className="py-2 pr-4 text-[12px] font-medium text-fg-muted">
                  &nbsp;
                </th>
                <th scope="col" className="px-3 py-2 text-[12px] font-semibold text-brand">
                  Huntloop
                </th>
                <th scope="col" className="px-3 py-2 text-[12px] font-medium text-fg-muted">
                  A list tool
                </th>
                <th scope="col" className="px-3 py-2 text-[12px] font-medium text-fg-muted">
                  An autonomous AI SDR
                </th>
              </tr>
            </thead>
            <tbody>
              {COMPARISON.map((r) => (
                <tr key={r.row} className="border-b border-line-subtle">
                  <th
                    scope="row"
                    className="py-2.5 pr-4 text-[13px] font-normal text-fg-secondary"
                  >
                    {r.row}
                  </th>
                  <td className="px-3 py-2.5">
                    <Mark on={r.huntloop} />
                  </td>
                  <td className="px-3 py-2.5">
                    <Mark on={r.list} />
                  </td>
                  <td className="px-3 py-2.5">
                    {r.sdr === "some" ? (
                      <Minus aria-label="Sometimes" className="size-4 text-fg-muted" />
                    ) : (
                      <Mark on={r.sdr === "yes"} />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function Mark({ on }: { on: boolean }) {
  return on ? (
    <Check aria-label="Yes" className="size-4 text-brand" strokeWidth={2.5} />
  ) : (
    <Minus aria-label="No" className="size-4 text-fg-muted" strokeWidth={2} />
  );
}

/* ── 8 · Proof ───────────────────────────────────────────────────────────── */

/**
 * No logo wall, and no testimonials.
 *
 * There are none yet. A "trusted by" strip of stock logos on a page whose
 * entire thesis is that we do not present the unverified as established would
 * be a self-inflicted wound — and it is the exact failure the product refuses
 * to commit about its own customers' prospects.
 *
 * What replaces it is specific and checkable: claims about the *system*, which
 * are true today, plus a signed note. When real customers exist this section
 * becomes named, outcome-specific testimonials and this comment goes away.
 */
function Proof() {
  return (
    <section className="mx-auto max-w-[1100px] px-6 py-16">
      <div className="rounded-md border border-line-subtle bg-panel p-6 sm:p-8">
        <h2 className="text-[20px] leading-7 font-semibold text-fg">
          We&rsquo;re early, and we&rsquo;d rather say so
        </h2>
        <p className="mt-3 max-w-2xl text-[14px] leading-[1.7] text-fg-secondary">
          There is no logo wall on this page because we have not earned one yet.
          Putting stock logos here would be exactly the thing this product
          exists not to do — presenting something unverified as established.
        </p>
        <p className="mt-3 max-w-2xl text-[14px] leading-[1.7] text-fg-secondary">
          What we can tell you is what the system does today: every score
          decomposes into the rules that produced it, every fact is stored with
          the URL it was read on and cannot be saved without one, every profile
          edit is a version so your scores stay comparable, and no message
          leaves your account without you pressing send.
        </p>
        <p className="mt-4 text-[13px] text-fg-muted">
          Try it on your own domain and judge the output. That is the only
          proof worth anything at this stage.
        </p>
      </div>
    </section>
  );
}

/* ── 9 · Integrations and data ───────────────────────────────────────────── */

function Integrations() {
  return (
    <section className="border-y border-line-subtle bg-panel">
      <div className="mx-auto grid max-w-[1100px] gap-10 px-6 py-16 lg:grid-cols-2">
        <div>
          <h2 className="text-[22px] leading-8 font-semibold text-fg">
            What it connects to
          </h2>
          <ul className="mt-4 space-y-2 text-[14px] leading-[1.6] text-fg-secondary">
            <li className="flex items-start gap-2">
              <Database aria-hidden className="mt-0.5 size-4 shrink-0 text-brand" strokeWidth={1.75} />
              <span>
                <span className="text-fg">Company and contact data</span> — Apollo
                for search and enrichment, with per-record cost accounting you
                can read.
              </span>
            </li>
            <li className="flex items-start gap-2">
              <Mail aria-hidden className="mt-0.5 size-4 shrink-0 text-brand" strokeWidth={1.75} />
              <span>
                <span className="text-fg">Your mailbox</span> — Gmail or Outlook,
                so replies land where you already work. Optional, and never
                required to use the rest.
              </span>
            </li>
            <li className="flex items-start gap-2">
              <Binoculars aria-hidden className="mt-0.5 size-4 shrink-0 text-brand" strokeWidth={1.75} />
              <span>
                <span className="text-fg">Any source you name</span> — a
                publication, a subreddit, a job board, a competitor&rsquo;s
                newsroom.
              </span>
            </li>
          </ul>
        </div>

        <div>
          <h2 className="text-[22px] leading-8 font-semibold text-fg">
            How your data is handled
          </h2>
          <ul className="mt-4 space-y-2 text-[14px] leading-[1.6] text-fg-secondary">
            <li>
              Your workspace is isolated at the database level, not by
              application code — one tenant cannot read another&rsquo;s rows
              even if we ship a bug.
            </li>
            <li>
              We do not train models on your data.
            </li>
            <li>
              Contact data has a retention window you set, and an erasure path
              that actually deletes rather than flags.
            </li>
            <li>
              Every outbound message carries a working unsubscribe, and a
              suppression is honoured across the whole workspace.
            </li>
          </ul>
        </div>
      </div>
    </section>
  );
}

/* ── 10 · Pricing ────────────────────────────────────────────────────────── */

function Pricing({ plans }: { plans: Awaited<ReturnType<typeof listPlans>>["data"] }) {
  return (
    <section id="pricing" className="mx-auto max-w-[1100px] px-6 py-16">
      <h2 className="text-[28px] leading-9 font-semibold tracking-[-0.01em] text-fg">
        Pricing
      </h2>
      <p className="mt-2 max-w-2xl text-[15px] leading-[1.6] text-fg-secondary">
        These are the limits the product actually enforces — read from the same
        catalogue the metering reads, not typed into this page.
      </p>

      <div className="mt-8 grid gap-3 sm:grid-cols-3">
        {plans.map((plan) => {
          const featured = plan.id === "growth";
          return (
            <div
              key={plan.id}
              className={[
                "rounded-md border p-5",
                featured
                  ? "border-brand-border bg-brand-surface/30"
                  : "border-line-subtle bg-panel",
              ].join(" ")}
            >
              <div className="flex items-center justify-between">
                <h3 className="text-[15px] font-semibold text-fg">{plan.name}</h3>
                {featured && <Badge variant="neutral">Most teams</Badge>}
              </div>
              <p className="mt-2">
                <span className="hl-tabular text-[28px] font-semibold text-fg">
                  ${(plan.priceCents / 100).toLocaleString()}
                </span>
                <span className="text-[13px] text-fg-muted">
                  {plan.priceCents === 0 ? "" : " / month"}
                </span>
              </p>

              <ul className="mt-4 space-y-1.5 text-[13px] text-fg-secondary">
                <li>{describeLimit(plan.limits.opportunities)} opportunities</li>
                <li>{describeLimit(plan.limits.aiRuns)} AI runs</li>
                <li>{describeLimit(plan.limits.enrich)} enrichments</li>
                <li>
                  {plan.limits.emails === 0
                    ? "No sending"
                    : `${describeLimit(plan.limits.emails)} emails`}
                </li>
                <li>{describeLimit(plan.limits.seats)} seats</li>
              </ul>

              <div className="mt-5">
                <Button
                  variant={featured ? "primary" : "secondary"}
                  href="/signup"
                  linkComponent={Link}
                >
                  {plan.priceCents === 0 ? "Start free" : `Start on ${plan.name}`}
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/* ── 11 · FAQ ────────────────────────────────────────────────────────────── */

const FAQ = [
  {
    q: "Where does the data come from?",
    a: "Two places, and they are kept distinct. Company and contact attributes come from a data provider (Apollo today). Signals — funding, hiring, launches, filings — come from sources you approve, and every one is stored with the URL it was read on so you can check it.",
  },
  {
    q: "How is this different from a list tool?",
    a: "A list tool answers 'who matches these filters'. Huntloop answers 'who should I pursue next, why are they a good fit, and what should I do about it' — and shows the working for all three. The list is the cheap part.",
  },
  {
    q: "What if the AI is wrong?",
    a: "You will be able to see that it is, which is the point. Every judgement decomposes into the evidence behind it, an inference is labelled as an inference, and anything unestablished is shown as unknown rather than filled in. You can also overrule any verdict, and the system records that you did and learns from it.",
  },
  {
    q: "Does it send email for me?",
    a: "Only when you press send. Huntloop drafts; a person approves. There is no autonomous sending mode and adding one is not on the roadmap.",
  },
  {
    q: "Can I use my own sources?",
    a: "Yes, and you should. Huntloop recommends sources from your profile and tells you which part of the profile put each one there, but the ones you add from your own market knowledge are usually the best.",
  },
  {
    q: "What happens when the trial limit runs out?",
    a: "Work stops rather than silently continuing on a bill you did not agree to. You will see what was used and what the ceiling was, on a usage screen, before it happens.",
  },
];

function Faq() {
  return (
    <section className="border-t border-line-subtle bg-panel">
      <div className="mx-auto max-w-[820px] px-6 py-16">
        <h2 className="text-[28px] leading-9 font-semibold tracking-[-0.01em] text-fg">
          Questions
        </h2>
        <dl className="mt-8 space-y-6">
          {FAQ.map((item) => (
            <div key={item.q}>
              <dt className="text-[15px] font-medium text-fg">{item.q}</dt>
              <dd className="mt-1.5 text-[14px] leading-[1.7] text-fg-secondary">
                {item.a}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

/* ── 12 · Final CTA ──────────────────────────────────────────────────────── */

function FinalCta() {
  return (
    <section className="mx-auto max-w-[1100px] px-6 py-20">
      <div className="flex flex-col items-center text-center">
        <h2 className="max-w-2xl text-[32px] leading-10 font-semibold tracking-[-0.01em] text-fg">
          See what Huntloop finds for you
        </h2>
        <p className="mt-3 max-w-lg text-[15px] leading-[1.6] text-fg-secondary">
          Put in your domain. We&rsquo;ll read your site, work out who you should
          be selling to, and show you. Two minutes, no card.
        </p>
        <div className="mt-8 flex w-full justify-center">
          <DomainInput />
        </div>
      </div>
    </section>
  );
}

/* ── 13 · Footer ─────────────────────────────────────────────────────────── */

function Footer() {
  return (
    <footer className="border-t border-line-subtle">
      <div className="mx-auto flex max-w-[1100px] flex-wrap items-center gap-x-6 gap-y-3 px-6 py-8">
        <div className="flex items-center gap-2">
          <span className="flex size-5 items-center justify-center rounded bg-brand-surface text-[11px] font-bold text-brand">
            H
          </span>
          <span className="text-[13px] text-fg-secondary">Huntloop</span>
        </div>
        <nav aria-label="Footer" className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <a href="#how" className="hl-focusable rounded-sm text-[13px] text-fg-muted hover:text-fg-secondary">
            How it works
          </a>
          <a href="#pricing" className="hl-focusable rounded-sm text-[13px] text-fg-muted hover:text-fg-secondary">
            Pricing
          </a>
          {/* The comparison pages, reachable from somewhere. A page in the
              sitemap that nothing on the site links to is a page search engines
              treat as orphaned and readers never find. */}
          <Link
            href="/compare/list-tools"
            className="hl-focusable rounded-sm text-[13px] text-fg-muted hover:text-fg-secondary"
          >
            Compared to a list tool
          </Link>
          <Link
            href="/compare/ai-sdr"
            className="hl-focusable rounded-sm text-[13px] text-fg-muted hover:text-fg-secondary"
          >
            Compared to an AI SDR
          </Link>
          <Link href="/login" className="hl-focusable rounded-sm text-[13px] text-fg-muted hover:text-fg-secondary">
            Sign in
          </Link>
          <Link href="/signup" className="hl-focusable rounded-sm text-[13px] text-fg-muted hover:text-fg-secondary">
            Create an account
          </Link>
        </nav>
        <p className="ml-auto text-[12px] text-fg-muted">
          © {new Date().getFullYear()} Huntloop
        </p>
      </div>
    </footer>
  );
}

export const metadata = {
  title: "Huntloop — know who needs you before you reach out",
  description:
    "Huntloop watches your market, finds companies that just became a fit, tells you why with cited sources, and drafts the outreach. Every score shows its working.",
  alternates: { canonical: "/" },
};

/* Anonymous visitors get a static page; signed-in ones are redirected, which
   needs the request. Dynamic because `resolveDestination` reads cookies — a
   cached landing page would show a signed-in user the marketing site. */
export const dynamic = "force-dynamic";

