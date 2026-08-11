import type {
  EvidenceItem,
  Priority,
  ScoreDimension,
} from "@huntloop/ui";

/**
 * Fixtures for the opportunity list and detail pages.
 *
 * Shaped to match the `opportunities` / `opportunity_scores` / `evidence`
 * rows in packages/db/migrations, so wiring these pages to Supabase is a
 * query swap rather than a rewrite. In particular:
 *
 *   · `dimensions` uses "unknown" where the migration stores NULL. §78 —
 *     an unmeasured dimension is not a zero.
 *   · every `fact` carries a sourceUrl, matching the CHECK constraint that
 *     rejects a source-less fact in the database.
 *   · `priorityReason` is always present, because the column is NOT NULL.
 */

/** Fixed instant so relative ages don't drift. Real pages pass request time. */
export const NOW = new Date("2026-08-11T09:00:00Z");

export interface OpportunityFixture {
  id: string;
  company: string;
  domain: string;
  industry: string;
  location: string;
  employees: string;
  priority: Priority;
  priorityReason: string;
  score: number;
  scoreExplanation: string;
  confidence: "high" | "medium" | "low";
  dimensions: ScoreDimension[];
  status: string;
  owner: string | null;
  trigger: string;
  triggerDate: string;
  whyThisCompany: string;
  whatTheyDo: string;
  identifiedProblem: string;
  potentialGap: string;
  currentApproach: string | null;
  whyNow: string;
  potentialUseCase: string;
  outreachAngle: string;
  recommendedAction: string;
  buyers: {
    name: string;
    title: string;
    isDecisionMaker: boolean;
    /** null where no verified contact exists — §78 forbids fabricating one. */
    email: string | null;
    emailConfidence: "high" | "medium" | "low" | null;
    linkedin: string | null;
  }[];
  evidence: EvidenceItem[];
  triggers: { type: string; date: string; strength: number | null }[];
}

