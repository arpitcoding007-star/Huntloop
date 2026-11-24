/* eslint-disable */
// Vendor simulator. Shapes follow each adapter's own types; state is inspectable at /__state.
import { createServer } from "node:http";
const S = { calls: {}, sent: [], mail: [], hubspot: { companies: {}, contacts: {}, deals: {}, assoc: 0 }, inbox: [], outlookSent: [], outlookInbox: [], fail: {}, ai: {}, history: 100 };
const ORGS = [["org1","Cloudflare","cloudflare.com"],["org2","Linear","linear.app"],["org3","Vercel","vercel.com"],["org4","Plausible Analytics","plausible.io"],["org5","Basecamp","basecamp.com"]].map(([id,name,d],i)=>({id,name,primary_domain:d,website_url:"https://"+d,short_description:name+" software",industry:"computer software",estimated_num_employees:60+i*40,country:"United States",state:"California",city:"San Francisco",founded_year:2012+i,technology_names:["Postgres","React"],latest_funding_stage:"Series B",total_funding:30000000,latest_funding_round_date:"2026-10-20"}));
const PEOPLE=(o)=>[{id:o+"-p1",first_name:"Dana",last_name:"Okonkwo",title:"VP Finance",seniority:"vp",departments:["finance"],linkedin_url:"https://linkedin.com/in/dana-"+o},{id:o+"-p2",first_name:"Maria",last_name:"Kovacs",title:"Head of Operations",seniority:"head",departments:["operations"]}];
// ---- model
function pick(schema, key, ctx) {
  if (!schema) return "x";
  if (schema.enum) return choose(schema.enum, key, ctx);
  if (schema.anyOf) { const nn = schema.anyOf.filter((s) => s.type !== "null"); if (!nn.length) return null; if (key==="confidence"||key==="urgency") return pick(nn[0],key,ctx); return pick(nn[0], key, ctx); }
  switch (schema.type) {
    case "object": { const o = {}; for (const k of Object.keys(schema.properties ?? {})) o[k] = pick(schema.properties[k], k, ctx); return fix(o, ctx); }
    case "array": {
      if (schema.maxItems === 0) return [];
      const it = schema.items ?? {};
      if (it.enum) { if (!it.enum.length) return []; return it.enum.slice(0, Math.max(schema.minItems ?? 1, 1)).slice(0, schema.maxItems ?? 9); }
      const ek = it.properties && ["field","label"].find((k) => it.properties[k]?.enum);
      if (ek && it.properties[ek].enum.length > 3 && it.properties[ek].enum.length < 12 && key !== "events") return it.properties[ek].enum.map((v) => { const o = pick(it, "", ctx); o[ek] = v; return o; });
      return [pick(it, key, ctx)];
    }
    case "integer": case "number": return key === "score" ? 84 : key === "weight" ? 10 : Math.min(schema.maximum ?? 72, 72);
    case "boolean": return true;
    case "null": return null;
    default: return text(key, ctx);
  }
}
function choose(e, key, ctx) {
  const want = { priority: "hot", kind: ctx.task==="qualify"||ctx.task==="research"?"inference":undefined, confidence: "high", scoreConfidence: "medium", direction: "buy", effect: "adjust", op: "contains", field: ctx.task==="rules"?"industry":undefined, eventType: "funding", urgency: "this_week" }[key];
  if (ctx.task === "classify" && key === "label") return ctx.reply;
  if (ctx.task === "classify" && key === "kind") return "request";
  return e.includes(want) ? want : e.find((x)=>x!=="none") ?? e[0];
}
function fix(o, ctx) {
  if ("kind" in o && "sourceUrl" in o && "claim" in o) { o.kind = ctx.site ? "fact" : "inference"; o.sourceUrl = ctx.site ?? null; o.excerpt = null; if(o.kind==="inference")o.confidence="medium"; }
  else if ("kind" in o && "sourceUrl" in o) { o.kind = "inference"; o.sourceUrl = null; o.confidence = "medium"; }
  if ("intent" in o && "effect" in o) { o.effect="adjust"; o.weight = 10; o.floorPriority = null; }
  return o;
}
const T = { companyName: "Audit Company", competitorName: "Rival Example", summary: "A team that fits the profile.", answer: "The record shows a hiring signal and no conversation yet.", subject: "Your finance hiring", body: "I saw that your team is hiring in finance. We run bookkeeping for software companies. Would a short call help?", reason: "The team announced a raise and is hiring in finance.", explanation: "Fits the profile on sector and size.", priorityReason: "Recent raise and an open finance role.", recommendation: "Contact the finance lead.", question: "How many do you need?", title: "Bookkeeping for multi-entity companies", description: "Announced a new funding round.", name: "Software companies", headline: "Funding signals answer more often", detail: "Seen in the recorded outcomes.", text: "Replies came from one segment.", statement: "Needs multi-entity consolidation.", url: "https://hnrss.org/newest?points=200", claim: "Is hiring in finance.", value: "Software", content: "Keep emails under ninety words.", key: "tone.short", companyDomain: null, eventDate: "2026-11-20" };
function text(key, ctx) { if (key === "excerpt") return ctx.excerpt; if (key === "companyName" && ctx.task==="signals") return ctx.headlineCo; if (key==="companyDomain") return ctx.domain ?? "stripe.com"; if(key==="value"&&ctx.task==="rules")return "Software"; return T[key] ?? "Audit text for " + key; }
function model(b) {
  const schema = b.output_config?.format?.schema ?? { type: "object", properties: {} };
  const p = schema.properties ?? {}; const prompt = JSON.stringify(b.messages ?? []);
  const raw = (b.messages ?? []).map((m) => typeof m.content === "string" ? m.content : (m.content ?? []).map((c) => c.text ?? "").join("\n")).join("\n");
  const task = p.dimensions ? "qualify" : p.findings && !p.companyName ? "learn/competitor" : p.companyName && p.findings ? "research" : p.events ? "signals" : p.demand && p.needsHuman ? "classify" : p.rules ? "rules" : p.citedEvidenceIds ? "write" : p.assignments ? "cluster" : Object.keys(p).join("+").slice(0, 60);
  S.ai[task] = (S.ai[task] ?? 0) + 1;
  const ctx = { task };
  if (task === "classify") ctx.reply = /not interested/i.test(raw) ? "negative" : /wrong person|not the right person/i.test(raw) ? "wrong_person" : /out of office/i.test(raw) ? "out_of_office" : "positive";
  const m = raw.match(/https?:\/\/[^\s"'<>)\]]+/); if (task === "qualify") ctx.site = m?.[0];
  if (task === "signals") { const body = raw.replace(/\s+/g, " "); ctx.excerpt = (body.match(/[A-Z][A-Za-z0-9 ,'-]{40,110}/g) ?? [body.slice(200, 300)]).sort((a, b2) => b2.length - a.length)[0]; ctx.headlineCo = "Stripe"; ctx.domain = null; }
  let out = pick(schema, "", ctx);
  if (task === "signals" && out.events?.[0]) { out.events[0].companyName = "GitHub"; out.events[0].companyDomain = "github.com"; }
  if (task === "research" || (p.findings && p.competitorName)) out.findings = out.findings.filter((f, i, a) => a.findIndex((g) => g.field === f.field) === i);
  if (task === "cluster") { const ids = p.newThemes.items.properties.signalIds.items.enum; out = { assignments: [], newThemes: ids.length >= 2 ? [{ title: T.title, kind: "request", description: "Asked for by several prospects.", signalIds: ids.slice(0, 2) }] : [] }; }
  if (p.summary && p.suggestions) out.suggestions = [];
  return out;
}
const json = (res, body, code = 200) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
createServer((req, res) => {
  let body = ""; req.on("data", (c) => (body += c));
  req.on("end", () => {
    const u = new URL(req.url, "http://x"); const path = u.pathname; const J = () => { try { return JSON.parse(body || "{}"); } catch { return {}; } };
    const k = req.method + " " + path.replace(/[0-9a-f-]{20,}/g, ":id"); S.calls[k] = (S.calls[k] ?? 0) + 1;
    if (path === "/__state") return json(res, S);
    if (path === "/__inbox") { const m = J(); m.id = "in" + Date.now() + Math.random().toString(36).slice(2, 6); S.inbox.push(m); S.history++; return json(res, { id: m.id }); }
    if (path === "/__fail") { S.fail = J(); return json(res, {}); }
    for (const [host, code] of Object.entries(S.fail)) if (path.includes(host)) return json(res, { error: "simulated" }, code);
    if (path.endsWith("/v1/messages") && !path.includes("gmail")) {
      const b = J(); let t; try { t = JSON.stringify(model(b)); } catch (e) { t = "{}"; S.modelErr = String(e.stack); }
      const msg = { id: "msg_a", type: "message", role: "assistant", model: b.model, content: [{ type: "text", text: t }], stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 900, output_tokens: 300, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } };
      if (!b.stream) return json(res, msg);
      res.writeHead(200, { "content-type": "text/event-stream" }); const ev = (type, d) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...d })}\n\n`);
      ev("message_start", { message: { ...msg, content: [], stop_reason: null } }); ev("content_block_start", { index: 0, content_block: { type: "text", text: "" } }); ev("content_block_delta", { index: 0, delta: { type: "text_delta", text: t } }); ev("content_block_stop", { index: 0 }); ev("message_delta", { delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 300 } }); ev("message_stop", {}); return res.end();
    }
    if (path.startsWith("/api.apollo.io")) {
      const b = J();
      if (path.endsWith("/mixed_companies/search")) { const only = b.q_organization_name; const list = only ? ORGS.filter((o) => o.name === only) : ORGS; return json(res, { organizations: list.slice(0, b.per_page), pagination: { total_entries: 1240, total_pages: 1 } }); }
      if (path.endsWith("/organizations/enrich")) return json(res, { organization: ORGS.find((o) => o.primary_domain === (b.domain ?? u.searchParams.get("domain"))) ?? { ...ORGS[0], id: "orgx", name: b.domain, primary_domain: b.domain } });
      if (path.endsWith("/mixed_people/search")) return json(res, { people: PEOPLE(String(b.organization_ids?.[0] ?? "o")), pagination: { total_entries: 2, total_pages: 1 } });
      if (path.endsWith("/people/match")) return json(res, { person: null });
      if (path.includes("/job_postings")) return json(res, { job_postings: [{ id: "j1", title: "Senior Finance Manager", department: "finance", city: "Austin", country: "United States", url: "https://jobs.example.com/j1", posted_at: new Date().toISOString() }], pagination: { total_entries: 1, total_pages: 1 } });
    }
    if (path.startsWith("/api.hunter.io")) { if (path.endsWith("/account")) return json(res, { data: {} }); return json(res, { data: { email: `${u.searchParams.get("first_name")}.${u.searchParams.get("last_name")}@${u.searchParams.get("domain")}`.toLowerCase(), score: 95, sources: [{}] } }); }
    if (path.startsWith("/api.zerobounce.net")) return json(res, path.endsWith("getcredits") ? { Credits: "100" } : { status: "valid", sub_status: "" });
    if (path.startsWith("/oauth2.googleapis.com")) return json(res, { access_token: "ga", refresh_token: "gr", expires_in: 3600 });
    if (path.startsWith("/login.microsoftonline.com")) return json(res, { access_token: "ma", refresh_token: "mr", expires_in: 3600 });
    if (path.startsWith("/gmail.googleapis.com")) {
      const p = path.replace("/gmail.googleapis.com/gmail/v1/users/me", "");
      if (p === "/profile") return json(res, { emailAddress: "founder@gmail.com", historyId: String(S.history) });
      if (p === "/messages/send") { const b = J(); const mime = Buffer.from(b.raw, "base64url").toString(); const id = "g" + (S.sent.length + 1); S.sent.push({ id, threadId: b.threadId ?? "t" + id, mime }); return json(res, { id, threadId: b.threadId ?? "t" + id }); }
      if (p === "/history") return json(res, { history: S.inbox.map((m, i) => ({ id: String(101 + i), messagesAdded: [{ message: { id: m.id } }] })), historyId: String(S.history) });
      if (p === "/messages") return json(res, { messages: S.inbox.map((m) => ({ id: m.id })) });
      const m = p.match(/^\/messages\/([^?]+)/); if (m) { const i = S.inbox.find((x) => x.id === m[1]); if (i) return json(res, { id: i.id, threadId: i.threadId, internalDate: String(Date.now()), payload: { mimeType: "text/plain", headers: [{ name: "From", value: i.from }, { name: "To", value: "founder@gmail.com" }, { name: "Subject", value: i.subject ?? "Re" }, { name: "Message-Id", value: `<${i.id}@x>` }], body: { data: Buffer.from(i.text).toString("base64url") } } }); return json(res, { id: m[1], payload: { headers: [{ name: "Message-Id", value: `<${m[1]}@gmail>` }] } }); }
    }
    if (path.startsWith("/graph.microsoft.com")) { const p = path.replace("/graph.microsoft.com/v1.0", ""); if (p === "/me") return json(res, { mail: "seller@outlook.com", userPrincipalName: "seller@outlook.com" }); if (req.method === "POST" && p === "/me/messages") return json(res, { id: "o1", conversationId: "oc1", internetMessageId: "<o1@x>" }, 201); if (/send$/.test(p) || /sendMail/.test(p)) { S.outlookSent.push(body.slice(0, 2000)); res.writeHead(202); return res.end(); } if (/delta/.test(p)) return json(res, { value: S.outlookInbox, "@odata.deltaLink": "https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?t=1" }); return json(res, { id: "o1", conversationId: "oc1", internetMessageId: "<o1@x>" }); }
    if (path.startsWith("/api.resend.com")) { const b = J(); S.mail.push(b); return json(res, { id: "re" + S.mail.length }); }
    if (path.startsWith("/api.hubapi.com")) {
      const H = S.hubspot; if (path.includes("account-info")) return json(res, { portalId: 4242 }); if (path.includes("oauth")) return json(res, { hub_id: 4242 });
      if (path.includes("/pipelines/")) return json(res, { results: [{ stages: [{ id: "appointmentscheduled", label: "Appointment scheduled" }] }] });
      if (path.includes("/properties/")) return json(res, {}, 201);
      const m = path.match(/objects\/(companies|contacts|deals)(?:\/([^/]+))?(?:\/associations.*)?$/);
      if (path.includes("associations")) { H.assoc++; return json(res, {}); }
      if (m && m[2] === "search") return json(res, { total: 0, results: [] });
      if (m && req.method === "POST") { const id = String(1000 + Object.keys(H[m[1]]).length); H[m[1]][id] = J().properties; return json(res, { id }, 201); }
      if (m && req.method === "GET" && m[2]) return json(res, { id: m[2], properties: { dealstage: "appointmentscheduled" } });
      return json(res, { results: [] });
    }
    json(res, { error: "unhandled " + k }, 404);
  });
}).listen(3196, "127.0.0.1", () => console.log("vendors ready"));
