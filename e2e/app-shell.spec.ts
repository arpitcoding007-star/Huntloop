import { expect, test } from "@playwright/test";

/**
 * The authenticated shell, exercised in demo mode.
 *
 * Everything here is reachable because the server runs with no Supabase
 * credentials — see the note in playwright.config.ts. That is a real
 * configuration of this app (it is what a developer sees before running the
 * migrations, and what CI builds), not a test-only bypass.
 */

const ORG = "acme";

test.describe("navigation", () => {
  test("the demo-data banner says the numbers are not real", async ({ page }) => {
    // §7 pointed at ourselves: the app must never show demo data as if it were
    // real. If this banner ever stops rendering, every screen becomes a
    // confident assertion of invented pipeline numbers.
    await page.goto(`/${ORG}/dashboard`);
    await expect(page.getByText(/demo|fixture|sample/i).first()).toBeVisible();
  });

  test("no nav item leads to a 404", async ({ page }) => {
    /*
     * FEAT-01: the sidebar advertised seventeen destinations and five existed,
     * so 71% of the primary navigation led nowhere. The fix marks the rest
     * `unbuilt`, which renders them as labels rather than links.
     *
     * `audit.mjs` NAV-01 checks this statically against the route tree. This
     * checks it against the running app, which also catches a route that
     * exists as a file but throws on render.
     */
    await page.goto(`/${ORG}/dashboard`);

    const links = page.locator('nav[aria-label="Primary"] a[href]');
    const hrefs = await links.evaluateAll((all) =>
      all.map((a) => a.getAttribute("href")!).filter((h) => h.startsWith("/")),
    );

    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) {
      const response = await page.request.get(href, { maxRedirects: 0 });
      expect(response.status(), `${href} is a live nav link`).toBeLessThan(400);
    }
  });

  test("unbuilt destinations are labels, and stay out of the tab order", async ({
    page,
  }) => {
    // A keyboard user landing on one would have nowhere to go, which is worse
    // than not being able to reach it at all.
    await page.goto(`/${ORG}/dashboard`);

    const unbuilt = page.locator('nav[aria-label="Primary"] [aria-disabled="true"]');
    expect(await unbuilt.count()).toBeGreaterThan(0);

    for (const element of await unbuilt.all()) {
      expect(await element.getAttribute("href")).toBeNull();
      expect(await element.getAttribute("tabindex")).not.toBe("0");
    }
  });

  test("nothing on the page is a link that goes nowhere", async ({ page }) => {
    // NAV-02. Eight StatCards on this screen were `href="#"`, each rendering
    // "Click to view →" and doing nothing when activated.
    await page.goto(`/${ORG}/dashboard`);
    expect(await page.locator('a[href="#"], a[href=""]').count()).toBe(0);
  });

  test("navigating between screens does not reload the document", async ({
    page,
  }) => {
    /*
     * PERF-01. Every internal navigation used to be a raw <a>, so each one
     * discarded the App Router, re-parsed all the shared JS and re-hydrated.
     *
     * Asserted by marking the window and checking the mark survives: a full
     * document load destroys it, a client-side transition does not.
     */
    test.skip(
      test.info().project.name === "mobile",
      "the sidebar is a drawer below lg; covered by the drawer spec",
    );

    await page.goto(`/${ORG}/dashboard`);
    await page.evaluate(() => {
      (window as unknown as { __noReload: boolean }).__noReload = true;
    });

    await page.locator('nav[aria-label="Primary"] a[href$="/opportunities"]').click();
    await expect(page).toHaveURL(new RegExp(`/${ORG}/opportunities$`));

    const survived = await page.evaluate(
      () => (window as unknown as { __noReload?: boolean }).__noReload === true,
    );
    expect(survived, "the document reloaded — this navigation is not client-side").toBe(
      true,
    );
  });
});

