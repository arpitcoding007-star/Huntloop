/**
 * Runs every loader's SELECT against the live project, and reports which ones
 * PostgREST can answer.
 *
 * The roadmap records the failure this exists to prevent: "a query that reads
 * as finished and has never returned a row". Three of the opportunity loader's
 * joins were wrong in ways only running them revealed — an embed PostgREST
 * cannot follow, a uuid compared against a URL segment, and soft deletes
 * filtered at one level of a two-level result. None of those are type errors,
 * and none of them fail a build.
 *
 * So this is not a test of the data. It is a test of the *shapes*: every
 * embed resolvable, every column real. It uses the secret key and therefore
 * bypasses RLS, which is exactly right for the question being asked — whether
 * PostgREST can parse and plan the query — and exactly wrong for any other,
 * so it stays a development script and is never imported by the app.
 *
 *   node scripts/check-queries.mjs
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

for (const line of readFileSync("apps/web/.env.local", "utf8").split(/\r?\n/)) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
  if (m && m[2]) process.env[m[1]] ??= m[2].trim().replace(/^["']|["']$/g, "");
}

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY,
  { auth: { persistSession: false } },
);

/** Each entry is the loader it comes from, its table, and its exact select. */
const QUERIES = [
  ["organization.getOrganization", "organizations", "id, name, slug, plan_id, trial_ends_at, created_at, settings"],
  ["product.listProducts", "products", "id, name, website, description, value_props, proof_points, updated_at"],
  [
    "icp.listIcps",
    "icps",
    `id, name, product_id, criteria, negative_criteria, is_active, version, updated_at,
     personas(id, name, title_patterns, seniority, pain_points, deleted_at)`,
  ],
  ["icp.getActiveIcp", "icps", "criteria, negative_criteria, products(description)"],
  [
    "company.listCompanies",
    "companies",
    `id, name, canonical_domain, website, industry, employee_count,
     country, region, business_model, description, last_researched_at,
     opportunities(id, priority, deleted_at),
     people(id, deleted_at)`,
  ],
  [
    "hunt-source.listHuntSources",
    "sources",
    `id, name, kind, url, is_enabled, recommended_by, status,
     failure_count, last_scanned_at, last_error`,
  ],
  ["hunt-source.evidenceCounts", "evidence", "source_id"],
  ["team.listMembers", "memberships", "id, user_id, role, created_at"],
  [
    "team.listAssignments",
    "opportunities",
    "id, priority, priority_reason, status, owner_id, companies!inner(name)",
  ],
  [
    "outreach.getOutreach campaigns",
    "campaigns",
    `id, name, status, autonomy_level, icp_id, product_id, started_at, updated_at,
     enrollments(id, deleted_at),
     sequences(id, name, version, deleted_at,
       sequence_steps(id, position, kind, delay_hours, template, deleted_at))`,
  ],
  [
    "outreach.getOutreach mailboxes",
    "mailboxes",
    `id, email, provider, display_name, status, daily_limit, sent_today,
     health_score, warmup_stage`,
  ],
  [
    "inbox.listThreads",
    "threads",
    `id, subject, status, classification, opportunity_id, last_message_at,
     messages(id, direction, subject, body_text, ai_generated, evidence_ids,
       sent_at, scheduled_at, created_at, deleted_at,
       message_events(kind, occurred_at))`,
  ],
  [
    "intelligence.evidence",
    "evidence",
    "id, claim, kind, confidence, source_url, excerpt, event_date, observed_at, subject_type",
  ],
  [
    "intelligence.triggers",
    "company_triggers",
    "id, trigger_type, event_date, strength, companies!inner(name)",
  ],
  [
    "intelligence.decisions",
    "ai_decisions",
    "id, decision_type, confidence, created_at, human_override, overridden_at",
  ],
  [
    "memory.listMemories",
    "memories",
    "id, scope, scope_id, kind, key, content, source, confidence, created_by, expires_at, created_at",
  ],
  ["imports.companies by domain", "companies", "id, canonical_domain"],
  ["imports.contact_points", "contact_points", "value"],
  ["imports.people", "people", "first_name, last_name, company_id"],
];

let failed = 0;

for (const [name, table, select] of QUERIES) {
  const { data, error } = await db.from(table).select(select).limit(1);
  if (error) {
    failed++;
    console.log(`  [FAIL] ${name.padEnd(34)} ${error.message}`);
  } else {
    console.log(`  [ ok ] ${name.padEnd(34)} ${data?.length ?? 0} row(s)`);
  }
}

console.log(
  `\n${QUERIES.length} queries · ${failed} that PostgREST cannot answer`,
);
process.exit(failed === 0 ? 0 : 1);
