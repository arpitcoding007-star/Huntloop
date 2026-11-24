/**
 * A whole marketplace, simulated: real migrations, real row security, the real
 * supabase-js client and the real job handlers, with synthetic people and no
 * network (see `packages/db/testing/local-backend.ts` for the isolation).
 *
 *   npm run test:simulation -w @huntloop/jobs   (part of `npm test`)
 */
import { createClient } from "@supabase/supabase-js";
import { ANON_KEY, LocalBackend, SERVICE_KEY } from "../../db/testing/local-backend.ts";

const realFetch = globalThis.fetch;
const backend = await LocalBackend.start();
const url = await backend.listen();

/* Nothing in this process may leave the machine, whatever the shell exports. */
for (const k of ["ANTHROPIC_API_KEY", "INNGEST_EVENT_KEY", "APOLLO_API_KEY", "HUNTER_API_KEY", "ZEROBOUNCE_API_KEY"]) delete process.env[k];
process.env.NEXT_PUBLIC_SUPABASE_URL = url;
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = ANON_KEY;
process.env.SUPABASE_SECRET_KEY = SERVICE_KEY;
process.env.HUNTLOOP_EXCHANGE = "on";
process.env.NEXT_PUBLIC_SITE_URL = "https://huntloop.example";
process.env.RESEND_API_KEY = "re_synthetic";
process.env.EMAIL_FROM = "Huntloop <mail@huntloop.example>";
process.env.MAILBOX_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");