export const OPPORTUNITIES: OpportunityFixture[] = [
  {
    id: "alphio-ai",
    company: "Alphio AI",
    domain: "alphio.ai",
    industry: "AI infrastructure",
    location: "San Francisco, US",
    employees: "24",
    priority: "hot",
    priorityReason:
      "Strong ICP fit, a problem stated in the founder's own words, and a funding trigger three days old.",
    score: 91,
    scoreExplanation:
      "Series A closed this week, and the launch post names custody permissions as an open problem — the exact gap the product closes.",
    confidence: "medium",
    dimensions: [
      { label: "ICP fit", value: 94 },
      { label: "Problem severity", value: 88 },
      { label: "Evidence strength", value: 82 },
      { label: "Trigger strength", value: 90 },
      { label: "Trigger freshness", value: 96 },
      { label: "Buying likelihood", value: "unknown" },
      { label: "Product relevance", value: 92 },
      { label: "Decision-maker accessibility", value: 71 },
    ],
    status: "Qualified",
    owner: "You",
    trigger: "Raised $12M Series A",
    triggerDate: "2026-08-08",
    whyThisCompany:
      "They build autonomous trading agents and have just taken institutional money. Institutional desks will not onboard an agent that holds unconstrained signing authority, which is the constraint this product removes.",
    whatTheyDo:
      "Autonomous trading agents for crypto desks. The product executes strategies on-chain on behalf of a fund, which means it must hold or delegate signing authority over real capital.",
    identifiedProblem:
      "Their agents need controlled financial permissions before institutional desks will onboard. The founder describes this as the thing standing between them and their first three enterprise customers.",
    potentialGap:
      "No public evidence of a permissioning or policy layer between the agent and the wallet.",
    currentApproach: null,
    whyNow:
      "The Series A closed three days ago and the launch post is public. Institutional onboarding is the stated use of funds, so the permissioning problem moves from theoretical to blocking within this quarter.",
    potentialUseCase:
      "Policy-constrained signing: per-strategy spend caps, allow-listed venues, and a human approval path for anything outside them.",
    outreachAngle:
      "Lead with the institutional-onboarding blocker they named themselves, not with the funding round. Everyone will congratulate them on the round this week.",
    recommendedAction: "Reach out to the CTO about custody permissions",
    buyers: [
      {
        name: "Dana Okonkwo",
        title: "Co-founder & CTO",
        isDecisionMaker: true,
        email: "dana@alphio.ai",
        emailConfidence: "high",
        linkedin: "https://www.linkedin.com/",
      },
      {
        name: "Marta Kovacs",
        title: "VP Revenue Operations",
        isDecisionMaker: false,
        email: null,
        emailConfidence: null,
        linkedin: "https://www.linkedin.com/",
      },
    ],
    evidence: [
      {
        claim: "Alphio AI closed a $12M Series A led by Northgate Ventures.",
        kind: "fact",
        confidence: "high",
        source: "TechCrunch",
        sourceUrl: "https://techcrunch.com/",
        eventDate: "2026-08-08",
        observedAt: "2026-08-09",
        excerpt:
          "Alphio AI has raised $12 million to scale its autonomous trading agents to institutional desks.",
      },
      {
        claim:
          "The founder describes permissioning as the blocker to institutional onboarding.",
        kind: "fact",
        confidence: "high",
        source: "Alphio engineering blog",
        sourceUrl: "https://example.com/",
        eventDate: "2026-08-08",
        observedAt: "2026-08-09",
        excerpt:
          "The hard part isn't the strategy. It's convincing a desk to let software hold the keys.",
      },
      {
        claim:
          "Their agents will need controlled financial permissions before institutional desks onboard.",
        kind: "inference",
        confidence: "medium",
        source: "Derived from the launch post and the funding announcement",
        eventDate: "2026-08-08",
        observedAt: "2026-08-09",
      },
      {
        claim: "Which wallet architecture they use today — MPC, multisig, or other.",
        kind: "unknown",
      },
      {
        claim: "Whether budget for this is allocated in the current quarter.",
        kind: "unknown",
      },
    ],
    triggers: [
      { type: "Funding — Series A", date: "2026-08-08", strength: 90 },
      { type: "Product launch", date: "2026-08-08", strength: 72 },
      { type: "Hiring — 2 backend engineers", date: "2026-07-30", strength: 54 },
    ],
  },
  {
    id: "northwind-logistics",
    company: "Northwind Logistics",
    domain: "northwind.co",
    industry: "Freight & logistics",
    location: "Rotterdam, NL",
    employees: "310",
    priority: "warm",
    priorityReason:
      "Good ICP fit and a clear hiring signal, but nothing yet showing the problem is urgent for them.",
    score: 74,
    scoreExplanation:
      "Hiring two integration engineers with a job spec that describes the manual process this replaces. No budget or timeline evidence.",
    confidence: "medium",
    dimensions: [
      { label: "ICP fit", value: 85 },
      { label: "Problem severity", value: 58 },
      { label: "Evidence strength", value: 61 },
      { label: "Trigger strength", value: 54 },
      { label: "Trigger freshness", value: 74 },
      { label: "Buying likelihood", value: "unknown" },
      { label: "Product relevance", value: 80 },
      { label: "Decision-maker accessibility", value: 66 },
    ],
    status: "Researching",
    owner: null,
    trigger: "Hiring 2 integration engineers",
    triggerDate: "2026-08-01",
    whyThisCompany:
      "Their own job spec describes maintaining 40+ carrier integrations by hand — the work this product automates.",
    whatTheyDo:
      "Freight forwarding across European road and sea routes, with a partner network that each expose their own booking and tracking APIs.",
    identifiedProblem:
      "Partner integrations are maintained manually across 40+ carriers, which is the reason they are hiring rather than the outcome they want.",
    potentialGap:
      "No integration platform in evidence. The hiring signal suggests headcount is the current answer.",
    currentApproach: "In-house, maintained by hand across 40+ carriers.",
    whyNow:
      "They are hiring for the problem right now, which means budget exists — but as headcount, not software. That is a competing spend, and it closes once the roles are filled.",
    potentialUseCase:
      "Replace hand-maintained carrier adapters with a managed integration layer, freeing the two roles for routing work.",
    outreachAngle:
      "The job spec is the opening. Frame against the cost of two engineers rather than against a competitor.",
    recommendedAction: "Research current approach before contacting",
    buyers: [
      {
        name: "Devan Rao",
        title: "Head of Growth",
        isDecisionMaker: false,
        email: null,
        emailConfidence: null,
        linkedin: "https://www.linkedin.com/",
      },
    ],
    evidence: [
      {
        claim: "Northwind posted two integration-engineer roles on 1 Aug.",
        kind: "fact",
        confidence: "high",
        source: "Careers page",
        sourceUrl: "https://example.com/",
        eventDate: "2026-08-01",
        observedAt: "2026-08-02",
        excerpt:
          "You will own the partner-integration pipeline, currently maintained by hand across 40+ carriers.",
      },
      {
        claim: "Integration maintenance is a growing cost for them.",
        kind: "inference",
        confidence: "medium",
        source: "Derived from the job specification",
        eventDate: "2026-08-01",
        observedAt: "2026-08-02",
      },
      { claim: "Whether a purchase decision is funded this quarter.", kind: "unknown" },
      { claim: "Who owns the integration budget.", kind: "unknown" },
    ],
    triggers: [
      { type: "Hiring — integration engineers", date: "2026-08-01", strength: 54 },
    ],
  },
  {
    id: "cormorant-health",
    company: "Cormorant Health",
    domain: "cormorant.health",
    industry: "Medical devices",
    location: "Boston, US",
    employees: "140",
    priority: "watch",
    /* Deliberately no month count in this copy: the age is rendered from the
       date by <Freshness>, and a hard-coded "four months" in prose beside a
       computed "3 months ago" is the kind of small contradiction that makes a
       user stop trusting the numbers. */
    priorityReason:
      "Plausible fit, but the only trigger on file is from April and nothing has changed since.",
    score: 48,
    scoreExplanation:
      "Regulatory approval in April is the sole signal. No hiring, no launches, no public statement of the problem since.",
    confidence: "low",
    dimensions: [
      { label: "ICP fit", value: 62 },
      { label: "Problem severity", value: "unknown" },
      { label: "Evidence strength", value: 31 },
      { label: "Trigger strength", value: 44 },
      { label: "Trigger freshness", value: 12 },
      { label: "Buying likelihood", value: "unknown" },
      { label: "Product relevance", value: 55 },
      { label: "Decision-maker accessibility", value: "unknown" },
    ],
    status: "Discovered",
    owner: null,
    trigger: "Received regulatory approval",
    triggerDate: "2026-04-14",
    whyThisCompany:
      "Regulatory clearance usually precedes a commercial build-out, and their device category fits the ICP.",
    whatTheyDo:
      "Remote patient-monitoring hardware and the clinician-facing software that reads from it.",
    identifiedProblem:
      "Not established. The approval is real; the problem it implies is not evidenced anywhere.",
    potentialGap: "Not established.",
    currentApproach: null,
    whyNow:
      "There is no why-now. The approval was in April and nothing has followed it. Contacting today would be contacting on a stale signal.",
    potentialUseCase: "Not established.",
    outreachAngle:
      "None recommended yet. Wait for a second signal — a hiring post, a launch, or a public statement of the problem.",
    recommendedAction: "Keep monitoring — no reason to contact today",
    buyers: [],
    evidence: [
      {
        claim:
          "Cormorant received regulatory clearance for its remote-monitoring device.",
        kind: "fact",
        confidence: "high",
        source: "Company press release",
        sourceUrl: "https://example.com/",
        eventDate: "2026-04-14",
        observedAt: "2026-04-15",
      },
      { claim: "Whether they have the problem this product solves.", kind: "unknown" },
      { claim: "Who the buyer would be.", kind: "unknown" },
    ],
    triggers: [{ type: "Regulatory approval", date: "2026-04-14", strength: 44 }],
  },
];

export function findOpportunity(id: string): OpportunityFixture | undefined {
  return OPPORTUNITIES.find((o) => o.id === id);
}
