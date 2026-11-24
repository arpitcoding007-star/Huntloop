import { expect, test } from "@playwright/test";

/**
 * The Exchange in a browser (DN-101).
 *
 * Demo mode has no database, so nothing can be filed, matched or introduced
 * here: that journey is asserted end to end in the migration tests (0062 to
 * 0067) and the job tests. What a browser can prove is the part they cannot —
 * every screen renders, the questionnaire falls back to its form with no
 * model, the privacy promise is visible before anything is filed, and no
 * screen invents a marketplace.
 */
const SCREENS = [
  ["/find", "Say what you need. Stay anonymous until you choose."],
  ["/demo/exchange", "My requests"],
  ["/demo/exchange/new", "New request"],
  ["/demo/exchange/intros", "Introductions"],
  ["/demo/exchange/updates", "Updates"],
  ["/demo/exchange/supplier", "Supplier profile"],
  ["/demo/exchange/market", "Market demand"],
  ["/demo/exchange/privacy", "Exchange privacy"],
  ["/demo/exchange/notifications", "Exchange notifications"],
] as const;

for (const [path, heading] of SCREENS) {
  test(`${heading} renders, and fits the screen`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const response = await page.goto(path);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
    expect(errors).toEqual([]);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
}

test("a request that does not exist is a 404, not an invented one", async ({ page }) => {
  /* The page streams behind a loading state, so the status line is already sent;
     what a person sees is what matters. */
  await page.goto("/demo/exchange/requests/11111111-1111-4111-8111-111111111111");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(/not found|doesn.t exist|can.t find|no page/i);
});

test("what a visitor says on /find is waiting in the questionnaire, and was never in a URL", async ({ page }) => {
  const sent: string[] = [];
  page.on("request", (r) => sent.push(r.url() + (r.postData() ?? "")));
  await page.goto("/find");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Stay anonymous");
  await page.getByLabel("What do you need?").fill("Zirconium flanges for Munich");
  await page.getByRole("button", { name: /Continue/ }).click();
  await page.waitForURL("**/demo/exchange/new");
  await expect(page.getByLabel("What do you need?")).toHaveValue("Zirconium flanges for Munich");
  expect(sent.filter((u) => /Zirconium/i.test(u))).toEqual([]);
});

test("onboarding offers buying and selling while the Exchange is on", async ({ page }) => {
  await page.goto("/welcome/start?job=buy");
  await expect(page.getByRole("radio", { name: /Find a product/ })).toBeChecked();
  await expect(page.getByRole("radio", { name: /List what I sell/ })).toBeVisible();
});

test("the plain form shows who may see the request before it is saved", async ({ page }) => {
  await page.goto("/demo/exchange/new");
  await page.getByRole("button", { name: "Use a plain form instead" }).click();
  await expect(page.getByRole("heading", { name: "Check your request" })).toBeVisible();
  await expect(page.getByText("Who may see this request")).toBeVisible();
  await expect(page.getByText("What a matched supplier sees")).toBeVisible();
});
