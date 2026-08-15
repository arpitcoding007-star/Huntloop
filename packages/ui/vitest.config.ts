import { defineConfig } from "vitest/config";

/**
 * Component tests for the design system.
 *
 * Scope, deliberately narrow: components whose *behaviour* is the point —
 * keyboard handling, focus, ARIA state. Not appearance. A test asserting that
 * a card has `rounded-md` re-states the source file in a second syntax and
 * then has to be edited every time the design changes, which teaches everyone
 * that these tests are overhead. `/kitchen-sink` is where appearance is
 * reviewed, by eye, which is the right instrument for it.
 *
 * jsdom rather than a browser, because these assertions are about the DOM and
 * the event model, both of which jsdom implements faithfully. Anything needing
 * real layout or real focus-visible behaviour belongs in the Playwright suite.
 */
export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.tsx"],
    globals: false,
    restoreMocks: true,
  },
});
