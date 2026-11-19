/**
 * Live check — the real adapters against the real vendors.
 *
 *   npm run live-check            free: every configured key is checked, no credit spent
 *   npm run live-check -- --spend also one small paid call per vendor (cents)
 *
 * ── Why this exists ──────────────────────────────────────────────────────
 *
 * Every provider and model test in this repository runs against a fake we
 * wrote, so it proves the code agrees with our idea of the vendor — not with
 * the vendor. A wrong request shape passes every suite and returns nothing in
 * production, which reads as an empty market rather than a bug. This runs the
 * same adapter code the engine runs, once, against the real API.
 *
 * Reads keys from the environment, or from apps/web/.env.local like
 * `db:doctor`. Never prints a key. Exit code 1 when a configured vendor fails.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
// The adapters by path: the package exports the routed API, not the adapters.
import { apolloAdapter } from "../packages/providers/src/adapters/apollo.ts";
import { hunterAdapter } from "../packages/providers/src/adapters/hunter.ts";
import { zerobounceAdapter } from "../packages/providers/src/adapters/zerobounce.ts";
import { createAnthropicClient, MODELS } from "@huntloop/ai";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const spend = process.argv.includes("--spend");

function loadEnvLocal(): void {
  try {
    const text = readFileSync(path.join(repoRoot, "apps", "web", ".env.local"), "utf8");
    for (const line of text.split(/\r?\n/)) {
      const match = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
      if (!match) continue;
      const value = match[2]!.replace(/^["']|["']$/g, "");
      if (value && process.env[match[1]!] === undefined) process.env[match[1]!] = value;
    }
  } catch {
    /* No file: the environment is the only source. */
  }
}
loadEnvLocal();

type Verdict = "ok" | "FAIL" | "skip";
const results: { vendor: string; step: string; verdict: Verdict; detail: string }[] = [];

function report(vendor: string, step: string, verdict: Verdict, detail: string) {
  results.push({ vendor, step, verdict, detail });
  console.log(`  [${verdict.padEnd(4)}] ${vendor.padEnd(11)} ${step.padEnd(22)} ${detail}`);
}

async function attempt(vendor: string, step: string, run: () => Promise<string>) {
  try {
    report(vendor, step, "ok", await run());
  } catch (e) {
    report(vendor, step, "FAIL", e instanceof Error ? `${e.name}: ${e.message}`.slice(0, 300) : String(e));
  }
}

const key = (...names: string[]) => names.map((n) => process.env[n]?.trim()).find(Boolean);

console.log(`\nLive check — ${spend ? "credentials and one paid call each" : "credentials only (no credit spent)"}\n`);

/* ── Anthropic ───────────────────────────────────────────────────────── */
if (!key("ANTHROPIC_API_KEY")) {
  report("anthropic", "credentials", "skip", "ANTHROPIC_API_KEY not set");
} else if (!spend) {
  report("anthropic", "structured output", "skip", "a model call costs money; run with --spend");
} else {
  // The cheapest call that exercises what the engine depends on: the routed
  // model id, adaptive thinking and schema-constrained output.
  await attempt("anthropic", "structured output", async () => {
    const result = await createAnthropicClient().run({
      model: MODELS.haiku,
      effort: "low",
      maxTokens: 2_000,
      system: "Answer in the requested JSON format.",
      userContent: "What is the capital of France?",
      schema: {
        type: "object",
        properties: { answer: { type: "string" } },
        required: ["answer"],
        additionalProperties: false,
      },
    });
    const answer = (result.json as { answer?: unknown } | null)?.answer;
    if (typeof answer !== "string") throw new Error(`no answer field in ${JSON.stringify(result.json)}`);
    return `${result.model} answered (${result.usage.inputTokens} in / ${result.usage.outputTokens} out)`;
  });
}

/* ── Apollo ──────────────────────────────────────────────────────────── */
const apolloKey = key("APOLLO_API_KEY");
if (!apolloKey) {
  report("apollo", "credentials", "skip", "APOLLO_API_KEY not set");
} else {
  const apollo = apolloAdapter(apolloKey);
  await attempt("apollo", "credentials", async () => {
    const v = await apollo.verifyCredentials();
    if (!v.ok) throw new Error(v.detail);
    return v.detail;
  });
  if (spend) {
    // PROV-005: the request shape no test has seen the real API accept.
    await attempt("apollo", "company search", async () => {
      const r = await apollo.searchCompanies!({
        name: null,
        keywords: ["payments"],
        industries: [],
        locations: ["United States"],
        employeeMin: 11,
        employeeMax: 200,
        revenueBands: [],
        technologies: [],
        excludeDomains: [],
        cursor: null,
        limit: 1,
      });
      const first = r.data.items[0];
      if (!first) throw new Error(`accepted, but returned no companies (total ${r.data.total ?? "unknown"}) — check the filters' shape`);
      return `${r.data.total ?? "?"} matches; first: ${first.name} (${first.domain ?? "no domain"}), ${r.credits} credit(s)`;
    });
  }
}

/* ── Hunter ──────────────────────────────────────────────────────────── */
const hunterKey = key("ENRICHMENT_API_KEY", "HUNTER_API_KEY");
if (!hunterKey) {
  report("hunter", "credentials", "skip", "ENRICHMENT_API_KEY not set");
} else {
  const hunter = hunterAdapter(hunterKey);
  await attempt("hunter", "credentials", async () => {
    const v = await hunter.verifyCredentials();
    if (!v.ok) throw new Error(v.detail);
    return v.detail;
  });
}

/* ── ZeroBounce ──────────────────────────────────────────────────────── */
const zbKey = key("EMAIL_VERIFICATION_API_KEY", "ZEROBOUNCE_API_KEY");
if (!zbKey) {
  report("zerobounce", "credentials", "skip", "EMAIL_VERIFICATION_API_KEY not set");
} else {
  const zb = zerobounceAdapter(zbKey);
  await attempt("zerobounce", "credentials", async () => {
    const v = await zb.verifyCredentials();
    if (!v.ok) throw new Error(v.detail);
    return v.detail;
  });
  if (spend) {
    // A ZeroBounce sandbox address: answers with a fixed status and uses no credit.
    await attempt("zerobounce", "verify (sandbox)", async () => {
      const r = await zb.verifyEmail!("valid@example.com");
      if (r.data !== "deliverable") throw new Error(`expected deliverable for the sandbox address, got ${r.data}`);
      return `sandbox address → ${r.data}`;
    });
  }
}

/* ── What this cannot check ──────────────────────────────────────────── */
for (const [name, set] of [
  ["Gmail OAuth", key("GOOGLE_CLIENT_ID") && key("GOOGLE_CLIENT_SECRET")],
  ["Outlook OAuth", key("MICROSOFT_CLIENT_ID") && key("MICROSOFT_CLIENT_SECRET")],
] as const) {
  report(name.split(" ")[0]!.toLowerCase(), "oauth client", "skip",
    set ? "set — connect a mailbox in Settings to prove it" : "not set");
}

const failed = results.filter((r) => r.verdict === "FAIL").length;
const ran = results.filter((r) => r.verdict !== "skip").length;
console.log(`\n${failed === 0 ? "PASS" : "FAIL"} — ${ran - failed}/${ran} live checks passed, ${results.length - ran} skipped\n`);
process.exit(failed === 0 ? 0 : 1);
