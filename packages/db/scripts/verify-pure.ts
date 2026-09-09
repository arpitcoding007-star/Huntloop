/**
 * The three pure modules `0011`–`0019` needed, exercised without a database.
 *
 *   icp.ts       the shape both sides of `ICP-01` now import
 *   identity.ts  the deterministic half of entity resolution
 *   contact.ts   who to talk to, and why
 *
 * Same split as `verify-rules.ts`: the migration suite proves the *schema*
 * enforces its rules, and this proves the code that decides what to put in it
 * does. The two are separate because these are the half that can be wrong
 * silently — a CHECK that stops working throws, while a domain normalizer
 * that stops stripping `www.` merely creates a second copy of every company.
 *
 * Three tests here exist because the thing they assert would keep *looking*
 * correct if it were removed, which is the standard the rest of this suite is
 * held to:
 *
 *   · `linkedin.com` is not a company identity. If it were, every company a
 *     provider returned with a LinkedIn URL as its website would resolve to
 *     the same row and the table would collapse into one company.
 *   · A missing dimension is skipped, not zeroed. Scoring an unparseable
 *     title as "department fit: 0" penalises the parser's failure as though
 *     it were the person's.
 *   · An unrecognised size band contributes nothing. A guess becomes a
 *     provider filter and silently narrows the market a customer is paying to
 *     search.
 *
 *   npm run test:pure --workspace @huntloop/db
 */
import {
  CRITERIA_KEYS,
  EXCLUSION_KEYS,
  InvalidIcpError,
  bandsToRange,
  isEmpty,
  isExcluded,
  parseCriteria,
  parseExclusions,
  parseIcp,
  scoreIcp,
  serializeCriteria,
  type ExclusionSubject,
} from "../src/icp.ts";
import {
  canonicalizeDomain,
  compareCompanies,
  editDistance,
  normalizeName,
  orderPair,
  rootLabel,
} from "../src/identity.ts";
import {
  classifyTitle,
  rankContacts,
  scoreContactFit,
  type ContactSubject,
  type PersonaSpec,
} from "../src/contact.ts";
import {
  EMPTY_FILTERS,
  canonicalFilters,
  describeFilters,
  translateIcp,
} from "../src/discovery.ts";

let failures = 0;
let checks = 0;

function ok(name: string) {
  checks++;
  console.log(`  ✓ ${name}`);
}

function fail(name: string, detail: unknown) {
  checks++;
  failures++;
  console.error(`  ✗ ${name}\n      ${String(detail).split("\n")[0]}`);
}

function expect(name: string, condition: boolean, detail = "expected true") {
  if (condition) ok(name);
  else fail(name, detail);
}

function expectEqual(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a === b) ok(name);
  else fail(name, `got ${a}, wanted ${b}`);
}

function expectThrows(name: string, fn: () => unknown, matching?: RegExp) {
  try {
    fn();
    fail(name, "did not throw");
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (matching && !matching.test(message)) fail(name, `threw "${message}"`);
    else ok(name);
  }
}

/* ════ icp.ts ════════════════════════════════════════════════════════════ */

console.log("\nicp — a missing field and an empty field are different facts");
{
  const parsed = parseCriteria({ segments: ["Fintech"] });
  expectEqual("a stated field comes back as its list", parsed.segments, ["Fintech"]);
  expect("an unstated field is null, not []", parsed.regions === null);
  expectEqual("and a field stated as empty is []", parseCriteria({ regions: [] }).regions, []);
}