const mail: { to: string; subject: string; text: string }[] = [];
const escaped: string[] = [];
/** Set only while a check needs a model; everything else runs without one. */
let modelAnswer: unknown = null;
const modelReply = (answer: unknown) => {
  const message = { id: "msg_sim", type: "message", role: "assistant", model: "claude-opus-5-5", stop_reason: null, stop_sequence: null, content: [], usage: { input_tokens: 10, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } };
  const events: [string, object][] = [
    ["message_start", { message }],
    ["content_block_start", { index: 0, content_block: { type: "text", text: "" } }],
    ["content_block_delta", { index: 0, delta: { type: "text_delta", text: JSON.stringify(answer) } }],
    ["content_block_stop", { index: 0 }],
    ["message_delta", { delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 10 } }],
    ["message_stop", {}],
  ];
  return new Response(events.map(([type, data]) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`).join(""), { status: 200, headers: { "content-type": "text/event-stream" } });
};
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const to = String(input instanceof Request ? input.url : input);
  if (to.startsWith(url)) return realFetch(input, init);
  if (to.startsWith("https://api.resend.com/")) {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    mail.push({ to: String(Array.isArray(body.to) ? body.to[0] : body.to), subject: String(body.subject), text: JSON.stringify(body) });
    return new Response(JSON.stringify({ id: `synthetic-${mail.length}` }), { status: 200, headers: { "content-type": "application/json" } });
  }
  if (to.startsWith("https://api.anthropic.com/") && modelAnswer) return modelReply(modelAnswer);
  escaped.push(to);
  throw new TypeError("fetch failed (simulation: no network)");
}) as typeof fetch;

const { sweep, tick } = await import("../src/runner.ts");
const { OrgScope } = await import("../src/scope.ts");
const { bounceHealth, repliedSinceLastSend } = await import("../src/handlers/send-message.ts");
const { HANDLERS } = await import("../src/registry.ts");
const { loadSourcePerformance } = await import("../src/handlers/analyze-performance.ts");
const { SCORE_DIMENSIONS } = await import("@huntloop/ai");

let failures = 0;
let checks = 0;
const check = (name: string, good: boolean, detail: unknown = "") => {
  checks += 1;
  if (!good) failures += 1;
  console.log(`  ${good ? "✓" : "✗"} ${name}${good ? "" : `\n      ${typeof detail === "string" ? detail : JSON.stringify(detail)}`}`);
};
const eq = (name: string, got: unknown, want: unknown) => check(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`);

/**
 * Two ticks' worth: queue every sweeper and work until the queue is dry, twice,
 * because what one sweeper makes (a match) the next tick's reports (an alert).
 */
async function engine(passes = 2) {
  for (let p = 0; p < passes; p++) {
    await backend.sql(`delete from job_executions where status = 'succeeded'`);
    await sweep();
    for (let i = 0; i < 60; i++) {
      const r = await tick({ limit: 20, reserveMs: 0, deadline: new Date(Date.now() + 120_000) });
      if (r.claimed === 0) break;
    }
  }
}
const failedJobs = () => backend.sql<{ job_name: string; error: string }>(`select distinct job_name, coalesce(error::text, '') as error from job_executions where status not in ('queued', 'running', 'succeeded')`);
const as = (u: { token: string }) => createClient(url, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${u.token}` } } });
/* ── People and workspaces ───────────────────────────────────────────────── */
const person = async (name: string, org: string) => {
  const u = await backend.addUser(`${name}@${org}.test`);
  const db = as(u);
  const { data, error } = await db.rpc("create_organization", { p_name: `${org} Ltd`, p_slug: org, p_domain: `${org}.test` });
  if (error) throw new Error(`create_organization ${org}: ${error.message}`);
  return { ...u, db, orgId: String(data), org };
};
console.log("\nEvery sweep on an empty database");
await engine();
eq("succeeds", await failedJobs(), []);

console.log("\nA market");
const buyer = await person("bea", "buyer-co");
const seller = await person("sam", "seller-co");
const rival = await person("rae", "rival-co");
const stranger = await person("sid", "stranger-co");
const cat = (await backend.sql<{ id: string }>(`select id from exchange_categories where slug = 'gpus-accelerators'`))[0]!.id;
await backend.sql(`update exchange_categories set matching_enabled = true where id = $1`, [cat]);

const must = async <T>(what: string, p: PromiseLike<{ data: T; error: { message: string } | null }>): Promise<T> => {
  const { data, error } = await p;
  if (error) throw new Error(`${what}: ${error.message}`);
  return data;
};
const list = async (p: typeof seller, title: string, extra: Record<string, unknown> = {}) => {
  let profile = (await must("profile", p.db.from("exchange_provider_profiles").select("id").eq("org_id", p.orgId).maybeSingle())) as { id: string } | null;
  profile ??= (await must("profile", p.db.from("exchange_provider_profiles").insert({ org_id: p.orgId, name: `${p.org} supply`, source: "claimed", claimed_at: new Date().toISOString() }).select("id").single())) as { id: string };
  return (await must("offering", p.db.from("exchange_offerings").insert({ provider_id: profile.id, category_id: cat, title, status: "active", serves_global: true, ...extra }).select("id").single())) as { id: string };
};
const file = async (p: typeof buyer, summary: string, extra: Record<string, unknown> = {}) =>
  ((await must("need", p.db.from("exchange_needs").insert({ org_id: p.orgId, category_id: cat, summary, requirement: {}, visibility: 2, status: "open", ...extra }).select("id").single())) as { id: string }).id;

await list(seller, "H100 accelerator cards", { moq: 10, price_from: 20000, price_to: 30000, currency: "EUR" });
await list(rival, "Refurbished accelerators", { serves_global: false, serves_countries: ["US"] });
const full = await file(buyer, "200 H100 cards for a Munich data centre", { quantity: 200, unit: "cards", budget_max: 5000000, currency: "EUR", country: "DE", timeline: "this_month" });
const vague = await file(buyer, "some accelerators");
const hidden = await file(buyer, "quietly looking", { visibility: 0 });
eq("purpose follows what people do", (await backend.sql<{ slug: string; purpose: string }>(`select slug, purpose from organizations where slug in ('buyer-co','seller-co') order by slug`)), [{ slug: "buyer-co", purpose: "both" }, { slug: "seller-co", purpose: "seller" }]);

await engine();
eq("no job failed", await failedJobs(), []);
const matches = await backend.sql<{ need: string; seller: boolean; rival: boolean }>(`select need_id as need, bool_or(provider_org_id = $1) as seller, bool_or(provider_org_id = $2) as rival from exchange_matches group by need_id`, [seller.orgId, rival.orgId]);
eq("the request in Germany reaches the global supplier and not the US-only one", matches.find((m) => m.need === full), { need: full, seller: true, rival: false });
check("a vague request is matched rather than lost", matches.some((m) => m.need === vague), matches);
const cards = (await must("cards", seller.db.rpc("exchange_matched_cards", { p_org: seller.orgId }))) as Record<string, unknown>[];
eq("the supplier sees the two visible requests, never the private one", [cards.length, cards.some((c) => c.need_id === hidden)], [2, false]);
check("as bands, with none of the buyer's words", !/Munich|buyer-co|5000000/.test(JSON.stringify(cards)), cards);
eq("one alert: the match with too little to score is a card, not an alert", (await backend.sql(`select need_id from exchange_notifications where org_id = $1 and kind = 'match_alert'`, [seller.orgId])), [{ need_id: full }]);
eq("the stranger has no card", await must("cards", stranger.db.rpc("exchange_matched_cards", { p_org: stranger.orgId })), []);

console.log("\nIntroduction to outcome");
const card = cards.find((c) => c.need_id === full)!;
const intro = String(await must("request intro", seller.db.rpc("exchange_request_intro", { p_match: card.match_id, p_message: "We can ship in two weeks." })));
await engine();
check("the buyer is emailed within a tick, naming the supplier", mail.some((m) => m.to === buyer.email && /would like to talk/.test(m.subject + m.text)), mail.map((m) => [m.to, m.subject]));
check("and no email to the supplier names the buyer", !mail.some((m) => m.to === seller.email && /buyer-co/i.test(m.text)), mail.filter((m) => m.to === seller.email));
const refusedBefore = backend.errors.length;
const early = await seller.db.rpc("exchange_send_message", { p_intro: intro, p_body: "hello?" });
check("no message before acceptance", !!early.error);
const nosy = await stranger.db.rpc("exchange_decide_intro", { p_intro: intro, p_accept: true });
check("nobody else can accept it", !!nosy.error || nosy.data === null);
backend.errors.splice(refusedBefore);
await must("accept", buyer.db.rpc("exchange_decide_intro", { p_intro: intro, p_accept: true }));
await must("message", buyer.db.rpc("exchange_send_message", { p_intro: intro, p_body: "Send a quote, please." }));
await engine();
eq("no job failed", await failedJobs(), []);
check("the supplier hears it was accepted, and who it is", mail.some((m) => m.to === seller.email && /buyer-co/i.test(m.text)), mail.map((m) => [m.to, m.subject]));
const opp = await backend.sql<{ id: string; origin: string }>(`select id, origin from opportunities where org_id = $1`, [seller.orgId]);
eq("it becomes an Exchange opportunity in the supplier's workspace", opp.map((o) => o.origin), ["exchange"]);
await must("share", buyer.db.rpc("exchange_share_contact", { p_intro: intro }));
const detail = JSON.stringify(await must("detail", seller.db.rpc("exchange_intro_detail", { p_intro: intro })));
check("the buyer's email appears once shared", detail.includes(buyer.email), detail);
await must("outcome", buyer.db.rpc("exchange_report_outcome", { p_intro: intro, p_outcome: "won", p_reason: null }));
await must("outcome", seller.db.rpc("exchange_report_outcome", { p_intro: intro, p_outcome: "lost", p_reason: "price" }));
eq("both sides' outcomes are kept when they disagree", (await backend.sql(`select side, outcome from exchange_outcomes where intro_id = $1 order by side`, [intro])), [{ side: "buyer", outcome: "won" }, { side: "provider", outcome: "lost" }]);
await engine();
eq("no job failed afterwards", await failedJobs(), []);
eq("the firewall holds: nothing was enriched, sequenced or drafted from it", (await backend.sql<{ n: number }>(`select (select count(*) from enrollments e where e.org_id = $1)::int + (select count(*) from messages m where m.org_id = $1 and m.direction = 'outbound')::int + (select count(*) from enrichment_records r where r.org_id = $1)::int as n`, [seller.orgId]))[0]!.n, 0);

console.log("\nPreferences, suspension, expiry and removal");
await must("prefs", seller.db.from("notification_preferences").upsert({ org_id: seller.orgId, user_id: seller.id, exchange_alerts: "off", exchange_emails: false }, { onConflict: "org_id,user_id" }));
const sentBefore = mail.filter((m) => m.to === seller.email).length;
await file(buyer, "another hundred H100 cards", { quantity: 100, country: "DE", timeline: "this_month", budget_max: 100000, currency: "EUR" });
await engine();
eq("alerts off means no alert", mail.filter((m) => m.to === seller.email).length, sentBefore);
const report = await must("report", seller.db.rpc("exchange_report", { p_subject_type: "intro", p_subject_id: intro, p_reason: "spam", p_detail: null }));
check("a party can report an introduction", report !== undefined);
const reportId = (await backend.sql<{ id: string }>(`select id from exchange_reports limit 1`))[0]!.id;
await backend.sql(`select exchange_resolve_report($1, 'suspend', 'synthetic')`, [reportId]);
eq("a suspended workspace's requests leave every card", ((await must("cards", seller.db.rpc("exchange_matched_cards", { p_org: seller.orgId }))) as unknown[]).length, 0);
await backend.sql(`select exchange_lift_suspension($1)`, [buyer.orgId]);
check("and return when it is lifted", ((await must("cards", seller.db.rpc("exchange_matched_cards", { p_org: seller.orgId }))) as unknown[]).length > 0);
await backend.sql(`update exchange_needs set decide_by = current_date - 30, created_at = now() - interval '90 days', last_confirmed_at = now() - interval '80 days' where id = $1`, [vague]);
await engine();
eq("a request past its date, unconfirmed, lapses", (await backend.sql<{ status: string }>(`select status from exchange_needs where id = $1`, [vague]))[0]!.status, "expired");
await must("remove", buyer.db.from("exchange_needs").update({ deleted_at: new Date().toISOString() }).eq("id", full));
await backend.sql(`update exchange_needs set deleted_at = now() - interval '31 days' where id = $1`, [full]);
await engine();
eq("a removed request is erased after 30 days", await backend.sql(`select 1 from exchange_needs where id = $1`, [full]), []);
eq("no job failed", await failedJobs(), []);

console.log("\nA crowd (more ids than one URL holds)");
await backend.sql(`insert into auth.users (email) select 'crowd' || i || '@crowd.test' from generate_series(1, 700) i`);
await backend.sql(`insert into organizations (id, name, slug) select gen_random_uuid(), 'Crowd ' || i, 'crowd-' || i from generate_series(1, 700) i`);
await backend.sql(`insert into memberships (org_id, user_id, role) select o.id, u.id, 'owner' from organizations o join auth.users u on u.email = replace(o.slug, '-', '') || '@crowd.test' where o.slug like 'crowd-%'`);
await backend.sql(`insert into exchange_provider_profiles (org_id, name, claimed_at) select id, name, now() from organizations where slug like 'crowd-%'`);
await backend.sql(`insert into exchange_offerings (provider_id, category_id, title, status, serves_global) select id, $1, 'H100 cards from ' || name, 'active', true from exchange_provider_profiles where name like 'Crowd %'`, [cat]);
await file(buyer, "H100 cards again", { quantity: 50, country: "FR", timeline: "this_month", budget_max: 900000, currency: "EUR" });
await backend.sql(`insert into notification_preferences (org_id, user_id, exchange_alerts, digest_hour, timezone) select m.org_id, m.user_id, 'digest', 0, 'UTC' from memberships m join organizations o on o.id = m.org_id where o.slug like 'crowd-%'`);
await engine();
eq("no job failed", await failedJobs(), []);
await backend.sql(`insert into exchange_notifications (org_id, user_id, kind, title, href, channel, dedupe_key) select m.org_id, m.user_id, 'match_alert', 'A buyer is looking', '/x', 'digest', 'crowd:' || m.user_id from memberships m join organizations o on o.id = m.org_id where o.slug like 'crowd-%' on conflict do nothing`);
for (let i = 0; i < 20; i++) {
  const r = await HANDLERS.send_exchange_notifications!({ scope: OrgScope.global() as never, payload: {}, job: {} as never, now: new Date() });
  if (!r.ok) check("the sender keeps going", false, r);
}
const crowdMail = mail.filter((m) => m.to.endsWith("@crowd.test"));
check("700 people with something waiting each get one email", crowdMail.length === 700 && new Set(crowdMail.map((m) => m.to)).size === crowdMail.length, `${crowdMail.length} emails, ${new Set(crowdMail.map((m) => m.to)).size} people`);

console.log(String.fromCharCode(10) + "Cold outreach: the checks before a send fail closed");
const C = (await backend.sql<{ id: string }>(`insert into companies (org_id, canonical_domain, name) values ($1, 'prospect.test', 'Prospect') returning id`, [rival.orgId]))[0]!.id;
check("a prospect is an ordinary company", !!C);
const box = (await backend.sql<{ id: string }>(`insert into mailboxes (org_id, email, provider, status) values ($1, 'rae@rival-co.test', 'gmail', 'connected') returning id`, [rival.orgId]))[0]!.id;
await backend.sql(`insert into messages (org_id, mailbox_id, direction, from_email, to_email, subject, body_text, sent_at, provider_message_id) select $1, $2, 'outbound', 'rae@rival-co.test', 'p' || i || '@prospect.test', 's', 'b', now(), 'out-' || i from generate_series(1, 120) i`, [rival.orgId, box]);
await backend.sql(`with m as (insert into messages (org_id, mailbox_id, direction, from_email, to_email, subject, body_text, sent_at, provider_message_id) select $1, $2, 'inbound', 'p' || i || '@prospect.test', 'rae@rival-co.test', 's', 'b', now(), 'in-' || i from generate_series(1, 600) i returning id), k as (select id, row_number() over () as n from m) insert into message_events (org_id, message_id, kind) select $1, id, 'bounced' from k where n <= 60`, [rival.orgId, box]);
const scope = new OrgScope(rival.orgId);
eq("a busy mailbox that bounces half its mail is paused", await bounceHealth({ scope } as never, box), { paused: true, sends: 120, bounces: 60 });
eq("a reply is seen", await repliedSinceLastSend({ scope } as never, "p400@prospect.test"), true);
eq("silence is silence", await repliedSinceLastSend({ scope } as never, "quiet@prospect.test"), false);

console.log("\nScoring and learning against the real schema (pass 22, V-04 and V-05)");
{
  const org = rival.orgId;
  const icpId = (await backend.sql<{ id: string }>(`insert into icps (org_id, name, is_active, criteria) values ($1, 'Profile', true, '{"segments":["Software"]}') returning id`, [org]))[0]!.id;
  const verdict = (priority: string, score: number) => ({
    companyName: "Prospect", priority, priorityReason: `Read as ${priority}.`, score, scoreConfidence: "medium",
    explanation: "Fits.", summary: `Summary ${score}.`, recommendation: "Write to them.", evidence: [{ claim: "Sells software", kind: "inference", confidence: "medium", sourceUrl: null, excerpt: null }],
    dimensions: SCORE_DIMENSIONS.map((label) => ({ label, value: 80, note: null })),
  });
  process.env.ANTHROPIC_API_KEY = "synthetic";
  const score = async (priority: string, n: number) => {
    modelAnswer = verdict(priority, n);
    return HANDLERS.score_opportunity!({ scope: new OrgScope(org), payload: { companyId: C, icpId }, job: {} as never, now: new Date() } as never);
  };
  const row = async () => (await backend.sql<{ id: string; priority: string; priority_reason: string; why: string; via: string }>(`select id, priority, priority_reason, why_this_company as why, discovered_via as via from opportunities where org_id = $1 and company_id = $2`, [org, C]));
  const first = await score("warm", 60);
  check("a new opportunity is scored", first.ok && (await row())[0]?.priority === "warm", [first, await row()]);
  await backend.sql(`update opportunities set discovered_via = 'import' where org_id = $1 and company_id = $2`, [org, C]);
  check("a rescore moves a priority the model set", (await score("hot", 80)).ok && (await row())[0]?.priority === "hot", await row());
  await backend.sql(`update opportunities set priority = 'watch', priority_reason = 'Too small', priority_set_by = 'user' where org_id = $1 and company_id = $2`, [org, C]);
  const kept = await score("hot", 91);
  check("a rescore succeeds after a person set the priority", kept.ok, kept);
  const [after, ...extra] = await row();
  eq("their priority and reason stay, the new read is stored, the origin is kept, and nothing is duplicated", [after?.priority, after?.priority_reason, after?.why, after?.via, extra.length], ["watch", "Too small", "Summary 91.", "import", 0]);
  eq("and every score is in the history", (await backend.sql<{ n: number }>(`select count(*)::int as n from opportunity_scores where opportunity_id = $1`, [after!.id]))[0]!.n, 3);
  modelAnswer = null;
  delete process.env.ANTHROPIC_API_KEY;

  const [src] = await backend.sql<{ id: string }>(`insert into sources (org_id, name, kind) values ($1, 'A feed', 'news') returning id`, [org]);
  await backend.sql(`insert into sources (org_id, name, kind) values ($1, 'A quiet feed', 'news')`, [org]);
  const [doc] = await backend.sql<{ id: string }>(`insert into source_documents (org_id, source_id, url, url_hash, content_hash) values ($1, $2, 'https://feed.test/a', 'h-sim', 'c-sim') returning id`, [org, src!.id]);
  await backend.sql(`insert into source_events (org_id, source_document_id, company_id, event_type, description) values ($1, $2, $3, 'funding', 'Raised')`, [org, doc!.id, C]);
  await backend.sql(`insert into outcomes (org_id, opportunity_id, kind, occurred_at) values ($1, $2, 'won', now())`, [org, after!.id]);
  const perf = await loadSourcePerformance({ scope: new OrgScope(org) });
  eq("a source is credited with what it found and won", perf.filter((p) => p.name === "A feed").map((p) => [p.companiesFound, p.opportunitiesCreated, p.outcomes, p.wins]), [[1, 1, 1, 1]]);
  eq("and a quiet one with nothing", perf.filter((p) => p.name === "A quiet feed").map((p) => [p.companiesFound, p.wins]), [[0, 0]]);
}

console.log("\nNothing unexpected happened on the way");
eq("no request left the machine", escaped, []);
check("the database refused nothing it was not expected to", backend.errors.length === 0, backend.errors.slice(0, 10).map((e) => `${e.method} ${e.path.slice(0, 160)} → ${e.status} ${e.message.slice(0, 200)}`).join("\n      "));
console.log(failures ? `\nFAIL — ${failures} of ${checks}` : `\nPASS — ${checks}/${checks}`);
await backend.stop();
process.exit(failures ? 1 : 0);
