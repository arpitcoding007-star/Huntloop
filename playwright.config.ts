import { defineConfig, devices } from "@playwright/test";

/**
 * Browser-level tests.
 *
 * Before these, `apps/web` and `packages/ui` had no test of any kind: nothing
 * exercised sign-in, the org membership guard and its deliberate 404, the
 * onboarding pipeline, the analyze screen, or the responsive drawer (audit
 * TEST-02). `SEC-01` lived in exactly the layer with no coverage, and `SEO-03`
 * — crawler routes answered with a redirect to `/login` — was found by
 * curl-ing the running server rather than by reading the code. That is the
 * argument for this file.
 *
 * ── Why the server runs with EMPTY Supabase credentials ───────────────────
 *
 * Not a shortcut. With no credentials the app runs in demo mode: middleware
 * passes everything through, loaders return fixtures, and a banner says so.
 * That makes the entire UI reachable without a login, which means these specs
 * can cover the app shell, navigation, filters and accessibility without ever
 * handling anyone's credentials — and it is exactly the configuration CI
 * already builds in, so the suite runs there unchanged.
 *
 * What it therefore does NOT cover, stated plainly rather than left to be
 * discovered: real sign-in, the OAuth callback, and the membership guard's
 * 404, all of which need a live Supabase project. Those are the specs to add
 * the day a seeded project exists — see audit/BACKLOG.md.
 *
 * The empty strings are load-bearing. `@next/env` skips any variable already
 * present in `process.env`, and an empty string counts as present, so these
 * override `apps/web/.env.local` on a developer machine that does have real
 * credentials. Without them this suite would pass locally and test a
 * different application than it tests in CI.
 */

const PORT = 3102;
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  // Ordinary UI assertions resolve in milliseconds; 5s is generous for those
  // and still fails fast when a page never renders.
  expect: { timeout: 5_000 },
  fullyParallel: true,
  // A committed `test.only` passes locally and silently stops running most of
  // the suite in CI.
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : [["list"]],

  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },

  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    {
      // The sidebar becomes an off-canvas drawer below `lg`, with a scrim and
      // Escape-to-dismiss. That behaviour is carefully built and was never
      // tested; a viewport project is the cheapest way to keep it working.
      name: "mobile",
      use: { ...devices["Pixel 7"] },
    },
  ],

  webServer: {
    /*
     * A production build, not `next dev`.
     *
     * The first version of this config ran the dev server, and the suite was
     * flaky in a specific and instructive way: `next dev` compiles each route
     * on first request, so with `fullyParallel` several workers all arrive at
     * a cold route at once and the slowest of them times out. Every failing
     * test passed when run on its own — which is the signature of a harness
     * problem rather than a product one, and the kind of flake that gets a
     * suite ignored within a month.
     *
     * Building first costs about a minute up front and removes the whole
     * class. It also means the specs exercise the same output that ships.
     */
    command: `npm run build --workspace @huntloop/web && npx next start apps/web -p ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 300_000,
    env: {
      NEXT_PUBLIC_SUPABASE_URL: "",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "",
      // No key means every AI wrapper returns its worked example instead of
      // calling a model. A browser suite must never be able to spend money.
      ANTHROPIC_API_KEY: "",
    },
  },
});