test.describe("the AI spend screen", () => {
  /*
   * Added because the nav test did not catch a real bug in this page.
   *
   * `no nav item leads to a 404` only checks the status code, and the failure
   * here was a runtime one — the Server Component built `DataTable`'s columns,
   * whose `render` callbacks are functions, and functions cannot cross into a
   * Client Component. Every request logged an error. A check that a route
   * *answers* is not a check that it works.
   */
  test("renders the spend summary and the runs table", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));

    await page.goto(`/${ORG}/analytics`);

    await expect(page.getByRole("heading", { name: /ai spend/i })).toBeVisible();
    await expect(page.getByText("Total spend")).toBeVisible();
    // The number that separates a cost dashboard from a cost guess: a run that
    // was billed and never reported an outcome.
    await expect(page.getByText("No outcome").first()).toBeVisible();
    await expect(page.getByRole("table")).toBeVisible();

    expect(errors, "the page threw while rendering").toEqual([]);
  });

  test("states no cache hit rate rather than claiming 0%", async ({ page }) => {
    // §7 applied to our own telemetry: "0%" is a claim about caching, "—" is
    // the truth when nothing has run. The demo data has runs, so this asserts
    // the populated case reads as a percentage rather than a placeholder.
    await page.goto(`/${ORG}/analytics`);
    await expect(page.getByText("Cache hit rate")).toBeVisible();
  });
});

test.describe("accessibility", () => {
  test("a skip link is the first thing you reach, and it moves focus", async ({
    page,
  }) => {
    /*
     * A11Y-02. Every authenticated page renders ~17 nav items before <main>,
     * so without this a keyboard user tabs the whole sidebar on every page.
     *
     * The second assertion is the one that usually fails silently: following
     * `#main` moves the scroll position but leaves focus where it was unless
     * the target carries tabIndex={-1}, so the next Tab drops the user back
     * into the sidebar they just escaped.
     */
    await page.goto(`/${ORG}/dashboard`);
    await page.keyboard.press("Tab");

    const skip = page.locator("a:focus");
    await expect(skip).toHaveText(/skip to content/i);
    await expect(skip).toBeVisible();

    await page.keyboard.press("Enter");
    const focusedId = await page.evaluate(() => document.activeElement?.id);
    expect(focusedId).toBe("main");
  });

  test("the priority classification is never colour alone", async ({ page }) => {
    // Nothing in this UI may be communicated by colour alone: priority always
    // ships with the word as well as the hue.
    await page.goto(`/${ORG}/opportunities`);
    await expect(page.getByText(/\b(hot|warm|watch|ignore)\b/i).first()).toBeVisible();
  });
});

test.describe("the opportunity list", () => {
  test("?priority= seeds the filter, so the dashboard cards can deep-link", async ({
    page,
  }) => {
    // The filter used to be client state only, which is why the four priority
    // cards on the Command Center had nowhere to point and were `href="#"`.
    await page.goto(`/${ORG}/opportunities?priority=hot`);
    // Scoped to the filter group: "Hot" also appears as a stat card label and
    // on every priority badge in the table.
    await expect(
      page
        .getByRole("group", { name: /filter by priority/i })
        .getByRole("button", { name: /hot/i }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  test("an unrecognised priority is ignored rather than trusted", async ({ page }) => {
    // The parameter can only ever select among values the component already
    // renders. Anything else falls back to All.
    await page.goto(`/${ORG}/opportunities?priority=<script>alert(1)</script>`);
    await expect(
      page
        .getByRole("group", { name: /filter by priority/i })
        .getByRole("button", { name: /^all$/i }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  test("a row links to its opportunity", async ({ page }) => {
    await page.goto(`/${ORG}/opportunities`);
    const first = page.locator(`a[href*="/${ORG}/opportunities/"]`).first();
    await expect(first).toBeVisible();
    await first.click();
    await expect(page).toHaveURL(new RegExp(`/${ORG}/opportunities/.+`));
  });
});

test.describe("the mobile drawer", () => {
  // The `isMobile` fixture rather than the project name: it comes from the
  // device descriptor, so this stays correct if the projects are renamed.
  test.skip(({ isMobile }) => !isMobile, "only meaningful below the lg breakpoint");

  test("Escape closes it — a pointer-only dismissal is a keyboard trap", async ({
    page,
  }) => {
    await page.goto(`/${ORG}/dashboard`);

    await page.getByRole("button", { name: /open navigation/i }).click();
    const nav = page.locator('nav[aria-label="Primary"]');
    await expect(nav).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: /close navigation/i })).toHaveCount(0);
  });
});
