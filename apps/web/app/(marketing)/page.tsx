import Link from "next/link";
import type { ComponentType, ReactNode } from "react";
import { BrandMark, Button, ScoreRing, ThemeToggle } from "@huntloop/ui";
import {
  Activity,
  ArrowRight,
  Ban,
  Building2,
  ChevronRight,
  CircleDot,
  CircleHelp,
  Clock,
  Cloud,
  Database,
  ExternalLink,
  Flame,
  GraduationCap,
  HeartPulse,
  House,
  Landmark,
  Layers,
  Link2,
  Lock,
  Scale,
  Search,
  Send,
  Sparkles,
  SquareCheck,
  SquareDashed,
  SquareDot,
  Target,
  Wallet,
} from "lucide-react";
import { DomainInput } from "./DomainInput";
import { LoopDiagram } from "./LoopDiagram";
import { describeLimit, listPublicPlans } from "../../lib/data/plans";
import { publicResearchEnabled } from "@huntloop/jobs";
import { IDENTITY, legalIsComplete } from "../../lib/legal";
import {
  continueTarget,
  resolveVisitorDestination,
  type ContinueTarget,
} from "../../lib/data/destination";
import type { UseCase } from "./for/use-cases";

/**
 * The front door — `design/PremiumLanding.dc.html`, section for section.
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
 * So the page is not framed as an "AI SDR" — section 04 says so in as many
 * words. That promises autonomy the product deliberately does not take — a
 * person approves every message — and it invites the one comparison Huntloop
 * loses.
 *
 * ── Where the build departs from the comp, and why ───────────────────────
 *
 *  · Every company on the page is invented, and the hero says so under the
 *    mock — the same rule the page has always kept: a product whose position
 *    is honesty does not open with a named third party scored as somebody's
 *    prospect.
 *  · Pricing renders from `listPlans()`, not the comp's typed $0 / $99 / $299
 *    — see `lib/data/plans.ts` — and keeps the "no checkout yet" notice and
 *    the paid-plan buttons that do not pretend to sell anything.
 *  · The comp's `#` links are real routes or in-page anchors, or they are not
 *    rendered: Security, About and "Read our data practices" have nowhere
 *    honest to go until the pages or the legal facts exist.
 *  · Where the comp sets a colour that fails AA on text (--ink-4, #6C6F76,
 *    blue numerals), the text reads one step up the same ramp; see the note
 *    at the top of `tokens.css`.
 *
 * ── Why a signed-in visitor sees it too ──────────────────────────────────
 *
 * `/` used to redirect anybody with a session straight to their workspace.
 * That made the domain itself resolve to `/<org>/dashboard`: a stale session
 * or a failing dashboard turned "open seefluence.com" into an error screen
 * with no way back to the front door, and the home page was reachable only
 * through a `?home=1` escape hatch. The home page is now always the home
 * page. A signed-in visitor gets a "Continue" button that goes where the
 * redirect used to — their workspace, or the setup step it stopped at.
 */
export default async function LandingPage() {
  const destination = await resolveVisitorDestination();
  const next = continueTarget(destination);

  const plans = await listPublicPlans();

  /* Whether the anonymous domain read is switched on. The closing CTA
     promises it in the present tense, so it has to know. */
  const canResearch = publicResearchEnabled();

  return (
    <div className="min-h-screen bg-panel text-fg">
      <Nav next={next} />

      <main id="main">
        {/*
          The first screen: the hero and the proof strip as one unit, at
          least one viewport tall below the sticky nav. The hero takes the
          space and centres its content; the strip sits on the unit's bottom
          edge, so it lands on the fold on every screen instead of being cut
          in half by it after a band of empty padding.

          `min-h`, never `h`: where the hero is taller than the viewport (a
          short laptop, a phone) the unit grows and nothing inside it — the
          product mock above all — is ever clipped or overlapped. `dvh` so a
          phone's collapsing URL bar does not push the strip off-screen.
        */}
        <div className="flex min-h-[calc(100dvh-68px)] flex-col">
          <Hero next={next} />
          <FeatureStrip />
        </div>
        <ListIsNotTheAnswer />
        <TheLoop />
        <Discover />
        <Qualify />
        <Evidence />
        <ClaimKinds />
        <InControl />
        <DataAndPricing plans={plans} />
        <ClosingCta canResearch={canResearch} />
      </main>

      <Footer />
    </div>
  );
}

/* ── Shared pieces ─────────────────────────────────────────────────────────
   The comp is drawn at 1440 with 56px gutters. `Frame` is that measure,
   stepping the gutter down to 16px on a phone, and every multi-column grid
   below collapses to one column under `xl`, where the comp's fixed columns
   (520 + 64 + the mock) stop fitting. */

type Icon = ComponentType<{ className?: string; strokeWidth?: number }>;

function Frame({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={`mx-auto w-full max-w-[1440px] px-4 sm:px-8 lg:px-14 ${className ?? ""}`}>
      {children}
    </div>
  );
}

/** The mark and the wordmark. The mark itself is BrandMark (packages/ui). */
function Logo({ size = "md" }: { size?: "md" | "sm" }) {
  const md = size === "md";
  return (
    <Link
      href="/"
      className={`hl-focusable flex items-center rounded-sm font-semibold text-fg ${
        md ? "gap-[9px] text-[18px] tracking-[-0.03em]" : "gap-2 text-[16px] tracking-[-0.02em]"
      }`}
    >
      <BrandMark className={md ? "size-[26px]" : "size-[22px]"} />
      Huntloop
    </Link>
  );
}

