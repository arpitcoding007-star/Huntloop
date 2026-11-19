#!/usr/bin/env node
/**
 * Drive the rate limiter over HTTP, concurrently (debt #15).
 *
 * The limiter is proven inside the database (`verify-migrations.ts`) and by
 * nothing driving it through PostgREST the way the app does. This fires N
 * concurrent `consume_rate_limit` calls as one signed-in member and checks
 * the two things that matter under load:
 *
 *   · admission: no more calls are allowed than the limit, however many
 *     arrive at once (the counter is one statement, not read-then-write);
 *   · latency: p50/p95/max of the call that guards every paid action.
 *
 * It spends nothing. The action name is `load_test`, which no product path
 * uses, so the rows it writes do not eat a real quota; `prune_rate_limits`
 * clears them within a day.
 *
 * Run against STAGING, as a test member of a test workspace:
 *
 *   SUPABASE_URL=https://<ref>.supabase.co \
 *   SUPABASE_ANON_KEY=<publishable key> \
 *   ACCESS_TOKEN=<a test user's access token> \
 *   ORG_ID=<a workspace that user belongs to> \
 *   node scripts/load-rate-limit.mjs [--requests 200] [--concurrency 50] [--limit 20]
 *
 * Exit 1 if more calls were admitted than the limit, or any call errored.
 */

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? Number(process.argv[i + 1]) : fallback;
};

const url = process.env.SUPABASE_URL?.replace(/\/$/, "");
const key = process.env.SUPABASE_ANON_KEY;
const token = process.env.ACCESS_TOKEN;
const org = process.env.ORG_ID;
if (!url || !key || !token || !org) {
  console.error("Set SUPABASE_URL, SUPABASE_ANON_KEY, ACCESS_TOKEN and ORG_ID. See the header of this file.");
  process.exit(2);
}

const requests = arg("requests", 200);
const concurrency = arg("concurrency", 50);
const limit = arg("limit", 20);
/* A fresh window per run, so a second run is not refused by the first. */
const action = `load_test_${Date.now()}`;

async function one() {
  const started = performance.now();
  const response = await fetch(`${url}/rest/v1/rpc/consume_rate_limit`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ p_org: org, p_action: action, p_limit: limit, p_window_seconds: 3600, p_per_user: true }),
  });
  const ms = performance.now() - started;
  if (!response.ok) return { ms, error: `HTTP ${response.status}: ${(await response.text()).slice(0, 200)}` };
  const body = await response.json();
  const row = Array.isArray(body) ? body[0] : body;
  return { ms, allowed: Boolean(row?.allowed) };
}

const results = [];
let next = 0;
const started = performance.now();
await Promise.all(
  Array.from({ length: Math.min(concurrency, requests) }, async () => {
    while (next < requests) {
      next++;
      results.push(await one().catch((e) => ({ ms: 0, error: String(e) })));
    }
  }),
);
const wall = performance.now() - started;

const errors = results.filter((r) => r.error);
const allowed = results.filter((r) => r.allowed).length;
const times = results.filter((r) => !r.error).map((r) => r.ms).sort((a, b) => a - b);
const pct = (p) => (times.length ? times[Math.min(times.length - 1, Math.floor((p / 100) * times.length))].toFixed(0) : "—");

console.log(`requests ${requests} · concurrency ${concurrency} · limit ${limit} · ${(wall / 1000).toFixed(1)} s`);
console.log(`admitted ${allowed} · refused ${requests - allowed - errors.length} · errors ${errors.length}`);
console.log(`latency ms  p50 ${pct(50)} · p95 ${pct(95)} · max ${pct(100)}`);
if (errors.length) console.log(`first error: ${errors[0].error}`);

const overAdmitted = allowed > limit;
if (overAdmitted) console.error(`FAIL — ${allowed} admitted against a limit of ${limit}: the counter races.`);
if (errors.length) console.error("FAIL — calls errored; see above.");
if (!overAdmitted && !errors.length) console.log(`PASS — exactly ${allowed} of ${limit} admitted under ${concurrency}-way concurrency.`);
process.exit(overAdmitted || errors.length ? 1 : 0);
