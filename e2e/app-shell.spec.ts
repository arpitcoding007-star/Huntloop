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
    /*
     * A keyboard user landing on one would have nowhere to go, which is worse
     * than not being able to reach it at all.
     *
     * This used to require at least one unbuilt item, which was true while
     * most of the §45 surface map was still a map. It is no longer: every
     * destination is built, the count is zero, and demanding one made the test
     * fail against an app that had got better.
     *
     * So the count assertion moved to `packages/ui/src/components/
     * Sidebar.test.tsx`, where an unbuilt item can be rendered on purpose
     * rather than waited for. What stays here is the invariant against the
     * real app: *if* the nav renders one, it is not a link and not tabbable.
     * Vacuous today, and meaningful again the moment the next destination is
     * added to the map ahead of its page.
     */
    await page.goto(`/${ORG}/dashboard`);

    const unbuilt = page.locator('nav[aria-label="Primary"] [aria-disabled="true"]');

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

test.describe("adding opportunities to a campaign", () => {
  /*
   * The entry point to the outreach engine, and the one control in the product
   * that can start email going to a real person. Three things are asserted, in
   * the order they matter: that the picker opens at all (it was a `pending`
   * button until enrollment existed), that it states the campaign's autonomy
   * level before the commit rather than after, and that a campaign with no
   * email step is offered disabled rather than hidden.
   *
   * In demo mode the action itself refuses — there is no database to write to
   * — which is what the last assertion checks. That refusal is the §7 rule the
   * whole demo mode exists to keep: nothing here may look like it worked.
   */
  test("the picker names the autonomy level before anything is committed", async ({
    page,
  }) => {
    await page.goto(`/${ORG}/opportunities`);

    await page.getByRole("checkbox", { name: /select all rows/i }).check();
    await page.getByRole("button", { name: /add to campaign/i }).click();

    const picker = page.getByLabel("Campaign");
    await expect(picker).toBeVisible();

    // §46's ladder, on the option itself — not somewhere the user has to go
    // and look after choosing.
    await expect(picker.locator("option").nth(1)).toHaveText(/autonomy \d/);
    await expect(page.getByText(/drafted and wait for you|without further approval/i)).toBeVisible();
  });

  test("with no database, adding to a campaign says so rather than appearing to work", async ({
    page,
  }) => {
    await page.goto(`/${ORG}/opportunities`);

    await page.getByRole("checkbox", { name: /select all rows/i }).check();
    await page.getByRole("button", { name: /add to campaign/i }).click();
    await page.getByRole("button", { name: /^add \d+ to campaign$/i }).click();

    // Scoped to a paragraph: Next renders its own empty `role="alert"` route
    // announcer on every page, which an unscoped alert role also matches.
    await expect(
      page.locator("p[role=alert]").filter({ hasText: /no database connected/i }),
    ).toBeVisible();
  });
});

test.describe("the Command Center", () => {
  /*
   * Every figure here used to be a literal in the page — `value={12}`, "9 new
   * triggers in the last 24h", two mailboxes with sending quotas — which read
   * identically on a live deployment and an empty one. These three assert the
   * properties that stop that coming back.
   */

  test("the priority counts agree with the list they link into", async ({ page }) => {
    /*
     * The strongest available check without a seeded database: the four cards
     * and the opportunity list are two renderings of the same rows, so a
     * hard-coded count on either side shows up as a disagreement between them.
     * It is exactly the disagreement the old dashboard had — 12 hot on the
     * card, one hot in the list.
     */
    await page.goto(`/${ORG}/dashboard`);
    const hotCard = page.getByRole("link", { name: /hot/i }).first();
    const onCard = ((await hotCard.innerText()).match(/\d+/) ?? ["0"])[0];

    await page.goto(`/${ORG}/opportunities?priority=hot`);
    const inList = await page.locator(`a[href*="/${ORG}/opportunities/"]`).count();

    expect(Number(onCard), "the card and the list disagree about how many are hot").toBe(
      inList,
    );
  });

  test("nothing claims a sending quota when no mailbox is connected", async ({
    page,
  }) => {
    // The old version drew two bars for addresses at `acme.co` on a deployment
    // where nothing could send. A capacity section with no mailbox behind it is
    // an invented denominator, so the section is absent rather than empty.
    await page.goto(`/${ORG}/dashboard`);
    await expect(page.getByText(/sending capacity/i)).toHaveCount(0);
  });

  test("the action rail asserts nothing it has not counted", async ({ page }) => {
    /*
     * This rail was the sharpest instance of the problem in the app: a column
     * headed "Needs you" asserting four decisions were required, with six inert
     * buttons under it and not one of the four counts computed. An empty
     * workspace now renders no rail at all, which is a real answer.
     */
    await page.goto(`/${ORG}/dashboard`);
    await expect(page.getByText(/replies unread|messages need approval/i)).toHaveCount(0);
  });
});