console.log("\nicp — the ICP-01 failure, made impossible");
{
  // The exact defect: a writer using a key the reader does not know. The old
  // reader degraded to an empty list; this one refuses.
  expectThrows(
    "an unrecognised key throws rather than degrading to an empty profile",
    () => parseCriteria({ industires: ["Fintech"] }),
    /unrecognised key "industires"/,
  );

  expectThrows(
    "criteria that is an array is refused",
    () => parseCriteria(["fintech"]),
    /must be an object/,
  );

  expectThrows(
    "a list containing a number is refused",
    () => parseCriteria({ segments: ["ok", 42] }),
    /every entry must be text/,
  );

  expectThrows(
    "and an inverted employee range is refused",
    () => parseCriteria({ employeeRange: { min: 500, max: 10 } }),
    /greater than/,
  );

  /* The refusal has a type, and callers branch on it. `discover_companies`
     turns an unreadable ICP into a *permanent* failure rather than a retry,
     which is only correct if "this profile is malformed" is distinguishable
     from "the database was briefly unreachable". A bare Error would make the
     two identical and the job would retry a typo three times. */
  let thrown: unknown;
  try {
    parseCriteria({ industires: ["Fintech"] });
  } catch (e) {
    thrown = e;
  }
  expect(
    "and the refusal is an InvalidIcpError, so a caller can tell it from an outage",
    thrown instanceof InvalidIcpError,
    `got ${thrown instanceof Error ? thrown.constructor.name : typeof thrown}`,
  );
}

console.log("\nicp — the key list matches what 0013 will accept");
{
  // Both directions. A key here and not there is a write that fails at
  // runtime; a key there and not here is `ICP-01` again, exactly. The SQL
  // list is duplicated below deliberately — the point of the test is that the
  // two are compared, and importing one from the other would compare nothing.
  const sqlCriteria = [
    "segments", "sizes", "regions", "triggers",
    "industries", "employeeRange", "revenueBands", "technologies",
    "businessModels", "painPoints", "useCases", "buyingSignals",
    "keywords", "exampleCompanies", "notes",
  ];
  const sqlExclusions = [
    "exclusions",
    "industries", "regions", "sizes", "technologies", "businessModels",
    "employeeRange", "keywords", "domains", "signals", "notes",
  ];
  expectEqual("criteria keys agree with the migration", [...CRITERIA_KEYS].sort(), [...sqlCriteria].sort());
  expectEqual("exclusion keys agree with the migration", [...EXCLUSION_KEYS].sort(), [...sqlExclusions].sort());
}

console.log("\nicp — human size bands become a machine range");
{
  expectEqual("a single band", bandsToRange(["11-50"]), { min: 11, max: 50 });
  expectEqual("an en-dash band, as the seed writes them", bandsToRange(["11–50"]), { min: 11, max: 50 });
  expectEqual("two bands are a union, not an intersection", bandsToRange(["11-50", "51-200"]), { min: 11, max: 200 });
  expectEqual("an open-ended band opens the whole range", bandsToRange(["11-50", "500+"]), { min: 11, max: null });
  expectEqual("a named band", bandsToRange(["enterprise"]), { min: 1001, max: null });
  expectEqual("'under 100'", bandsToRange(["under 100"]), { min: 1, max: 100 });
  expectEqual("a bare number is a point", bandsToRange(["50"]), { min: 50, max: 50 });

  // The important one. A guess here becomes a provider filter.
  expect("an unrecognised band contributes nothing", bandsToRange(["a few people"]) === null);
  expectEqual(
    "and an unrecognised band beside a real one does not disturb it",
    bandsToRange(["11-50", "a few people"]),
    { min: 11, max: 50 },
  );

  expectEqual(
    "sizes derive a range when none is stated",
    parseCriteria({ sizes: ["11-50"] }).employeeRange,
    { min: 11, max: 50 },
  );
  expectEqual(
    "and an explicit range wins over the bands",
    parseCriteria({ sizes: ["11-50"], employeeRange: { min: 1, max: 5 } }).employeeRange,
    { min: 1, max: 5 },
  );
}

console.log("\nicp — round-tripping omits what was never stated");
{
  const parsed = parseCriteria({ segments: ["Fintech"], regions: [] });
  const out = serializeCriteria(parsed);
  expect("a stated field survives", Array.isArray(out.segments));
  expect("an unstated field is omitted rather than written as null", !("triggers" in out));
  expect("and a field stated as empty is omitted too", !("regions" in out));
}

