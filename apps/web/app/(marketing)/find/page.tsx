import { notFound } from "next/navigation";
import { Card, CardBody, ThemeToggle } from "@huntloop/ui";
import { isExchangeEnabled } from "../../../lib/exchange/flag";
import { resolveVisitorDestination } from "../../../lib/data/destination";
import { BrandLink } from "../../BrandLink";
import { NavActions } from "../NavActions";
import { FindForm } from "./FindForm";

/**
 * The buyer's front door (DN-74), and the home page of the buyer domain
 * (DN-73). It exists only while the Exchange is on.
 *
 * It promises what the database enforces and nothing else: no supplier counts,
 * no response times, no example matches.
 */
export default async function FindPage() {
  if (!isExchangeEnabled()) notFound();
  const destination = await resolveVisitorDestination();
  const workspace =
    destination.kind === "workspace" ? destination.orgSlug : destination.kind === "demo" ? destination.path.split("/")[1]! : null;
  const next = workspace
    ? `/${workspace}/exchange/new`
    : destination.kind === "choose"
      ? "/orgs"
      : destination.kind === "new-user"
        ? "/welcome?job=buy"
        : "/signup?for=buy";

  return (
    <div className="min-h-screen bg-canvas">
      <header className="border-b border-line-subtle">
        <nav aria-label="Main" className="mx-auto flex max-w-[880px] items-center gap-4 px-6 py-3">
          <BrandLink href="/" />
          <div className="ml-auto flex items-center gap-1">
            <ThemeToggle className="mr-2" />
            <NavActions destination={destination} />
          </div>
        </nav>
      </header>
      <main id="main" className="mx-auto max-w-[880px] px-6 py-14">
        <h1 className="hl-display text-fg">Say what you need. Stay anonymous until you choose.</h1>
        <p className="mt-4 max-w-xl text-[16px] leading-[1.6] text-fg-secondary">
          Describe a product, a service or a partner in your own words. Huntloop matches it against what suppliers list,
          shows you why each one fits, and introduces you only when you say so.
        </p>
        <div className="mt-8">
          <FindForm next={next} cta={destination.kind === "anonymous" ? "Continue with a free account" : "Continue to your request"} />
        </div>
        <section className="mt-14" aria-labelledby="find-promise">
          <h2 id="find-promise" className="text-[22px] leading-8 font-semibold text-fg">
            What happens to your request
          </h2>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {PROMISES.map((p) => (
              <Card key={p.heading} flush>
                <CardBody>
                  <h3 className="text-[14px] font-semibold text-fg">{p.heading}</h3>
                  <p className="mt-1 text-[13px] leading-[1.6] text-fg-muted">{p.body}</p>
                </CardBody>
              </Card>
            ))}
          </div>
        </section>
        <section className="mt-12 rounded-md border border-warning-border bg-warning-surface/40 p-5">
          <h2 className="text-[14px] font-semibold text-warning-text">What to expect</h2>
          <p className="mt-2 max-w-2xl text-[14px] leading-[1.7] text-fg-secondary">
            Matching opens category by category, as suppliers list in it. Until yours opens, your request is saved and
            you are shown no matches rather than poor ones. Huntloop is not a party to any purchase.
          </p>
        </section>
      </main>
    </div>
  );
}

const PROMISES = [
  { heading: "You confirm every detail", body: "Huntloop asks a few questions and shows you the result. Nothing is filed until you check it." },
  { heading: "You choose who may see it", body: "Keep it private, count it only, or show suppliers an anonymous card with rounded amounts." },
  { heading: "You see who looked", body: "Every time a supplier is shown your card, it is recorded where you can read it." },
  { heading: "You are never cold-emailed from it", body: "A request never becomes outreach, and your name is shared only when you accept an introduction." },
] as const;

/* Says nothing while the flag is off, like every Exchange page. */
export function generateMetadata() {
  if (!isExchangeEnabled()) return {};
  return {
    title: "Find a supplier",
    description: "Describe what you need and stay anonymous until you accept an introduction.",
    alternates: { canonical: "/find" },
  };
}

/* Reads cookies, like the other marketing pages. */
export const dynamic = "force-dynamic";
