/**
 * Seed a Supabase project with one worked organisation.
 *
 *   node --experimental-strip-types packages/db/scripts/seed.ts
 *   node --experimental-strip-types packages/db/scripts/seed.ts --reset
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 *
 * FEAT-02 sat blocked for one reason, recorded in `lib/data/opportunities.ts`:
 * writing the opportunity join blind produces a query that reads as finished
 * and has never returned a row. The unblocking step is not a credential, it is
 * *rows* — something for the join to return, shaped like what the product will
 * actually hold. This writes them.
 *
 * ── What it is not ─────────────────────────────────────────────────────────
 *
 * Not a fixture loader for tests. The unit suites run against PGlite and stay
 * self-contained; this targets a hosted project a developer is looking at.
 *
 * Not production data. Every row it writes is scoped to one organisation
 * (`--slug`, default `acme`), and `--reset` removes exactly that organisation
 * and nothing else. The cascade in 0001–0003 does the rest.
 *
 * ── Why the service-role client ────────────────────────────────────────────
 *
 * Seeds are named in `src/admin.ts` as a legitimate caller. There is no user
 * session here, and the membership row that would let RLS admit us is one of
 * the things being created. Every statement below is scoped by `org_id`
 * anyway, per rule 3 of that file.
 *
 * ── Idempotence ────────────────────────────────────────────────────────────
 *
 * Re-runnable. The organisation, membership, product, ICP and sources are
 * upserted on their natural keys; the company graph is deleted and rewritten,
 * because a partial upsert across seven tables with three foreign-key chains
 * is more code and more ways to be subtly wrong than a scoped delete.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

/* ── Environment ─────────────────────────────────────────────────────────── */

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..", "..");

/**
 * Read `apps/web/.env.local` before importing anything that touches
 * `process.env`. The app is a Next.js project, which loads that file itself;
 * a standalone Node script gets no such favour, and requiring the developer to
 * export three variables by hand is how a seed script goes unused.
 *
 * Existing environment wins, so CI or a shell export can override the file.
 */
function loadEnvLocal(): void {
  const file = path.join(repoRoot, "apps", "web", ".env.local");
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return; // Absent is fine: the variables may already be exported.
  }
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!match?.[1]) continue;
    const key = match[1];
    const value = (match[2] ?? "").trim().replace(/^["']|["']$/g, "");
    // `.env.example` was copied here, so the file legitimately contains keys
    // with empty values. An empty string is not a configured value, and
    // setting it would defeat the `required()` checks in src/env.ts.
    if (value && process.env[key] === undefined) process.env[key] = value;
  }
}

loadEnvLocal();

/**
 * The service-role client, constructed here rather than imported from
 * `../src/admin.ts`.
 *
 * Not a preference. `src/` is consumed by Next.js under `moduleResolution:
 * Bundler` and so imports its siblings without file extensions (`./env`).
 * Node's type stripping resolves ESM specifiers literally and cannot find
 * those, so importing `admin.ts` from a plain `node` script fails outright.
 * Adding extensions across `src/` to suit one script is the larger change and
 * the one more likely to break a build.
 *
 * The rules in `src/admin.ts` still apply, and this file obeys them: seeds are
 * a named legitimate caller, and every statement below is scoped by `org_id`.
 * The check that actually matters — that nothing under `apps/` reaches for
 * this — is enforced by `check-admin-imports.ts` and is unaffected, because
 * this script is not under `apps/`.
 */
const { createClient } = await import("@supabase/supabase-js");

function requiredEnv(name: string, alt?: string): string {
  const value = process.env[name] ?? (alt ? process.env[alt] : undefined);
  if (!value) {
    console.error(
      `\n✗ Missing ${name}.\n` +
        `  Fill it in at apps/web/.env.local — see SETUP.md step 2.\n`,
    );
    process.exitCode = 1;
    // Before any request has been made, so `process.exit` is still safe here —
    // but thrown for consistency with everything after it. See `Stop` below.
    throw new Error(`Missing ${name}`);
  }
  return value;
}

