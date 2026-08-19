/**
 * The production build, in demo mode, on its own port.
 *
 * `next dev` under Turbopack leaves a streamed Suspense boundary parked in its
 * staging <div hidden> on first paint, so every /[org] screen shows its
 * loading.tsx skeleton and never swaps the content in. That is a dev-server
 * artefact — the same routes render correctly here and under Playwright,
 * which also builds before it runs — but it makes `next dev` useless for
 * confirming that a screen actually renders.
 *
 * Same env-clearing and same spawn reasoning as dev-demo.mjs; see the notes
 * there. Build first, then start:
 *
 *   node scripts/dev-demo-prod.mjs --build
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const nextBin = require.resolve("next/dist/bin/next");

const env = {
  ...process.env,
  NEXT_PUBLIC_SUPABASE_URL: "",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "",
  SUPABASE_SECRET_KEY: "",
  ANTHROPIC_API_KEY: "",
};

const port = process.env.DEMO_PROD_PORT ?? "3103";
const run = (args) =>
  new Promise((resolve) =>
    spawn(process.execPath, [nextBin, ...args], { stdio: "inherit", env }).on(
      "exit",
      resolve,
    ),
  );

if (process.argv.includes("--build")) {
  const code = await run(["build", "apps/web"]);
  if (code) process.exit(code);
}
process.exit((await run(["start", "apps/web", "-p", port])) ?? 0);
