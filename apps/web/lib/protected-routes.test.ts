import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { WORKSPACE_SECTIONS, isProtectedRoute } from "./protected-routes";

describe("isProtectedRoute", () => {
  /* The list fails closed — a missing section 404s anonymous visitors rather
     than exposing anything — but a missing section still breaks "sign in and
     come back here" for that screen, so it has to track the folders. */
  it("lists every workspace screen on disk", () => {
    const dir = fileURLToPath(new URL("../app/(app)/[org]", import.meta.url));
    const onDisk = readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith("_") && !e.name.startsWith("("))
      .map((e) => e.name)
      .sort();
    expect([...WORKSPACE_SECTIONS].sort()).toEqual(onDisk);
  });

  it.each([
    "/kima/dashboard",
    "/kima/settings/icp",
    "/kima/opportunities/abc-123",
    "/orgs",
    "/welcome",
    "/welcome/icp",
    "/invite/token",
    "/api/mailboxes/gmail/start",
  ])("sends %s to sign-in", (path) => {
    expect(isProtectedRoute(path)).toBe(true);
  });

  it.each(["/nope", "/pricing", "/kima", "/kima/nope", "/welcomes", "/orgsx", "/a/b/c"])(
    "treats %s as not a page",
    (path) => {
      expect(isProtectedRoute(path)).toBe(false);
    },
  );
});
