import { expect, test } from "@playwright/test";

/**
 * Routes, redirects, and the things a browser asks for that a compiler never
 * does.
 *
 * Three of the findings in this file's scope were invisible to typecheck,
 * lint and build, and one of them (`SEO-03`) was found only by requesting the
 * URL. That is the pattern worth guarding: these are all assertions about what
 * the *running server* answers.
 */

test.describe("the front door", () => {
  test("/ sends visitors to sign-in, not to the component gallery", async ({
    page,
  }) => {
    // It used to redirect to /kitchen-sink — which is also the canonical URL
    // in the sitemap and the Open Graph `url`, so the internal swatch board
    // was the first thing every crawler and first-time visitor saw (SEO-04).
    const response = await page.goto("/");
    expect(response?.status()).toBe(200);
    await expect(page).toHaveURL(/\/login$/);
  });

  test("the redirect is temporary, so a landing page can replace it", async ({
    request,
  }) => {
    // A 308 is cached by browsers more or less forever. Shipping one here
    // would make the eventual landing page invisible to everyone who had
    // already visited.
    const response = await request.get("/", { maxRedirects: 0 });
    expect(response.status()).toBe(307);
    expect(response.headers()["location"]).toContain("/login");
  });
});

test.describe("crawler routes", () => {
  // SEO-03: these are routes (app/robots.ts, app/sitemap.ts), not files, so
  // they fell through the auth matcher and every crawler got a 307 to /login —
  // a robots policy that nothing could read. Found by curl, not by review.
  test("robots.txt is served, not redirected to /login", async ({ request }) => {
    const response = await request.get("/robots.txt", { maxRedirects: 0 });
    expect(response.status()).toBe(200);

    const body = await response.text();
    expect(body).toContain("User-Agent: *");
    // The gallery is public on purpose and emphatically not the page anyone
    // should reach from a search for "Huntloop".
    expect(body).toContain("Disallow: /kitchen-sink");
    expect(body).toContain("Sitemap:");
  });

  test("sitemap.xml is served, not redirected to /login", async ({ request }) => {
    const response = await request.get("/sitemap.xml", { maxRedirects: 0 });
    expect(response.status()).toBe(200);
    expect(await response.text()).toContain("<urlset");
  });

  test("the sitemap lists no URL that answers with a redirect", async ({
    request,
  }) => {
    // A sitemap entry that 307s is reported as an error by Search Console.
    // This is why `/` is deliberately absent from it.
    const xml = await (await request.get("/sitemap.xml")).text();
    const locations = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    expect(locations.length).toBeGreaterThan(0);

    for (const location of locations) {
      const path = new URL(location).pathname;
      const response = await request.get(path, { maxRedirects: 0 });
      expect(response.status(), `${path} is in the sitemap`).toBe(200);
    }
  });

  test("the app icon is served, so browsers stop 404ing on the favicon", async ({
    request,
  }) => {
    const response = await request.get("/icon.svg");
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("svg");
  });
});

test.describe("security response headers", () => {
  test("every header the config declares actually reaches the browser", async ({
    request,
  }) => {
    const headers = (await request.get("/login")).headers();

    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["x-frame-options"]).toBe("DENY");
    // The app has approve-and-send actions behind single clicks, which is the
    // exact shape a framing attack targets.
    expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    // Org slugs and opportunity ids are in the URL path, and the opportunity
    // page links out to prospect websites. Under the browser default, every
    // such click leaked the full internal URL to a third party.
    expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["permissions-policy"]).toContain("camera=()");
  });

  test("the server does not announce what it is", async ({ request }) => {
    const headers = (await request.get("/login")).headers();
    expect(headers["x-powered-by"]).toBeUndefined();
  });
});

