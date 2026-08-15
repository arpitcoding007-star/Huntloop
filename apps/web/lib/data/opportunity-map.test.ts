import { describe, expect, it } from "vitest";
import {
  byPriorityThenScore,
  dimensionsOf,
  hostOf,
  isUuid,
  latestScore,
  liveTriggers,
  mapDetail,
  mapEvidence,
  mapListRow,
  recommendedAction,
  statusLabel,
  type DetailQueryRow,
  type ListQueryRow,
  type OpportunityRow,
  type ScoreRow,
} from "./opportunity-map";

/**
 * The rules that stop the opportunity screens asserting things nobody
 * established.
 *
 * FEAT-02 shipped after being deliberately held back for a year, and the thing
 * that made it safe to ship was running the query — see the fifth pass in
 * audit/VERIFICATION.md. That was a one-off. These are the parts that can be
 * held still, so the next refactor has to break a named rule rather than a
 * generic assertion.
 *
 * Each case below names the rule it defends. Several would keep passing if the
 * code simply returned the happy path, which is exactly why they are here.
 */

const score = (over: Partial<ScoreRow> = {}): ScoreRow => ({
  score: 70,
  explanation: "Because.",
  confidence: "medium",
  computed_at: "2026-08-01T00:00:00Z",
  icp_fit: 80,
  problem_severity: 60,
  evidence_strength: 55,
  trigger_strength: 50,
  trigger_freshness: 45,
  buying_likelihood: 40,
  product_relevance: 35,
  decision_maker_accessibility: 30,
  ...over,
});

describe("dimensionsOf — §78, an unmeasured dimension is not a zero", () => {
  it("renders a NULL dimension as 'unknown', never as 0", () => {
    const dims = dimensionsOf(
      score({ buying_likelihood: null, decision_maker_accessibility: null }),
    );

    expect(dims.find((d) => d.label === "Buying likelihood")?.value).toBe("unknown");
    expect(
      dims.find((d) => d.label === "Decision-maker accessibility")?.value,
    ).toBe("unknown");
    // The distinction that matters: a 0 would assert "we measured this and it
    // is bad", which is a finding Huntloop did not make.
    expect(dims.map((d) => d.value)).not.toContain(0);
  });

  it("keeps a genuine 0 as 0", () => {
    // The mirror image, and the reason `?? "unknown"` is used rather than a
    // falsy check: a measured zero is a real finding and must survive.
    const dims = dimensionsOf(score({ trigger_freshness: 0 }));
    expect(dims.find((d) => d.label === "Trigger freshness")?.value).toBe(0);
  });

  it("renders every dimension as unknown when there is no score at all", () => {
    const dims = dimensionsOf(undefined);
    expect(dims).toHaveLength(8);
    expect(dims.every((d) => d.value === "unknown")).toBe(true);
  });
});

describe("latestScore — §58 keeps history rather than clobbering", () => {
  it("picks the newest by computed_at, not the first returned", () => {
    const rows = [
      score({ score: 10, computed_at: "2026-01-01T00:00:00Z" }),
      score({ score: 99, computed_at: "2026-08-01T00:00:00Z" }),
      score({ score: 50, computed_at: "2026-04-01T00:00:00Z" }),
    ];
    expect(latestScore(rows)?.score).toBe(99);
  });

  it("does not reorder its argument", () => {
    const rows = [
      score({ score: 10, computed_at: "2026-01-01T00:00:00Z" }),
      score({ score: 99, computed_at: "2026-08-01T00:00:00Z" }),
    ];
    latestScore(rows);
    expect(rows[0]?.score).toBe(10);
  });

  it("returns undefined for an unscored opportunity", () => {
    expect(latestScore([])).toBeUndefined();
  });
});

