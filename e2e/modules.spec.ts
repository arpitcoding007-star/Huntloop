import { expect, test } from "@playwright/test";

/**
 * The sidebar modules, exercised in demo mode.
 *
 * Same reasoning as `app-shell.spec.ts`: the server runs with no Supabase
 * credentials, which is a real configuration of this app rather than a
 * test-only bypass. Every screen here has a demo branch, and the branch
 * nobody looks at is the branch that breaks.
 *
 * ── Why these assert on rendered content, not on status codes ────────────
 *
 * `no nav item leads to a 404` already proves each route answers. It cannot
 * prove the route *works*: the AI spend screen once answered 200 on every
 * request while throwing a Server-Component-boundary error that emptied the
 * page. So each test below names something only a correctly rendered screen
 * puts on the page, and collects `pageerror` — a screen that renders its
 * heading and throws underneath is still broken.
 */

const ORG = "acme";

/** Fails the test on any uncaught error, not just a missing element. */
function watchForErrors(page: import("@playwright/test").Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

test.describe("settings", () => {
  test("the organisation screen renders, and says why the slug is fixed", async ({
    page,
  }) => {
    const errors = watchForErrors(page);
    await page.goto(`/${ORG}/settings`);

    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
    await expect(page.getByRole("textbox", { name: /name/i })).toBeVisible();
    // The slug is rendered as text rather than a disabled input, and the
    // sentence explaining that is the part a disabled field would omit.
    await expect(page.getByText(`/${ORG}`, { exact: true })).toBeVisible();
    await expect(page.getByText(/first segment of every link/i)).toBeVisible();

    expect(errors, "the page threw while rendering").toEqual([]);
  });

  test("the three settings tabs all lead somewhere real", async ({ page }) => {
    /*
     * `audit.mjs` NAV-01 only inspects OrgShell, so it never saw this tab bar
     * — and for a while two of its three tabs 404'd. A dead tab is the same
     * defect as a dead nav item; it just lives in a component the static
     * check does not read.
     */
    await page.goto(`/${ORG}/settings`);

    const tabs = page.getByRole("tab");
    await expect(tabs).toHaveCount(3);

    for (const tab of await tabs.all()) {
      const href = await tab.getAttribute("href");
      expect(href, "every tab is a real link").toBeTruthy();
      const response = await page.request.get(href!, { maxRedirects: 0 });
      expect(response.status(), `${href} is a live tab`).toBeLessThan(400);
    }
  });

  test("the product screen renders its editor", async ({ page }) => {
    const errors = watchForErrors(page);
    await page.goto(`/${ORG}/settings/product`);

    await expect(page.getByPlaceholder("What you sell")).toBeVisible();
    await expect(page.getByText(/value propositions/i)).toBeVisible();
    // FEAT-DEMO: with no database the screen must say its figures are not real.
    await expect(page.getByText(/illustrative figures/i)).toBeVisible();

    expect(errors, "the page threw while rendering").toEqual([]);
  });

  test("the ICP screen keeps exclusions a separate question", async ({ page }) => {
    const errors = watchForErrors(page);
    await page.goto(`/${ORG}/settings/icp`);

    await expect(page.getByRole("heading", { name: /ideal customer profile/i })).toBeVisible();
    // §9 asks "what is NOT a fit?" as its own question, and the schema gives
    // it its own column. A screen that folded it into the positive lists
    // would lose the distinction §78 depends on.
    await expect(page.getByText("Not a fit")).toBeVisible();
    await expect(page.getByText(/buying triggers/i)).toBeVisible();

    expect(errors, "the page threw while rendering").toEqual([]);
  });
});

test.describe("companies", () => {
  test("renders the list with its identifying columns", async ({ page }) => {
    const errors = watchForErrors(page);
    await page.goto(`/${ORG}/companies`);

    await expect(page.getByRole("heading", { name: "Companies" })).toBeVisible();
    await expect(page.getByRole("table")).toBeVisible();
    await expect(page.getByRole("cell", { name: /alphio/i }).first()).toBeVisible();

    expect(errors, "the page threw while rendering").toEqual([]);
  });

  test("an unresearched field reads UNKNOWN rather than blank", async ({ page }) => {
    // §78's rule about scores, applied to a text column: blank reads as
    // "there is nothing", and not having looked is a different statement.
    await page.goto(`/${ORG}/companies`);
    await expect(page.getByText("Unknown").first()).toBeVisible();
  });

  test("the opportunity count links to a list actually filtered by it", async ({
    page,
  }) => {
    /*
     * The link exists because the alternative was an inert number or a link
     * to an unfiltered list. `?company=` seeds the opportunity list's search,
     * so this asserts the destination is really narrowed rather than just
     * reachable.
     */
    await page.goto(`/${ORG}/companies`);

    const link = page.getByRole("link", { name: /\d+ open/ }).first();
    await expect(link).toBeVisible();
    await link.click();

    await expect(page).toHaveURL(/\/opportunities\?company=/);
    await expect(page.getByRole("table")).toBeVisible();
    // One company's opportunities, not the whole list.
    await expect(page.locator("tbody tr")).toHaveCount(1);
  });
});

test.describe("imports", () => {
  const CSV = [
    "Company Name,Website,Industry,Contact Name,Work Email,Mystery",
    '"Acme, Inc.",https://www.acme.com/pricing,AI infrastructure,Dana Whitfield,dana@acme.com,x',
    "Northwind,northwind.co,Logistics,Sam Reyes,sam@northwind.co,y",
    "Nodomain,not a domain,Retail,,,z",
  ].join("\n");

  test("previews what will happen before anything is written", async ({ page }) => {
    /*
     * The preview is the point of this screen. An import is the one action in
     * the product that writes hundreds of rows from one click, and the failure
     * is silent — a domain column that is really a marketing URL keys every
     * row on something that is not a domain.
     */
    const errors = watchForErrors(page);
    await page.goto(`/${ORG}/imports`);

    await page.getByLabel("CSV").fill(CSV);

    await expect(page.getByText("What will be imported")).toBeVisible();
    // Three data rows, two of which have a usable domain.
    await expect(page.getByText("Rows read")).toBeVisible();
    await expect(page.getByText("With a usable domain")).toBeVisible();
    // The row whose domain is "not a domain" is named as skipped rather than
    // imported with a corrupted entity key.
    await expect(page.getByText(/no usable domain and will be skipped/i)).toBeVisible();

    expect(errors, "the page threw while rendering").toEqual([]);
  });

  test("names the columns it recognised, and the ones it ignored", async ({ page }) => {
    // A column the importer did not understand is data the user believes they
    // imported. Naming it is the difference between a skip and a silent loss.
    await page.goto(`/${ORG}/imports`);
    await page.getByLabel("CSV").fill(CSV);

    await expect(page.getByText("website → domain")).toBeVisible();
    await expect(page.getByText("work email → email")).toBeVisible();
    // Scoped to the "not recognised" line: `mystery` also appears in the
    // textarea and as a preview column header, and asserting on the bare
    // string would pass on either of those without the line existing at all.
    await expect(
      page.getByText(/not recognised, and not imported:\s*mystery/i),
    ).toBeVisible();
  });

  test("a quoted comma does not shift the domain column", async ({ page }) => {
    // The parser's whole reason for existing: split(",") would make
    // `"Acme, Inc."` two fields and key the company on " Inc.".
    await page.goto(`/${ORG}/imports`);
    await page.getByLabel("CSV").fill(CSV);

    await expect(page.getByRole("cell", { name: "Acme, Inc." })).toBeVisible();
  });

  test("with no database, importing says so rather than appearing to work", async ({
    page,
  }) => {
    // §7 aimed at ourselves. The refusal a demo deployment must give is a
    // sentence, not a silent no-op that looks like success.
    await page.goto(`/${ORG}/imports`);
    await page.getByLabel("CSV").fill(CSV);

    await page.getByRole("button", { name: /^Import \d+ compan/ }).click();

    /* Next renders an empty `role="alert"` route announcer on every page, so
       an unscoped alert lookup is ambiguous and resolves to that one. */
    await expect(
      page.getByRole("alert").filter({ hasText: /no database connected/i }),
    ).toBeVisible();
  });
});

test.describe("sources", () => {
  test("surfaces failing sources rather than only showing green", async ({ page }) => {
    /*
     * §58: a source that fails must not fail the hunt — it is marked, retried
     * and surfaced. A list that only ever shows healthy is lying by omission
     * on the day it matters, so the demo data deliberately contains a degraded
     * source and an unavailable one.
     */
    const errors = watchForErrors(page);
    await page.goto(`/${ORG}/sources`);

    await expect(page.getByRole("heading", { name: "Sources" })).toBeVisible();
    await expect(page.getByText(/are not returning full results/i)).toBeVisible();
    await expect(page.getByText(/treat this cycle.s results as incomplete/i)).toBeVisible();

    expect(errors, "the page threw while rendering").toEqual([]);
  });

  test("an unrun source says nothing was read rather than inventing a count", async ({
    page,
  }) => {
    /*
     * The number here used to be "22 opportunities produced", invented. A
     * fabricated 22 makes a source list that has never run look like one that
     * is working.
     *
     * The honest pair is documents read and evidence attributed, and the
     * distinction between them is the diagnosis: "40 documents, no evidence"
     * is a source being read that publishes nothing this ICP cares about,
     * while "nothing read" is a source that is not being scanned at all. A
     * source that has never run says the second and gives no count for the
     * first.
     */
    await page.goto(`/${ORG}/sources`);
    await expect(page.getByText(/nothing read yet/i).first()).toBeVisible();
    await expect(page.getByText(/never scanned/i).first()).toBeVisible();
  });

  test("a recommendation is not enabled until it is accepted", async ({ page }) => {
    // §10, and it has to be true in the database rather than only in the copy:
    // a pending recommendation is `is_enabled = false`, so nothing reads it.
    await page.goto(`/${ORG}/sources`);

    await expect(page.getByText(/nothing is scanned until you accept it/i)).toBeVisible();
    await expect(page.getByRole("button", { name: "Accept" }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Dismiss" }).first()).toBeVisible();
  });

  test("Scan now still says why it cannot act", async ({ page }) => {
    // NAV-03: nothing reads these on a timer yet, and a live-looking control
    // would promise the scheduled hunt the product is built around.
    await page.goto(`/${ORG}/sources`);

    const scan = page.getByRole("button", { name: /scan now/i });
    await expect(scan).toBeVisible();
    await expect(scan).toHaveAttribute("aria-disabled", "true");
  });

  test("the engine notice reports what is observed, not what is configured", async ({
    page,
  }) => {
    /*
     * `CRON_SECRET` being set means `/api/jobs/tick` would accept a caller. It
     * has never meant one exists. While a cron sat in `vercel.json` those were
     * the same thing in practice, so the screen could get away with reading an
     * environment variable; that cron is gone (OPS-04), and "configured, and
     * nothing is calling it" is now the ordinary state.
     *
     * The observed fact is whether any job has ever run — a row in
     * `job_executions` exists because a tick created it. In demo mode there
     * are none, so the notice must appear and must not claim a working engine.
     */
    await page.goto(`/${ORG}/sources`);

    await expect(page.getByText(/nothing is reading these sources on a timer/i)).toBeVisible();
    // Whichever half of the explanation applies, it names a cause the reader
    // can act on rather than asserting the scanner is fine.
    await expect(
      page.getByText(/CRON_SECRET|nothing has called it|refuses every request/i).first(),
    ).toBeVisible();
  });


  test("removing a source offers an undo rather than a bare success line", async ({
    page,
  }) => {
    /*
     * UX-14, the sixth state. A removal reported through the ordinary result
     * banner is indistinguishable from a save, which is fine for a save and
     * wrong for a removal — the two need different amounts of attention and
     * only one has an action attached.
     *
     * Undo rather than a confirmation dialog: a dialog asks everybody to
     * confirm in order to protect the few who pressed by mistake, and people
     * learn to dismiss it without reading. Undo charges nothing to the person
     * who meant it.
     *
     * In demo mode the write itself refuses, which is what the second half
     * checks — the offer must not appear over something that did not happen.
     */
    await page.goto(`/${ORG}/sources`);

    const remove = page.getByRole("button", { name: /^remove /i }).first();
    await expect(remove).toBeVisible();
    await remove.click();

    // No database, so the removal failed and there is nothing to undo. The
    // screen says so instead of confirming.
    await expect(
      page.locator("p[role=alert]").filter({ hasText: /no database connected/i }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: /^undo$/i })).toHaveCount(0);
  });

  test("adding a source with no database says so", async ({ page }) => {
    await page.goto(`/${ORG}/sources`);

    await page.getByRole("button", { name: /add a source/i }).click();
    await page.getByRole("textbox", { name: /name/i }).fill("Blockworks");
    await page.getByRole("button", { name: /^Add source$/ }).click();

    await expect(
      page.getByRole("alert").filter({ hasText: /no database connected/i }),
    ).toBeVisible();
  });
});