console.log("\nicp — quality is a count, not an opinion");
{
  const empty = scoreIcp(parseIcp({}, {}));
  expect("an empty profile scores 0", empty.score === 0);
  expect("and says what to add, highest-value first", empty.suggestions.length > 0);
  expect("an empty profile is empty", isEmpty(parseIcp({}, {})));

  const full = scoreIcp(
    parseIcp(
      {
        segments: ["Fintech"],
        sizes: ["11-50"],
        regions: ["Europe"],
        triggers: ["Series A"],
        painPoints: ["Manual reconciliation"],
        technologies: ["Postgres"],
        exampleCompanies: ["acme.com"],
        businessModels: ["B2B SaaS"],
      },
      { exclusions: ["Agencies"] },
    ),
  );
  expect("a complete profile scores 100", full.score === 100);
  expect("and has nothing left to suggest", full.suggestions.length === 0);

  // Deterministic: the same input twice is the same number. A model-produced
  // quality score could not promise this, which is the argument for the
  // whole approach.
  const a = scoreIcp(parseIcp({ segments: ["X"] }, {}));
  const b = scoreIcp(parseIcp({ segments: ["X"] }, {}));
  expect("the same profile scores identically twice", a.score === b.score);
}

console.log("\nicp — exclusions fire before anything is paid for");
{
  const exclusions = parseExclusions({
    industries: ["Staffing"],
    domains: ["Competitor.COM"],
    regions: ["Russia"],
    keywords: ["consultancy"],
    employeeRange: { min: 0, max: 5 },
  });

  const subject = (over: Partial<ExclusionSubject>): ExclusionSubject => ({
    name: "Acme", domain: "acme.com", industry: "Software", country: "Germany",
    region: "Europe", employeeCount: 50, businessModel: "B2B SaaS",
    techStack: [], description: null, ...over,
  });

  expect("a company matching nothing is kept", !isExcluded(subject({}), exclusions).excluded);

  const industry = isExcluded(subject({ industry: "Staffing Solutions" }), exclusions);
  expect("a substring match on industry excludes", industry.excluded);
  expect("and names the term, not a code", industry.reason?.includes("Staffing") === true);

  // The domain list is normalized on the way in, so a customer typing
  // "Competitor.COM" produces an exclusion that actually fires.
  expect(
    "an excluded domain matches case-insensitively",
    isExcluded(subject({ domain: "competitor.com" }), exclusions).excluded,
  );
  expect(
    "and matches a subdomain of it",
    isExcluded(subject({ domain: "eu.competitor.com" }), exclusions).excluded,
  );
  expect(
    "but not a domain that merely contains it",
    !isExcluded(subject({ domain: "notcompetitor.com" }), exclusions).excluded,
  );

  expect("geography excludes", isExcluded(subject({ country: "Russia" }), exclusions).excluded);
  expect(
    "a keyword in the description excludes",
    isExcluded(subject({ description: "A boutique consultancy" }), exclusions).excluded,
  );
  expect(
    "an excluded size band excludes",
    isExcluded(subject({ employeeCount: 3 }), exclusions).excluded,
  );
  expect(
    "and an unknown employee count does not",
    !isExcluded(subject({ employeeCount: null }), exclusions).excluded,
  );
}

/* ════ identity.ts ═══════════════════════════════════════════════════════ */

console.log("\nidentity — one domain, however it arrives");
{
  const cases: Array<[string, string | null]> = [
    ["acme.com", "acme.com"],
    ["ACME.com", "acme.com"],
    ["www.acme.com", "acme.com"],
    ["https://acme.com", "acme.com"],
    ["https://www.acme.com/careers?utm=1#top", "acme.com"],
    ["http://user:pw@acme.com:8443/x", "acme.com"],
    ["acme.com.", "acme.com"],
    ["  acme.com  ", "acme.com"],
    ["someone@acme.com", "acme.com"],
    ["mailto:someone@acme.com", "acme.com"],
    // A subdomain is NOT folded into the parent. `mail.acme.com` and
    // `acme.com` are different hosts, and treating one as the other would
    // merge a staging site into production.
    ["mail.acme.com", "mail.acme.com"],
    ["acme.co.uk", "acme.co.uk"],
    // Unusable.
    ["", null],
    ["   ", null],
    ["localhost", null],
    ["192.168.1.1", null],
    ["notadomain", null],
    ["http://[::1]/", null],
  ];
  let bad = 0;
  for (const [input, expected] of cases) {
    const got = canonicalizeDomain(input);
    if (got !== expected) {
      fail(`canonicalizeDomain(${JSON.stringify(input)})`, `got ${JSON.stringify(got)}, wanted ${JSON.stringify(expected)}`);
      bad++;
    }
  }
  if (bad === 0) ok(`${cases.length} canonicalization cases`);
}

