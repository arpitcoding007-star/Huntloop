import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Where `/`, the auth callback and the org picker send a signed-in person.
 *
 * The regression held down here: an unfinished workspace used to resolve to
 * its onboarding step, so every route into the product — typing the domain,
 * signing in again, picking the workspace — landed back in the wizard. The
 * workspace is usable before setup is done; the resolver must say so.
 */

const state = {
  user: { id: "u1" } as { id: string } | null,
  rows: [] as unknown[],
};

vi.mock("./source", () => ({
  resolveDataSource: async () => ({
    db: {
      auth: { getUser: async () => ({ data: { user: state.user } }) },
      from: () => {
        const q = {
          select: () => q,
          eq: () => q,
          is: () => q,
          order: async () => ({ data: state.rows, error: null }),
        };
        return q;
      },
    },
  }),
}));
vi.mock("./onboarding-schema", () => ({ hasOnboardingSchema: async () => true }));
vi.mock("../demo", () => ({ DEMO_HOME: "/demo/dashboard" }));
vi.mock("./onboarding", () => ({
  ONBOARDING_STEPS: ["you", "company", "goals", "icp", "sources", "building", "review", "done"],
}));

const org = (slug: string, step: string, completed: string | null = null) => ({
  role: "owner",
  created_at: "2026-01-01",
  organizations: {
    id: `id-${slug}`,
    slug,
    name: slug,
    onboarding_step: step,
    onboarding_completed_at: completed,
    deleted_at: null,
  },
});

const { continueTarget, resolveDestination } = await import("./destination");

describe("resolveDestination", () => {
  beforeEach(() => {
    state.user = { id: "u1" };
    state.rows = [];
  });

  it("sends an unfinished workspace to its dashboard, not back into setup", async () => {
    state.rows = [org("kima", "icp")];
    const d = await resolveDestination();
    expect(d).toEqual({
      kind: "workspace",
      path: "/kima/dashboard",
      orgSlug: "kima",
      setupStep: "icp",
    });
  });

  it("marks a finished workspace as having no setup left", async () => {
    state.rows = [org("kima", "done", "2026-02-01")];
    const d = await resolveDestination();
    expect(d).toMatchObject({ path: "/kima/dashboard", setupStep: null });
  });

  it("still starts onboarding for somebody with no workspace", async () => {
    expect(await resolveDestination()).toEqual({ kind: "new-user", path: "/welcome" });
  });

  it("asks somebody with several workspaces to choose", async () => {
    state.rows = [org("a", "done"), org("b", "icp")];
    expect((await resolveDestination()).path).toBe("/orgs");
  });

  it("honours a remembered workspace, unfinished or not", async () => {
    state.rows = [org("a", "done"), org("b", "goals")];
    expect((await resolveDestination("b")).path).toBe("/b/dashboard");
  });

  it("sends a visitor with no session to sign in", async () => {
    state.user = null;
    expect((await resolveDestination()).kind).toBe("anonymous");
  });
});

/**
 * What the landing page offers a signed-in visitor instead of redirecting
 * them. `/` used to send every session straight to `/<org>/dashboard`, so the
 * domain resolved to the dashboard and a failing dashboard had no way back.
 */
describe("continueTarget", () => {
  it("offers nothing to an anonymous visitor or the demo", () => {
    expect(continueTarget({ kind: "anonymous", path: "/login" })).toBeNull();
    expect(continueTarget({ kind: "demo", path: "/demo/dashboard" })).toBeNull();
  });

  it("continues setup at the step an unfinished workspace stopped at", () => {
    expect(
      continueTarget({ kind: "workspace", path: "/kima/dashboard", orgSlug: "kima", setupStep: "icp" }),
    ).toEqual({ href: "/welcome/icp?org=kima", label: "Continue setup" });
  });

  it("opens the dashboard of a finished workspace", () => {
    expect(
      continueTarget({ kind: "workspace", path: "/kima/dashboard", orgSlug: "kima", setupStep: null }),
    ).toEqual({ href: "/kima/dashboard", label: "Open workspace" });
  });

  it("starts onboarding for somebody with no workspace yet", () => {
    expect(continueTarget({ kind: "new-user", path: "/welcome" })).toEqual({
      href: "/welcome",
      label: "Continue setup",
    });
  });
});
