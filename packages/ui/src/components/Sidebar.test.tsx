import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { Flame } from "lucide-react";
import { Sidebar, type NavSection } from "./Sidebar";

/** Explicit cleanup, because `globals: false`. See the note in DataTable.test.tsx. */
afterEach(cleanup);

/**
 * FEAT-01 — the `unbuilt` mechanism, tested where it lives.
 *
 * ── Why this moved here ──────────────────────────────────────────────────
 *
 * The guarantee used to be asserted end-to-end, by a Playwright test that
 * counted the `aria-disabled` items in the running app's sidebar and required
 * at least one. That worked while most of the nav was unbuilt. It stopped
 * working the moment the last destination was built — the count went to zero
 * and the test failed against an app that had got *better*.
 *
 * The mechanism still has to work: the next destination added to the §45
 * surface map will be a label before it is a page, and if `unbuilt` has
 * quietly rotted in the meantime it will ship as a link onto a 404, which is
 * the §7 failure the flag exists to prevent.
 *
 * So the assertion belongs to the component, where an unbuilt item can be
 * rendered on purpose rather than waited for. The browser test keeps the
 * weaker invariant — *if* the app renders one, it is not a link — which is
 * now vacuously true and will start meaning something again on its own.
 */

const sections: NavSection[] = [
  {
    id: "hunt",
    label: "Hunt",
    icon: Flame,
    // `icon` is required on NavItem — the rail renders it when collapsed, so
    // an item without one has nothing to show at the width where the label
    // is gone. One icon for both items is enough; none of this is about which.
    items: [
      { label: "Opportunities", href: "/acme/opportunities", icon: Flame },
      { label: "Companies", href: "/acme/companies", icon: Flame, unbuilt: true },
    ],
  },
];

/**
 * `activeHref` is required by `SidebarProps`, and it is pointed at the built
 * item on purpose: the last test asserts that marking one item unbuilt does
 * not disturb its neighbour, and the active item is the neighbour most likely
 * to be disturbed.
 */
const renderSidebar = () =>
  render(<Sidebar sections={sections} activeHref="/acme/opportunities" />);

describe("an unbuilt destination", () => {
  it("is not a link", () => {
    // The whole point. A link onto a route that does not exist is the app
    // asserting a capability it does not have.
    renderSidebar();

    expect(screen.getByRole("link", { name: /^opportunities$/i })).toHaveProperty("href");
    expect(screen.queryByRole("link", { name: /companies/i })).toBeNull();
  });

  it("stays out of the tab order", () => {
    /*
     * A keyboard user who can reach it has nowhere to go, which is worse than
     * not being able to reach it at all — they cannot tell "not built" from
     * "broken", and they have spent a Tab stop finding out.
     */
    renderSidebar();

    const item = screen.getByText("Companies").closest("[aria-disabled]");
    expect(item).not.toBeNull();
    expect(item!.getAttribute("tabindex")).not.toBe("0");
    expect(item!.getAttribute("href")).toBeNull();
  });

  it("says it is not built, rather than looking merely disabled", () => {
    /*
     * A greyed-out control with no reason is the question NAV-03 exists to
     * stop shipping. The explanation rides on `title`, which is what gives the
     * span its accessible name — the visual "Soon" badge is not announced, and
     * is hidden entirely while the rail is collapsed.
     */
    renderSidebar();

    expect(screen.getByTitle(/companies — not built yet/i)).toBeTruthy();
  });

  it("leaves built destinations alone", () => {
    renderSidebar();

    const link = screen.getByRole("link", { name: /^opportunities$/i });
    expect(link.getAttribute("aria-disabled")).toBeNull();
  });
});

/* ── Two levels ────────────────────────────────────────────────────────── */

const Icon = Flame;
const twoLevel: NavSection[] = [
  { id: "home", label: "Home", icon: Icon, items: [{ label: "Command Center", href: "/a/dashboard", icon: Icon }] },
  {
    id: "company",
    label: "Company",
    icon: Icon,
    items: [
      { label: "Product", href: "/a/settings/product", icon: Icon },
      { label: "ICP", href: "/a/settings/icp", icon: Icon },
    ],
  },
];
const settings: NavSection[] = [
  {
    id: "settings",
    label: "Settings",
    icon: Icon,
    items: [
      { label: "Organisation", href: "/a/settings", icon: Icon },
      { label: "ICP", href: "/a/settings/icp", icon: Icon },
    ],
  },
];
const panel = () => screen.queryByRole("list", { name: /company|settings/i });
const railCurrent = () =>
  document.querySelector('a[aria-current="page"][title]')?.getAttribute("title");

describe("the two-level sidebar", () => {
  it("rail entries lead to their section's first page", () => {
    render(<Sidebar sections={twoLevel} footerSections={settings} activeHref="/a/dashboard" />);
    expect(screen.getByTitle("Company").getAttribute("href")).toBe("/a/settings/product");
    expect(screen.getByTitle("Settings").getAttribute("href")).toBe("/a/settings");
  });

  it("gives a single-page section no panel", () => {
    render(<Sidebar sections={twoLevel} activeHref="/a/dashboard" />);
    expect(panel()).toBeNull();
  });

  it("shows the current section's pages beside the rail", () => {
    render(<Sidebar sections={twoLevel} activeHref="/a/settings/icp" />);
    const list = within(panel()!);
    expect(list.getByRole("link", { name: "ICP" }).getAttribute("aria-current")).toBe("page");
  });

  it("hides the panel, not the rail, when closed", () => {
    render(<Sidebar sections={twoLevel} activeHref="/a/settings/icp" panelOpen={false} />);
    expect(screen.getByTitle("Company")).toBeTruthy();
    expect(screen.getByText("ICP").closest("[inert]")).not.toBeNull();
  });

  it("keeps the section you came from when a page sits in two", () => {
    const { rerender } = render(
      <Sidebar sections={twoLevel} footerSections={settings} activeHref="/a/settings" />,
    );
    rerender(<Sidebar sections={twoLevel} footerSections={settings} activeHref="/a/settings/icp" />);
    expect(railCurrent()).toBe("Settings");

    rerender(<Sidebar sections={twoLevel} footerSections={settings} activeHref="/a/settings/product" />);
    rerender(<Sidebar sections={twoLevel} footerSections={settings} activeHref="/a/settings/icp" />);
    expect(railCurrent()).toBe("Company");
  });

  it("previews a section instead of navigating when the rail selects", () => {
    render(
      <Sidebar sections={twoLevel} footerSections={settings} activeHref="/a/dashboard" railSelects />,
    );
    const tap = fireEvent.click(screen.getByTitle("Settings"));
    expect(tap).toBe(false); // default prevented
    expect(within(panel()!).getByRole("link", { name: "Organisation" })).toBeTruthy();
  });
});