function createAdminClient() {
  return createClient(
    requiredEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requiredEnv("SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

/* ── Arguments ───────────────────────────────────────────────────────────── */

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return (i !== -1 ? process.argv[i + 1] : undefined) ?? fallback;
}

const RESET = process.argv.includes("--reset");
const CREATE_USER = process.argv.includes("--create-user");
const SLUG = arg("slug", "acme");
const OWNER_EMAIL = arg("email", "");

/* ── The dataset ─────────────────────────────────────────────────────────── */

/**
 * Three companies, chosen to exercise the states the UI has to distinguish
 * rather than to look impressive:
 *
 *   Alphio AI          hot, fresh trigger, a named decision maker
 *   Northwind          warm, one trigger, a contact with no verified address
 *   Cormorant Health   watch, stale trigger, NO buyer identified, and three
 *                      score dimensions left NULL
 *
 * That last row is the important one. §78 says an unmeasured dimension is not
 * a zero, and a seed where every column is populated proves nothing about
 * whether the read path handles the NULL — which is the case that ships.
 */

type Kind = "fact" | "inference" | "unknown";
type Conf = "low" | "medium" | "high";

interface SeedEvidence {
  claim: string;
  kind: Kind;
  confidence?: Conf;
  source_url?: string;
  excerpt?: string;
  event_date?: string;
  observed_at?: string;
  /** Links a trigger to the evidence that established it. */
  tag?: string;
}

interface SeedCompany {
  canonical_domain: string;
  name: string;
  website: string;
  industry: string;
  employee_count: number;
  country: string;
  region: string;
  business_model: string;
  description: string;
  tech_stack: string[];
  triggers: {
    trigger_type: string;
    event_date: string;
    strength: number | null;
    evidence_tag?: string;
  }[];
  people: {
    first_name: string;
    last_name: string;
    title: string;
    seniority: string;
    is_decision_maker: boolean;
    linkedin_url: string | null;
    email: string | null;
    email_confidence: Conf | null;
  }[];
  opportunity: {
    priority: "hot" | "warm" | "watch" | "ignore";
    priority_reason: string;
    status: string;
    confidence: Conf | null;
    why_this_company: string | null;
    identified_problem: string | null;
    potential_gap: string | null;
    why_now: string | null;
    current_approach: string | null;
    potential_use_case: string | null;
    outreach_angle: string | null;
    first_seen_at: string;
    /** Set on the person who should be contacted first, by full name. */
    primary_person?: string;
  };
  score: {
    score: number;
    explanation: string;
    confidence: Conf;
    icp_fit: number | null;
    problem_severity: number | null;
    evidence_strength: number | null;
    trigger_strength: number | null;
    trigger_freshness: number | null;
    buying_likelihood: number | null;
    product_relevance: number | null;
    decision_maker_accessibility: number | null;
  };
  evidence: SeedEvidence[];
}

const COMPANIES: SeedCompany[] = [
  {
    canonical_domain: "alphio.ai",
    name: "Alphio AI",
    website: "https://alphio.ai",
    industry: "AI infrastructure",
    employee_count: 24,
    country: "US",
    region: "San Francisco, US",
    business_model: "B2B SaaS",
    description:
      "Autonomous trading agents for crypto desks. The product executes strategies on-chain on behalf of a fund, which means it must hold or delegate signing authority over real capital.",
    tech_stack: ["Python", "Rust", "Kubernetes"],
    triggers: [
      {
        trigger_type: "Funding — Series A",
        event_date: "2026-08-08T00:00:00Z",
        strength: 90,
        evidence_tag: "series-a",
      },
      {
        trigger_type: "Product launch",
        event_date: "2026-08-08T00:00:00Z",
        strength: 72,
        evidence_tag: "launch-post",
      },
      {
        trigger_type: "Hiring — 2 backend engineers",
        event_date: "2026-07-30T00:00:00Z",
        strength: 54,
      },
    ],
    people: [
      {
        first_name: "Dana",
        last_name: "Okonkwo",
        title: "Co-founder & CTO",
        seniority: "c_level",
        is_decision_maker: true,
        linkedin_url: "https://www.linkedin.com/",
        email: "dana@alphio.ai",
        email_confidence: "high",
      },
      {
        first_name: "Marta",
        last_name: "Kovacs",
        title: "VP Revenue Operations",
        seniority: "vp",
        is_decision_maker: false,
        linkedin_url: "https://www.linkedin.com/",
        email: null,
        email_confidence: null,
      },
    ],
    opportunity: {
      priority: "hot",
      priority_reason:
        "Strong ICP fit, a problem stated in the founder's own words, and a funding trigger three days old.",
      status: "qualified",
      confidence: "medium",
      why_this_company:
        "They build autonomous trading agents and have just taken institutional money. Institutional desks will not onboard an agent that holds unconstrained signing authority, which is the constraint this product removes.",
      identified_problem:
        "Their agents need controlled financial permissions before institutional desks will onboard. The founder describes this as the thing standing between them and their first three enterprise customers.",
      potential_gap:
        "No public evidence of a permissioning or policy layer between the agent and the wallet.",
      why_now:
        "The Series A closed three days ago and the launch post is public. Institutional onboarding is the stated use of funds, so the permissioning problem moves from theoretical to blocking within this quarter.",
      current_approach: null,
      potential_use_case:
        "Policy-constrained signing: per-strategy spend caps, allow-listed venues, and a human approval path for anything outside them.",
      outreach_angle:
        "Lead with the institutional-onboarding blocker they named themselves, not with the funding round. Everyone will congratulate them on the round this week.",
      first_seen_at: "2026-08-09T08:12:00Z",
      primary_person: "Dana Okonkwo",
    },
    score: {
      score: 91,
      explanation:
        "Series A closed this week, and the launch post names custody permissions as an open problem — the exact gap the product closes.",
      confidence: "medium",
      icp_fit: 94,
      problem_severity: 88,
      evidence_strength: 82,
      trigger_strength: 90,
      trigger_freshness: 96,
      buying_likelihood: null,
      product_relevance: 92,
      decision_maker_accessibility: 71,
    },
    evidence: [
      {
        tag: "series-a",
        claim: "Alphio AI closed a $12M Series A led by Northgate Ventures.",
        kind: "fact",
        confidence: "high",
        source_url: "https://techcrunch.com/",
        excerpt:
          "Alphio AI has raised $12 million to scale its autonomous trading agents to institutional desks.",
        event_date: "2026-08-08T00:00:00Z",
        observed_at: "2026-08-09T07:40:00Z",
      },
      {
        tag: "launch-post",
        claim:
          "The founder describes permissioning as the blocker to institutional onboarding.",
        kind: "fact",
        confidence: "high",
        source_url: "https://alphio.ai/blog/agents-and-keys",
        excerpt:
          "The hard part isn't the strategy. It's convincing a desk to let software hold the keys.",
        event_date: "2026-08-08T00:00:00Z",
        observed_at: "2026-08-09T07:41:00Z",
      },
      {
        claim:
          "Their agents will need controlled financial permissions before institutional desks onboard.",
        kind: "inference",
        confidence: "medium",
        event_date: "2026-08-08T00:00:00Z",
        observed_at: "2026-08-09T07:42:00Z",
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
  },
  {
    canonical_domain: "northwind.co",
    name: "Northwind Logistics",
    website: "https://northwind.co",
    industry: "Freight & logistics",
    employee_count: 310,
    country: "NL",
    region: "Rotterdam, NL",
    business_model: "Freight forwarding",
    description:
      "Freight forwarding across European road and sea routes, with a partner network that each expose their own booking and tracking APIs.",
    tech_stack: ["Java", "Oracle"],
    triggers: [
      {
        trigger_type: "Hiring — integration engineers",
        event_date: "2026-08-01T00:00:00Z",
        strength: 54,
        evidence_tag: "job-post",
      },
    ],
    people: [
      {
        first_name: "Devan",
        last_name: "Rao",
        title: "Head of Growth",
        seniority: "head",
        is_decision_maker: false,
        linkedin_url: "https://www.linkedin.com/",
        email: null,
        email_confidence: null,
      },
    ],
    opportunity: {
      priority: "warm",
      priority_reason:
        "Good ICP fit and a clear hiring signal, but nothing yet showing the problem is urgent for them.",
      status: "researching",
      confidence: "medium",
      why_this_company:
        "Their own job spec describes maintaining 40+ carrier integrations by hand — the work this product automates.",
      identified_problem:
        "Partner integrations are maintained manually across 40+ carriers, which is the reason they are hiring rather than the outcome they want.",
      potential_gap:
        "No integration platform in evidence. The hiring signal suggests headcount is the current answer.",
      why_now:
        "They are hiring for the problem right now, which means budget exists — but as headcount, not software. That is a competing spend, and it closes once the roles are filled.",
      current_approach: "In-house, maintained by hand across 40+ carriers.",
      potential_use_case:
        "Replace hand-maintained carrier adapters with a managed integration layer, freeing the two roles for routing work.",
      outreach_angle:
        "The job spec is the opening. Frame against the cost of two engineers rather than against a competitor.",
      first_seen_at: "2026-08-02T09:05:00Z",
    },
    score: {
      score: 74,
      explanation:
        "Hiring two integration engineers with a job spec that describes the manual process this replaces. No budget or timeline evidence.",
      confidence: "medium",
      icp_fit: 85,
      problem_severity: 58,
      evidence_strength: 61,
      trigger_strength: 54,
      trigger_freshness: 74,
      buying_likelihood: null,
      product_relevance: 80,
      decision_maker_accessibility: 66,
    },
    evidence: [
      {
        tag: "job-post",
        claim: "Northwind posted two integration-engineer roles on 1 Aug.",
        kind: "fact",
        confidence: "high",
        source_url: "https://northwind.co/careers",
        excerpt:
          "You will own the partner-integration pipeline, currently maintained by hand across 40+ carriers.",
        event_date: "2026-08-01T00:00:00Z",
        observed_at: "2026-08-02T09:00:00Z",
      },
      {
        claim: "Integration maintenance is a growing cost for them.",
        kind: "inference",
        confidence: "medium",
        event_date: "2026-08-01T00:00:00Z",
        observed_at: "2026-08-02T09:01:00Z",
      },
      { claim: "Whether a purchase decision is funded this quarter.", kind: "unknown" },
      { claim: "Who owns the integration budget.", kind: "unknown" },
    ],
  },
  {
    canonical_domain: "cormorant.health",
    name: "Cormorant Health",
    website: "https://cormorant.health",
    industry: "Medical devices",
    employee_count: 140,
    country: "US",
    region: "Boston, US",
    business_model: "Hardware + software",
    description:
      "Remote patient-monitoring hardware and the clinician-facing software that reads from it.",
    tech_stack: ["C++", "React"],
    triggers: [
      {
        trigger_type: "Regulatory approval",
        event_date: "2026-04-14T00:00:00Z",
        strength: 44,
        evidence_tag: "clearance",
      },
    ],
    // No people at all: §78 requires the page to say buyer identification is
    // incomplete rather than render an empty list as though it were finished.
    people: [],
    opportunity: {
      priority: "watch",
      priority_reason:
        "Plausible fit, but the only trigger on file is from April and nothing has changed since.",
      status: "discovered",
      confidence: "low",
      why_this_company:
        "Regulatory clearance usually precedes a commercial build-out, and their device category fits the ICP.",
      // Deliberately NULL, not "Not established." — the string would be a
      // claim stored in the database; the absence is the finding, and the page
      // renders its own "not established" for a null.
      identified_problem: null,
      potential_gap: null,
      why_now:
        "There is no why-now. The approval was in April and nothing has followed it. Contacting today would be contacting on a stale signal.",
      current_approach: null,
      potential_use_case: null,
      outreach_angle:
        "None recommended yet. Wait for a second signal — a hiring post, a launch, or a public statement of the problem.",
      first_seen_at: "2026-04-15T11:20:00Z",
    },
    score: {
      score: 48,
      explanation:
        "Regulatory approval in April is the sole signal. No hiring, no launches, no public statement of the problem since.",
      confidence: "low",
      icp_fit: 62,
      problem_severity: null,
      evidence_strength: 31,
      trigger_strength: 44,
      trigger_freshness: 12,
      buying_likelihood: null,
      product_relevance: 55,
      decision_maker_accessibility: null,
    },
    evidence: [
      {
        tag: "clearance",
        claim:
          "Cormorant received regulatory clearance for its remote-monitoring device.",
        kind: "fact",
        confidence: "high",
        source_url: "https://cormorant.health/press/clearance",
        event_date: "2026-04-14T00:00:00Z",
        observed_at: "2026-04-15T11:00:00Z",
      },
      { claim: "Whether they have the problem this product solves.", kind: "unknown" },
      { claim: "Who the buyer would be.", kind: "unknown" },
    ],
  },
];

const SOURCES: { kind: string; name: string; url: string; recommended_by: string }[] = [
  { kind: "funding", name: "TechCrunch — funding", url: "https://techcrunch.com/category/venture/", recommended_by: "system" },
  { kind: "jobs", name: "Hiring signals", url: "https://news.ycombinator.com/jobs", recommended_by: "system" },
  { kind: "github", name: "GitHub — repository activity", url: "https://github.com/", recommended_by: "system" },
  { kind: "regulatory", name: "FDA device clearances", url: "https://www.fda.gov/", recommended_by: "user" },
];

/* ── Helpers ─────────────────────────────────────────────────────────────── */

const db = createAdminClient();

/**
 * Stopping, without `process.exit()`.
 *
 * `process.exit()` here aborts the process on Windows —
 * `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)` — because the
 * Supabase client's keep-alive sockets and the type-stripping loader still
 * hold libuv handles, and it truncates unflushed stdout on the way out. The
 * exit code that reaches npm is a 32-bit abort code rather than 0 or 1, so a
 * caller cannot tell success from failure.
 *
 * So: throw, and let the handler below end the process naturally. Registering
 * an `unhandledRejection` listener stops Node terminating on its own, which is
 * what makes a thrown sentinel a clean exit rather than a crash.
 */
class Stop extends Error {}

// Both, because which one fires depends on where in module evaluation the
// throw happens: a rejection inside a `.then` is `unhandledRejection`, and a
// throw in the module's own top-level await surfaces as `uncaughtException`.
function end(reason: unknown): void {
  if (reason instanceof Stop) return; // Deliberate stop; its message is printed.
  console.error(reason);
  process.exitCode = 1;
}

process.on("unhandledRejection", end);
process.on("uncaughtException", end);

function fail(step: string, error: { message: string } | null): void {
  if (!error) return;
  console.error(`\n✗ ${step}\n  ${error.message}\n`);
  process.exitCode = 1;
  throw new Stop(step);
}

/**
 * `fail` plus "and there is definitely a row".
 *
 * Supabase types every `.select()` result as `data: T | null`, which is
 * correct — an error means no data. `fail()` exits on error, but a function
 * returning `void` cannot tell the compiler that, so every insert would be
 * followed by a non-null assertion. This narrows honestly instead: both
 * branches exit, so what it returns is a row.
 */
function must<T>(
  step: string,
  result: { data: T; error: { message: string } | null },
): NonNullable<T> {
  fail(step, result.error);
  if (result.data === null || result.data === undefined) {
    console.error(`\n✗ ${step}\n  The insert reported no error and returned no row.\n`);
    process.exitCode = 1;
    throw new Stop(step);
  }
  // `data` is declared `T` rather than `T | null` on purpose: a Supabase
  // response is a union of a success and a failure shape, so inferring against
  // `T | null` binds T to the union and defeats the narrowing. Taking the
  // property whole and stripping null on the way out is what makes callers see
  // a row.
  return result.data as NonNullable<T>;
}

/* ── Run ─────────────────────────────────────────────────────────────────── */

// Every statement below is scoped to this one organisation. See src/admin.ts
// rule 3 — the service-role client bypasses RLS, so the scoping is the only
// thing keeping this seed from being able to touch another tenant.
const { data: existingOrg, error: orgLookupError } = await db
  .from("organizations")
  .select("id")
  .eq("slug", SLUG)
  .maybeSingle();
fail(`looking up organisation "${SLUG}"`, orgLookupError);

if (RESET) {
  if (!existingOrg) {
    console.log(`Nothing to reset: no organisation with slug "${SLUG}".`);
    throw new Stop("nothing to reset");
  }
  const { error } = await db.from("organizations").delete().eq("id", existingOrg.id);
  fail("deleting the organisation", error);
  console.log(
    `Removed organisation "${SLUG}" and everything referencing it.\n` +
      `The auth user is left alone — it may be a real account.`,
  );
  throw new Stop("reset complete");
}

/* 1 — Organisation */

const orgId = existingOrg?.id ?? null;
const org = must(
  "creating the organisation",
  await db
    .from("organizations")
    .upsert(
      { ...(orgId ? { id: orgId } : {}), name: "Acme", slug: SLUG },
      { onConflict: "slug" },
    )
    .select("id")
    .single(),
);
console.log(`organisation  ${SLUG}`);

/* 2 — Owner membership.
 *
 * Skipped when no `--email` is given. A membership needs a row in auth.users,
 * and every screen under /[org] resolves through one: with no membership the
 * org guard returns 404, so seeded rows exist but nobody can see them.
 *
 * `--create-user` creates the account when it does not exist, email already
 * confirmed. That is a real account in a real project, so it is opt-in rather
 * than implied — but it is also the difference between a seed you can look at
 * and a seed you cannot. No password is set: sign-in stays magic-link or
 * Google, exactly as it is for any other user. */

if (OWNER_EMAIL) {
  const { data: list, error: listError } = await db.auth.admin.listUsers({ perPage: 200 });
  fail("listing auth users", listError);
  let user = list?.users.find(
    (u) => u.email?.toLowerCase() === OWNER_EMAIL.toLowerCase(),
  );

  if (!user && CREATE_USER) {
    const { data: created, error } = await db.auth.admin.createUser({
      email: OWNER_EMAIL,
      // Confirmed on creation. The alternative is a confirmation email to an
      // inbox nobody is watching, which turns a seed into a manual step.
      email_confirm: true,
    });
    fail(`creating the auth user ${OWNER_EMAIL}`, error);
    user = created?.user ?? undefined;
    console.log(`auth user     ${OWNER_EMAIL} created`);
  }

  if (!user) {
    console.log(
      `membership    skipped — no auth user with email ${OWNER_EMAIL}.\n` +
        `              Sign up at /signup, or re-run with --create-user.`,
    );
  } else {
    const { error } = await db
      .from("memberships")
      .upsert(
        { org_id: org.id, user_id: user.id, role: "owner" },
        { onConflict: "org_id,user_id" },
      );
    fail("creating the membership", error);
    console.log(`membership    ${OWNER_EMAIL} → owner`);
  }
} else {
  console.log(
    `membership    skipped — pass --email you@example.com to join this org`,
  );
}

/* 3 — Product and ICP */

/* Neither `products` nor `icps` has a unique constraint on (org_id, name) —
 * both are things a user creates several of — so `upsert` would fall back to
 * an insert and a second run would duplicate them. Look up, then insert or
 * update. */

const productPayload = {
  org_id: org.id,
  name: "Huntloop",
  website: "https://huntloop.example",
  description:
    "Finds companies with a problem you solve, proves it with evidence, and says why now.",
  value_props: ["Evidence before pitch", "Why-now on every opportunity"],
  proof_points: [],
};

const { data: existingProduct } = await db
  .from("products")
  .select("id")
  .eq("org_id", org.id)
  .eq("name", productPayload.name)
  .limit(1)
  .maybeSingle();

const product = must(
  "creating the product",
  existingProduct
    ? await db
        .from("products")
        .update(productPayload)
        .eq("id", existingProduct.id)
        .select("id")
        .single()
    : await db.from("products").insert(productPayload).select("id").single(),
);

const { data: existingIcp } = await db
  .from("icps")
  .select("id")
  .eq("org_id", org.id)
  .eq("name", "Agent infrastructure teams")
  .limit(1)
  .maybeSingle();

const icpPayload = {
  org_id: org.id,
  product_id: product.id,
  name: "Agent infrastructure teams",
  criteria: {
    industries: ["AI infrastructure", "Fintech", "Logistics"],
    employee_count: { min: 10, max: 500 },
    signals: ["recent funding", "hiring integration or platform engineers"],
  },
  negative_criteria: {
    industries: ["Consumer social"],
    notes: "Pre-seed companies with no revenue — no budget, no procurement.",
  },
  is_active: true,
};

const icp = must(
  "creating the ICP",
  existingIcp
    ? await db
        .from("icps")
        .update(icpPayload)
        .eq("id", existingIcp.id)
        .select("id")
        .single()
    : await db.from("icps").insert(icpPayload).select("id").single(),
);
console.log(`icp           ${icpPayload.name}`);

/* 4 — Sources */

const { error: sourcesDeleteError } = await db
  .from("sources")
  .delete()
  .eq("org_id", org.id);
fail("clearing sources", sourcesDeleteError);

const { error: sourcesError } = await db.from("sources").insert(
  SOURCES.map((s) => ({
    org_id: org.id,
    icp_id: icp.id,
    kind: s.kind,
    name: s.name,
    url: s.url,
    recommended_by: s.recommended_by,
    is_enabled: true,
    status: "ok",
    last_scanned_at: new Date().toISOString(),
  })),
);
fail("creating sources", sourcesError);
console.log(`sources       ${SOURCES.length}`);

/* 5 — The company graph.
 *
 * Deleted and rewritten rather than upserted. `companies` cascades to
 * problems, gaps, triggers, people, contact points, opportunities and scores,
 * so one delete clears the graph; `evidence` has no FK to a company (its
 * subject is polymorphic) and is cleared separately. */

const { error: evidenceDeleteError } = await db
  .from("evidence")
  .delete()
  .eq("org_id", org.id);
fail("clearing evidence", evidenceDeleteError);

const { error: companyDeleteError } = await db
  .from("companies")
  .delete()
  .eq("org_id", org.id);
fail("clearing companies", companyDeleteError);

let opportunityCount = 0;
let evidenceCount = 0;

for (const c of COMPANIES) {
  const company = must(
    `creating company ${c.name}`,
    await db
      .from("companies")
      .insert({
        org_id: org.id,
        canonical_domain: c.canonical_domain,
        name: c.name,
        website: c.website,
        industry: c.industry,
        employee_count: c.employee_count,
        country: c.country,
        region: c.region,
        business_model: c.business_model,
        description: c.description,
        tech_stack: c.tech_stack,
        last_researched_at: c.opportunity.first_seen_at,
      })
      .select("id")
      .single(),
  );

  // People before the opportunity: `primary_person_id` points at one of them.
  const peopleByName = new Map<string, string>();
  for (const p of c.people) {
    const person = must(
      `creating person ${p.first_name} ${p.last_name}`,
      await db
        .from("people")
        .insert({
          org_id: org.id,
          company_id: company.id,
          first_name: p.first_name,
          last_name: p.last_name,
          title: p.title,
          seniority: p.seniority,
          linkedin_url: p.linkedin_url,
          is_decision_maker: p.is_decision_maker,
          source: "seed",
        })
        .select("id")
        .single(),
    );
    peopleByName.set(`${p.first_name} ${p.last_name}`, person.id);

    // §25: an address is a claim with provenance. No address is a real answer,
    // and the row is simply absent rather than present-and-empty.
    if (p.email) {
      const { error } = await db.from("contact_points").insert({
        org_id: org.id,
        person_id: person.id,
        kind: "email",
        value: p.email,
        verification_status: "verified",
        confidence: p.email_confidence,
        provider: "seed",
        verified_at: new Date().toISOString(),
      });
      fail(`creating contact point for ${p.first_name}`, error);
    }
    if (p.linkedin_url) {
      const { error } = await db.from("contact_points").insert({
        org_id: org.id,
        person_id: person.id,
        kind: "linkedin",
        // Unique on (org_id, kind, value): two seeded people sharing the
        // placeholder LinkedIn URL would collide, so make it per-person.
        value: `${p.linkedin_url}in/${p.first_name}-${p.last_name}`.toLowerCase(),
        verification_status: "unverified",
        confidence: null,
        provider: "seed",
      });
      fail(`creating linkedin contact point for ${p.first_name}`, error);
    }
  }

  const o = c.opportunity;
  const opportunity = must(
    `creating opportunity for ${c.name}`,
    await db
      .from("opportunities")
      .insert({
        org_id: org.id,
        company_id: company.id,
        icp_id: icp.id,
        primary_person_id: o.primary_person
          ? (peopleByName.get(o.primary_person) ?? null)
          : null,
        priority: o.priority,
        priority_reason: o.priority_reason,
        status: o.status,
        confidence: o.confidence,
        why_this_company: o.why_this_company,
        identified_problem: o.identified_problem,
        potential_gap: o.potential_gap,
        why_now: o.why_now,
        current_approach: o.current_approach,
        potential_use_case: o.potential_use_case,
        outreach_angle: o.outreach_angle,
        first_seen_at: o.first_seen_at,
      })
      .select("id")
      .single(),
  );
  opportunityCount++;

  const { error: scoreError } = await db.from("opportunity_scores").insert({
    org_id: org.id,
    opportunity_id: opportunity.id,
    model_version: "seed-1",
    ...c.score,
    computed_at: o.first_seen_at,
  });
  fail(`creating score for ${c.name}`, scoreError);

  // Evidence is attached to the opportunity, because that is what the §47
  // page asks it to justify. `tag` is a seed-local handle so a trigger can
  // name the evidence that established it.
  const evidenceByTag = new Map<string, string>();
  for (const e of c.evidence) {
    const row = must(
      `creating evidence for ${c.name}`,
      await db
        .from("evidence")
        .insert({
          org_id: org.id,
          subject_type: "opportunity",
          subject_id: opportunity.id,
          claim: e.claim,
          kind: e.kind,
          // The migration's CHECK rejects a confidence on an `unknown`: high
          // confidence that we don't know is a category error.
          confidence: e.kind === "unknown" ? null : (e.confidence ?? null),
          source_url: e.source_url ?? null,
          excerpt: e.excerpt ?? null,
          event_date: e.event_date ?? null,
          observed_at: e.observed_at ?? new Date().toISOString(),
        })
        .select("id")
        .single(),
    );
    evidenceCount++;
    if (e.tag) evidenceByTag.set(e.tag, row.id);
  }

  for (const t of c.triggers) {
    const { error } = await db.from("company_triggers").insert({
      org_id: org.id,
      company_id: company.id,
      trigger_type: t.trigger_type,
      event_date: t.event_date,
      strength: t.strength,
      evidence_id: t.evidence_tag ? (evidenceByTag.get(t.evidence_tag) ?? null) : null,
    });
    fail(`creating trigger for ${c.name}`, error);
  }

  console.log(
    `company       ${c.name.padEnd(20)} ${o.priority.padEnd(6)} ` +
      `${c.evidence.length} evidence · ${c.triggers.length} triggers · ${c.people.length} people`,
  );
}

console.log(
  `\nSeeded ${COMPANIES.length} companies, ${opportunityCount} opportunities, ` +
    `${evidenceCount} evidence rows into "${SLUG}".\n` +
    `Undo with:  npm run seed --workspace @huntloop/db -- --reset\n`,
);
