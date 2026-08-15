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
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts"],
    // The Next-specific globals these modules expect are absent under vitest.
    // Any test needing them is an integration test and belongs in e2e/.
    restoreMocks: true,
  },
});