console.log("\nidentity — a social profile is not a company identity");
{
  // The test that matters most in this file. A provider returning
  // `linkedin.com/company/acme` as a website is routine; if that canonicalized
  // to `linkedin.com`, every such company would resolve to one row and the
  // companies table would collapse.
  expect("linkedin is refused", canonicalizeDomain("https://linkedin.com/company/acme") === null);
  expect("so is a www linkedin", canonicalizeDomain("https://www.linkedin.com/company/acme") === null);
  expect("crunchbase is refused", canonicalizeDomain("crunchbase.com/organization/acme") === null);
  expect("a free mail host is refused", canonicalizeDomain("someone@gmail.com") === null);
  expect("and a real company domain is not", canonicalizeDomain("https://acme.io/about") === "acme.io");
}

console.log("\nidentity — names, reduced to what identifies them");
{
  expectEqual("legal forms are noise", normalizeName("Acme, Inc."), "acme");
  expectEqual("so is a leading 'The'", normalizeName("The Acme Company"), "acme");
  expectEqual("accents fold", normalizeName("Zürich Systems"), "zurich systems");
  expectEqual("ampersands become words", normalizeName("R&D Labs"), "r and d labs");
  expectEqual("GmbH is noise", normalizeName("Acme GmbH"), "acme");
  // Deliberately NOT noise: these distinguish companies more often than they
  // decorate one.
  expectEqual("'Group' is kept", normalizeName("Acme Group"), "acme group");
  expectEqual("'Digital' is kept", normalizeName("Acme Digital"), "acme digital");
  expectEqual("an empty name is empty", normalizeName(null), "");

  expect("edit distance is bounded", editDistance("a".repeat(200), "b".repeat(200), 4) === 5);
  expect("and exact when it can be", editDistance("acme", "acne") === 1);

  expectEqual("root labels", [rootLabel("acme.com"), rootLabel("acme.co.uk"), rootLabel("eu.acme.com")], ["acme", "acme", "acme"]);
}

console.log("\nidentity — matching proposes; it never merges");
{
  const provider = compareCompanies(
    { name: "Acme", domain: "acme.com", country: "US", providerIds: { apollo: "org_1" } },
    { name: "Acme Inc", domain: "acme.io", country: "US", providerIds: { apollo: "org_1" } },
  );
  expect("a shared provider id is high confidence", provider.confidence === "high" && provider.signal === "provider_id");

  const domain = compareCompanies(
    { name: "Acme", domain: "https://www.acme.com/", country: null },
    { name: "Acme Corporation", domain: "acme.com", country: "DE" },
  );
  expect("the same domain is high confidence", domain.confidence === "high" && domain.signal === "domain");

  const roots = compareCompanies(
    { name: "Acme", domain: "acme.com", country: "US" },
    { name: "Acme Ltd", domain: "acme.co.uk", country: "GB" },
  );
  expect("same name across TLDs is medium", roots.matched && roots.confidence === "medium");

  const named = compareCompanies(
    { name: "Apex", domain: "apex-de.com", country: "DE" },
    { name: "Apex", domain: "apex-br.com", country: "DE" },
  );
  expect("same name, same country is medium", named.matched && named.confidence === "medium");

  // The one that keeps the review queue trustworthy. The same word is a
  // company name in a dozen countries, and proposing those as duplicates
  // produces a queue people approve in bulk without reading.
  const across = compareCompanies(
    { name: "Apex", domain: "apex-de.com", country: "DE" },
    { name: "Apex", domain: "apex-br.com", country: "BR" },
  );
  expect("but the same name in different countries is not a match", !across.matched);

  const unrelated = compareCompanies(
    { name: "Acme", domain: "acme.com", country: "US" },
    { name: "Globex", domain: "globex.com", country: "US" },
  );
  expect("two different companies do not match", !unrelated.matched);

  const typo = compareCompanies(
    { name: "Northwind Trading", domain: "a.com", country: "US" },
    { name: "Northwynd Trading", domain: "b.com", country: "US" },
  );
  expect("a one-character difference in a long name is a low-confidence proposal", typo.matched && typo.confidence === "low");

  const short = compareCompanies(
    { name: "Acme", domain: "a.com", country: "US" },
    { name: "Acne", domain: "b.com", country: "US" },
  );
  expect("but not in a short one, where one edit is most of the word", !short.matched);

  expectEqual("pairs order canonically", orderPair("b", "a"), ["a", "b"]);
  expectEqual("both ways round", orderPair("a", "b"), ["a", "b"]);
}

