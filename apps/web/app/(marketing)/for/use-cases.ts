/**
 * The four use-case pages.
 *
 * ── Why this is a hand-written list and not a generator ──────────────────
 *
 * The plan called this a "programmatic surface", and the same paragraph
 * carried the constraint that matters more than the idea: *each templated page
 * must offer something real, or it is doorway spam that damages the domain.*
 *
 * Four pages, written out, is what honours that. A generator over a list of
 * industries would produce two hundred URLs whose only difference is a noun
 * substituted into the same sentences — which is exactly the pattern search
 * engines demote and, more to the point, exactly the kind of content-shaped
 * filler this product's whole position is against. If we would not put our
 * name to the sentence, it does not get a URL.
 *
 * These four are real because they describe genuinely different work. A
 * founder with four hours a week, an SDR with a daily queue, an agency with
 * five clients and an account-based team watching a fixed list are not one
 * audience with different job titles — they want the loop to start in
 * different places, which is the same distinction `personalization.ts` encodes
 * for the dashboard.
 *
 * ── Why there is no `/compare/[alternative]` ─────────────────────────────
 *
 * The plan proposed one and it is deliberately not built. An honest comparison
 * needs current, checked facts about somebody else's product, and we have
 * none — what we would actually produce is a table where our column is
 * researched and theirs is guessed. The landing page's comparison section does
 * the defensible version of this: it names *categories* rather than companies,
 * and every row is a claim about Huntloop that we can substantiate.
 *
 * A comparison page that overclaims poisons the honesty position the rest of
 * the site rests on, and that is a worse trade than the traffic is worth.
 */

export interface UseCase {
  slug: string;
  /** The audience, as they would describe themselves. */
  label: string;
  title: string;
  headline: string;
  subhead: string;
  /** The situation, in their words rather than ours. */
  problem: { heading: string; body: string };
  /** What the loop looks like when it starts where they need it to. */
  fit: { heading: string; body: string }[];
  /** A profile shape that is genuinely usable as a starting point. */
  profile: { label: string; value: string }[];
  /** The honest limit. Every page has one. */
  caveat: string;
}

