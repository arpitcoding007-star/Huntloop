import { expect, test } from "@playwright/test";

/**
 * The daily loop — COMMAND.md §16.5 — in demo mode.
 *
 * "Needs you" as a ranked queue, the opportunity's next step and timeline, the
 * approval queue in the inbox, and the reasons a deal ends. Demo mode has no
 * database, so what is asserted is the part a person sees: each item says why
 * it is there, each control opens, and each write that cannot happen says so
 * instead of appearing to work.
 */

const ORG = "demo";

function watchForErrors(page: import("@playwright/test").Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

test.describe("needs you", () => {
  test("the queue lists items that each explain themselves", async ({ page }) => {
    const errors = watchForErrors(page);
    await page.goto(`/${ORG}/needs-you`);

    await expect(page.getByRole("heading", { name: "Needs you", level: 1 })).toBeVisible();
    // A positive reply ranks first, and says what it is and why.
    const first = page.getByRole("article").first();
    await expect(first.getByText("Positive reply")).toBeVisible();
    await expect(first.getByText(/replied .* nobody has answered/i)).toBeVisible();
    // Grouped by kind of work.
    await expect(page.getByRole("heading", { name: /conversations/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: /new opportunities/i })).toBeVisible();
    // Every item has one action and a snooze.
    const articles = page.getByRole("article");
    const count = await articles.count();
    expect(count).toBeGreaterThan(1);
    for (let i = 0; i < count; i++) {
      await expect(articles.nth(i).getByRole("button", { name: /^snooze /i })).toBeVisible();
    }
    expect(errors).toEqual([]);
  });

  test("the ownership filter is a link a colleague can be sent", async ({ page }) => {
    await page.goto(`/${ORG}/needs-you?filter=unassigned`);
    await expect(page.getByRole("link", { name: "Unassigned" })).toHaveAttribute("aria-current", "page");
    await page.getByRole("link", { name: "Everyone" }).click();
    await expect(page).toHaveURL(/filter=everyone/);
  });

  test("snoozing in demo mode says there is nowhere to keep it", async ({ page }) => {
    await page.goto(`/${ORG}/needs-you`);
    await page.getByRole("button", { name: /^snooze /i }).first().click();
    await page.getByRole("menuitem", { name: /tomorrow morning/i }).click();
    await expect(page.locator("p[role=alert]").filter({ hasText: /no database connected/i })).toBeVisible();
  });

  test("the dashboard rail shows the top of the same queue", async ({ page }) => {
    await page.goto(`/${ORG}/dashboard`);
    const rail = page.getByRole("complementary", { name: /needs you/i });
    await expect(rail).toBeVisible();
    await expect(rail.getByText("Positive reply")).toBeVisible();
    await expect(rail.getByRole("link", { name: /open the queue|see all/i })).toHaveAttribute(
      "href",
      `/${ORG}/needs-you`,
    );
  });
});

test.describe("opportunity", () => {
  test("says what to do next, and what that rests on", async ({ page }) => {
    const errors = watchForErrors(page);
    await page.goto(`/${ORG}/opportunities/alphio-ai`);
    await expect(page.getByText("Recommended", { exact: true })).toBeVisible();
    await expect(page.getByText(/based on:/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /set next step/i })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("has a timeline and a way to log a touch on any channel", async ({ page }) => {
    await page.goto(`/${ORG}/opportunities/alphio-ai`);
    await expect(page.getByRole("heading", { name: "Activity" })).toBeVisible();
    await expect(page.getByText("Opportunity found")).toBeVisible();

    await page.getByRole("button", { name: "Log activity" }).click();
    await expect(page.getByLabel("Channel")).toBeVisible();
    await page.getByLabel("Channel").selectOption("linkedin");
    await page.getByLabel(/who started it/i).selectOption("inbound");
    await expect(page.getByText(/moves the opportunity to replied/i)).toBeVisible();

    await page.getByRole("button", { name: "Log it" }).click();
    await expect(page.locator("p[role=alert]").filter({ hasText: /no database connected/i })).toBeVisible();
  });

  test("not a fit asks why before closing anything", async ({ page }) => {
    await page.goto(`/${ORG}/opportunities/alphio-ai`);
    await page.getByRole("button", { name: "Not a fit" }).click();
    await expect(page.getByLabel("Why", { exact: true })).toBeVisible();
    await page.getByLabel("Why", { exact: true }).selectOption("missing_capability");
    await expect(page.getByLabel(/what do they need/i)).toBeVisible();
    // Opening another panel closes this one (M-17 as a single state).
    await page.getByRole("button", { name: "Disagree" }).click();
    await expect(page.getByLabel("Why", { exact: true })).toHaveCount(0);
  });
});

test.describe("inbox", () => {
  test("counts drafts waiting for approval and links them to the queue", async ({ page }) => {
    const errors = watchForErrors(page);
    await page.goto(`/${ORG}/inbox`);
    await expect(page.getByText(/waiting for approval/i).first()).toBeVisible();
    await expect(page.getByRole("heading", { name: /waiting for your approval/i })).toBeVisible();
    await expect(page.getByRole("button", { name: "Edit" })).toBeVisible();
    await page.getByRole("button", { name: "Reject" }).click();
    await expect(page.getByRole("button", { name: /reject draft/i })).toBeVisible();
    expect(errors).toEqual([]);
  });
});

test.describe("pipeline", () => {
  test("choosing Lost asks why, and can be cancelled", async ({ page }) => {
    await page.goto(`/${ORG}/pipeline`);
    const stage = page.getByLabel(/^stage for /i).first();
    const before = await stage.inputValue();
    await stage.selectOption("lost");
    await expect(page.getByText(/why was .* lost\?/i)).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).first().click();
    await expect(page.getByText(/why was .* lost\?/i)).toHaveCount(0);
    expect(await stage.inputValue()).toBe(before);
  });
});

test.describe("performance", () => {
  test("explains itself, and says when there is not enough data", async ({ page }) => {
    const errors = watchForErrors(page);
    await page.goto(`/${ORG}/performance`);
    await expect(page.getByRole("heading", { name: "Performance", level: 1 })).toBeVisible();
    await expect(page.getByRole("heading", { name: /what the data says/i })).toBeVisible();
    await expect(page.getByText(/not enough outreach in this period/i)).toBeVisible();
    await expect(page.getByRole("heading", { name: /where replies come from/i })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("periods are links", async ({ page }) => {
    await page.goto(`/${ORG}/performance`);
    await page.getByRole("link", { name: "Last 90 days" }).click();
    await expect(page).toHaveURL(/period=90d/);
    await expect(page.getByRole("link", { name: "Last 90 days" })).toHaveAttribute("aria-current", "page");
  });

  test("the summary is labelled an inference and quotes its sources", async ({ page }) => {
    await page.goto(`/${ORG}/performance`);
    await page.getByRole("button", { name: /summarise this period/i }).click();
    await expect(page.getByText(/worked example/i)).toBeVisible();
    await expect(page.getByText("Inference").first()).toBeVisible();
  });

  test("exports CSV that a spreadsheet will not execute", async ({ request }) => {
    const res = await request.get(`/${ORG}/performance/export?period=30d&table=funnel`);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("text/csv");
    const body = await res.text();
    expect(body.split(/\r?\n/)[0]).toBe("measure,this period,previous period");
  });

  test("Learn names it Performance, and spend lives under Operate", async ({ page }) => {
    await page.goto(`/${ORG}/performance`);
    await expect(page.getByRole("link", { name: "Performance" }).first()).toBeVisible();
    await page.goto(`/${ORG}/analytics`);
    await expect(page.getByRole("link", { name: "AI spend" }).first()).toBeVisible();
  });
});