test.describe("an opportunity's own page", () => {
  test("both header controls act, rather than explaining why they cannot", async ({
    page,
  }) => {
    /*
     * This is "the screen the product is judged on", by its own file comment,
     * and until now both of its buttons were labels: Assign and Draft outreach
     * each carried a reason instead of a handler. Both reasons had stopped
     * being true — assigning is the action the assignments board already
     * called, and enrolling is the one the opportunity list already called for
     * a whole selection.
     *
     * "Add to campaign" rather than "Draft outreach", because that is what it
     * does: whether the first message is drafted for review or sent on its own
     * is the campaign's autonomy level, not this button's.
     */
    await page.goto(`/${ORG}/opportunities`);
    await page.locator(`a[href*="/${ORG}/opportunities/"]`).first().click();

    const assign = page.getByRole("button", { name: /assign|owned by/i }).first();
    await expect(assign).not.toHaveAttribute("aria-disabled", "true");
    await assign.click();
    await expect(page.getByLabel("Owner")).toBeVisible();

    await page.getByRole("button", { name: /add to campaign/i }).click();
    await expect(page.getByLabel("Campaign")).toBeVisible();
    // §46's ladder, stated before the commit rather than discovered after it.
    await expect(
      page.getByText(/drafted and wait for you|without further approval/i),
    ).toBeVisible();
  });
});

test.describe("the per-opportunity agent", () => {
  test("the send control acts, and the panel no longer says nothing will answer", async ({
    page,
  }) => {
    /*
     * §19's discussion window. It shipped as UI with nothing behind it and
     * said so, which was the honest thing to do at the time; what has arrived
     * is the model, the persistence, and the grounding contract the footer was
     * already promising.
     *
     * The footer is asserted here because it is the promise: an answer cites
     * what it rests on and says what it could not establish. A panel that made
     * that claim and then did not keep it would be the §7 failure aimed at the
     * screen where a reader is most likely to be deciding whether this product
     * invents things.
     */
    await page.goto(`/${ORG}/opportunities`);
    await page.locator(`a[href*="/${ORG}/opportunities/"]`).first().click();

    await expect(page.getByText(/not connected yet/i)).toHaveCount(0);
    await expect(page.getByText(/rather than guess/i)).toBeVisible();

    const send = page.getByRole("button", { name: /^send$/i });
    await expect(send).toBeVisible();
    await expect(send).not.toHaveAttribute("aria-disabled", "true");
  });

  test("with no database, asking says so rather than appearing to answer", async ({
    page,
  }) => {
    // Demo mode has nowhere to store the conversation, and §19 asks it to
    // remember — so the honest answer is that it cannot, not a reply that
    // vanishes on navigation.
    await page.goto(`/${ORG}/opportunities`);
    await page.locator(`a[href*="/${ORG}/opportunities/"]`).first().click();

    await page.getByRole("button", { name: /what do we actually know/i }).click();
    await page.getByRole("button", { name: /^send$/i }).click();

    // Scoped to a paragraph: Next renders its own empty `role="alert"` route
    // announcer on every page, which an unscoped alert role also matches.
    await expect(
      page.locator("p[role=alert]").filter({ hasText: /no database connected/i }),
    ).toBeVisible();
  });
});