describe("liveTriggers — soft deletes under an embedded select", () => {
  const t = (type: string, date: string, deleted: string | null = null) => ({
    trigger_type: type,
    event_date: date,
    strength: null,
    deleted_at: deleted,
  });

  it("drops soft-deleted rows", () => {
    // These arrive nested under `companies`, where the statement's own
    // `deleted_at is null` does not reach them.
    const out = liveTriggers([
      t("Funding", "2026-08-01T00:00:00Z"),
      t("Deleted", "2026-08-09T00:00:00Z", "2026-08-10T00:00:00Z"),
    ]);
    expect(out.map((x) => x.trigger_type)).toEqual(["Funding"]);
  });

  it("orders newest first, so [0] is the why-now", () => {
    const out = liveTriggers([
      t("Older", "2026-01-01T00:00:00Z"),
      t("Newest", "2026-08-01T00:00:00Z"),
      t("Middle", "2026-04-01T00:00:00Z"),
    ]);
    expect(out.map((x) => x.trigger_type)).toEqual(["Newest", "Middle", "Older"]);
  });
});

describe("isUuid — a URL segment meets a uuid column", () => {
  it("accepts a real uuid", () => {
    expect(isUuid("b08fc3ca-83d8-4d99-afc8-c2fd949d81fe")).toBe(true);
    expect(isUuid("B08FC3CA-83D8-4D99-AFC8-C2FD949D81FE")).toBe(true);
  });

  it("rejects the fixture slugs this app served for months", () => {
    // Without this the comparison reaches Postgres and raises 22P02, which is
    // a 500 on a route where a 404 belongs.
    expect(isUuid("alphio-ai")).toBe(false);
    expect(isUuid("northwind-logistics")).toBe(false);
  });

  it("rejects near-misses rather than passing them to the database", () => {
    expect(isUuid("")).toBe(false);
    expect(isUuid("b08fc3ca83d84d99afc8c2fd949d81fe")).toBe(false);
    expect(isUuid("b08fc3ca-83d8-4d99-afc8-c2fd949d81fe-extra")).toBe(false);
    expect(isUuid("../../etc/passwd")).toBe(false);
  });
});

describe("statusLabel", () => {
  it("labels every value of the opportunity_status enum", () => {
    const enumValues = [
      "discovered", "researching", "qualified", "assigned", "contacted",
      "replied", "meeting", "proposal", "won", "lost", "archived",
    ];
    for (const value of enumValues) {
      expect(statusLabel(value), value).not.toBe(value);
    }
  });

  it("passes an unmapped value through rather than inventing one", () => {
    // If the enum grows and this map does not, the badge shows the raw value —
    // visibly wrong, which is the point. Silently title-casing would hide it.
    expect(statusLabel("negotiating")).toBe("negotiating");
  });
});

describe("recommendedAction — derived from what is on the page", () => {
  it("does not recommend contacting a watch-listed company", () => {
    expect(recommendedAction("watch", true)).toMatch(/monitoring/i);
    expect(recommendedAction("watch", false)).toMatch(/monitoring/i);
  });

  it("recommends finding a buyer before outreach when none is identified", () => {
    expect(recommendedAction("hot", false)).toMatch(/decision maker/i);
    expect(recommendedAction("warm", false)).toMatch(/decision maker/i);
  });

  it("recommends reaching out only for hot, with a buyer", () => {
    expect(recommendedAction("hot", true)).toMatch(/reach out/i);
    expect(recommendedAction("warm", true)).not.toMatch(/reach out/i);
  });

  it("says nothing to do for ignore", () => {
    expect(recommendedAction("ignore", true)).toMatch(/no action/i);
  });
});

describe("byPriorityThenScore — the verdict orders the list, not the score", () => {
  it("puts a low-scoring hot above a high-scoring warm", () => {
    // §78: a strong trigger must not lift a poor-fit company. If this ever
    // sorts by score first, that rule is gone from the primary screen.
    const rows = [
      { priority: "warm", score: 99 },
      { priority: "hot", score: 51 },
      { priority: "watch", score: 100 },
    ] as OpportunityRow[];

    expect([...rows].sort(byPriorityThenScore).map((r) => r.priority)).toEqual([
      "hot",
      "warm",
      "watch",
    ]);
  });

  it("breaks ties within a priority by score, descending", () => {
    const rows = [
      { priority: "hot", score: 60 },
      { priority: "hot", score: 90 },
    ] as OpportunityRow[];
    expect([...rows].sort(byPriorityThenScore).map((r) => r.score)).toEqual([90, 60]);
  });
});

