import Link from "next/link";
import type { ReactNode } from "react";
import { Plus } from "lucide-react";
import { BrandMark, ThemeToggle } from "@huntloop/ui";
import { MobileNav } from "./MobileNav";
import { ClosingMark } from "./_home/ClosingMark";
import { Dial } from "./_home/Dial";
import { FindReasons } from "./_home/FindReasons";
import { Loop } from "./_home/Loop";
import { SnapToProblem } from "./_home/SnapToProblem";
import { Tiles } from "./_home/Tiles";
import "./_home/home.css";
import { describeLimit, listPublicPlans, type Plan } from "../../lib/data/plans";
import { IDENTITY, legalIsComplete } from "../../lib/legal";
import { continueTarget, resolveVisitorDestination, type ContinueTarget } from "../../lib/data/destination";
import type { UseCase } from "./for/use-cases";

/**
 * Whether research and sending are switched on in production. Until they are,
 * the page says so beside every demonstration. Set this to true only after a
 * real company has gone through the whole loop there.
 */
const LIVE: boolean = false;

/**
 * The front door, in seven sections: hero, problem, features, how it works,
 * pricing and comparison, FAQ, closing.
 *
 * Rules it keeps:
 *
 *  · Every company on it is invented, and it says so.
 *  · It shows what is built, and says what is not switched on (`LIVE`).
 *  · Plans come from `listPublicPlans()`, the catalogue metering reads.
 *    There is no checkout, so no button pretends to sell a paid plan.
 *  · Autonomy is described as it behaves: a person approves every message
 *    until an owner or admin says otherwise.
 *
 * A signed-in visitor sees it too. Redirecting them made the domain itself
 * resolve to their dashboard, so a stale session turned "open huntloop.pro"
 * into an error screen. Their buttons read "Open workspace" instead.
 */
export default async function LandingPage() {
  const [destination, plans] = await Promise.all([resolveVisitorDestination(), listPublicPlans()]);
  const next = continueTarget(destination);

  return (
    <div className="hm">
      <SnapToProblem />
      <Nav next={next} />
      <main id="main">
        <Hero next={next} />
        <Problem />
        <Features />
        <HowItWorks />
        <Pricing plans={plans} next={next} />
        <Faq />
        <Closing next={next} />
      </main>
      <Footer />
    </div>
  );
}

const CREATE = "Create a workspace";

/** The one action on the page: start, or pick up where they are. */
function StartLink({ next, className = "btn" }: { next: ContinueTarget | null; className?: string }) {
  return (
    <Link href={next?.href ?? "/signup"} className={className}>
      {next?.label ?? CREATE}
    </Link>
  );
}

function Logo() {
  return (
    <Link
      href="/"
      className="hl-focusable flex items-center gap-[9px] self-start rounded-sm text-[18px] font-semibold tracking-[-0.03em] text-fg"
    >
      <BrandMark className="size-[26px]" />
      Huntloop
    </Link>
  );
}

/* ── Nav ─────────────────────────────────────────────────────────────────── */

/* Anchors to sections that exist on this page. A nav that links to something
   nobody has written is the `NAV-02` failure the audit script catches. */
const SECTIONS = [
  { href: "#features", label: "Features" },
  { href: "#how", label: "How it works" },
  { href: "#pricing", label: "Pricing" },
  { href: "#faq", label: "FAQ" },
];

