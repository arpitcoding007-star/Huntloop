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
 * One page per distinct layout, rather than every route.
 *
 * These five cover the four shells the app actually has — marketing, auth,
 * onboarding, and the org chrome — plus the design-system gallery, which is
 * where a component regresses before any screen shows it. Adding the other
 * thirty routes would multiply runtime for pages whose structure is already
 * represented here.
 */
const PAGES: { path: string; name: string }[] = [
  { path: "/", name: "the landing page" },
  { path: "/login", name: "sign-in" },
  { path: "/acme/dashboard", name: "the Command Center" },
  { path: "/acme/opportunities", name: "the opportunity list" },
  { path: "/kitchen-sink", name: "the design-system gallery" },
];

test.describe("accessibility", () => {
  for (const { path, name } of PAGES) {
    test(`${name} has no detectable WCAG A/AA violation`, async ({ page }) => {
      await page.goto(path);

      const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze();

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
    await page.goto("/acme/dashboard");
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
    { path: "/acme/opportunities", name: "the opportunity list" },
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
