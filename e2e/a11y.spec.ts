import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

/**
 * Automated accessibility checks.
 *
 * ── Why this exists ──────────────────────────────────────────────────────
 *
 * The design audit found accessibility quality well above typical, and found
 * that nothing enforced it: contrast measured by hand and written into
 * comments, a focus-ring convention applied by discipline, `aria-hidden` on
 * decorative icons because somebody remembered each time. `eslint-plugin-
 * jsx-a11y` catches what is visible in a single JSX file; it cannot see a
 * computed contrast ratio, a duplicate landmark, or an id referenced by an
 * `aria-labelledby` that was renamed two components away.
 *
 * `axe-core` was already in `node_modules` as a transitive dependency of the
 * lint plugin and nothing imported it. This is that dependency doing the
 * other half of the job.
 *
 * ── What it asserts, and what it deliberately does not ──────────────────
 *
 * WCAG 2.0/2.1 A and AA, which is the level the token file's own contrast
 * notes target. Not AAA: the palette was measured against 4.5:1 on purpose
 * and asserting 7:1 here would fail a design decision rather than a defect.
 *
 * Axe finds roughly a third of accessibility problems. A green run here is
 * not a claim that these pages are accessible — keyboard order, focus
 * management and whether the copy makes sense read aloud are all outside
 * what any automated tool sees. It is a floor, and its job is to stop the
 * floor dropping without anybody noticing.
 */

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

/**
 * Every route, not one per layout.
 *
 * This used to be five pages, one per shell, on the argument that the other
 * routes share their structure. Pass 17 (A11Y-301) ran axe on all of them and
 * found every violation on a page this list skipped: an unlabelled file input
 * on Imports, contrast on the Inbox's provenance chip and the Companies table,
 * a scroll region on the report. Components that live on one page are only
 * checked by checking that page. All of them together take about two minutes.
 */
const ORG_ROUTES = [
  "dashboard", "opportunities", "opportunities/alphio-ai", "companies", "companies/demo-company-1",
  "competitors", "competitors/demo-competitor-1", "analytics", "analyze", "assistant", "demand",
  "imports", "inbox", "intelligence", "learn", "memory", "needs-you", "ops", "outreach", "outreach/log",
  "performance", "performance/report", "pipeline", "settings", "settings/icp", "settings/integrations",
  "settings/privacy", "settings/product", "settings/scoring", "settings/you", "sources", "team",
  "team/assignments",
];

const PAGES: { path: string; name: string }[] = [
  { path: "/", name: "the landing page" },
  { path: "/login", name: "sign-in" },
  { path: "/signup", name: "sign-up" },
  { path: "/discover", name: "anonymous research" },
  { path: "/for/founder-led-sales", name: "a use-case page" },
  { path: "/kitchen-sink", name: "the design-system gallery" },
  ...ORG_ROUTES.map((route) => ({ path: `/demo/${route}`, name: `/demo/${route}` })),
];

/**
 * Rules switched off for one page, each with its reason. Empty is the goal.
 *
 * `scrollable-region-focusable` on the org shell's `<main>`: it scrolls, and
 * it carries `tabIndex={-1}` so the skip link can focus it, after which the
 * arrow keys scroll it. Axe wants `tabIndex={0}`, which would add a tab stop
 * to the frame of every page. Pages with focusable content (all but this
 * one in demo data) pass anyway.
 */
const PAGE_EXCEPTIONS: Record<string, string[]> = {
  "/demo/intelligence": ["scrollable-region-focusable"],
};

test.describe("accessibility", () => {
  for (const { path, name } of PAGES) {
    test(`${name} has no detectable WCAG A/AA violation`, async ({ page }) => {
      await page.goto(path);

      const { violations } = await new AxeBuilder({ page })
        .withTags(TAGS)
        .disableRules(PAGE_EXCEPTIONS[path] ?? [])
        .analyze();

      /* Reported as a readable list rather than as a bare count. A failure
         saying "expected 0, got 3" sends the next person to go and re-run
         the tool by hand; this one names the rule, the impact and the
         element, which is usually enough to fix it from the CI log. */
      expect(
        violations.map((v) => ({
          rule: v.id,
          impact: v.impact,
          help: v.help,
          nodes: v.nodes.map((n) => n.target.join(" ")),
        })),
      ).toEqual([]);
    });
  }

  /**
   * The ⌘K palette renders into the top layer only once opened, so the page
   * scan above never sees it. Opened by the shortcut rather than a click, so
   * the binding the search row advertises is exercised at the same time.
   */
  test("the jump-to palette has no detectable WCAG A/AA violation", async ({ page }) => {
    await page.goto("/demo/dashboard");
    await page.keyboard.press("Control+k");
    await expect(page.getByRole("combobox", { name: /search pages/i })).toBeFocused();

    const { violations } = await new AxeBuilder({ page })
      .withTags(TAGS)
      .include("dialog[open]")
      .analyze();

    expect(
      violations.map((v) => ({
        rule: v.id,
        impact: v.impact,
        nodes: v.nodes.map((n) => n.target.join(" ")),
      })),
    ).toEqual([]);
  });

  /**
   * Both themes, because half the contrast tokens only exist in one of them.
   *
   * Light was added later and derives from reference screenshots rather than
   * from inverting Dark, so its ratios are a separate set of measurements —
   * exactly the situation where a colour gets changed in one theme and
   * forgotten in the other.
   */
  /* The landing page too: Meridian's black bands are `data-theme="dark"`
     subtrees inside a light page, and in the dark theme the whole page
     inverts around them — two contrast situations one theme cannot show. */
  const THEMED: { path: string; name: string }[] = [
    { path: "/demo/opportunities", name: "the opportunity list" },
    { path: "/", name: "the landing page" },
  ];

  for (const theme of ["light", "dark"] as const) for (const { path, name } of THEMED) {
    test(`${name} passes contrast in ${theme}`, async ({ page }) => {
      await page.goto(path);
      await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);

      const { violations } = await new AxeBuilder({ page })
        .withTags(TAGS)
        .include("body")
        .withRules(["color-contrast"])
        .analyze();

      expect(
        violations.flatMap((v) =>
          v.nodes.map((n) => `${n.target.join(" ")} — ${n.failureSummary ?? v.help}`),
        ),
      ).toEqual([]);
    });
  }
});
