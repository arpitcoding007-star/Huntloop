/**
 * A ceiling on the JavaScript every visitor downloads.
 *
 * PERF-06. The finding that produced it: adding Sentry took shared First Load
 * JS from 103 kB to 185 kB, tree-shaking recovered 49 kB of that, and **nobody
 * would have known without measuring**. A bundle grows the way a room gets
 * untidy — never in one noticeable step.
 *
 * The Next 16 upgrade made this urgent rather than nice-to-have: `next build`
 * no longer prints a First Load JS column at all, so the number that used to
 * be visible on every build is now visible on no build.
 *
 *   node scripts/bundle-budget.mjs
 *
 * ── What is measured, and why only this ──────────────────────────────────
 *
 * `rootMainFiles` plus `polyfillFiles` from the build manifest: the chunks
 * loaded on every route, by every visitor, before anything page-specific.
 *
 * Deliberately *not* the middleware/proxy bundle, and the reason is recorded
 * in audit/BACKLOG.md. `NEXT_PUBLIC_*` variables are inlined at build time, so
 * with the empty credentials CI builds with, the bundler can prove the
 * Supabase branch in `proxy.ts` is dead and drops it — 125 kB in CI against
 * 154 kB in production, and it will always understate. A budget that read that
 * number would be policing a bundle nobody ships.
 *
 * Per-route chunks are excluded for a softer reason: they vary with what a
 * page imports, and a budget that fires when someone adds a screen teaches
 * people to raise the budget.
 */
import { existsSync, readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const NEXT_DIR = join(ROOT, "apps", "web", ".next");

/**
 * The budget, in kilobytes of **gzipped** shared client JS.
 *
 * Gzipped, not raw, because that is what a visitor downloads and what Next
 * used to print. The difference is not cosmetic — the same bundle measured
 * both ways is 787 kB raw and 245 kB gzipped, so a budget in the wrong unit is
 * off by a factor of three and either never fires or always does. (Brotli is
 * 211 kB and is what most CDNs actually serve; gzip is the more conservative
 * of the two and needs no extra dependency to reproduce.)
 *
 * Set at 275 kB from a measurement of 244.6 kB — about 12% of headroom. It is
 * meant to catch a dependency arriving, not to force a fight over a few
 * kilobytes.
 *
 * If you are here because the build failed: the question to answer first is
 * *what* got added, not what the number should be. `node
 * scripts/bundle-budget.mjs --list` prints the chunks.
 */
const BUDGET_KB = 275;

const manifestPath = join(NEXT_DIR, "build-manifest.json");
if (!existsSync(manifestPath)) {
  console.error(
    "No build manifest. Run `npm run build` before the bundle budget — this\n" +
      "check measures build output and cannot infer it.",
  );
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const shared = [
  ...(manifest.rootMainFiles ?? []),
  ...(manifest.polyfillFiles ?? []),
];

if (shared.length === 0) {
  console.error(
    "The build manifest lists no shared chunks. That is not a passing state —\n" +
      "it means the manifest format changed and this check is now measuring\n" +
      "nothing. Fix the check rather than deleting it.",
  );
  process.exit(1);
}

const files = shared.map((file) => {
  const path = join(NEXT_DIR, file);
  if (!existsSync(path)) return { file, bytes: 0, raw: 0 };
  const contents = readFileSync(path);
  return { file, bytes: gzipSync(contents).length, raw: contents.length };
});

const missing = files.filter((f) => f.bytes === 0);
const totalKb = files.reduce((sum, f) => sum + f.bytes, 0) / 1024;

if (process.argv.includes("--list")) {
  console.log("\n   gzip        raw  chunk");
  for (const { file, bytes, raw } of [...files].sort((a, b) => b.bytes - a.bytes)) {
    console.log(
      `  ${(bytes / 1024).toFixed(1).padStart(6)} kB  ${(raw / 1024)
        .toFixed(1)
        .padStart(7)} kB  ${file}`,
    );
  }
}

if (missing.length) {
  console.error(
    `\n${missing.length} chunk(s) named in the manifest do not exist on disk. ` +
      "The measurement would be silently low, so this fails rather than reports:\n" +
      missing.map((m) => `  ${m.file}`).join("\n"),
  );
  process.exit(1);
}

const verdict = totalKb <= BUDGET_KB ? "ok" : "OVER";
console.log(
  `\nShared client JS: ${totalKb.toFixed(1)} kB of ${BUDGET_KB} kB budget ` +
    `[${verdict}] · ${files.length} chunks`,
);

if (totalKb > BUDGET_KB) {
  console.error(
    `\nOver budget by ${(totalKb - BUDGET_KB).toFixed(1)} kB.\n\n` +
      "This is every visitor's download on every route. Before raising the\n" +
      "number, find what was added — `node scripts/bundle-budget.mjs --list`.\n" +
      "If the addition is worth it, raise the budget in the same commit and\n" +
      "say why, so the next person inherits a decision rather than a constant.",
  );
  process.exit(1);
}
