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
  test("a member is named rather than shown as a uuid", async ({ page }) => {
    /*
     * TEAM-01. This screen used to show uuids and a sentence explaining that
     * names live in `auth.users`, which tenants cannot read. `0007`'s
     * `profiles` — one row per user, written by a trigger and readable only by
     * co-members — closed that, so the explanation is gone and the name is
     * there.
     *
     * What is asserted is the invariant rather than a fixture's name: no row
     * in the member list is identified by a bare uuid. The fallback chain is
     * name, then address, then id, and only the last of those is a failure —
     * so finding one means the profile join stopped working.
     */
    const errors = watchForErrors(page);
    await page.goto(`/${ORG}/team`);

    await expect(page.getByRole("heading", { name: "Team" })).toBeVisible();
    await expect(page.getByText(/what each role may do/i)).toBeVisible();

    /* Read through the role control's own label rather than a test id: each
       row labels its select "Role for <name>", so the accessible name already
       carries the identity this test is about and no markup exists only to be
       queried. */
    const uuid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
    const labels = await page.getByText(/^Role for /).allInnerTexts();
    expect(labels.length, "no members rendered").toBeGreaterThan(0);
    for (const label of labels) {
      expect(label, "a member is identified by a bare uuid").not.toMatch(uuid);
    }

    expect(errors, "the page threw while rendering").toEqual([]);
  });

  test("with no database, inviting says so rather than appearing to work", async ({
    page,
  }) => {
    /*
     * TEAM-02, and it is built now: `0007` added `invitations`, and the button
     * that used to be a label opens a real form. What has to stay true is the
     * §7 rule — in demo mode there is nowhere to write an invitation to, and
     * the screen says that instead of showing a link nobody can accept.
     */
    await page.goto(`/${ORG}/team`);

    await page.getByRole("button", { name: /^invite$/i }).click();
    await expect(page.getByLabel(/email/i)).toBeVisible();

    await page.getByLabel(/email/i).fill("dana@example.com");
    await page.getByRole("button", { name: /create invitation/i }).click();

    // Scoped to a paragraph: Next renders its own empty `role="alert"` route
    // announcer on every page, which an unscoped alert role also matches.
    await expect(
      page.locator("p[role=alert]").filter({ hasText: /no database connected/i }),
    ).toBeVisible();
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

  test("names what is missing before offering to connect a mailbox", async ({
    page,
  }) => {
    /*
     * Connecting is built — an OAuth flow per provider, and tokens encrypted
     * before they are stored. Three deployment facts have to be true before it
     * can run, though: a database, credentials for a provider, and an
     * encryption key.
     *
     * In demo mode the first is missing, and the control says so rather than
     * starting a flow that cannot finish. That is the assertion worth keeping
     * from when this was genuinely unbuilt: the reason is on the control, not
     * discovered after the user has granted access to their mail.
     */
    await page.goto(`/${ORG}/outreach`);

    const connect = page.getByRole("button", { name: /connect a mailbox/i });
    await expect(connect).toBeVisible();
    await expect(connect).toHaveAttribute("aria-disabled", "true");
    await expect(connect).toHaveAttribute("title", /no database connected/i);
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

  test("an unsent message says which of the two kinds of unsent it is", async ({
    page,
  }) => {
    /*
     * Both are "not sent" and only one is waiting on a person. Collapsing them
     * into one badge hides the approval queue inside the send queue, so the
     * reader cannot tell which messages are theirs to act on — which is §46's
     * ladder made invisible at the point it applies.
     */
    await page.goto(`/${ORG}/inbox`);

    await expect(page.getByText(/awaiting approval/i).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /^approve$/i }).first()).toBeVisible();
  });

  test("the reply box queues rather than claiming to send", async ({ page }) => {
    /*
     * "Queue reply", because that is what happens: the action writes an
     * approved message and the runner sends it on the next tick. A button
     * labelled Send would be found out the first time somebody watched for the
     * message to show as sent.
     *
     * In demo mode there is nowhere to write it, and the screen says so — the
     * §7 rule the whole demo configuration exists to keep.
     */
    await page.goto(`/${ORG}/inbox`);

    await page.getByRole("button", { name: /^reply$/i }).first().click();
    await page.getByLabel(/your reply/i).fill("Thursday works — I will send an invite.");
    await page.getByRole("button", { name: /queue reply/i }).click();

    // Scoped to a paragraph: Next renders its own empty `role="alert"` route
    // announcer on every page, which an unscoped alert role also matches.
    await expect(
      page.locator("p[role=alert]").filter({ hasText: /no database connected/i }),
    ).toBeVisible();
  });

  test("a conversation with nothing incoming says why it cannot be replied to", async ({
    page,
  }) => {
    // A reply goes to whoever wrote last, so a thread that has only ever sent
    // has no address to answer. The control says which, rather than failing
    // after the user has written something.
    await page.goto(`/${ORG}/inbox`);

    const replies = page.getByRole("button", { name: /^reply$/i });
    await expect(replies.nth(1)).toHaveAttribute("aria-disabled", "true");
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