describe("hostOf", () => {
  it("derives a readable source label from the stored URL", () => {
    expect(hostOf("https://techcrunch.com/2026/08/08/alphio")).toBe("techcrunch.com");
    expect(hostOf("https://www.example.com/x")).toBe("example.com");
  });

  it("returns undefined rather than throwing on an unparseable URL", () => {
    expect(hostOf("not a url")).toBeUndefined();
  });
});

describe("mapEvidence", () => {
  it("carries an unknown claim through with no confidence", () => {
    // The database CHECK forbids a confidence on an `unknown` — "high
    // confidence that we don't know" is a category error — and the mapping
    // must not reintroduce one.
    const [item] = mapEvidence([
      {
        claim: "Whether budget is allocated.",
        kind: "unknown",
        confidence: null,
        source_url: null,
        excerpt: null,
        event_date: null,
        observed_at: "2026-08-09T00:00:00Z",
      },
    ]);

    expect(item?.kind).toBe("unknown");
    expect(item?.confidence).toBeUndefined();
    expect(item?.sourceUrl).toBeUndefined();
  });

  it("labels a fact with the host of its source", () => {
    const [item] = mapEvidence([
      {
        claim: "Raised $12M.",
        kind: "fact",
        confidence: "high",
        source_url: "https://techcrunch.com/x",
        excerpt: "…",
        event_date: "2026-08-08T00:00:00Z",
        observed_at: "2026-08-09T00:00:00Z",
      },
    ]);

    expect(item?.source).toBe("techcrunch.com");
    expect(item?.sourceUrl).toBe("https://techcrunch.com/x");
  });
});

describe("mapListRow", () => {
  const row = (over: Partial<ListQueryRow> = {}): ListQueryRow => ({
    id: "b08fc3ca-83d8-4d99-afc8-c2fd949d81fe",
    priority: "hot",
    priority_reason: "Because.",
    status: "qualified",
    first_seen_at: "2026-08-09T00:00:00Z",
    companies: {
      name: "Alphio AI",
      canonical_domain: "alphio.ai",
      industry: "AI infrastructure",
      company_triggers: [],
    },
    opportunity_scores: [score()],
    ...over,
  });

  it("shows the newest live trigger as the why-now", () => {
    const mapped = mapListRow(
      row({
        companies: {
          name: "Alphio AI",
          canonical_domain: "alphio.ai",
          industry: "AI",
          company_triggers: [
            { trigger_type: "Hiring", event_date: "2026-07-30T00:00:00Z", deleted_at: null },
            { trigger_type: "Series A", event_date: "2026-08-08T00:00:00Z", deleted_at: null },
          ],
        },
      }),
      [],
    );

    expect(mapped.trigger).toBe("Series A");
    expect(mapped.triggerDate).toBe("2026-08-08T00:00:00Z");
  });

  it("says so when there is no trigger, and dates the row from first sight", () => {
    // A blank cell would read as "nothing worth showing"; the honest answer is
    // that nothing has been seen. The date still has to refer to something
    // real, or the freshness beside it is meaningless.
    const mapped = mapListRow(row(), []);
    expect(mapped.trigger).toBe("No trigger on file");
    expect(mapped.triggerDate).toBe("2026-08-09T00:00:00Z");
  });

  it("does not claim a score for an unscored opportunity", () => {
    const mapped = mapListRow(row({ opportunity_scores: [] }), []);
    expect(mapped.score).toBe(0);
    expect(mapped.scoreExplanation).toBe("Not scored yet.");
    expect(mapped.dimensions.every((d) => d.value === "unknown")).toBe(true);
  });
});