export const USE_CASES: readonly UseCase[] = [
  {
    slug: "founder-led-sales",
    label: "Founder-led sales",
    title: "Huntloop for founder-led sales",
    headline: "You are the pipeline, and you have four hours a week for it.",
    subhead:
      "Huntloop is the research team you cannot hire yet. It arrives with a short list and the reason for every name on it.",
    problem: {
      heading: "The problem is not finding companies",
      body: "It is finding the twenty minutes to work out which of them is worth an email this week, and then having something to say that is not obviously templated. Most tools give you more names. The names were never the bottleneck.",
    },
    fit: [
      {
        heading: "It starts from your own site",
        body: "You give Huntloop your website. It reads what you sell, who buys it and what problem it solves, then drafts the customer profile that follows — and shows you which sentence each line came from, so you can correct it rather than accept it.",
      },
      {
        heading: "It leads with why now",
        body: "The dashboard a founder gets opens on what changed in your market this week and who is worth your next hour, because that is the only question you have time to ask.",
      },
      {
        heading: "Nothing sends without you",
        body: "Huntloop drafts. You approve. There is no autonomous mode, which matters more when the sender's name is also the company's.",
      },
    ],
    profile: [
      { label: "Segments", value: "The two or three markets you have actually closed in" },
      { label: "Company size", value: "One band. Narrower than feels comfortable" },
      { label: "Triggers", value: "Funding, a relevant hire, a launch that implies the problem" },
      { label: "Never a fit", value: "The deals you regret taking" },
    ],
    caveat:
      "If you have not closed anyone yet, the profile is a hypothesis rather than a pattern. Huntloop will say so — an ICP drafted from a site with no customers behind it comes back thin, and thin is the honest answer.",
  },
  {
    slug: "outbound-teams",
    label: "Outbound teams",
    title: "Huntloop for outbound teams",
    headline: "Stop paying people to build lists.",
    subhead:
      "Start the day with a ranked queue where every entry already answers why this company and why now.",
    problem: {
      heading: "List building is not the job",
      body: "An SDR spending half their week in a data tool is an expensive researcher who also does outreach. The research is the part a system can do — what it cannot do is the judgement about whether the research is any good, which is why most automated lists get worked once and abandoned.",
    },
    fit: [
      {
        heading: "Every entry shows its working",
        body: "A score that decomposes into the criteria it matched, the trigger with the date it happened, and the evidence with a link. A rep who can see why a company is on the list can tell you when the list is wrong.",
      },
      {
        heading: "The queue is the dashboard",
        body: "An SDR's workspace opens on today's outreach queue — who is ready to reach, and what to say — rather than on a pipeline summary written for their manager.",
      },
      {
        heading: "Disagreement is an input",
        body: "When a rep overrules a verdict, that is recorded. After enough of them Huntloop asks what those companies had in common, and turns the answer into a scoring rule you can read before it runs.",
      },
    ],
    profile: [
      { label: "Segments", value: "Where your best-performing sequences already land" },
      { label: "Job titles", value: "Specific enough to search — 'Head of Platform', not 'decision maker'" },
      { label: "Triggers", value: "The events that made your last five meetings happen" },
      { label: "Exclusions", value: "The titles that look right and never convert" },
    ],
    caveat:
      "Huntloop will not send on a schedule without a person in the loop. If what you want is volume with nobody reading it, this is the wrong tool and will feel slow.",
  },
  {
    slug: "agencies",
    label: "Agencies and consultants",
    title: "Huntloop for agencies",
    headline: "One workspace per client, one loop each.",
    subhead:
      "Each client gets its own customer profile, sources and pipeline. You switch between them without a second login.",
    problem: {
      heading: "Every client is a different market",
      body: "Running five clients out of one tool means five sets of filters you keep re-remembering, and a constant low risk of showing somebody another client's list. Running five accounts means five logins.",
    },
    fit: [
      {
        heading: "Separated at the database, not in the interface",
        body: "Each workspace is a tenant. The isolation is a row-level policy in Postgres rather than a filter in application code, so one client's data cannot reach another's even if we ship a bug.",
      },
      {
        heading: "Setup asks whose company it is",
        body: "Tell Huntloop you are an agency and the research step asks whether this workspace is for a client or for you — because a profile drafted from your own site would hunt for companies that want an agency, which is not the job.",
      },
      {
        heading: "Costs attributed per client",
        body: "Provider credits and model spend are recorded against the workspace that used them, so a client's usage is answerable rather than estimated.",
      },
    ],
    profile: [
      { label: "One workspace", value: "Per client, created from their domain" },
      { label: "Segments", value: "Their market, drafted from their site" },
      { label: "Sources", value: "Their trade press, not yours" },
      { label: "Voice", value: "Set per workspace, so drafts sound like the client" },
    ],
    caveat:
      "There is no consolidated invoice. The workspace switcher shows what each client used this month — opportunities, AI runs, enrichments — so you can bill it on, but Huntloop will not produce one bill across ten clients. If that is what you need, tell us and it moves up the list.",
  },
  {
    slug: "account-based",
    label: "Account-based",
    title: "Huntloop for account-based selling",
    headline: "Bring your target list. We will tell you when each one wakes up.",
    subhead:
      "Huntloop watches every account you name and surfaces the week one becomes reachable, instead of you checking.",
    problem: {
      heading: "The list is not the hard part",
      body: "You already know the two hundred companies. What you cannot do is read all of their news, job boards and filings every week — so timing becomes luck, and the account you had been nursing for a year signs with somebody who happened to email in the right month.",
    },
    fit: [
      {
        heading: "Import the list you already have",
        body: "Paste a CSV or a set of domains. Huntloop qualifies them against your profile and starts watching, rather than trying to sell you a bigger list first.",
      },
      {
        heading: "It knows when something happened, separately from when it saw it",
        body: "A six-month-old funding round found yesterday is still six months old. Most tools store one date and present stale news as a fresh trigger — which is how an account-based team learns to distrust alerts.",
      },
      {
        heading: "Discovery is optional",
        body: "If your market is a fixed list, you can turn company search off entirely and use Huntloop purely as the thing that watches it.",
      },
    ],
    profile: [
      { label: "Example companies", value: "Your named accounts, as domains" },
      { label: "Triggers", value: "What has historically preceded a real conversation" },
      { label: "Sources", value: "The specific places your accounts appear" },
      { label: "Discovery", value: "Off, if the list is the whole market" },
    ],
    caveat:
      "Huntloop cannot see inside an account. Everything it reports is public — news, hiring, filings, releases — so it complements whatever you know from relationships rather than replacing it.",
  },
];

export function findUseCase(slug: string): UseCase | undefined {
  return USE_CASES.find((useCase) => useCase.slug === slug);
}