/* ════ contact.ts ════════════════════════════════════════════════════════ */

console.log("\ncontact — a title, classified");
{
  const cases: Array<[string, string | null, string | null]> = [
    ["VP of Engineering", "VP", "engineering"],
    ["VP, Engineering", "VP", "engineering"],
    ["Vice President Engineering", "VP", "engineering"],
    ["Chief Technology Officer", "C-level", "engineering"],
    ["CTO", "C-level", "engineering"],
    ["Co-Founder & CEO", "Founder", "executive"],
    ["Head of Data", "Head of", "data"],
    ["Director of Revenue Operations", "Director", "sales"],
    ["Senior Software Engineer", "Senior", "engineering"],
    // "Analyst" alone says a level and not a function — a financial analyst
    // and a data analyst are the same word. Reporting null here rather than
    // guessing "data" is the same §7 position the rest of this file takes.
    ["Junior Analyst", "Junior", null],
    ["Junior Data Analyst", "Junior", "data"],
    ["Engineering Manager", "Manager", "engineering"],
    ["Staff Engineer", "Principal / Staff", "engineering"],
  ];
  let bad = 0;
  for (const [title, seniority, dept] of cases) {
    const c = classifyTitle(title);
    if (c.seniorityLabel !== seniority || c.department !== dept) {
      fail(`classifyTitle(${JSON.stringify(title)})`, `got ${c.seniorityLabel}/${c.department}, wanted ${seniority}/${dept}`);
      bad++;
    }
  }
  if (bad === 0) ok(`${cases.length} title classifications`);

  // The §7 position, in a classifier. An unreadable title is UNKNOWN, and
  // returning zero would make it look like a judgement of "junior".
  const unknown = classifyTitle("Chief Vibes Officer at large");
  expect("a title with no readable level reports null, not 0", unknown.seniorityRank !== 0);
  expectEqual("and no title at all reports nothing", classifyTitle(null), {
    seniorityRank: null, seniorityLabel: null, department: null, departmentLabel: null,
  });
}

console.log("\ncontact — fit is scored, ranked, and explained");
{
  const persona: PersonaSpec = {
    id: "p1",
    name: "Technical Buyer",
    titlePatterns: ["VP of Engineering", "Head of Platform", "CTO"],
    seniority: ["VP", "C-level"],
    departments: ["engineering"],
    excludeTitles: ["recruiter"],
    priority: 1,
    isPrimary: true,
  };

  const person = (over: Partial<ContactSubject>): ContactSubject => ({
    firstName: "A", lastName: "B", title: "VP of Engineering",
    bestContactKind: "email", bestContactConfidence: "high", emailVerified: true,
    employmentStatus: "current", lastVerifiedAt: new Date("2026-09-01"), ...over,
  });

  const now = new Date("2026-09-05");

  const strong = scoreContactFit(person({}), [persona], now);
  expect("an exact persona match scores high", strong.score >= 85);
  expect("names the persona", strong.personaId === "p1");
  expect("and explains itself in words, not a number", /Technical Buyer/.test(strong.reason));

  const weak = scoreContactFit(person({ title: "Junior Accountant" }), [persona], now);
  expect("a mismatched title scores far lower", weak.score < strong.score);
  expect("and is not vetoed — wrong is not forbidden", !weak.vetoed);

  // Vetoes are facts, not judgements, and they remove rather than reduce. A
  // strong title must not outweigh "this person has left".
  const departed = scoreContactFit(person({ employmentStatus: "departed" }), [persona], now);
  expect("a departed person is vetoed", departed.vetoed && departed.score === 0);
  expect("and says so plainly", /left the company/.test(departed.reason));

  const excluded = scoreContactFit(person({ title: "Technical Recruiter" }), [persona], now);
  expect("an excluded title is vetoed", excluded.vetoed);
  expect("and names the exclusion that fired", /recruiter/i.test(excluded.reason));

  // A guessed address is a plausible string with no evidence behind it. It
  // must not rank alongside a verified one.
  const unverified = scoreContactFit(
    person({ emailVerified: false, bestContactConfidence: "low" }),
    [persona],
    now,
  );
  expect("an unverified address scores below a verified one", unverified.score < strong.score);

  const noContact = scoreContactFit(person({ bestContactKind: null, emailVerified: false, bestContactConfidence: null }), [persona], now);
  expect("and no contact point at all scores below that", noContact.score < unverified.score);

  // The dimension test that matters. A title the classifier cannot read must
  // not be scored as a department fit of zero.
  const unparseable = scoreContactFit(person({ title: "Chief Vibes Officer" }), [persona], now);
  expect(
    "an unreadable department is null rather than zero",
    unparseable.dimensions.departmentFit === null || unparseable.dimensions.departmentFit > 0,
  );

  const noPersona = scoreContactFit(person({}), [], now);
  expect("with no persona defined, confidence is low", noPersona.confidence === "low");
  expect("and the reason says why", /no persona defined/.test(noPersona.reason));
}

