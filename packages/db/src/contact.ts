/**
 * Contact fit — who to talk to, and why.
 *
 * ── What this replaces ───────────────────────────────────────────────────
 *
 * `people.is_decision_maker boolean`. One bit, set by whatever wrote the row,
 * with no reasoning attached. It could not express that the VP of Engineering
 * is the buyer while the Head of Platform feels the pain, it could not rank
 * two people who were both true, and a person looking at it had to take it on
 * faith — which is the one thing this product is built not to ask.
 *
 * ── Why this is deterministic ────────────────────────────────────────────
 *
 * Architecture principle 3, and it applies unusually cleanly here. "Does this
 * title match this persona" is a string comparison against a list the
 * customer wrote. A model would be slower, cost money, produce a different
 * answer on Tuesday, and be unable to show its working — for a question with
 * a correct answer that a regex can find.
 *
 * The model's contribution comes later and is a different question: *given*
 * this person and this evidence, what is worth saying to them. That is
 * `recommended_angle`, it is genuinely a judgement, and it is not here.
 *
 * ── The shape mirrors opportunity scoring on purpose ─────────────────────
 *
 * Named dimensions, a base score kept apart from the rule-adjusted one, a
 * trace naming every rule that fired, and an explanation that is not
 * optional. That architecture is the most carefully-considered thing in this
 * repo and contact selection has exactly the same structure of problem; a
 * second, differently-shaped scoring system would be a second set of the
 * mistakes this one already avoids.
 */

/* ── Seniority ─────────────────────────────────────────────────────────── */

/**
 * The ladder, 0–100.
 *
 * A number rather than the `seniority text[]` that `0002` gave `people`,
 * because ranking needs an order and a text array does not know that "vp"
 * outranks "director".
 *
 * The values are spaced rather than sequential so a level can be inserted
 * later without renumbering — and, more usefully, so the gaps carry meaning:
 * the jump from manager to director is smaller than the jump from director to
 * VP, which is how buying authority actually distributes.
 *
 * Order matters in this array. It is scanned in order and the first match
 * wins, so the most specific patterns come first — "vp of engineering" must
 * match `vp` before it matches `engineer`.
 */
interface SeniorityLevel {
  key: string;
  label: string;
  rank: number;
  patterns: RegExp[];
}

const SENIORITY_LADDER: SeniorityLevel[] = [
  {
    key: "founder",
    label: "Founder",
    rank: 100,
    patterns: [/\bfounder\b/, /\bco[- ]?founder\b/, /\bowner\b/, /\bproprietor\b/],
  },
  {
    key: "c_level",
    label: "C-level",
    rank: 95,
    patterns: [
      /\bchief\b/,
      /\bc[eftoirm]o\b/,
      /\bcto\b/, /\bceo\b/, /\bcfo\b/, /\bcoo\b/, /\bcmo\b/, /\bciso\b/,
      /\bcio\b/, /\bcpo\b/, /\bcro\b/, /\bcdo\b/, /\bcso\b/,
      /* "Vice President" contains "President", and this list is scanned
         before the VP one — so a plain `\bpresident\b` classified every VP in
         the database as C-level. Silent, plausible, and wrong in the
         direction that matters: it inflates seniority, which is the input to
         "who should I contact". */
      /(?<!vice[ -])(?<!deputy[ -])\bpresident\b/,
      /\bmanaging director\b/,
      /\bpartner\b/,
    ],
  },
  {
    key: "vp",
    label: "VP",
    rank: 80,
    patterns: [/\bvp\b/, /\bv\.p\.?\b/, /\bvice[- ]president\b/, /\bsvp\b/, /\bevp\b/, /\bavp\b/],
  },
  {
    key: "head",
    label: "Head of",
    rank: 70,
    patterns: [/\bhead of\b/, /\bglobal head\b/, /\bgroup head\b/],
  },
  {
    key: "director",
    label: "Director",
    rank: 65,
    patterns: [/\bdirector\b/, /\bsenior director\b/],
  },
  {
    key: "principal",
    label: "Principal / Staff",
    rank: 50,
    patterns: [/\bprincipal\b/, /\bstaff\b/, /\bdistinguished\b/, /\bfellow\b/, /\barchitect\b/],
  },
  {
    key: "manager",
    label: "Manager",
    rank: 45,
    patterns: [/\bmanager\b/, /\bteam lead\b/, /\btech lead\b/, /\bsupervisor\b/],
  },
  {
    key: "senior",
    label: "Senior",
    rank: 30,
    patterns: [/\bsenior\b/, /\bsr\.?\b/, /\blead\b/],
  },
  /* Junior comes before the generic IC patterns, not after. "Junior Analyst"
     matches both, and the first match wins — so with these the other way
     round every junior in the database read as a mid-level individual
     contributor. Same class of error as the President one above, in the same
     direction: seniority inflated by a pattern that was merely earlier. */
  {
    key: "junior",
    label: "Junior",
    rank: 10,
    patterns: [/\bjunior\b/, /\bjr\.?\b/, /\bintern\b/, /\btrainee\b/, /\bgraduate\b/, /\bapprentice\b/],
  },
  {
    key: "ic",
    label: "Individual contributor",
    rank: 20,
    patterns: [
      /\bengineer\b/, /\bdeveloper\b/, /\banalyst\b/, /\bspecialist\b/,
      /\bconsultant\b/, /\bassociate\b/, /\bcoordinator\b/, /\brepresentative\b/,
      /\bdesigner\b/, /\bscientist\b/, /\badministrator\b/,
    ],
  },
];