/**
 * The tracked uppercase eyebrow. `n` is the section number the comp sets in
 * blue before the word — here in `brand-text`, because the comp's #2F6BFF is
 * 4.49:1 on white at 11.5px.
 */
function Eyebrow({ n, children, className }: { n?: string; children: ReactNode; className?: string }) {
  return (
    <p className={`hl-label ${className ?? ""}`}>
      {n && <span className="hl-tabular mr-2 text-brand-text">{n}</span>}
      {children}
    </p>
  );
}

/** "Label ›" — the comp's text link. */
function TextLink({
  href,
  children,
  className,
}: {
  href: string;
  children: ReactNode;
  className?: string;
}) {
  const cls = `hl-focusable inline-flex items-center gap-1 rounded-sm transition-colors duration-[140ms] hover:text-brand-hover ${className ?? ""}`;
  const inner = (
    <>
      {children}
      <ChevronRight aria-hidden className="size-[0.95em]" strokeWidth={1.8} />
    </>
  );
  return href.startsWith("#") ? (
    <a href={href} className={cls}>
      {inner}
    </a>
  ) : (
    <Link href={href} className={cls}>
      {inner}
    </Link>
  );
}

/* ── The worked example ────────────────────────────────────────────────────
   One set of invented companies, used by the hero, the dark mock and the
   Discover table, so the three agree with each other the way a real
   workspace would. */

type Tone = "brand" | "success" | "neutral" | "warning";

const TILE: Record<Tone, string> = {
  brand: "bg-brand-surface text-brand-vivid",
  success: "bg-success-surface text-success",
  neutral: "bg-surface-active text-fg-secondary",
  warning: "bg-warning-surface text-warning",
};

const COMPANIES: {
  name: string;
  sector: string;
  score: number;
  source: string;
  tone: Tone;
  icon: Icon;
}[] = [
  { name: "Northwind Systems", sector: "Infrastructure · Series B", score: 92, source: "LinkedIn", tone: "brand", icon: Layers },
  { name: "Vertex Labs", sector: "Software · Growth", score: 89, source: "News", tone: "success", icon: Building2 },
  { name: "Halcyon Cloud", sector: "Infrastructure · Series A", score: 84, source: "Job boards", tone: "neutral", icon: Cloud },
  { name: "Pioneer Tech", sector: "Fintech · Growth", score: 78, source: "Web", tone: "brand", icon: Landmark },
  { name: "Summit Health", sector: "Healthcare · Seed", score: 72, source: "News", tone: "warning", icon: HeartPulse },
];

function CompanyTile({ tone, icon: I, size = 30 }: { tone: Tone; icon: Icon; size?: 30 | 34 | 40 }) {
  const box = size === 30 ? "size-[30px] rounded-[8px]" : size === 34 ? "size-[34px] rounded-[9px]" : "size-10 rounded-[10px]";
  const glyph = size === 30 ? "size-[15px]" : size === 34 ? "size-[17px]" : "size-5";
  return (
    <span aria-hidden className={`flex shrink-0 items-center justify-center ${box} ${TILE[tone]}`}>
      <I className={glyph} strokeWidth={1.8} />
    </span>
  );
}

/** The factor rows the Qualify card, the Evidence list and section 04 share. */
const FACTORS: { label: string; value: number | null; icon: Icon }[] = [
  { label: "ICP fit", value: 92, icon: Target },
  { label: "Timing", value: 88, icon: Clock },
  { label: "Pain evidence", value: 74, icon: Flame },
  { label: "Budget signal", value: null, icon: Wallet },
];

/* ── 1 · Nav ─────────────────────────────────────────────────────────────── */

function Nav({ next }: { next: ContinueTarget | null }) {
  return (
    <header className="sticky top-0 z-30 h-[68px] border-b border-line-subtle bg-panel/82 backdrop-blur-[16px] backdrop-saturate-[1.6]">
      <Frame className="flex h-full items-center justify-between gap-6">
        <Logo />
        {/* In-page anchors to sections that exist on this page. A nav that
            links to a Docs site nobody has written is the `NAV-02` failure
            the product's own audit script exists to catch. */}
        <nav aria-label="Main" className="hidden items-center gap-[34px] text-[14.5px] text-fg-muted md:flex">
          <a href="#discover" className="hl-focusable rounded-sm transition-colors hover:text-fg">
            Product
          </a>
          <a href="#how" className="hl-focusable rounded-sm transition-colors hover:text-fg">
            How it works
          </a>
          <a href="#pricing" className="hl-focusable rounded-sm transition-colors hover:text-fg">
            Pricing
          </a>
        </nav>
        <div className="flex items-center gap-5">
          <ThemeToggle className="max-sm:hidden" />
          {/* Signed in: a sign-in link is the one thing they cannot use. */}
          {next ? (
            <Button variant="primary" size="lg" href={next.href} linkComponent={Link} className="px-[18px]!">
              {next.label}
            </Button>
          ) : (
            <>
              <Link
                href="/login"
                className="hl-focusable rounded-sm text-[14.5px] text-fg-secondary transition-colors hover:text-fg"
              >
                Sign in
              </Link>
              <Button variant="primary" size="lg" href="/signup" linkComponent={Link} className="px-[18px]!">
                Start free
              </Button>
            </>
          )}
        </div>
      </Frame>
    </header>
  );
}