function Nav({ next }: { next: ContinueTarget | null }) {
  return (
    <header className="sticky top-0 z-30 h-[68px] border-b border-line-subtle bg-panel/82 backdrop-blur-[16px] backdrop-saturate-[1.6]">
      <div className="f flex h-full items-center justify-between gap-4">
        <div className="flex">
          <Logo />
        </div>
        <nav aria-label="Main" className="hidden items-center gap-7 text-[14.5px] text-fg-secondary lg:flex">
          {SECTIONS.map((s) => (
            <a key={s.href} href={s.href} className="hl-focusable rounded-sm transition-colors hover:text-fg">
              {s.label}
            </a>
          ))}
        </nav>
        <div className="flex items-center gap-2 sm:gap-4">
          <ThemeToggle className="max-lg:hidden" />
          <MobileNav links={next ? SECTIONS : [...SECTIONS, { href: "/login", label: "Sign in" }]} />
          {next ? (
            <StartLink next={next} className="btn c" />
          ) : (
            <>
              <Link
                href="/login"
                className="hl-focusable rounded-sm text-[14.5px] text-fg-secondary transition-colors hover:text-fg max-lg:hidden"
              >
                Sign in
              </Link>
              <Link href="/signup" className="btn c">
                <span className="max-sm:hidden">{CREATE}</span>
                <span className="sm:hidden">Sign up</span>
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

/* ── 1 · Hero ────────────────────────────────────────────────────────────── */

function Hero({ next }: { next: ContinueTarget | null }) {
  return (
    <section className="hz" id="top">
      <div className="hzt f">
        <h1>Know who needs you before you reach out.</h1>
        <p>
          Huntloop finds the companies with a reason to hear from you, shows the evidence, and drafts the
          first message.
        </p>
        <div className="row justify-center">
          <StartLink next={next} />
          <a className="btn s" href="#how">
            See how it works
          </a>
          {/* Development only — see app/dev/onboarded/route.ts. `next build`
              inlines NODE_ENV, so this link is dead code in every deployed
              bundle; it must stay a comparison here for that to happen. */}
          {process.env.NODE_ENV === "development" && (
            <Link
              href="/dev/onboarded"
              prefetch={false}
              className="hl-focusable rounded-sm border border-dashed border-warning-border px-2 py-1 text-[12.5px] text-warning-text max-sm:hidden"
            >
              Dev: open onboarded workspace
            </Link>
          )}
        </div>
      </div>
      <Dial note={LIVE ? "Examples. These companies are invented." : "Invented examples. Built and tested, not live yet."} />
    </section>
  );
}

/* ── 2 · Problem and solution ────────────────────────────────────────────── */

function Problem() {
  return (
    <section id="problem">
      <div className="f w-full">
        <div className="hd">
          <h2>Finding companies is easy. Knowing who actually needs you is not.</h2>
          <p className="lead">
            A list gives you names, no timing and no reasons. Huntloop keeps the companies with a dated reason
            and sets the rest aside.
          </p>
        </div>
        <FindReasons />
      </div>
    </section>
  );
}

/* ── 3 · Features and benefits ───────────────────────────────────────────── */

function Features() {
  return (
    <section className="sc alt" id="features">
      <div className="f">
        <h2 className="rise">Less guessing. More control.</h2>
        <Tiles />
        <p className="sm mut mt-6">
          {LIVE ? "Examples are illustrative." : "Examples are illustrative. Built and tested; live services are not on yet."}{" "}
          Exchange is a preview and switched off.
        </p>
      </div>
    </section>
  );
}

/* ── 4 · How it works ────────────────────────────────────────────────────── */

function HowItWorks() {
  return (
    <section className="sc hl-band" data-theme="dark" id="how">
      <div className="f">
        <div className="hd">
          <h2 className="rise">One loop. Intelligence in motion.</h2>
          <p className="lead">Drag the dot from first clue to first reply. The last stretch waits for you.</p>
        </div>
        <Loop />
      </div>
    </section>
  );
}

/* ── 5 · Pricing and comparison ──────────────────────────────────────────── */

function planSummary({ limits }: Plan) {
  const seats = `${describeLimit(limits.seats)} seats`;
  const found = `${describeLimit(limits.opportunities)} opportunities`;
  return limits.emails === 0
    ? `${found} and ${seats}. No sending.`
    : `${found}, ${describeLimit(limits.emails)} emails and ${seats}.`;
}

const APPROACHES = [
  ["List tools", "Names that match a filter", "Varies", "Usually written elsewhere"],
  ["Conventional CRM", "Accounts you already have", "Varies", "Templates, in many"],
  ["Huntloop", "Companies that fit, with a reason", "Dated, with its source", "A draft that cites the evidence"],
] as const;
const COLUMNS = ["Approach", "Who to contact", "Why now", "What you send"] as const;

function Pricing({ plans, next }: { plans: Plan[]; next: ContinueTarget | null }) {
  return (
    <section className="sc" id="pricing">
      <div className="f">
        <div className="hd">
          <h2 className="rise">Start free.</h2>
          <p className="lead">
            There is no checkout yet, so nothing here can charge you. Paid plans are what we intend to charge.
          </p>
        </div>
        <div className="plans win">
          {plans.map((plan) => (
            <div key={plan.id}>
              <h3>{plan.name}</h3>
              <p className="pr tn">
                ${(plan.priceCents / 100).toLocaleString()}
                <small>a month</small>
              </p>
              <p className="sec tn">{planSummary(plan)}</p>
              {/* A paid tier's button never creates a Free account under
                  another name: it writes to us, or says there is nothing to
                  buy yet. */}
              {plan.priceCents === 0 ? (
                <StartLink next={next} />
              ) : IDENTITY.contactEmail ? (
                <a
                  className="btn s"
                  href={`mailto:${IDENTITY.contactEmail}?subject=${encodeURIComponent(`Huntloop ${plan.name}`)}`}
                >
                  Talk to us about {plan.name}
                </a>
              ) : (
                <p className="na">Not available yet</p>
              )}
            </div>
          ))}
        </div>
        <div className="cmp" role="table" aria-label="Three approaches">
          <div role="row">
            {COLUMNS.map((c) => (
              <span key={c} role="columnheader" className="mut">
                {c}
              </span>
            ))}
          </div>
          {APPROACHES.map(([name, ...cells]) => (
            <div key={name} role="row" className={name === "Huntloop" ? "us" : undefined}>
              <b role="rowheader">{name}</b>
              {cells.map((cell, i) => (
                <span key={COLUMNS[i + 1]} role="cell" data-label={COLUMNS[i + 1]}>
                  {cell}
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ── 6 · FAQ ─────────────────────────────────────────────────────────────── */

const QUESTIONS: { q: string; a: string }[] = [
  {
    q: "Can it email people without me?",
    a: "Only if an owner or admin raises a campaign's level. New campaigns start at 0, where every message waits for a person.",
  },
  {
    q: "Does a high score mean they will buy?",
    a: "No. It means they fit and there is recent evidence. What cannot be measured stays Unknown.",
  },
  {
    q: "Where does the data come from?",
    a: "Company websites, public job boards, feeds you choose, your own files, and licensed providers once connected. Facts carry a source.",
  },
  {
    q: "Does it replace my CRM?",
    a: "No. It keeps its own pipeline and can push to HubSpot. Email goes from your own Gmail or Outlook.",
  },
  {
    q: "Is my data private?",
    a: "Workspace data is isolated in the database. You can export or erase it.",
  },
  ...(LIVE
    ? []
    : [
        {
          q: "What works today?",
          a: "The website, sign-in pages and database are live. Research, sending and Exchange are built and tested, and not switched on.",
        },
      ]),
];

function Faq() {
  return (
    <section className="sc alt" id="faq">
      <div className="f faq">
        <h2 className="rise">Fair questions.</h2>
        <div>
          {QUESTIONS.map(({ q, a }) => (
            <details key={q}>
              <summary>
                {q}
                <Plus aria-hidden className="size-5" strokeWidth={1.8} />
              </summary>
              <p>{a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ── 7 · Closing ─────────────────────────────────────────────────────────── */

function Closing({ next }: { next: ContinueTarget | null }) {
  return (
    <section className="hl-band" data-theme="dark">
      <div className="f end">
        <div>
          <h2>Your next opportunity is out there. Find it with Huntloop.</h2>
          <p className="lead">
            {LIVE
              ? "Create a workspace, set up your profile and see who has a reason to hear from you."
              : "Create a workspace and set up your profile. Research begins when live services are switched on."}
          </p>
          <div className="row wrap">
            <StartLink next={next} />
            <a className="btn s" href="#how">
              Explore the demo
            </a>
          </div>
        </div>
        <ClosingMark />
      </div>
    </section>
  );
}

/* ── Footer ──────────────────────────────────────────────────────────────── */

/**
 * Kept in step with `for/use-cases.ts` by the `satisfies` below: the footer
 * is now the only place on the site that links these pages, and a page in
 * the sitemap that nothing links to is one search engines treat as orphaned.
 */
const LANDING_USE_CASES = [
  { slug: "founder-led-sales", title: "Founder-led sales" },
  { slug: "outbound-teams", title: "Outbound teams" },
  { slug: "agencies", title: "Agencies and consultants" },
  { slug: "account-based", title: "Account-based" },
] as const satisfies readonly { slug: UseCase["slug"]; title: string }[];

function FooterColumn({ label, children }: { label: string; children: ReactNode }) {
  return (
    <nav aria-label={label} className="flex flex-col gap-2.5">
      <p className="font-semibold text-fg-muted">{label}</p>
      {children}
    </nav>
  );
}

const footerLink = "hl-focusable self-start rounded-sm text-fg-secondary transition-colors hover:text-fg";

function Footer() {
  return (
    <footer className="border-t border-line-subtle">
      <div className="f flex flex-col gap-7 py-10">
        <Logo />

        <div className="grid gap-8 border-t border-line-subtle pt-7 text-[13px] sm:grid-cols-2 md:grid-flow-col md:grid-cols-[minmax(0,1fr)] md:auto-cols-[180px] md:gap-6">
          <div className="flex flex-col items-start gap-4">
            <p className="text-fg-muted">© {new Date().getFullYear()} Huntloop</p>
            {/* The header drops its toggle on phones; this one is always there. */}
            <ThemeToggle />
          </div>
          <FooterColumn label="Product">
            <a href="#features" className={footerLink}>
              Features
            </a>
            <a href="#how" className={footerLink}>
              How it works
            </a>
            <a href="#pricing" className={footerLink}>
              Pricing
            </a>
            <a href="#faq" className={footerLink}>
              FAQ
            </a>
            {/* The comparison pages, reachable from somewhere — see the note
                on LANDING_USE_CASES. */}
            <Link href="/compare/list-tools" className={footerLink}>
              Compared to a list tool
            </Link>
            <Link href="/compare/ai-sdr" className={footerLink}>
              Compared to an AI SDR
            </Link>
          </FooterColumn>
          <FooterColumn label="Use cases">
            {LANDING_USE_CASES.map((u) => (
              <Link key={u.slug} href={`/for/${u.slug}`} className={footerLink}>
                {u.title}
              </Link>
            ))}
          </FooterColumn>
          <FooterColumn label="Company">
            {IDENTITY.contactEmail && (
              <a href={`mailto:${IDENTITY.contactEmail}`} className={footerLink}>
                Contact
              </a>
            )}
            <Link href="/login" className={footerLink}>
              Sign in
            </Link>
            <Link href="/signup" className={footerLink}>
              Create an account
            </Link>
          </FooterColumn>
          {/* The legal pages appear here only once every fact in
              `lib/legal.ts` is supplied. They exist and are reviewable before
              that; what they are not is *published*, and a footer link is what
              publishing means to a reader. Linking a document that says
              "draft — not in force" at the top would be worse than linking
              nothing, because a visitor would reasonably read the link as a
              claim that we have a privacy policy. */}
          {legalIsComplete() && (
            <FooterColumn label="Legal">
              <Link href="/privacy" className={footerLink}>
                Privacy
              </Link>
              <Link href="/terms" className={footerLink}>
                Terms
              </Link>
              <Link href="/acceptable-use" className={footerLink}>
                Acceptable use
              </Link>
            </FooterColumn>
          )}
        </div>
      </div>
    </footer>
  );
}

export const metadata = {
  /* `absolute`: the root layout's template appends "· Huntloop", which on the
     one page whose title already opens with the name read "Huntloop — … ·
     Huntloop" in every tab and search result. */
  title: { absolute: "Huntloop — know who needs you before you reach out" },
  description:
    "Huntloop finds the companies with a reason to hear from you, shows the evidence, and drafts the first message.",
  alternates: { canonical: "/" },
};

/* Dynamic because `resolveDestination` reads cookies: the nav and the hero
   CTA differ for a signed-in visitor, and a cached copy would show one
   visitor's "Continue" button to everybody. */
export const dynamic = "force-dynamic";
