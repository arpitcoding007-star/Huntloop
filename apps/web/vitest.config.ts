import { defineConfig } from "vitest/config";

/**
 * Unit tests for `apps/web`.
 *
 * Scope, deliberately narrow: the modules that make a *decision* — a redirect
 * target, a refusal, a parsed input — with no React rendering and no network.
 * Component and page behaviour belongs in the Playwright suite (`e2e/`),
 * because a component test that mounts a Server Component tree teaches you
 * about your mocks rather than about your app.
 *
 * `environment: "node"` for the same reason: nothing here touches a DOM, and a
 * jsdom that is not needed is a second runtime whose differences from the real
 * one eventually produce a passing test for broken code.
 */
export default defineConfig({
  resolve: {
    alias: {
      /*
       * `server-only` is a build-time guard, and vitest is not that build.
       *
       * The package is a single `throw` that Next's bundler swaps for an
       * empty module when the importer lands in the server graph. Under
       * vitest there is no client graph at all — every module here runs in
       * Node — so the unswapped version throws on import and fails tests for
       * code that is correct.
       *
       * It started mattering when `lib/data/icp.ts` began importing
       * `requireOrgId` from `lib/data/org.ts`, which puts `server-only` on the
       * path of `lib/ai/qualify` and `lib/ai/why-now` — the two wrappers
       * `spend-guard.test.ts` exists to hold down. Aliasing it away restores
       * those tests without weakening anything: the real guard is still in the
       * real build, where a Client Component importing one of these files is
       * still an error.
       */
      "server-only": new URL("./test/server-only-stub.ts", import.meta.url).pathname,
    },
  },
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts"],
    // The Next-specific globals these modules expect are absent under vitest.
    // Any test needing them is an integration test and belongs in e2e/.
    restoreMocks: true,
  },
});