/* ── 2 · Hero ────────────────────────────────────────────────────────────── */

function Hero({ next }: { next: ContinueTarget | null }) {
  return (
    <section className="flex flex-1 items-center">
      <Frame className="grid items-center gap-14 py-14 lg:py-16 xl:grid-cols-[520px_minmax(0,1fr)] xl:gap-16">
        <div className="flex flex-col gap-[26px]">
          <Eyebrow>Intelligence for outbound</Eyebrow>
          {/* `hl-hero` carries the size *and* its tracking — 62 / 1.04 /
              -0.04em — because the two are one decision. */}
          <h1 className="hl-hero text-fg">Know who needs you before you reach out.</h1>
          <p className="max-w-[440px] text-[19px] leading-[1.55] text-fg-secondary">
            Huntloop finds the companies becoming a fit, shows you why with sources, and
            drafts the outreach.
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-6">
            {/* Anonymous: sign-up is the first step of onboarding — a
                workspace is owned by an account, so the account comes first.
                Signed in: pick up where they are. */}
            <Button
              variant="primary"
              size="xl"
              href={next?.href ?? "/signup"}
              linkComponent={Link}
              className="text-[15.5px]!"
            >
              {next?.label ?? "Start free"}
            </Button>
            <TextLink href="#how" className="text-[15.5px] font-medium text-fg">
              See how it works
            </TextLink>
            {/* Development only — see app/dev/onboarded/route.ts. `next build`
                inlines NODE_ENV, so this link is dead code in every deployed
                bundle; it must stay a comparison here for that to happen. */}
            {process.env.NODE_ENV === "development" && (
              <a
                href="/dev/onboarded"
                className="hl-focusable rounded-sm border border-dashed border-warning-border px-2 py-1 text-[12.5px] text-warning-text"
              >
                Dev: open onboarded workspace
              </a>
            )}
          </div>
        </div>

        <figure className="min-w-0">
          <HeroMock />
          <figcaption className="mt-3 text-[12px] leading-[1.5] text-fg-muted">
            A worked example. These companies are not real and the scores are invented —
            the layout is what the product renders.
          </figcaption>
        </figure>
      </Frame>
    </section>
  );
}