describe("mapDetail", () => {
  const detail = (over: Partial<DetailQueryRow> = {}): DetailQueryRow => ({
    id: "b08fc3ca-83d8-4d99-afc8-c2fd949d81fe",
    priority: "hot",
    priority_reason: "Because.",
    status: "qualified",
    confidence: "medium",
    first_seen_at: "2026-08-09T00:00:00Z",
    owner_id: null,
    why_this_company: "They build agents.",
    identified_problem: null,
    potential_gap: null,
    why_now: "The round closed.",
    current_approach: null,
    potential_use_case: null,
    outreach_angle: "Lead with the blocker.",
    companies: {
      name: "Alphio AI",
      canonical_domain: "alphio.ai",
      industry: "AI infrastructure",
      region: "San Francisco, US",
      employee_count: 24,
      description: "Autonomous trading agents.",
      company_triggers: [],
      people: [],
    },
    opportunity_scores: [score()],
    ...over,
  });

  const person = (over: Partial<DetailQueryRow["companies"]["people"][number]> = {}) => ({
    first_name: "Dana",
    last_name: "Okonkwo",
    title: "CTO",
    is_decision_maker: true,
    linkedin_url: null,
    deleted_at: null,
    contact_points: [],
    ...over,
  });

  it("keeps an unestablished field null, so the page can say so", () => {
    // The alternative — storing or substituting "Not established" — turns the
    // absence of a finding into a claim in the database.
    const mapped = mapDetail(detail(), [], null);
    expect(mapped.identifiedProblem).toBeNull();
    expect(mapped.potentialGap).toBeNull();
    expect(mapped.currentApproach).toBeNull();
  });

  it("does not show an unverified address", () => {
    // §78, "do not fabricate contact details". A guess rendered as a mailto is
    // a guess that gets sent.
    const mapped = mapDetail(
      detail({
        companies: {
          ...detail().companies,
          people: [
            person({
              contact_points: [
                {
                  kind: "email",
                  value: "guess@alphio.ai",
                  confidence: "low",
                  verification_status: "unverified",
                  deleted_at: null,
                },
              ],
            }),
          ],
        },
      }),
      [],
      null,
    );

    expect(mapped.buyers[0]?.email).toBeNull();
    expect(mapped.buyers[0]?.emailConfidence).toBeNull();
  });

  it("shows a verified address with the confidence it was recorded at", () => {
    const mapped = mapDetail(
      detail({
        companies: {
          ...detail().companies,
          people: [
            person({
              contact_points: [
                {
                  kind: "email",
                  value: "dana@alphio.ai",
                  confidence: "high",
                  verification_status: "verified",
                  deleted_at: null,
                },
              ],
            }),
          ],
        },
      }),
      [],
      null,
    );

    expect(mapped.buyers[0]?.email).toBe("dana@alphio.ai");
    expect(mapped.buyers[0]?.emailConfidence).toBe("high");
  });

  it("drops soft-deleted people and their contact points", () => {
    const mapped = mapDetail(
      detail({
        companies: {
          ...detail().companies,
          people: [
            person({ first_name: "Gone", deleted_at: "2026-08-10T00:00:00Z" }),
            person({ first_name: "Here" }),
          ],
        },
      }),
      [],
      null,
    );

    expect(mapped.buyers.map((b) => b.name)).toEqual(["Here Okonkwo"]);
  });

  it("puts decision makers first", () => {
    const mapped = mapDetail(
      detail({
        companies: {
          ...detail().companies,
          people: [
            person({ first_name: "Marta", is_decision_maker: false }),
            person({ first_name: "Dana", is_decision_maker: true }),
          ],
        },
      }),
      [],
      null,
    );

    expect(mapped.buyers[0]?.name).toBe("Dana Okonkwo");
  });

  it("names no colleague — an owner is 'You' or nobody in particular", () => {
    // Resolving another member's name means reading auth.users, which the
    // tenant client cannot do and should not: it would expose an org's user
    // directory to every member.
    expect(mapDetail(detail({ owner_id: "u1" }), [], "u1").owner).toBe("You");
    expect(mapDetail(detail({ owner_id: "u1" }), [], "u2").owner).toBe(
      "another member",
    );
    expect(mapDetail(detail({ owner_id: null }), [], "u1").owner).toBeNull();
  });

  it("recommends finding a buyer when the company has none", () => {
    expect(mapDetail(detail(), [], null).recommendedAction).toMatch(
      /decision maker/i,
    );
  });

  it("falls back honestly when a company row is sparse", () => {
    const mapped = mapDetail(
      detail({
        companies: {
          ...detail().companies,
          industry: null,
          region: null,
          employee_count: null,
          description: null,
        },
      }),
      [],
      null,
    );

    expect(mapped.industry).toBe("Industry unknown");
    expect(mapped.location).toBe("Location unknown");
    expect(mapped.employees).toBe("—");
    // Null, not a placeholder string: the page renders its own "not
    // established" and marks the section UNKNOWN.
    expect(mapped.whatTheyDo).toBeNull();
  });
});
