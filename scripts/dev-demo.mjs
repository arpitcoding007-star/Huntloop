/**
 * The dev server in demo mode — no Supabase, no Anthropic key.
 *
 * This is a real configuration of the app, not a test bypass: it is what a
 * developer sees before running the migrations, what CI builds, and what the
 * Playwright suite exercises (see the note in playwright.config.ts). Having it
 * one command away matters because every screen has a demo branch, and the
 * branch nobody looks at is the branch that breaks.
 *
 * Env vars are cleared here rather than in an npm script because `FOO= next`
 * is shell syntax that does not survive cmd.exe on Windows.
 *
 * Next is launched as `node node_modules/next/dist/bin/next` rather than as
 * `npx next`. Spawning `npx.cmd` without `shell: true` is `EINVAL` on Node 20
 * and later — the fix for CVE-2024-27980 made Windows refuse to spawn a
 * `.cmd` outside a shell — and turning the shell on instead would put every
 * argument back through cmd.exe quoting, which is the thing this file exists
 * to stay out of. Resolving the bin script and running it with the Node we
 * are already inside has neither problem.
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

spawn(
  process.execPath,
  [nextBin, "dev", "apps/web", "-p", process.env.DEMO_PORT ?? "3101"],
  { stdio: "inherit", env },
).on("exit", (code) => process.exit(code ?? 0));
