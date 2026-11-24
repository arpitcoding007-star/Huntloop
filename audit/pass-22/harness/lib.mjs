/* eslint-disable */
import { chromium } from "playwright";
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
export const B = "http://127.0.0.1:3103";
const DOOR = "http://127.0.0.1:3198", V = "http://127.0.0.1:3196";
const door = async (b) => { const r = await fetch(DOOR, { method: "POST", body: JSON.stringify(b) }); if (!r.ok) throw new Error(await r.text()); return r.json(); };
export const sql = (text, args = []) => door({ op: "sql", text, args });
export const resetVendors = () => fetch(V + "/__fail", { method: "POST", body: "{}" });
await resetVendors();
export const refused = () => door({ op: "errors" });
export const person = (email) => door({ op: "user", email });
export const vendors = async () => (await fetch(V + "/__state")).json();
export const inbox = (m) => fetch(V + "/__inbox", { method: "POST", body: JSON.stringify(m) });
export const tick = async (n = 3) => { const all = []; for (let i = 0; i < n; i++) { await sql(`update job_executions set run_at = now() where status='queued'`); const r = await (await fetch(B + "/api/jobs/tick?limit=25", { headers: { authorization: "Bearer audit-cron" } })).json(); all.push(...(r.jobs ?? [])); } return all; };
export const signIn = async (ctx, p) => { await ctx.clearCookies(); const name = "sb-127-auth-token", ch = p.session.match(/.{1,3000}/g); await ctx.addCookies(ch.map((value, i) => ({ name: ch.length > 1 ? `${name}.${i}` : name, value, domain: "127.0.0.1", path: "/" }))); };
export const eq = (a, b, m = "") => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m} got ${JSON.stringify(a)} wanted ${JSON.stringify(b)}`); };
export const ok = (c, m) => { if (!c) throw new Error(m); };
export const until = async (f, m = "condition", ms = 15000) => { const t = Date.now(); let last; while (Date.now() - t < ms) { try { last = await f(); if (last) return last; } catch (e) { last = e.message; } await new Promise((r) => setTimeout(r, 250)); } throw new Error("timed out: " + m + " last=" + JSON.stringify(last)); };
const FILE = "audit/pass-22/results.json"; mkdirSync("audit/pass-22", { recursive: true });
export const results = existsSync(FILE) ? JSON.parse(readFileSync(FILE, "utf8")) : {};
const only = process.argv.slice(2);
export async function t(id, name, fn) {
  if (only.length && !only.some((o) => id.startsWith(o))) return;
  await refused().catch(() => {}); const s = Date.now(); let r;
  try { const ev = await fn(); r = { name, pass: true, evidence: ev ?? "", ms: Date.now() - s }; } catch (e) { r = { name, pass: false, evidence: String(e.message).slice(0, 500), ms: Date.now() - s }; }
  const bad = (await refused().catch(() => [])).filter((e) => e.status >= 400).map((e) => `${e.method} ${e.path.slice(0, 120)} ${e.status} ${String(e.message).slice(0, 120)}`);
  if (bad.length) r.dbRefusals = bad.slice(0, 4);
  results[id] = r; writeFileSync(FILE, JSON.stringify(results, null, 1));
  console.log(`${r.pass ? "ok  " : "FAIL"} ${id} ${name}${r.pass ? (r.evidence ? " — " + String(r.evidence).slice(0, 140) : "") : "\n       " + r.evidence}${bad.length ? "\n       db: " + bad.slice(0, 2).join(" | ") : ""}`);
}
export async function open() { const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true }); const page = await ctx.newPage(); page.setDefaultTimeout(9000); return { b, ctx, page }; }