test.describe("the 404", () => {
  test("renders our page rather than the framework default", async ({ page }) => {
    const response = await page.goto("/no/such/place");
    expect(response?.status()).toBe(404);
    // The description rather than the heading: "Not found" also matches the
    // <title>, and a strict-mode locator that resolves to two elements is a
    // test that fails for a reason having nothing to do with the app.
    await expect(page.getByText("There is nothing at this address.")).toBeVisible();
  });

  test("says nothing that distinguishes 'no such org' from 'not your org'", async ({
    page,
  }) => {
    /*
     * This page is load-bearing for a security decision. The org layout calls
     * notFound() rather than returning 403 when the caller is not a member, so
     * that guessing a slug cannot be used to enumerate Huntloop's customers.
     * Copy like "you may not have access" or "ask an admin" would hand back
     * exactly the distinction the 404 was chosen to withhold.
     */
    await page.goto("/no/such/place");
    const body = (await page.locator("body").innerText()).toLowerCase();

    for (const leak of ["access", "permission", "admin", "member", "exists", "403"]) {
      expect(body, `404 copy leaks "${leak}"`).not.toContain(leak);
    }
  });
});

test.describe("unsubscribe", () => {
  /* A structurally valid v4 uuid — the variant nibble matters, and zod checks
     it. Real tokens come from `gen_random_uuid()`, so they always are. */
  const TOKEN = "4a3b2c1d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";

  test("the link in an email reaches a page, not a login redirect", async ({ page }) => {
    /*
     * Every message this product sends carries `List-Unsubscribe` and a footer
     * line pointing here, and for a while both pointed at nothing: the route
     * did not exist and `/unsubscribe` was not a public path, so a recipient
     * got a redirect to a sign-in form for an account they do not have.
     *
     * A dead unsubscribe is not a broken link. It is a spam report, charged to
     * the sending domain and to every other campaign running from it.
     */
    const response = await page.goto(`/unsubscribe/${TOKEN}`);

    expect(response?.status(), "the page answered").toBe(200);
    await expect(page).toHaveURL(new RegExp(`/unsubscribe/${TOKEN}$`));
    await expect(page.getByRole("heading", { name: /unsubscribe/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /unsubscribe me/i })).toBeVisible();
  });

  test("arriving does not unsubscribe anybody — only the button does", async ({
    page,
  }) => {
    // Mail clients and security gateways prefetch links in messages. A GET
    // that acted would remove people who never clicked, triggered by the
    // software trying to protect them.
    await page.goto(`/unsubscribe/${TOKEN}`);
    await expect(page.getByText(/you have been unsubscribed/i)).toHaveCount(0);
  });

  test("with no database it says so rather than reporting success", async ({ page }) => {
    // §7 aimed at the person with the least reason to forgive it: telling
    // somebody they will not be emailed again, and then emailing them.
    await page.goto(`/unsubscribe/${TOKEN}`);
    await page.getByRole("button", { name: /unsubscribe me/i }).click();

    // Scoped to a paragraph: Next renders its own empty `role="alert"` route
    // announcer on every page, which an unscoped alert role also matches.
    await expect(
      page.locator("p[role=alert]").filter({ hasText: /no database connected/i }),
    ).toBeVisible();
    await expect(page.getByText(/you have been unsubscribed/i)).toHaveCount(0);
  });

  test("the one-click endpoint refuses a token that is not one", async ({ request }) => {
    // RFC 8058 posts to this address. A malformed token is rejected before it
    // reaches the database rather than becoming a 500.
    const response = await request.post("/api/unsubscribe/not-a-token");
    expect(response.status()).toBe(400);
  });

  test("the one-click endpoint is reachable without a session", async ({ request }) => {
    /*
     * The check that matters for deliverability: Gmail posts here with no
     * cookies at all. Anything other than a straight answer — a redirect to
     * /login especially — is a failed one-click unsubscribe.
     *
     * 503 in demo mode is the honest answer and is not a 3xx.
     */
    const response = await request.post(`/api/unsubscribe/${TOKEN}`, {
      maxRedirects: 0,
    });
    expect(response.status(), "must not redirect to a sign-in page").toBe(503);
  });
});
