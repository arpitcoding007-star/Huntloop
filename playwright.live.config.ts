import { defineConfig, devices } from "@playwright/test";

/**
 * The web app against a real schema with row security on, signed in as
 * synthetic people (packages/db/testing). Nothing here can reach a hosted
 * project: the backend is in memory on the loopback interface.
 *
 *   npm run test:e2e:live
 */
export default defineConfig({
  testDir: "./e2e-live",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  reporter: [["list"]],
  use: { baseURL: "http://127.0.0.1:3103", ...devices["Desktop Chrome"], screenshot: "only-on-failure" },
  webServer: [
    { command: "node --experimental-strip-types packages/db/testing/serve.ts", url: "http://127.0.0.1:3199/auth/v1/logout", timeout: 120_000, reuseExistingServer: false },
    {
      command: "npm run build --workspace @huntloop/web && npx next start apps/web -p 3103",
      url: "http://127.0.0.1:3103",
      timeout: 300_000,
      reuseExistingServer: false,
      env: {
        NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:3199",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "test-anon",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "test-anon",
        SUPABASE_SECRET_KEY: "test-service-role",
        NEXT_PUBLIC_SITE_URL: "http://127.0.0.1:3103",
        /* The synthetic model in serve.ts: no key exists and nothing is spent. */
        ANTHROPIC_API_KEY: "synthetic",
        ANTHROPIC_BASE_URL: "http://127.0.0.1:3197",
        RESEND_API_KEY: "",
        INNGEST_EVENT_KEY: "",
        INNGEST_SIGNING_KEY: "",
        CRON_SECRET: "",
        NEXT_PUBLIC_POSTHOG_KEY: "",
        POSTHOG_KEY: "",
        SENTRY_DSN: "",
        NEXT_PUBLIC_SENTRY_DSN: "",
        HUNTLOOP_EXCHANGE: "on",
        HUNTLOOP_BUYER_HOST: "localhost:3103",
        MAILBOX_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
      },
    },
  ],
});