function HeroMock() {
  const nav: { label: string; icon: Icon }[] = [
    { label: "Home", icon: House },
    { label: "Discover", icon: Search },
    { label: "Enrich", icon: Sparkles },
    { label: "Reach out", icon: Send },
    { label: "Track", icon: Activity },
    { label: "Learn", icon: GraduationCap },
  ];
  return (
    <div className="overflow-hidden rounded-xl border border-line-subtle bg-surface shadow-modal">
      <div className="flex h-[52px] items-center gap-3.5 border-b border-line-subtle px-[18px]">
        <span className="flex items-center gap-[7px] text-[13px] font-semibold">
          <BrandMark className="size-[18px]" />
          Huntloop
        </span>
        <span className="flex h-[30px] min-w-0 flex-1 items-center truncate rounded-[7px] bg-canvas px-3 text-[12.5px] text-fg-muted">
          Search companies, industries, keywords…
        </span>
      </div>
      <div className="grid sm:grid-cols-[132px_minmax(0,1fr)]">
        <div className="hidden flex-col gap-0.5 border-r border-line-subtle px-3 py-3.5 text-[12.5px] text-fg-muted sm:flex">
          {nav.map(({ label, icon: I }, i) => (
            <span
              key={label}
              className={`flex items-center gap-2 rounded-[7px] px-[9px] py-[7px] ${
                i === 0 ? "bg-canvas font-medium text-fg" : ""
              }`}
            >
              <I className="size-3.5 shrink-0" strokeWidth={1.7} />
              {label}
            </span>
          ))}
        </div>
        <div className="min-w-0 px-[18px] py-4">
          <p className="mb-2 text-[13px] font-semibold">Companies becoming a fit</p>
          <ul>
            {COMPANIES.map((c) => (
              <li
                key={c.name}
                className="grid grid-cols-[30px_minmax(0,1fr)_44px_20px] items-center gap-3 rounded-[8px] px-2 py-2.5 transition-colors duration-[140ms] hover:bg-hover sm:grid-cols-[30px_minmax(0,1fr)_44px_96px_20px]"
              >
                <CompanyTile tone={c.tone} icon={c.icon} />
                <span className="min-w-0">
                  <span className="block truncate text-[13.5px] font-semibold">{c.name}</span>
                  <span className="block truncate text-[11.5px] text-fg-muted">{c.sector}</span>
                </span>
                <ScoreRing score={c.score} size="md" label={`Fit ${c.score}`} />
                <span className="hidden text-[11px] leading-[1.5] text-fg-muted sm:block">
                  ICP fit
                  <br />
                  Timing
                  <br />
                  Pain
                </span>
                <ChevronRight aria-hidden className="size-3 text-fg-faint" strokeWidth={2} />
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

/* ── 3 · Feature strip ───────────────────────────────────────────────────── */

function FeatureStrip() {
  const items: { text: string; icon: Icon }[] = [
    { text: "Every claim has a source.", icon: Link2 },
    { text: "Every inference is labelled.", icon: CircleDot },
    { text: "Unknown stays unknown.", icon: CircleHelp },
  ];
  return (
    <section className="border-y border-line-subtle bg-canvas">
      <ul className="mx-auto grid max-w-[1160px] sm:grid-cols-3">
        {items.map(({ text, icon: I }, i) => (
          <li
            key={text}
            className={`flex items-center justify-center gap-3.5 px-6 py-[22px] sm:px-10 sm:py-[26px] ${
              i === 1 ? "border-y border-line-subtle sm:border-x sm:border-y-0" : ""
            }`}
          >
            <I aria-hidden className="size-5 shrink-0 text-fg" strokeWidth={1.6} />
            <span className="text-[15px] font-medium">{text}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ── 4 · Black — "The list isn't the answer." ─────────────────────────────
   `data-theme="dark"` on the section flips every token inside it (see the
   note above `.hl-band` in tokens.css), so the mock below is written with
   the same classes as the light one and comes out as the comp's #101113. */

function ListIsNotTheAnswer() {
  const signals = [
    { text: "Series B announced", when: "11 days ago" },
    { text: "New VP Engineering hired", when: "5 days ago" },
    { text: "Expanding to new markets", when: "2 days ago" },
  ];
  const northwind = COMPANIES[0]!;
  return (
    <section data-theme="dark" className="hl-band">
      <Frame className="grid items-center gap-14 py-20 lg:py-[100px] xl:grid-cols-[440px_minmax(0,1fr)] xl:gap-[72px]">
        <div className="flex flex-col gap-[22px]">
          <h2 className="text-[38px] leading-[1.02] font-semibold tracking-[-0.035em] sm:text-[52px]">
            The list isn&rsquo;t the answer.
          </h2>
          <p className="max-w-[360px] text-[18px] leading-[1.6] text-fg-secondary">
            Finding companies is easy. Knowing which one deserves your attention is not.
          </p>
        </div>

        <div className="min-w-0 overflow-hidden rounded-[24px_24px_0_24px] border border-line bg-surface shadow-[0_60px_120px_-40px_rgba(0,0,0,0.7)]">
          <div className="flex h-12 items-center gap-[7px] border-b border-line px-[18px] text-[13px] text-fg-secondary">
            <BrandMark className="size-4 text-fg" />
            Huntloop
          </div>
          <div className="grid sm:grid-cols-[120px_minmax(0,1fr)]">
            <div className="hidden flex-col gap-3 border-r border-line px-3 py-3.5 text-[12px] text-fg-muted sm:flex">
              {["Home", "Discover", "Enrich", "Reach out", "Track", "Learn"].map((l) => (
                <span key={l}>{l}</span>
              ))}
            </div>
            <div className="flex min-w-0 flex-col gap-[18px] px-5 py-[22px] sm:px-[26px]">
              <div className="flex items-center justify-between gap-4">
                <div className="flex min-w-0 items-center gap-3">
                  <span aria-hidden className="flex size-10 shrink-0 items-center justify-center rounded-[10px] bg-ai-surface text-ai-text">
                    <Layers className="size-5" strokeWidth={1.8} />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-[18px] font-semibold">{northwind.name}</p>
                    <p className="truncate text-[12.5px] text-fg-secondary">{northwind.sector}</p>
                  </div>
                </div>
                <ScoreRing score={northwind.score} size="lg" label={`Fit ${northwind.score}`} />
              </div>

              <div className="flex gap-[26px] border-b border-line pb-3 text-[13.5px] text-fg-secondary">
                <span className="-mb-[13px] border-b-2 border-fg pb-3 font-medium text-fg">Overview</span>
                <span>Evidence</span>
                <span>Activity</span>
              </div>

              <div>
                <p className="mb-3 text-[12px] font-semibold tracking-[0.06em] text-fg-muted uppercase">
                  Why now?
                </p>
                <ul className="flex flex-col gap-3 text-[14px]">
                  {signals.map((s) => (
                    <li key={s.text} className="flex items-center justify-between gap-4">
                      <span className="flex items-center gap-2.5">
                        <SquareCheck aria-hidden className="size-[15px] shrink-0 text-success" strokeWidth={2} />
                        {s.text}
                      </span>
                      <span className="shrink-0 text-fg-muted">{s.when}</span>
                    </li>
                  ))}
                </ul>
                {/* Not a link: the example cites nothing real, and a
                    citation that goes nowhere is the one thing this page
                    cannot be seen to do. */}
                <span className="mt-4 inline-flex items-center gap-1.5 text-[13px] text-brand-text">
                  <ExternalLink aria-hidden className="size-[13px]" strokeWidth={1.8} />
                  Source
                </span>
              </div>
            </div>
          </div>
        </div>
      </Frame>
    </section>
  );
}

/* ── 5 · The Huntloop ────────────────────────────────────────────────────── */

const STAGES = ["Discover", "Qualify", "Enrich", "Reach out", "Track", "Learn"] as const;

function TheLoop() {
  return (
    <section id="how" className="scroll-mt-[68px]">
      <Frame className="flex flex-col items-center gap-2 pt-20 pb-16 text-center lg:pt-[110px] lg:pb-[90px]">
        <Eyebrow className="mb-[18px]">The Huntloop</Eyebrow>
        <h2 className="text-[40px] leading-[1.06] font-semibold tracking-[-0.035em] sm:text-[56px]">
          Find. Understand.
          <br />
          Prioritize. Act.
        </h2>
        <ol className="mt-14 grid w-full max-w-[1160px] grid-cols-2 items-start gap-y-8 sm:grid-cols-3 lg:grid-cols-6">
          {STAGES.map((stage, i) => (
            <li key={stage} className="relative flex flex-col gap-2 pr-7 text-left">
              <span className="hl-label hl-tabular tracking-[0.1em]!">
                {String(i + 1).padStart(2, "0")}
              </span>
              <span className="text-[18px] font-semibold tracking-[-0.02em]">{stage}</span>
              {i < STAGES.length - 1 && (
                <ArrowRight
                  aria-hidden
                  className="absolute top-[3px] right-2 hidden size-4 text-fg-faint lg:block"
                  strokeWidth={1.6}
                />
              )}
            </li>
          ))}
        </ol>
      </Frame>
    </section>
  );
}

/* ── 6 · 01 Discover ─────────────────────────────────────────────────────── */

function Discover() {
  return (
    <section id="discover" className="scroll-mt-[68px] border-t border-line-subtle">
      <Frame className="grid items-center gap-12 py-20 lg:py-24 xl:grid-cols-[420px_minmax(0,1fr)] xl:gap-[72px]">
        <div className="flex flex-col gap-5">
          <Eyebrow n="01">Discover</Eyebrow>
          <h2 className="text-[32px] leading-[1.08] font-semibold tracking-[-0.03em] sm:text-[42px]">
            Find the companies you didn&rsquo;t know you should be watching.
          </h2>
          <p className="max-w-[380px] text-[17px] leading-[1.6] text-fg-secondary">
            Huntloop scans thousands of signals — from funding and hiring to tech stacks and
            intent — to surface companies that are becoming a fit.
          </p>
        </div>

        <div className="min-w-0 overflow-hidden rounded-lg border border-line-subtle bg-surface shadow-popover">
          <div className="border-b border-line-subtle px-[22px] py-[18px]">
            <span className="text-[14px] font-semibold">Discover</span>
            <span className="mt-2.5 flex h-[34px] items-center rounded-[8px] bg-canvas px-3 text-[12.5px] text-fg-muted">
              <Search aria-hidden className="mr-2 size-3.5 shrink-0" strokeWidth={1.7} />
              <span className="truncate">Search companies, industries, keywords…</span>
            </span>
          </div>
          <div className="px-3.5 pt-2 pb-4">
            <div className="grid grid-cols-[30px_minmax(0,1fr)_56px] gap-3.5 px-2 py-2.5 text-[11px] font-semibold tracking-[0.05em] text-fg-muted uppercase sm:grid-cols-[30px_minmax(0,1fr)_70px_90px]">
              <span />
              <span>Companies becoming a fit</span>
              <span className="text-center">Fit score</span>
              <span className="hidden sm:block">Source</span>
            </div>
            <ul>
              {COMPANIES.map((c) => (
                <li
                  key={c.name}
                  className="grid grid-cols-[30px_minmax(0,1fr)_56px] items-center gap-3.5 rounded-[8px] border-t border-line-subtle px-2 py-[11px] transition-colors duration-[140ms] hover:bg-hover sm:grid-cols-[30px_minmax(0,1fr)_70px_90px]"
                >
                  <CompanyTile tone={c.tone} icon={c.icon} />
                  <span className="min-w-0">
                    <span className="block truncate text-[13.5px] font-semibold">{c.name}</span>
                    <span className="block truncate text-[11.5px] text-fg-muted">{c.sector}</span>
                  </span>
                  {/* The comp paints the numeral in --pos / --mid, which are
                      graphic values (3.4 and 3.0:1). The `-text` leaves are
                      the same hues, darkened to AA. */}
                  <span
                    className={`hl-tabular text-center text-[15px] font-semibold ${
                      c.score >= 75 ? "text-success-text" : "text-warning-text"
                    }`}
                  >
                    {c.score}
                  </span>
                  <span className="hidden text-[12.5px] text-fg-secondary sm:block">{c.source}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Frame>
    </section>
  );
}

/* ── 7 · 02 Qualify ──────────────────────────────────────────────────────── */

function Qualify() {
  const northwind = COMPANIES[0]!;
  return (
    <section className="border-y border-line-subtle bg-canvas">
      <Frame className="grid items-center gap-12 py-20 lg:py-24 xl:grid-cols-[minmax(0,1fr)_420px] xl:gap-[72px]">
        <div className="flex flex-col gap-5 xl:order-2">
          <Eyebrow n="02">Qualify</Eyebrow>
          <h2 className="text-[32px] leading-[1.08] font-semibold tracking-[-0.03em] sm:text-[42px]">
            A match isn&rsquo;t a reason.
          </h2>
          <p className="max-w-[360px] text-[17px] leading-[1.6] text-fg-secondary">
            Huntloop evaluates each opportunity across multiple dimensions — and keeps what it
            doesn&rsquo;t know as unknown, not zero.
          </p>
        </div>

        <div className="w-full max-w-[540px] overflow-hidden rounded-lg border border-line-subtle bg-surface shadow-popover xl:order-1">
          <div className="flex items-center gap-2 border-b border-line-subtle px-5 py-3.5 text-[13px] text-fg-muted">
            <Scale aria-hidden className="size-3.5" strokeWidth={1.8} />
            Qualify
          </div>
          <div className="flex flex-col gap-5 px-6 py-[22px]">
            <div className="flex items-center justify-between gap-4">
              <div className="flex min-w-0 items-center gap-3">
                <CompanyTile tone="brand" icon={northwind.icon} size={34} />
                <div className="min-w-0">
                  <p className="truncate text-[15px] font-semibold">{northwind.name}</p>
                  <p className="truncate text-[11.5px] text-fg-muted">{northwind.sector}</p>
                </div>
              </div>
              <ScoreRing score={northwind.score} size="sm" label={`Overall fit ${northwind.score}`} />
            </div>

            <dl className="flex flex-col border-t border-line-subtle">
              {FACTORS.map(({ label, value, icon: I }, i) => (
                <div
                  key={label}
                  className={`grid grid-cols-[24px_minmax(0,1fr)_40px] items-center gap-3 py-[13px] text-[14px] ${
                    i < FACTORS.length - 1 ? "border-b border-line-subtle" : ""
                  }`}
                >
                  <I aria-hidden className="size-[15px] text-fg-muted" strokeWidth={1.7} />
                  <dt className={value === null ? "text-fg-secondary" : ""}>{label}</dt>
                  <dd className="hl-tabular text-right font-semibold">
                    {value ?? (
                      <>
                        <span aria-hidden className="font-normal text-fg-muted">
                          —
                        </span>
                        <span className="sr-only">Unknown</span>
                      </>
                    )}
                  </dd>
                </div>
              ))}
            </dl>

            <div className="rounded-[10px] border border-dashed border-line bg-canvas px-3.5 py-3">
              <p className="mb-1 text-[11px] font-semibold tracking-[0.05em] text-fg-muted uppercase">
                Unknown
              </p>
              <p className="text-[13px] text-fg-secondary">Budget allocation could not be established.</p>
            </div>
          </div>
        </div>
      </Frame>
    </section>
  );
}

/* ── 8 · Black — 03 Evidence ─────────────────────────────────────────────── */

function Evidence() {
  return (
    <section id="evidence" data-theme="dark" className="hl-band scroll-mt-[68px]">
      <Frame className="grid items-center gap-12 py-20 lg:py-[100px] xl:grid-cols-[minmax(0,1fr)_300px_minmax(0,1fr)] xl:gap-14">
        <div className="flex flex-col gap-5">
          <Eyebrow n="03">Evidence</Eyebrow>
          <h2 className="text-[36px] leading-[1.04] font-semibold tracking-[-0.035em] sm:text-[48px]">
            Don&rsquo;t trust the number.
          </h2>
          <p className="max-w-[300px] text-[17px] leading-[1.6] text-fg-secondary">
            A score you can&rsquo;t inspect isn&rsquo;t intelligence.
          </p>
        </div>

        <div className="flex justify-center">
          <ScoreRing score={87} size="xl" tone="neutral" caption="WHY?" label="Score 87, inspectable" />
        </div>

        <dl className="flex flex-col gap-4">
          {FACTORS.map(({ label, value }, i) => (
            <div
              key={label}
              className={`grid items-center gap-3 text-[14px] ${
                value === null ? "grid-cols-[minmax(0,1fr)_auto]" : "grid-cols-[minmax(0,1fr)_40px]"
              } ${i < FACTORS.length - 1 ? "border-b border-line pb-3" : ""}`}
            >
              <dt className="text-fg-secondary">{label}</dt>
              <dd
                className={
                  value === null
                    ? "text-[11px] tracking-[0.05em] text-fg-muted uppercase"
                    : "hl-tabular text-right font-semibold"
                }
              >
                {value ?? "Unknown"}
              </dd>
            </div>
          ))}
        </dl>
      </Frame>
    </section>
  );
}

/* ── 9 · Fact / Inference / Unknown ──────────────────────────────────────── */

function ClaimKinds() {
  const kinds: { label: string; lines: string[]; icon: Icon; mark: string; ink: string }[] = [
    { label: "Fact", lines: ["Observed.", "Cited.", "Verifiable."], icon: SquareCheck, mark: "text-success", ink: "text-fg" },
    { label: "Inference", lines: ["Concluded.", "Labelled.", "Inspectable."], icon: SquareDot, mark: "text-brand-vivid", ink: "text-fg" },
    { label: "Unknown", lines: ["Not established.", "Not invented.", "Visible."], icon: SquareDashed, mark: "text-fg-faint", ink: "text-fg-secondary" },
  ];
  return (
    <section>
      <Frame className="flex flex-col items-center gap-10 py-20 lg:py-[90px]">
        <Eyebrow>The Huntloop</Eyebrow>
        <div className="grid w-full max-w-[1160px] overflow-hidden rounded-lg border border-line-subtle md:grid-cols-3">
          {kinds.map(({ label, lines, icon: I, mark, ink }, i) => (
            <div
              key={label}
              className={`flex flex-col gap-4 px-[34px] py-8 ${
                i === 1 ? "border-y border-line-subtle md:border-x md:border-y-0" : ""
              }`}
            >
              <h3 className={`flex items-center gap-2.5 text-[12px] font-semibold tracking-[0.08em] uppercase ${ink}`}>
                <I aria-hidden className={`size-4 ${mark}`} strokeWidth={1.8} />
                {label}
              </h3>
              <div className="text-[15px] leading-[1.9] text-fg-secondary">
                {lines.map((l) => (
                  <p key={l}>{l}</p>
                ))}
              </div>
            </div>
          ))}
        </div>
        <p className="text-center text-[16px] text-fg-muted">
          The system doesn&rsquo;t fill gaps just to look confident.
        </p>
      </Frame>
    </section>
  );
}

/* ── 10 · 04 You stay in control ─────────────────────────────────────────── */

function InControl() {
  const rules = ["ICP industry", "Company size", "Recent funding", "Hiring activity", "Pain signal"];
  return (
    <section className="border-t border-line-subtle">
      <Frame className="grid items-center gap-12 py-20 lg:py-24 xl:grid-cols-[300px_minmax(0,1fr)_300px] xl:gap-14">
        <div className="flex flex-col gap-5">
          <Eyebrow n="04">Not an AI SDR</Eyebrow>
          <h2 className="text-[34px] leading-[1.06] font-semibold tracking-[-0.03em] sm:text-[40px]">
            You stay in control.
          </h2>
          <p className="text-[16px] leading-[1.8] text-fg-secondary">
            Huntloop researches.
            <br />
            Huntloop explains.
            <br />
            Huntloop drafts.
            <br />
            <span className="font-medium text-fg">You decide.</span>
          </p>
        </div>

        <LoopDiagram />

        <div className="flex flex-col gap-6">
          <div>
            <Eyebrow className="mb-3.5">Factor breakdown</Eyebrow>
            <dl className="flex flex-col gap-2.5 text-[13.5px]">
              {FACTORS.map(({ label, value }, i) => (
                <div
                  key={label}
                  className={`grid ${
                    value === null ? "grid-cols-[minmax(0,1fr)_auto] items-center" : "grid-cols-[minmax(0,1fr)_36px]"
                  } ${i < FACTORS.length - 1 ? "border-b border-line-subtle pb-2" : ""}`}
                >
                  <dt className="text-fg-secondary">{value === null ? "Budget" : label}</dt>
                  <dd
                    className={
                      value === null
                        ? "text-[10.5px] tracking-[0.05em] text-fg-muted uppercase"
                        : "hl-tabular text-right font-semibold"
                    }
                  >
                    {value ?? "Unknown"}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
          <div>
            <Eyebrow className="mb-3.5">Rules used</Eyebrow>
            <ul className="flex flex-col gap-[9px] text-[13.5px] text-fg-secondary">
              {rules.map((r) => (
                <li key={r} className="flex gap-[9px]">
                  <span aria-hidden className="text-brand-text">
                    +
                  </span>
                  {r}
                </li>
              ))}
            </ul>
            <TextLink href="#evidence" className="mt-3.5 text-[13px] text-brand-text">
              Show evidence
            </TextLink>
          </div>
        </div>
      </Frame>
    </section>
  );
}

/* ── 11 · Data + Pricing ─────────────────────────────────────────────────── */

function DataAndPricing({ plans }: { plans: Awaited<ReturnType<typeof listPublicPlans>> }) {
  /* Each of these is true of the product today: row-level security on every
     tenant table, the AI provider's no-training terms (privacy page), the
     per-workspace contact retention setting, and the suppression list the
     outreach engine checks before every send. */
  const practices: { text: string; icon: Icon }[] = [
    { text: "Database-level isolation", icon: Database },
    { text: "No training on your data", icon: Ban },
    { text: "Configurable retention", icon: Clock },
    { text: "Workspace-wide suppression", icon: Lock },
  ];
  return (
    <section id="pricing" className="scroll-mt-[68px] border-t border-line-subtle bg-canvas">
      <Frame className="grid items-start gap-14 py-20 lg:py-[90px] xl:grid-cols-[300px_minmax(0,1fr)] xl:gap-16">
        <div className="flex flex-col gap-[18px]">
          <Eyebrow>Your data stays yours</Eyebrow>
          <ul className="flex flex-col gap-0.5">
            {practices.map(({ text, icon: I }) => (
              <li key={text} className="flex items-center gap-3 border-b border-line-subtle py-3.5 text-[14px]">
                <I aria-hidden className="size-[17px] shrink-0 text-fg" strokeWidth={1.6} />
                {text}
              </li>
            ))}
          </ul>
          {/* Only once the privacy policy is published — see the footer's
              note on `legalIsComplete`. */}
          {legalIsComplete() && (
            <TextLink href="/privacy" className="text-[13.5px] text-brand-text">
              Read our data practices
            </TextLink>
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-6">
          <h2 className="text-[28px] leading-[1.1] font-semibold tracking-[-0.03em] sm:text-[34px]">
            Start with the work.
            <br />
            Scale when you need it.
          </h2>

          {/* ── Why this paragraph exists ────────────────────────────────────
              The plans below are read from the same catalogue the metering
              reads. A page whose whole argument is that this product does not
              overstate what it knows should say what it cannot do as plainly
              as what it can, and "you cannot buy this yet" is the more
              important of the two. */}
          <p className="max-w-2xl rounded-[10px] border border-warning-border bg-warning-surface px-3.5 py-2.5 text-[13px] leading-[1.6] text-fg-secondary">
            <span className="font-medium text-warning-text">There is no checkout yet.</span>{" "}
            Every account starts on Free, and the paid plans below are what we intend to charge
            rather than something you can buy today. When billing exists it will be a separate,
            explicit step — nothing here can charge you.
          </p>

          <div className="grid gap-4 md:grid-cols-3">
            {plans.map((plan) => {
              const featured = plan.id === "growth";
              return (
                <div
                  key={plan.id}
                  className={`flex flex-col gap-4 rounded-lg bg-surface px-6 py-7 ${
                    featured
                      ? "border-[1.5px] border-brand-vivid shadow-popover"
                      : "border border-line-subtle"
                  }`}
                >
                  <div>
                    <h3 className="text-[15px] font-semibold">{plan.name}</h3>
                    {featured && <p className="text-[11.5px] text-fg-muted">For growing teams</p>}
                  </div>
                  <p>
                    <span className="hl-tabular text-[38px] font-semibold tracking-[-0.03em]">
                      ${(plan.priceCents / 100).toLocaleString()}
                    </span>
                    <span className="text-[13px] text-fg-muted"> /month</span>
                  </p>
                  <ul className="hl-tabular flex-1 text-[13px] leading-[1.9] text-fg-secondary">
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

                  {/* A paid tier's button used to read "Start on Growth" and
                      create a Free account. That is a misleading commercial
                      representation whether or not money changes hands — the
                      comp still says it, and this does not. Free keeps its
                      signup button because it is the thing you can start. */}
                  {plan.priceCents === 0 ? (
                    <Button
                      variant={featured ? "primary" : "secondary"}
                      size="lg"
                      href="/signup"
                      linkComponent={Link}
                      className="h-10! w-full text-[13.5px]!"
                    >
                      Start free
                    </Button>
                  ) : IDENTITY.contactEmail ? (
                    <Button
                      variant={featured ? "primary" : "secondary"}
                      size="lg"
                      href={`mailto:${IDENTITY.contactEmail}?subject=${encodeURIComponent(`Huntloop ${plan.name}`)}`}
                      className="h-10! w-full text-[13.5px]!"
                    >
                      Talk to us about {plan.name}
                    </Button>
                  ) : (
                    /* No contact address configured yet, so there is nothing
                       honest for this button to do. A disabled control that
                       says why beats a working one that goes somewhere else —
                       the same rule `NAV-03` enforces inside the product. */
                    <p className="flex h-10 items-center justify-center rounded-[9px] border border-dashed border-line text-[13px] text-fg-muted">
                      Not available yet
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </Frame>
    </section>
  );
}

/* ── 12 · Black CTA ──────────────────────────────────────────────────────── */

function ClosingCta({ canResearch }: { canResearch: boolean }) {
  return (
    <section data-theme="dark" className="hl-band">
      <Frame className="grid items-center gap-12 py-16 lg:py-20 xl:grid-cols-[300px_minmax(0,1fr)] xl:gap-16">
        <div className="flex flex-col gap-3">
          <h3 className="text-[28px] font-semibold tracking-[-0.03em]">We&rsquo;re early.</h3>
          <p className="text-[14.5px] leading-[1.6] text-fg-secondary">
            We would rather show you what Huntloop actually does than decorate the page with
            logos we haven&rsquo;t earned.
          </p>
          <TextLink href="#domain" className="mt-1 self-start text-[13.5px] text-brand-text">
            Try it on your domain
          </TextLink>
        </div>
        <div className="flex min-w-0 flex-col gap-6">
          <h2 className="text-[40px] leading-none font-semibold tracking-[-0.04em] sm:text-[58px]">
            See who needs you.
          </h2>
          {/* `canResearch` decides where the box goes and what the note under
              it promises — see DomainInput. */}
          <DomainInput id="domain" canResearch={canResearch} />
        </div>
      </Frame>
    </section>
  );
}

/* ── 13 · Footer ─────────────────────────────────────────────────────────── */

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
      <Frame className="flex flex-col gap-7 py-10">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <Logo size="sm" />
          <p className="hl-label flex flex-wrap items-center gap-x-3 gap-y-1.5">
            {["Find", "Understand", "Prioritize", "Act"].map((w, i) => (
              <span key={w} className="flex items-center gap-3">
                {i > 0 && <ArrowRight aria-hidden className="size-3.5 text-fg-faint" strokeWidth={1.6} />}
                {w}
              </span>
            ))}
          </p>
        </div>

        <div className="grid gap-8 border-t border-line-subtle pt-7 text-[13px] sm:grid-cols-2 md:grid-flow-col md:grid-cols-[minmax(0,1fr)] md:auto-cols-[180px] md:gap-6">
          <div className="flex flex-col items-start gap-4">
            <p className="text-fg-muted">© {new Date().getFullYear()} Huntloop</p>
            {/* The header drops its toggle on phones; this one is always there. */}
            <ThemeToggle />
          </div>
          <FooterColumn label="Product">
            <a href="#how" className={footerLink}>
              How it works
            </a>
            <a href="#pricing" className={footerLink}>
              Pricing
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
      </Frame>
    </footer>
  );
}

export const metadata = {
  /* `absolute`: the root layout's template appends "· Huntloop", which on the
     one page whose title already opens with the name read "Huntloop — … ·
     Huntloop" in every tab and search result. */
  title: { absolute: "Huntloop — know who needs you before you reach out" },
  description:
    "Huntloop finds the companies becoming a fit, shows you why with sources, and drafts the outreach. Every score shows its working.",
  alternates: { canonical: "/" },
};

/* Dynamic because `resolveDestination` reads cookies: the nav and the hero
   CTA differ for a signed-in visitor, and a cached copy would show one
   visitor's "Continue" button to everybody. */
export const dynamic = "force-dynamic";
