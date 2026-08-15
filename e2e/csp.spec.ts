import { expect, test } from "@playwright/test";

/**
 * SEC-03.
 *
 * A CSP is unusually hard to verify by reading, because getting it wrong does
 * not throw: the header is present, the audit check passes, and one script on
 * one route quietly does not run. So these tests assert the two things that
 * actually distinguish a working nonce policy from a decorative one —
 * the nonce reaches the framework's own inline scripts, and the browser
 * reports no violations while rendering a real page.
 *
 * The suite runs against whichever mode is configured. With `CSP_ENFORCE`
 * unset (the default, and what CI uses) the policy is report-only and
 * violations are still observable through the console. Run the whole suite
 * with `CSP_ENFORCE=true` before flipping the switch in production — that is
 * the rehearsal this file exists for.
 */

const ORG = "acme";

/**
 * Whichever of the two headers carries the real policy, plus which one it was.
 *
 * Picked by content rather than by preferring the enforcing name, because
 * there are always two: `next.config.ts` sets a static
 * `Content-Security-Policy: frame-ancestors 'none'` for the responses the
 * middleware matcher never sees. In report-only mode that static one shadowed
 * the real policy and every assertion here failed against a working app —
 * which is a test bug that looks exactly like a product bug.
 */
function policyFrom(headers: Record<string, string>) {
  const enforcing = headers["content-security-policy"] ?? "";
  const reportOnly = headers["content-security-policy-report-only"] ?? "";
  const full = [enforcing, reportOnly].find((p) => p.includes("script-src"));

  return {
    policy: full ?? enforcing ?? reportOnly,
    enforcing: enforcing.includes("script-src"),
  };
}

test.describe("the policy itself", () => {
  test("ships a script-src with a nonce, not unsafe-inline", async ({ request }) => {
    const { policy } = policyFrom((await request.get("/login")).headers());

    expect(policy).toContain("script-src");
    expect(policy).toMatch(/'nonce-[A-Za-z0-9+/=]+'/);
    expect(policy).toContain("'strict-dynamic'");

    // The whole point. `'unsafe-inline'` in a script-src permits every inline
    // script, including an injected one, which makes the nonce decorative.
    const scriptSrc = policy.split(";").find((d) => d.trim().startsWith("script-src"));
    expect(scriptSrc).not.toContain("'unsafe-inline'");
  });

  test("carries the directives that make script-src worth having", async ({
    request,
  }) => {
    const { policy } = policyFrom((await request.get("/login")).headers());

    // Without this a plugin is still a code-execution path.
    expect(policy).toContain("object-src 'none'");
    // Without this an injected <base> re-points every relative script URL.
    expect(policy).toContain("base-uri 'self'");
    // A form posting off-origin is a credential-harvesting primitive.
    expect(policy).toContain("form-action 'self'");
    expect(policy).toContain("frame-ancestors 'none'");
  });

  test("issues a different nonce on every response", async ({ request }) => {
    // A nonce that repeats is a password an attacker only has to read once.
    const nonces = new Set<string>();
    for (let i = 0; i < 3; i++) {
      const { policy } = policyFrom((await request.get("/login")).headers());
      nonces.add(policy.match(/'nonce-([A-Za-z0-9+/=]+)'/)?.[1] ?? "");
    }
    expect(nonces.size).toBe(3);
  });

  test("applies to the demo-mode paths too, not just the guarded ones", async ({
    request,
  }) => {
    // The middleware returns early when Supabase is unconfigured. A header set
    // only on the fully-configured path is a header missing from every preview
    // deployment — which is where this suite runs.
    for (const path of [`/${ORG}/dashboard`, "/kitchen-sink", "/login"]) {
      const { policy } = policyFrom((await request.get(path)).headers());
      expect(policy, `${path} has no CSP`).toContain("script-src");
    }
  });

  test("names a reporting endpoint that exists", async ({ request }) => {
    const { policy } = policyFrom((await request.get("/login")).headers());
    expect(policy).toContain("report-uri /api/csp-report");

    // And it must be reachable without a session: a browser sends a report on
    // its own initiative, often for a visitor who has none. Behind the auth
    // guard this would answer 307 and the report stream would be empty.
    const response = await request.post("/api/csp-report", {
      headers: { "content-type": "application/csp-report" },
      data: JSON.stringify({
        "csp-report": {
          "effective-directive": "script-src",
          "blocked-uri": "inline",
          "document-uri": "https://huntloop.example/login",
        },
      }),
      maxRedirects: 0,
    });
    expect(response.status()).toBe(204);
  });

  test("the report endpoint refuses to be a megaphone", async ({ request }) => {
    // It reaches the alerting channel engineers read, so an oversized or
    // malformed body must be dropped rather than forwarded.
    const oversized = await request.post("/api/csp-report", {
      headers: { "content-type": "application/csp-report" },
      data: JSON.stringify({ "csp-report": { "blocked-uri": "x".repeat(20_000) } }),
      maxRedirects: 0,
    });
    expect(oversized.status()).toBe(204);

    const garbage = await request.post("/api/csp-report", {
      headers: { "content-type": "application/csp-report" },
      data: "not json at all",
      maxRedirects: 0,
    });
    expect(garbage.status()).toBe(204);
  });
});