/* ── Departments ───────────────────────────────────────────────────────── */

const DEPARTMENTS: Array<{ key: string; label: string; patterns: RegExp[] }> = [
  {
    key: "engineering",
    label: "Engineering",
    patterns: [
      /\bengineer/, /\bdeveloper\b/, /\bsoftware\b/, /\bplatform\b/, /\bdevops\b/,
      /\bsre\b/, /\binfrastructure\b/, /\bsecurity\b/, /\barchitect\b/, /\btechnical\b/,
      /\bcto\b/, /\bciso\b/, /\bchief technology\b/,
    ],
  },
  {
    key: "data",
    label: "Data",
    patterns: [/\bdata\b/, /\banalytics\b/, /\bmachine learning\b/, /\bml\b/, /\bai\b/, /\bbi\b/],
  },
  {
    key: "product",
    label: "Product",
    patterns: [/\bproduct\b/, /\bcpo\b/, /\bux\b/, /\bdesign\b/, /\bresearch\b/],
  },
  {
    key: "sales",
    label: "Sales",
    patterns: [
      /\bsales\b/, /\brevenue\b/, /\baccount executive\b/, /\bae\b/, /\bbusiness development\b/,
      /\bbd\b/, /\bpartnerships\b/, /\bcro\b/,
    ],
  },
  {
    key: "marketing",
    label: "Marketing",
    patterns: [/\bmarketing\b/, /\bgrowth\b/, /\bdemand gen/, /\bbrand\b/, /\bcontent\b/, /\bcmo\b/, /\bcommunications\b/],
  },
  {
    key: "customer",
    label: "Customer",
    patterns: [/\bcustomer success\b/, /\bcustomer\b/, /\bsupport\b/, /\bservice\b/, /\baccount manage/],
  },
  {
    key: "operations",
    label: "Operations",
    patterns: [/\boperations\b/, /\bops\b/, /\bcoo\b/, /\bsupply chain\b/, /\blogistics\b/, /\bprocurement\b/],
  },
  {
    key: "finance",
    label: "Finance",
    patterns: [/\bfinance\b/, /\bfinancial\b/, /\baccounting\b/, /\bcontroller\b/, /\btreasur/, /\bcfo\b/],
  },
  {
    key: "people",
    label: "People",
    patterns: [/\bpeople\b/, /\bhuman resources\b/, /\bhr\b/, /\btalent\b/, /\brecruit/, /\bchro\b/],
  },
  {
    key: "legal",
    label: "Legal",
    patterns: [/\blegal\b/, /\bcounsel\b/, /\bcompliance\b/, /\bprivacy\b/],
  },
  {
    key: "executive",
    label: "Executive",
    patterns: [/\bceo\b/, /\bchief executive\b/, /\bfounder\b/, /\bpresident\b/, /\bmanaging director\b/, /\bowner\b/],
  },
];

