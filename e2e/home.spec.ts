import { expect, test } from "@playwright/test";

/** The home page's demonstrations, driven the way a visitor drives them. */

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  /* The scatter is placed on hydration, so this also waits for it. */
  await expect(page.locator(".mess[data-ready]")).toBeVisible();
});

test("the dial opens on a reason and moves to the next one", async ({ page }) => {
  const company = page.getByTestId("dial-company");
  await expect(company).toContainText("Northwind Systems");
  await page.getByRole("button", { name: "Next company with a reason" }).click();
  await expect(company).toContainText("Vertex Labs");
  await page.getByRole("slider", { name: "Example companies" }).press("ArrowRight");
  await expect(company).toContainText("No reason yet");
});

test("the dial turns when dragged", async ({ page }) => {
  const dial = page.getByRole("slider", { name: "Example companies" });
  const box = (await dial.boundingBox())!;
  const y = box.y + 40;
  await page.mouse.move(box.x + box.width * 0.7, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.3, y, { steps: 10 });
  await page.mouse.up();
  await expect(page.getByTestId("dial-company")).not.toContainText("Northwind");
});

test("one wheel gesture lands on the problem, and one returns", async ({ page, isMobile }) => {
  test.skip(isMobile, "touch screens use the browser's own snapping");
  const top = () => page.locator("#problem").evaluate((el) => Math.round(el.getBoundingClientRect().top));
  await page.mouse.move(400, 300);
  await page.mouse.wheel(0, 120);
  await expect.poll(top).toBe(68);
  await page.waitForTimeout(800); // the gesture's own lock
  await page.mouse.wheel(0, -120);
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
  await page.waitForTimeout(800);
  await page.mouse.wheel(0, 120);
  await expect.poll(top).toBe(68);
  await page.waitForTimeout(800);
  await page.mouse.wheel(0, 400);
  await expect.poll(top).toBeLessThan(-100);
});

test("finding the reasons keeps three companies, and goes back", async ({ page }) => {
  await page.getByRole("button", { name: "Find the reasons" }).click();
  await expect(page.locator(".mess").getByText("Hiring finance, 3 days ago")).toBeVisible();
  await page.getByRole("button", { name: "Back to the list" }).click();
  await expect(page.locator(".mess").getByText("Hiring finance, 3 days ago")).toBeHidden();
});

test("each benefit responds", async ({ page }) => {
  const tiles = page.locator("#features");
  await tiles.getByRole("button", { name: "Senior Accountant role" }).click();
  await tiles.getByRole("button", { name: "Series B in October" }).click();
  await expect(tiles.getByRole("img", { name: "Score 41" })).toBeVisible();
  await expect(tiles.getByText("Unknown", { exact: true })).toHaveCount(3);

  await tiles.getByRole("radio", { name: /^Level 2/ }).click();
  await expect(tiles.getByText("Approve the first. Follow-ups then send.")).toBeVisible();

  await tiles.getByRole("button", { name: "Hope you are well." }).click();
  await expect(tiles.getByText(/drafts drop it/)).toBeVisible();

  await tiles.getByRole("button", { name: /Gather three replies/ }).click();
  await expect(tiles.getByText("Three replies, one theme.")).toBeVisible();

  const consent = tiles.getByRole("slider");
  await expect(tiles.getByText("Fieldnote")).toHaveCount(0);
  await consent.fill("4");
  await expect(tiles.getByText("Fieldnote")).toBeVisible();
});

test("the loop waits for a person, then closes", async ({ page }) => {
  const loop = page.locator("#how");
  for (let i = 0; i < 6; i++) await loop.getByRole("button", { name: "Next stage" }).click();
  await expect(page.getByTestId("loop-status")).toHaveText("Waiting for you");
  await expect(loop.getByRole("button", { name: "Approve to continue" })).toBeDisabled();
  await loop.getByRole("button", { name: "Accept finding" }).click();
  await expect(loop.getByText("Nothing changes yet")).toBeVisible();
  await loop.getByRole("button", { name: "Activate rule" }).click();
  await expect(page.getByTestId("loop-status")).toHaveText("The loop is closed");
  await loop.getByRole("button", { name: "Start the next round" }).click();
  await expect(page.getByTestId("loop-status")).toHaveText("Round 2, with your rule");
});

test("no paid plan can be started", async ({ page }) => {
  const plans = page.locator("#pricing .plans > div");
  await expect(plans).toHaveCount(3);
  await expect(plans.locator('a[href="/signup"]')).toHaveCount(1);
});

test("nothing overflows sideways", async ({ page }) => {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
});

for (const width of [360, 800, 1280])
  test(`section links and sign-in are reachable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const menu = page.getByRole("button", { name: "Open menu" });
    if (await menu.isVisible()) await menu.click();
    const header = page.locator("header");
    await expect(header.getByRole("link", { name: "Pricing" })).toBeVisible();
    await expect(header.getByRole("link", { name: "Sign in" })).toBeVisible();
  });