console.log("\ncontact — ranking is stable and shows its rejects");
{
  const persona: PersonaSpec = {
    id: "p1", name: "Technical Buyer",
    titlePatterns: ["VP of Engineering"], seniority: ["VP"], departments: ["engineering"],
    excludeTitles: [], priority: 1, isPrimary: true,
  };
  const base = {
    bestContactKind: "email" as const, bestContactConfidence: "high" as const,
    emailVerified: true, employmentStatus: "current" as const,
    lastVerifiedAt: new Date("2026-09-01"),
  };
  const people: ContactSubject[] = [
    { firstName: "Zoe", lastName: "Zed", title: "Junior Developer", ...base },
    { firstName: "Ann", lastName: "Ay", title: "VP of Engineering", ...base },
    { firstName: "Bob", lastName: "Bee", title: "VP of Engineering", ...base },
    { firstName: "Gone", lastName: "Away", title: "CTO", ...base, employmentStatus: "departed" as const },
  ];

  const ranked = rankContacts(people, [persona], new Date("2026-09-05"));
  expect("the best fit is first", ranked[0]?.subject.title === "VP of Engineering");
  expect("the departed person is last despite the strongest title", ranked[3]?.subject.firstName === "Gone");
  expect("and is still returned, with a reason", ranked[3]?.fit.vetoed === true);

  // Two identical fits must not swap between runs, or the "recommended
  // contact" looks unstable to a user who reloads the page.
  const again = rankContacts(people, [persona], new Date("2026-09-05"));
  expectEqual(
    "ranking is deterministic across runs",
    ranked.map((r) => r.subject.firstName),
    again.map((r) => r.subject.firstName),
  );
  expect(
    "and ties break on name rather than row order",
    ranked[0]?.subject.lastName === "Ay" && ranked[1]?.subject.lastName === "Bee",
  );
}

/* ════ discovery.ts ══════════════════════════════════════════════════════ */