export interface TitleClassification {
  /** 0–100 on the ladder above, or null when the title says nothing about level. */
  seniorityRank: number | null;
  seniorityLabel: string | null;
  department: string | null;
  departmentLabel: string | null;
}

/**
 * What a job title says about level and function.
 *
 * Both halves are independently nullable, and that is the honest shape:
 * "Engineer" says a department and no useful level, "Director" says a level
 * and no department. Returning zero for an unreadable title would make an
 * unknown look like a judgement of "junior", which is exactly the promotion
 * of UNKNOWN to a value that §7 forbids.
 */
export function classifyTitle(title: string | null | undefined): TitleClassification {
  const empty: TitleClassification = {
    seniorityRank: null,
    seniorityLabel: null,
    department: null,
    departmentLabel: null,
  };
  if (!title) return empty;

  /* Normalized with spaces around it so `\b` behaves at the ends, and with
     punctuation flattened so "VP, Engineering" and "VP of Engineering" and
     "VP-Engineering" all read the same. */
  const t = ` ${String(title).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
  if (t.trim() === "") return empty;

  let seniority: SeniorityLevel | null = null;
  for (const level of SENIORITY_LADDER) {
    if (level.patterns.some((p) => p.test(t))) {
      seniority = level;
      break;
    }
  }

  let department: (typeof DEPARTMENTS)[number] | null = null;
  for (const dept of DEPARTMENTS) {
    if (dept.patterns.some((p) => p.test(t))) {
      department = dept;
      break;
    }
  }

  return {
    seniorityRank: seniority?.rank ?? null,
    seniorityLabel: seniority?.label ?? null,
    department: department?.key ?? null,
    departmentLabel: department?.label ?? null,
  };
}

/* ── Fit ───────────────────────────────────────────────────────────────── */

export interface PersonaSpec {
  id: string | null;
  name: string;
  titlePatterns: string[];
  seniority: string[];
  departments: string[];
  excludeTitles: string[];
  priority: number;
  isPrimary: boolean;
}

export interface ContactSubject {
  firstName: string | null;
  lastName: string | null;
  title: string | null;
  /** Best available contact point kind, or null when we have none. */
  bestContactKind: "email" | "phone" | "linkedin" | null;
  bestContactConfidence: "low" | "medium" | "high" | null;
  emailVerified: boolean;
  employmentStatus: "current" | "departed" | "unknown";
  lastVerifiedAt: Date | null;
}

export interface FitDimensions {
  titleMatch: number | null;
  seniorityFit: number | null;
  departmentFit: number | null;
  personaMatch: number | null;
  contactability: number | null;
  recency: number | null;
}

export interface ContactFit {
  score: number;
  dimensions: FitDimensions;
  personaId: string | null;
  personaName: string | null;
  confidence: "low" | "medium" | "high";
  reason: string;
  /** True when something disqualifies this person outright. */
  vetoed: boolean;
}

/**
 * How well one person fits one persona set.
 *
 * ── On the weighting ────────────────────────────────────────────────────
 *
 * §51 records that the combination rule for the *opportunity* dimensions is
 * NOT DEFINED and warns against inventing one. That constraint is about
 * opportunity scoring specifically, and it exists because those eight
 * dimensions are model judgements whose relative importance is a product
 * question nobody has answered.
 *
 * These six are different in kind: they are deterministic measurements of
 * observable facts, and the weighting below is a stated policy rather than a
 * discovered truth. It is written here in one place, it is versioned with the
 * code, and the screen shows every dimension separately so a user can
 * disagree with the total and still read the parts. That is the difference
 * between a weighting and a fabrication.
 *
 * ── Vetoes ──────────────────────────────────────────────────────────────
 *
 * Two, and both are facts rather than judgements: a person who has left, and
 * a person matching an explicit exclusion. Neither reduces the score — they
 * remove the person from consideration, because a 40 and "do not contact" are
 * different states and averaging them would let a strong title outweigh an
 * instruction.
 */
export function scoreContactFit(
  subject: ContactSubject,
  personas: readonly PersonaSpec[],
  now: Date = new Date(),
): ContactFit {
  const classification = classifyTitle(subject.title);
  const title = (subject.title ?? "").toLowerCase();

  if (subject.employmentStatus === "departed") {
    return {
      score: 0,
      dimensions: { titleMatch: null, seniorityFit: null, departmentFit: null, personaMatch: null, contactability: null, recency: null },
      personaId: null,
      personaName: null,
      confidence: "high",
      reason: "This person has left the company.",
      vetoed: true,
    };
  }

  /* Exclusions first, across every persona: one persona excluding a title is
     an instruction about that title, not a preference of that persona. */
  for (const persona of personas) {
    for (const excluded of persona.excludeTitles) {
      const needle = excluded.toLowerCase().trim();
      if (needle && title.includes(needle)) {
        return {
          score: 0,
          dimensions: { titleMatch: null, seniorityFit: null, departmentFit: null, personaMatch: null, contactability: null, recency: null },
          personaId: persona.id,
          personaName: persona.name,
          confidence: "high",
          reason: `"${subject.title}" matches the excluded title "${excluded}" on ${persona.name}.`,
          vetoed: true,
        };
      }
    }
  }

  /* Score against every persona and keep the best. A person legitimately fits
     two personas; the one they fit best is the one that should decide the
     angle, and `priority` breaks a tie so the result is deterministic rather
     than dependent on row order. */
  let best: { persona: PersonaSpec | null; dims: FitDimensions; total: number } | null = null;

  const contactability = scoreContactability(subject);
  const recency = scoreRecency(subject, now);

  const candidates: Array<PersonaSpec | null> = personas.length > 0 ? [...personas] : [null];

  for (const persona of candidates) {
    const titleMatch = persona ? scoreTitleMatch(title, persona) : null;
    const seniorityFit = persona
      ? scoreSeniorityFit(classification, persona)
      : classification.seniorityRank;
    const departmentFit = persona ? scoreDepartmentFit(classification, persona) : null;
    const personaMatch = persona
      ? weighted([
          [titleMatch, 3],
          [seniorityFit, 2],
          [departmentFit, 2],
        ])
      : null;

    const dims: FitDimensions = {
      titleMatch,
      seniorityFit,
      departmentFit,
      personaMatch,
      contactability,
      recency,
    };

    /* With no persona defined the profile has not said who to talk to, so the
       only defensible ranking is seniority and reachability. That is a weaker
       claim and the confidence below says so. */
    const total = persona
      ? weighted([
          [personaMatch, 5],
          [contactability, 3],
          [recency, 1],
        ])
      : weighted([
          [seniorityFit, 5],
          [contactability, 3],
          [recency, 1],
        ]);

    if (!best || total > best.total || (total === best.total && persona && best.persona && persona.priority < best.persona.priority)) {
      best = { persona, dims, total };
    }
  }

  const chosen = best ?? { persona: null, dims: { titleMatch: null, seniorityFit: null, departmentFit: null, personaMatch: null, contactability: null, recency: null }, total: 0 };

  return {
    score: Math.max(0, Math.min(100, Math.round(chosen.total))),
    dimensions: chosen.dims,
    personaId: chosen.persona?.id ?? null,
    personaName: chosen.persona?.name ?? null,
    confidence: fitConfidence(subject, chosen.persona, chosen.dims),
    reason: explainFit(subject, chosen.persona, chosen.dims, classification),
    vetoed: false,
  };
}

/**
 * A weighted mean over the dimensions that have a value.
 *
 * Nulls are *skipped*, not treated as zero. That is the whole §7 position
 * applied to arithmetic: a person whose department cannot be read from their
 * title is not a person with a department fit of zero, and scoring them as
 * one would penalise a title we failed to parse.
 */
function weighted(parts: Array<[number | null, number]>): number {
  let sum = 0;
  let weight = 0;
  for (const [value, w] of parts) {
    if (value === null) continue;
    sum += value * w;
    weight += w;
  }
  return weight === 0 ? 0 : sum / weight;
}

function scoreTitleMatch(title: string, persona: PersonaSpec): number | null {
  if (!persona.titlePatterns.length) return null;
  if (!title) return null;

  for (const pattern of persona.titlePatterns) {
    const needle = pattern.toLowerCase().trim();
    if (!needle) continue;
    if (title === needle) return 100;
    if (title.includes(needle)) return 85;
  }

  /* A partial match on the words of a pattern. "VP Platform Engineering"
     against a pattern of "VP Engineering" is a real match that substring
     matching misses, and it is common enough in provider data to be worth
     handling. Capped below an exact match so the ordering stays honest. */
  const titleWords = new Set(title.split(/\s+/).filter(Boolean));
  let bestOverlap = 0;
  for (const pattern of persona.titlePatterns) {
    const words = pattern.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) continue;
    const hits = words.filter((w) => titleWords.has(w)).length;
    bestOverlap = Math.max(bestOverlap, hits / words.length);
  }
  if (bestOverlap >= 0.5) return Math.round(40 + bestOverlap * 30);

  return 10;
}

function scoreSeniorityFit(c: TitleClassification, persona: PersonaSpec): number | null {
  if (c.seniorityRank === null) return null;
  if (!persona.seniority.length) return c.seniorityRank;

  const wanted = persona.seniority.map((s) => s.toLowerCase().trim()).filter(Boolean);
  const label = (c.seniorityLabel ?? "").toLowerCase();
  const matched = wanted.some((w) => label.includes(w) || w.includes(label));
  /* Not a veto: a persona asking for VPs and finding a Director has found
     someone worth contacting, and 45 says "worse, not wrong". */
  return matched ? 100 : 45;
}

function scoreDepartmentFit(c: TitleClassification, persona: PersonaSpec): number | null {
  if (!persona.departments.length) return null;
  if (c.department === null) return null;
  const wanted = persona.departments.map((d) => d.toLowerCase().trim());
  return wanted.includes(c.department) ? 100 : 20;
}

/**
 * Can we actually reach them, and do we trust the address?
 *
 * A verified email is the only thing that scores full marks, because it is
 * the only contact point the product can act on with confidence. A guessed
 * address scores badly on purpose — the whole posture of `providers.ts` is
 * that a plausible string with no evidence behind it is not a finding, and
 * ranking it as one here would launder it back in.
 */
function scoreContactability(subject: ContactSubject): number | null {
  if (subject.bestContactKind === null) return 0;
  if (subject.bestContactKind === "email") {
    if (subject.emailVerified) return 100;
    return subject.bestContactConfidence === "high" ? 70
      : subject.bestContactConfidence === "medium" ? 45
      : 25;
  }
  if (subject.bestContactKind === "linkedin") return 40;
  return 30;
}

/**
 * How stale the record is.
 *
 * Never verified is `null`, not zero — we do not know that it is stale, we
 * know that nobody checked. Six months is the point at which a title is more
 * likely wrong than right in the data this system sees.
 */
function scoreRecency(subject: ContactSubject, now: Date): number | null {
  if (!subject.lastVerifiedAt) return null;
  const days = (now.getTime() - subject.lastVerifiedAt.getTime()) / 86_400_000;
  if (days <= 30) return 100;
  if (days <= 90) return 80;
  if (days <= 180) return 55;
  if (days <= 365) return 30;
  return 10;
}

function fitConfidence(
  subject: ContactSubject,
  persona: PersonaSpec | null,
  dims: FitDimensions,
): "low" | "medium" | "high" {
  /* Confidence is about how much we know, not how good the answer is. A
     perfect title with no contact point and an unknown employment status is a
     low-confidence recommendation however high it scores. */
  const known = [dims.titleMatch, dims.seniorityFit, dims.departmentFit, dims.contactability]
    .filter((d) => d !== null).length;

  if (!persona) return "low";
  if (subject.employmentStatus === "unknown" && !subject.lastVerifiedAt) {
    return known >= 3 ? "medium" : "low";
  }
  if (known >= 3 && subject.emailVerified) return "high";
  return known >= 2 ? "medium" : "low";
}

/**
 * The sentence a person reads.
 *
 * NOT NULL in the schema, for the same reason `opportunities.priority_reason`
 * is: a ranking with no stated reason is a number the user has to trust
 * blindly. It names what was matched rather than restating the score, because
 * "82" is not a reason and "Matches Technical Buyer on title and seniority"
 * is.
 */
function explainFit(
  subject: ContactSubject,
  persona: PersonaSpec | null,
  dims: FitDimensions,
  c: TitleClassification,
): string {
  const parts: string[] = [];

  if (persona) {
    if ((dims.titleMatch ?? 0) >= 85) parts.push(`title matches ${persona.name}`);
    else if ((dims.titleMatch ?? 0) >= 40) parts.push(`title partly matches ${persona.name}`);
    else if (dims.titleMatch !== null) parts.push(`title does not match ${persona.name}`);

    if ((dims.departmentFit ?? 0) >= 100 && c.departmentLabel) {
      parts.push(`in ${c.departmentLabel}`);
    }
    if ((dims.seniorityFit ?? 0) >= 100 && c.seniorityLabel) {
      parts.push(`at the ${c.seniorityLabel} level the persona asks for`);
    } else if (c.seniorityLabel) {
      parts.push(`${c.seniorityLabel} level`);
    }
  } else if (c.seniorityLabel) {
    parts.push(`${c.seniorityLabel} level, with no persona defined to compare against`);
  } else {
    parts.push("no persona defined, and the title says little about seniority");
  }

  if (subject.emailVerified) parts.push("verified email");
  else if (subject.bestContactKind === "email") parts.push("unverified email");
  else if (subject.bestContactKind) parts.push(`${subject.bestContactKind} only`);
  else parts.push("no contact point yet");

  if (subject.employmentStatus === "unknown" && !subject.lastVerifiedAt) {
    parts.push("employment not confirmed");
  }

  const sentence = parts.join(", ");
  return sentence.charAt(0).toUpperCase() + sentence.slice(1) + ".";
}

/**
 * Rank a company's people, best first.
 *
 * Vetoed people are returned too, at the bottom, with their reason. Hiding
 * them would mean a user who wonders why an obvious contact is missing has no
 * way to find out — and "they left in March" is exactly the kind of answer
 * that builds trust in the ranking above it.
 */
export interface RankedContact<T> {
  subject: T;
  fit: ContactFit;
}

export function rankContacts<T extends ContactSubject>(
  people: readonly T[],
  personas: readonly PersonaSpec[],
  now: Date = new Date(),
): Array<RankedContact<T>> {
  return people
    .map((subject) => ({ subject, fit: scoreContactFit(subject, personas, now) }))
    .sort((a, b) => {
      if (a.fit.vetoed !== b.fit.vetoed) return a.fit.vetoed ? 1 : -1;
      if (b.fit.score !== a.fit.score) return b.fit.score - a.fit.score;
      /* A deterministic tiebreak, so two equal contacts do not swap places
         between runs and make the "recommended contact" look unstable. */
      const an = `${a.subject.lastName ?? ""}${a.subject.firstName ?? ""}`;
      const bn = `${b.subject.lastName ?? ""}${b.subject.firstName ?? ""}`;
      return an.localeCompare(bn);
    });
}
