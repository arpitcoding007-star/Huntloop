import { expect, test } from "@playwright/test";

/**
 * The second half of the nav — Team, Engage and Learn — in demo mode.
 *
 * A companion to `modules.spec.ts`, which covers Company and Hunt. Split
 * because one file covering thirteen screens is a file nobody reads before
 * adding the fourteenth, and the nav already draws the line here.
 *
 * Same rules as the other file: assert on rendered content rather than status
 * codes, and collect `pageerror` — a screen that renders its heading and
 * throws underneath is still broken. See the header there for why.
 */

const ORG = "acme";

/** Fails the test on any uncaught error, not just a missing element. */
function watchForErrors(page: import("@playwright/test").Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

test.describe("team", () => {
  test("says why members have no names instead of showing a blank", async ({ page }) => {
    /*
     * TEAM-01. Names live in `auth.users`, which tenants cannot read and which
     * would need the service-role client this app is forbidden to import. A
     * blank where a name goes reads as "this person has no name" rather than
     * "we cannot see it", so the screen states the reason.
     */
    const errors = watchForErrors(page);
    await page.goto(`/${ORG}/team`);

    await expect(page.getByRole("heading", { name: "Team" })).toBeVisible();
    await expect(page.getByText(/aren.t shown because they live in/i)).toBeVisible();
    await expect(page.getByText(/what each role may do/i)).toBeVisible();

    expect(errors, "the page threw while rendering").toEqual([]);
  });

  test("Invite says why it cannot act", async ({ page }) => {
    // NAV-03: creating a user is `auth.admin` and needs a server-side path
    // that does not exist. TEAM-02 in the backlog.
    await page.goto(`/${ORG}/team`);

    const invite = page.getByRole("button", { name: /invite/i });
    await expect(invite).toBeVisible();
    await expect(invite).toHaveAttribute("aria-disabled", "true");
  });

  test("assignments separate the work nobody owns", async ({ page }) => {
    // The only part of the screen anyone comes to change. Mixing owned and
    // unowned rows makes "what is nobody working on?" a scanning exercise.
    const errors = watchForErrors(page);
    await page.goto(`/${ORG}/team/assignments`);

    await expect(page.getByText(/nobody is working on these/i)).toBeVisible();
    await expect(page.getByText("Unassigned").first()).toBeVisible();

    expect(errors, "the page threw while rendering").toEqual([]);
  });
});

test.describe("pipeline", () => {
  test("renders a column per stage, and keeps closed work visible", async ({ page }) => {
    /*
     * The enum has eleven states. Dropping the terminal ones would make an
     * opportunity disappear when it is marked lost, which is worse than a
     * crowded board — so they share one column at the end.
     */
    const errors = watchForErrors(page);
    await page.goto(`/${ORG}/pipeline`);

    await expect(page.getByRole("heading", { name: "Pipeline" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Discovered" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Won" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Closed" })).toBeVisible();

    expect(errors, "the page threw while rendering").toEqual([]);
  });

  test("the board scrolls inside itself, not the page", async ({ page }) => {
    // Nine columns at a readable width exceed any viewport, and a
    // horizontally scrolling document breaks the sidebar.
    await page.goto(`/${ORG}/pipeline`);

    const contained = await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    );
    expect(contained, "the page body must never scroll sideways").toBe(true);
  });
});

test.describe("outreach", () => {
  test("leads with whether anything sends without approval", async ({ page }) => {
    // §46's ladder is the only field on a campaign that can hurt somebody, so
    // it is a named choice rather than a 0–5 number, and the count of
    // campaigns sending unattended is stated at the top.
    const errors = watchForErrors(page);
    await page.goto(`/${ORG}/outreach`);

    await expect(page.getByRole("heading", { name: "Outreach" })).toBeVisible();
    await expect(page.getByText("Sending without approval")).toBeVisible();
    await expect(page.getByText(/draft only/i).first()).toBeVisible();

    expect(errors, "the page threw while rendering").toEqual([]);
  });

  test("says a mailbox cannot be connected yet, rather than offering it", async ({
    page,
  }) => {
    await page.goto(`/${ORG}/outreach`);

    const connect = page.getByRole("button", { name: /connect a mailbox/i });
    await expect(connect).toBeVisible();
    await expect(connect).toHaveAttribute("aria-disabled", "true");
    await expect(page.getByText(/no mailbox is connected/i)).toBeVisible();
  });
});

test.describe("inbox", () => {
  test("renders a delivery failure as a failure", async ({ page }) => {
    /*
     * §78: "record the failure and do not falsely mark the message as sent."
     * A bounce and a message with no events yet look identical in most
     * inboxes and mean opposite things.
     */
    const errors = watchForErrors(page);
    await page.goto(`/${ORG}/inbox`);

    await expect(page.getByRole("heading", { name: "Inbox" })).toBeVisible();
    await expect(page.getByText(/did not reach anybody/i)).toBeVisible();
    await expect(page.getByText("Delivery failed").first()).toBeVisible();
    await expect(page.getByText("bounced").first()).toBeVisible();

    expect(errors, "the page threw while rendering").toEqual([]);
  });

  test("shows whether a drafted message cites any evidence", async ({ page }) => {
    // §62 rule 9: a personalised claim names the evidence behind it, or the
    // message does not send. Shown per message, because it is checked per
    // message.
    await page.goto(`/${ORG}/inbox`);
    await expect(page.getByText(/\d+ evidence/).first()).toBeVisible();
  });

  test("Reply says why it cannot act", async ({ page }) => {
    // Sending needs a connected mailbox, and there is no OAuth flow or token
    // storage. A reply box would compose a message with nowhere to send it.
    await page.goto(`/${ORG}/inbox`);

    const reply = page.getByRole("button", { name: /^reply$/i }).first();
    await expect(reply).toHaveAttribute("aria-disabled", "true");
  });
});

test.describe("intelligence", () => {
  test("leads with the fact-versus-inference split", async ({ page }) => {
    // §7 makes the distinction the product's central claim. An account with
    // 200 inferences and 3 facts is in a very different state from the
    // reverse, and no other number on the screen distinguishes them.
    const errors = watchForErrors(page);
    await page.goto(`/${ORG}/intelligence`);

    await expect(page.getByRole("heading", { name: "Intelligence" })).toBeVisible();
    await expect(page.getByText("Facts")).toBeVisible();
    await expect(page.getByText("Inferences")).toBeVisible();
    await expect(page.getByText("Open questions")).toBeVisible();

    expect(errors, "the page threw while rendering").toEqual([]);
  });

  test("an unmeasured trigger strength reads unknown, not zero", async ({ page }) => {
    // §78: a 0 asserts "we measured this and it is weak", which is a finding
    // nobody made.
    await page.goto(`/${ORG}/intelligence`);
    await expect(page.getByText("strength unknown")).toBeVisible();
  });
});

test.describe("memory", () => {
  test("keeps what you said apart from what Huntloop concluded", async ({ page }) => {
    // §7, applied to the product's own memory: a conclusion and an
    // instruction are different kinds of thing.
    const errors = watchForErrors(page);
    await page.goto(`/${ORG}/memory`);

    await expect(page.getByRole("heading", { name: "Memory" })).toBeVisible();
    await expect(page.getByText(/what you have told huntloop/i)).toBeVisible();
    await expect(page.getByText(/what huntloop worked out/i)).toBeVisible();

    expect(errors, "the page threw while rendering").toEqual([]);
  });

  test("asks for a subject only when the scope needs one", async ({ page }) => {
    /*
     * `memories_scope_id_presence`: organisation scope takes no subject, and
     * every other scope requires one. A user-scoped memory with a NULL
     * `scope_id` matches every user's retrieval filter — the §37 leak the
     * column exists to prevent — so the field appears with the scope rather
     * than sitting there inviting a blank.
     */
    await page.goto(`/${ORG}/memory`);
    await page.getByRole("button", { name: /add a memory/i }).click();

    await expect(page.getByRole("textbox", { name: /subject/i })).toBeHidden();

    await page.getByRole("combobox", { name: /who this applies to/i }).selectOption("user");
    await expect(page.getByRole("textbox", { name: /subject/i })).toBeVisible();
  });
});
