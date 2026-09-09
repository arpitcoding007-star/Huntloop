/**
 * Comparison pages, against approaches rather than products.
 *
 * ── Why not `/compare/[competitor]` ──────────────────────────────────────
 *
 * The twelfth-pass plan proposed one and the first implementation pass
 * deliberately declined to build it. The reasoning still holds and is worth
 * keeping next to the thing that replaced it:
 *
 * An honest comparison against a named product needs current, checked facts
 * about somebody else's software. We do not have them and cannot keep them
 * current. What we would actually produce is a table where our column is
 * researched and theirs is guessed — and a comparison page that overclaims
 * poisons the honesty position the entire rest of the site rests on. It would
 * also age badly in the worst way: silently, as the other product ships things.
 *
 * ── Why comparing *approaches* is different ──────────────────────────────
 *
 * "A list tool", "an autonomous AI SDR", "hiring an SDR" and "doing it by
 * hand" are categories defined by what they structurally are, not by what a
 * particular vendor shipped last quarter. Every claim below is a claim about
 * the *shape* of the approach — a list tool does not explain its results
 * because explaining them is not what a list tool is for — and those claims
 * are checkable, stable, and fair.
 *
 * ── The rule every page here follows ─────────────────────────────────────
 *
 * **Each one says when to choose the other thing, and means it.**
 *
 * A comparison page whose every row favours us is an advert wearing a table's
 * clothes, and readers know it. `chooseOther` is not a hedge — it names the
 * situation where Huntloop is genuinely the worse purchase, in terms specific
 * enough to act on. It costs some conversions and buys the only thing worth
 * more: the reader believing the rest of the page.
 */

export interface ComparisonRow {
  /** The question a buyer is actually asking. */
  question: string;
  /** What the other approach does. Stated as its designers would state it. */
  other: string;
  /** What Huntloop does. */
  huntloop: string;
}

export interface Approach {
  slug: string;
  /** How the approach is named in the wild. Title-cased for headings. */
  label: string;
  /**
   * The same thing, cased for the middle of a sentence.
   *
   * Spelled out rather than produced with `toLowerCase()`, which turns
   * "An autonomous AI SDR" into "an autonomous ai sdr" — an acronym lowercased
   * in the one heading on the page whose whole job is to sound like a person
   * being straight with you.
   */
  labelInSentence: string;
  title: string;
  headline: string;
  subhead: string;
  /** What it is genuinely good at. First, and not grudging. */
  strengths: { heading: string; body: string };
  rows: readonly ComparisonRow[];
  /** When the other approach is the right purchase. Named specifically. */
  chooseOther: string;
}