test.describe("the policy against real pages", () => {
  // The assertion that a static reading cannot make: the browser parsed this
  // policy, rendered the page under it, and complained about nothing.
  for (const path of ["/login", `/${ORG}/dashboard`, `/${ORG}/opportunities`, "/no/such/place"]) {
    test(`${path} renders with no CSP violation`, async ({ page }) => {
      const violations: string[] = [];
      page.on("console", (message) => {
        const text = message.text();
        if (/content security policy|Refused to (load|execute|apply)/i.test(text)) {
          violations.push(text);
        }
      });

      await page.goto(path);
      await page.waitForLoadState("networkidle");

      expect(violations, `CSP violations on ${path}`).toEqual([]);
    });
  }

  test("Next's inline bootstrap scripts carry the nonce", async ({ request }) => {
    /*
     * The specific failure this catches, and the reason SEC-03 was a task of
     * its own rather than a line in next.config.ts.
     *
     * Next injects inline scripts carrying the flight data that hydrates the
     * App Router. It stamps them with the nonce only if it can *find* one — by
     * reading the Content-Security-Policy header off the incoming request.
     * Set the policy on the response alone and every inline script goes
     * un-nonced: report-only, that is a stream of violations; enforcing, the
     * page loads and never hydrates.
     *
     * ── Asserted against the raw HTML, not the DOM ───────────────────────
     *
     * The first version of this test read `nonce` off the live elements and
     * failed against a working policy. Browsers implement "nonce hiding":
     * once a script has been checked, the content attribute is blanked, so a
     * page that is behaving perfectly reports an empty nonce to script that
     * inspects it. That defence exists precisely to stop an attacker
     * exfiltrating the nonce via CSS attribute selectors — so this test has to
     * look at what the server sent, before the browser gets its hands on it.
     */
    const response = await request.get("/login");
    const html = await response.text();

    const nonce = policyFrom(response.headers()).policy.match(
      /'nonce-([A-Za-z0-9+/=]+)'/,
    )?.[1];
    expect(nonce, "no nonce in the policy").toBeTruthy();

    // Inline scripts only — `<script src=…>` is covered by 'self'.
    const inline = [...html.matchAll(/<script(?![^>]*\ssrc=)([^>]*)>/g)].map(
      (m) => m[1] ?? "",
    );
    expect(inline.length, "no inline scripts in the document").toBeGreaterThan(0);

    for (const attributes of inline) {
      expect(
        attributes.includes(`nonce="${nonce}"`),
        `an inline script was served without the nonce: <script${attributes}>`,
      ).toBe(true);
    }
  });

  test("the app still works when the policy is enforced", async ({ page }) => {
    /*
     * Hydration is the thing a broken CSP takes away, and it fails silently:
     * the server-rendered HTML looks perfect and nothing responds to a click.
     * Filtering the opportunity list is client state, so if this passes, React
     * is alive under the policy.
     */
    await page.goto(`/${ORG}/opportunities`);

    const filters = page.getByRole("group", { name: /filter by priority/i });
    await filters.getByRole("button", { name: /hot/i }).click();
    await expect(filters.getByRole("button", { name: /hot/i })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
});