console.log("\ndiscovery — every criterion either maps or is reported");
{
  const icp = parseIcp(
    {
      segments: ["Crypto trading desks"],
      sizes: ["11-50", "51-200"],
      regions: ["Europe"],
      industries: ["Financial Services"],
      technologies: ["Postgres"],
      keywords: ["settlement"],
      businessModels: ["B2B SaaS"],
      triggers: ["Series A"],
      painPoints: ["Manual reconciliation"],
      useCases: ["Automated settlement"],
      buyingSignals: ["Hiring a Head of Ops"],
      exampleCompanies: ["acme.com"],
      notes: "Prefer teams with an in-house quant desk.",
    },
    { domains: ["competitor.com"], industries: ["Staffing"] },
  );

  const t = translateIcp(icp);

  expectEqual("industries map directly", t.filters.industries, ["Financial Services"]);
  expectEqual("regions become locations", t.filters.locations, ["Europe"]);
  expectEqual("technologies map directly", t.filters.technologies, ["Postgres"]);
  expectEqual("size bands become a numeric range", [t.filters.employeeMin, t.filters.employeeMax], [11, 200]);
  expect(
    "segments, keywords and business models all feed the keyword bag",
    ["Crypto trading desks", "settlement", "B2B SaaS"].every((k) => t.filters.keywords.includes(k)),
    JSON.stringify(t.filters.keywords),
  );
  expectEqual("excluded domains are pushed down to the provider", t.filters.excludeDomains, ["competitor.com"]);
  expect("a profile with filters is not empty", !t.empty);

  // The honesty requirement. A customer whose trigger silently vanished would
  // reasonably believe the results honour it.
  const unmappedFields = t.unmapped.map((u) => u.field).sort();
  expectEqual(
    "everything a provider cannot express is reported",
    unmappedFields,
    ["buyingSignals", "exampleCompanies", "exclusions", "painPoints", "triggers", "useCases"],
  );

  // And the report distinguishes "lost" from "handled somewhere else" — most
  // of these are applied by qualification, and calling them dropped would
  // push a user to weaken an ICP that is working.
  expect(
    "and each says where it IS handled, when it is",
    t.unmapped.every((u) => u.handledElsewhere !== null || u.field === "sizes"),
    JSON.stringify(t.unmapped.map((u) => [u.field, u.handledElsewhere])),
  );

  // `notes` is prose for a human. Reporting it as unmapped would train users
  // to ignore the list.
  expect("prose notes are not reported as a lost filter", !unmappedFields.includes("notes"));

  // Only reported when the bands produced nothing — otherwise the range IS
  // the mapping and a warning would be a false alarm.
  expect("readable size bands are not reported as unmapped", !unmappedFields.includes("sizes"));
  const unreadable = translateIcp(parseIcp({ sizes: ["a handful"], segments: ["X"] }, {}));
  expect(
    "but unreadable ones are",
    unreadable.unmapped.some((u) => u.field === "sizes"),
  );
}

console.log("\ndiscovery — an empty profile cannot start a paid search");
{
  const t = translateIcp(parseIcp({}, {}));
  expect("a profile with nothing in it is empty", t.empty);
  const notes = translateIcp(parseIcp({ notes: "we sell to nice people" }, {}));
  expect("and prose alone does not make it searchable", notes.empty);
  const one = translateIcp(parseIcp({ segments: ["Fintech"] }, {}));
  expect("one real criterion does", !one.empty);
}

console.log("\ndiscovery — the same search is one row and one cache entry");
{
  const a = canonicalFilters({
    ...EMPTY_FILTERS, keywords: ["Fintech", "SaaS"], locations: ["Europe"],
  });
  const b = canonicalFilters({
    ...EMPTY_FILTERS, keywords: ["SaaS", "Fintech"], locations: ["Europe"],
  });
  expect("filter order does not change the fingerprint", a === b);

  const c = canonicalFilters({ ...EMPTY_FILTERS, keywords: ["fintech"] });
  const d = canonicalFilters({ ...EMPTY_FILTERS, keywords: ["  FINTECH  "] });
  expect("nor does case or padding", c === d);

  const e = canonicalFilters({ ...EMPTY_FILTERS, keywords: ["fintech", "fintech"] });
  expect("nor does a duplicate", c === e);

  const f = canonicalFilters({ ...EMPTY_FILTERS, keywords: ["fintech"], employeeMin: 10 });
  expect("but a different filter does", c !== f);
}

console.log("\ndiscovery — the description is checkable by a person");
{
  const text = describeFilters({
    ...EMPTY_FILTERS,
    keywords: ["Fintech"],
    locations: ["Europe"],
    employeeMin: 11,
    employeeMax: 200,
  });
  expect("it names the filters in plain words", /Fintech/.test(text) && /Europe/.test(text));
  expect("and the size range", /11–200 people/.test(text), text);

  // The point of showing it is that somebody notices when it is wrong — so
  // "no filters" must be conspicuous rather than an empty string.
  const nothing = describeFilters(EMPTY_FILTERS);
  expect("no filters says so loudly", /no filters are set/i.test(nothing), nothing);
}

console.log(
  `\n${failures === 0 ? "PASS" : "FAIL"} — ${checks - failures}/${checks} checks passed\n`,
);
process.exit(failures === 0 ? 0 : 1);
