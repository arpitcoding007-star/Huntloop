import { expect, test } from "@playwright/test";

/**
 * Every route, loaded, in demo mode.
 *
 * The other specs assert what particular screens say. This one asserts the
 * thing none of them does: that each route answers, renders, and throws
 * nothing on the way. It exists because the failures it catches are the ones
 * that survive a careful review — a loader querying a column that was renamed,
 * a component reading a field the fixture stopped carrying — and they do not
 * announce themselves anywhere except in the browser.
 *
 * `pageerror` is collected rather than only the status code. A screen that
 * renders its heading and throws underneath is still broken, and Next will
 * happily answer 200 while a client component fails to hydrate.
 */

const ORG = "acme";

const ROUTES = [
  "/login",
  "/signup",
  "/kitchen-sink",
  `/${ORG}/dashboard`,
  `/${ORG}/opportunities`,
  `/${ORG}/companies`,
  `/${ORG}/analyze`,
  `/${ORG}/imports`,
  `/${ORG}/sources`,
  `/${ORG}/outreach`,
  `/${ORG}/inbox`,
  `/${ORG}/pipeline`,
  `/${ORG}/analytics`,
  `/${ORG}/intelligence`,
  `/${ORG}/learn`,
  `/${ORG}/memory`,
  `/${ORG}/team`,
  `/${ORG}/team/assignments`,
  `/${ORG}/settings`,
  `/${ORG}/settings/icp`,
  `/${ORG}/settings/product`,
  `/${ORG}/settings/scoring`,
  `/${ORG}/settings/integrations`,
  /* Both added by the compliance work: the screens that let somebody set a
     retention window, export a workspace and honour an erasure request. */
  `/${ORG}/settings/privacy`,
  "/welcome",
  /* `/welcome/product` was here and 404s — the product step was folded into
     `company`, and this list was not updated. `lib/analytics.ts` records the
     same merge from the other side, keeping `product` as a retired funnel
     step so historical data stays readable. */
  "/welcome/company",
  "/welcome/goals",
  "/welcome/icp",
  "/welcome/sources",
  /* The legal pages. They are unlinked and noindex while their facts are
     PENDING, which is exactly the condition under which a page rots without
     anybody noticing. */
  "/privacy",
  "/terms",
  "/acceptable-use",
];

for (const route of ROUTES) {
  test(`${route} loads without throwing`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));

    const response = await page.goto(route);

    expect(response?.status(), `${route} did not answer 200`).toBeLessThan(400);
    // Something rendered. A blank body with a 200 is the shape a failed
    // server component takes once the error boundary has swallowed it.
    await expect(page.locator("body")).not.toBeEmpty();
    expect(errors, `${route} threw while rendering`).toEqual([]);
  });
}

test("the opportunity detail route renders for a real fixture", async ({ page }) => {
  // Not in the list above because the id has to come from the list; a
  // hard-coded one would rot the first time the fixtures changed.
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto(`/${ORG}/opportunities`);
  await page.locator(`a[href*="/${ORG}/opportunities/"]`).first().click();

  await expect(page.getByRole("heading").first()).toBeVisible();
  expect(errors, "the detail page threw while rendering").toEqual([]);
});