export const APPROACHES: readonly Approach[] = [
  {
    slug: "list-tools",
    label: "A list tool",
    labelInSentence: "a list tool",
    title: "Huntloop compared to a list tool",
    headline: "A list tool answers who matches. Huntloop answers who to pursue.",
    subhead:
      "Both start from filters. The difference is what happens after the query returns.",
    strengths: {
      heading: "What a list tool is genuinely better at",
      body: "Coverage and speed. A mature data provider has more companies, more contacts and more attributes than anything built on top of one, and it returns ten thousand rows in a second. If what you need is the raw set — for a market map, an addressable-market number, a territory split — that is the right tool and Huntloop is a slower, more opinionated way to get it.",
    },
    rows: [
      {
        question: "How do I know why a company is on the list?",
        other: "It matched your filters. That is the whole answer, and for a list it is the correct one.",
        huntloop:
          "A score that decomposes into the criteria it matched, plus evidence with the URL each claim was read on.",
      },
      {
        question: "How do I know which of these to contact this week?",
        other:
          "Sort by a firmographic field, or export and decide elsewhere. Timing is not something a filter can express.",
        huntloop:
          "A trigger with the date it happened, kept separate from the date we saw it — so a six-month-old round is not presented as news.",
      },
      {
        question: "What happens when the list is wrong?",
        other: "You adjust the filters and run it again.",
        huntloop:
          "Overruling a verdict is recorded. After a few, Huntloop asks what those companies had in common and proposes a scoring rule you read before it runs.",
      },
      {
        question: "Who does the research?",
        other: "You do, or somebody you pay to.",
        huntloop:
          "Huntloop reads the sources you approve and attaches what it finds to the company, with citations.",
      },
    ],
    chooseOther:
      "If your team already has a research process that works and what is missing is volume, buy the data and keep the process. Huntloop's value is the explanation, and you are already producing one.",
  },
  {
    slug: "ai-sdr",
    label: "An autonomous AI SDR",
    labelInSentence: "an autonomous AI SDR",
    title: "Huntloop compared to an autonomous AI SDR",
    headline: "It sends without you. Huntloop will not.",
    subhead:
      "That is the whole difference, and it is a real trade rather than a marketing distinction.",
    strengths: {
      heading: "What an autonomous SDR is genuinely better at",
      body: "Throughput per hour of human attention, which is not a small thing. If a system can find, research, write and send without stopping, it will contact more companies in a week than a person approving each message ever will. For a high-volume, low-consideration motion where the cost of a bad email rounds to zero, that arithmetic favours autonomy and Huntloop is the slower choice.",
    },
    rows: [
      {
        question: "Who presses send?",
        other: "The system, on a schedule.",
        huntloop:
          "A person, every time. There is no autonomous mode and adding one is not on the roadmap.",
      },
      {
        question: "What happens when it is confidently wrong?",
        other:
          "The email goes out. You find out from the reply, or from nothing at all.",
        huntloop:
          "You see the claim, its label — fact, inference or unknown — and the page it came from, before anything is sent.",
      },
      {
        question: "Whose reputation is spending?",
        other: "Yours. The sending domain is your company's.",
        huntloop:
          "Also yours, which is precisely why a person approves. Volume you did not read is a domain-reputation decision made on your behalf.",
      },
      {
        question: "How does it improve?",
        other: "Typically by optimising for reply rate on the copy it already sends.",
        huntloop:
          "By asking you what a pattern of overrides meant, and turning the answer into a rule you approve.",
      },
    ],
    chooseOther:
      "If you are running high-volume outbound where a wrong email costs nothing and nobody has the hours to approve each one, autonomy is the honest fit. Huntloop will feel like friction, because for that motion it is.",
  },
  {
    slug: "hiring-an-sdr",
    label: "Hiring an SDR",
    labelInSentence: "hiring an SDR",
    title: "Huntloop compared to hiring an SDR",
    headline: "A person can do things software cannot. Research is not one of them.",
    subhead:
      "The comparison is not people versus software. It is which half of the job each is better at.",
    strengths: {
      heading: "What a person is genuinely better at",
      body: "Everything that requires judgement about a human being. Reading a lukewarm reply and knowing whether to push. Working a referral. Sitting in a call and hearing the objection behind the objection. Deciding a market is not worth the quarter. None of that is a research task, and none of it is something Huntloop attempts.",
    },
    rows: [
      {
        question: "Who builds the list?",
        other:
          "Often the SDR — commonly a third to a half of the week, which is an expensive researcher who also does outreach.",
        huntloop: "Huntloop, continuously, from a profile the team can read and argue with.",
      },
      {
        question: "What happens to what they learned when they leave?",
        other: "Most of it leaves too.",
        huntloop:
          "It is in the profile, the rules and the recorded overrides — versioned, so a score from March is still comparable.",
      },
      {
        question: "How long until it is producing?",
        other: "Ramp. Usually measured in months.",
        huntloop: "A first scored list on the day you set it up.",
      },
      {
        question: "Can it hold a conversation?",
        other: "Yes, and this is the reason to hire one.",
        huntloop:
          "No. Huntloop drafts an opener and stops. Everything after the reply is a person's job.",
      },
    ],
    chooseOther:
      "If what you are short of is *conversations* rather than *candidates* — you already know who to talk to and nobody has time to talk to them — hire the person. Huntloop makes a good SDR faster; it does not replace one.",
  },
  {
    slug: "doing-it-manually",
    label: "Doing it by hand",
    labelInSentence: "doing it by hand",
    title: "Huntloop compared to doing it yourself",
    headline: "You will do it better. You will not do it every week.",
    subhead:
      "Manual research is the highest-quality option available and the least likely to still be happening in March.",
    strengths: {
      heading: "What doing it yourself is genuinely better at",
      body: "Quality, and it is not close. A founder who reads a prospect's last two blog posts, their job board and their investor's thesis will write a better opener than any system, and will notice things no filter encodes. For the first twenty customers this is usually the right answer, and a tool that talked you out of it would be selling you something.",
    },
    rows: [
      {
        question: "How good is the research?",
        other: "Better than ours, when you actually do it.",
        huntloop: "Consistent, cited, and it happens on the weeks you are busy.",
      },
      {
        question: "How many companies can you cover?",
        other: "As many as you have hours for.",
        huntloop:
          "The market your profile describes, watched continuously, with the ones that changed surfaced.",
      },
      {
        question: "What happens in a busy month?",
        other: "It stops, and the pipeline gap arrives a quarter later.",
        huntloop: "It keeps running, and the queue is waiting when you come back.",
      },
      {
        question: "Where does what you learn go?",
        other: "Your head, mostly.",
        huntloop:
          "The profile and the scoring rules, where the next person to join inherits it.",
      },
    ],
    chooseOther:
      "If you have not closed ten customers yet, do it by hand. You are still learning who your buyer is, and a profile drafted before you know that is a guess Huntloop will faithfully act on. Come back when the pattern is real — the product will tell you as much on the ICP screen.",
  },
];

export function findApproach(slug: string): Approach | undefined {
  return APPROACHES.find((approach) => approach.slug === slug);
}
