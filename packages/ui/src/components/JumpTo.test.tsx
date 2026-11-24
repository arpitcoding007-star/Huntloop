import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Flame } from "lucide-react";
import { JumpTo, rank, type JumpToItem } from "./JumpTo";
import { Sidebar } from "./Sidebar";

/** Explicit cleanup, because `globals: false`. See the note in DataTable.test.tsx. */
afterEach(cleanup);

/* jsdom has no <dialog> behaviour. The palette only needs the element to
   report itself open, which is all these two stubs do. */
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
});

const items: JumpToItem[] = [
  { label: "Command Center", href: "/acme/dashboard" },
  { label: "Intelligence", href: "/acme/intelligence", group: "Learn" },
  { label: "Inbox", href: "/acme/inbox", group: "Engage" },
  { label: "Outreach", href: "/acme/outreach", group: "Engage" },
  { label: "What we've learned", href: "/acme/learn", group: "Learn" },
];

describe("rank", () => {
  it("returns everything, in nav order, for an empty query", () => {
    expect(rank(items, "  ")).toEqual(items);
  });

  it("puts a label that starts with the query first", () => {
    // "in" — Inbox and Intelligence both start with it; Inbox is not
    // promoted over Intelligence, because within a tier the nav order holds.
    expect(rank(items, "in").map((i) => i.label)).toEqual(["Intelligence", "Inbox"]);
  });

  it("ranks a later word's start above a group match", () => {
    // "lea" starts a word in "What we've learned", and is also the start of
    // the group "Learn" — so Intelligence follows, one tier down.
    expect(rank(items, "lea").map((i) => i.label)).toEqual(["What we've learned", "Intelligence"]);
  });

  it("falls back to the group, so a group name lists the whole group", () => {
    expect(rank(items, "engage").map((i) => i.label)).toEqual(["Inbox", "Outreach"]);
  });
});

describe("records", () => {
  it("lists what the search finds, after the pages, and opens it", async () => {
    const onNavigate = vi.fn();
    const onSearch = vi.fn(async () => [{ label: "Inbox Ltd", href: "/acme/companies/1", group: "Company" }]);
    render(<JumpTo open onClose={() => {}} items={items} onNavigate={onNavigate} onSearch={onSearch} />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "inbox" } });
    const hit = await screen.findByRole("option", { name: /Inbox Ltd/ });
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([expect.stringContaining("Inbox"), expect.stringContaining("Inbox Ltd")]);
    fireEvent.click(hit);
    expect(onNavigate).toHaveBeenCalledWith("/acme/companies/1");
  });

  it("says when records could not be searched", async () => {
    render(<JumpTo open onClose={() => {}} items={items} onNavigate={() => {}} onSearch={async () => { throw new Error("down"); }} />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "zzzz" } });
    expect(await screen.findByText(/could not be searched/)).toBeTruthy();
  });

  it("does not search for one character", async () => {
    const onSearch = vi.fn(async () => []);
    render(<JumpTo open onClose={() => {}} items={items} onNavigate={() => {}} onSearch={onSearch} />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "i" } });
    await new Promise((r) => setTimeout(r, 300));
    expect(onSearch).not.toHaveBeenCalled();
  });
});

describe("the palette", () => {
  it("jumps to the highlighted page on Enter, and moves with the arrows", () => {
    const onNavigate = vi.fn();
    const onClose = vi.fn();
    render(<JumpTo open onClose={onClose} items={items} onNavigate={onNavigate} />);

    const input = screen.getByRole("combobox", { name: /search pages/i });
    fireEvent.change(input, { target: { value: "engage" } });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onClose).toHaveBeenCalled();
    expect(onNavigate).toHaveBeenCalledWith("/acme/outreach");
  });

  it("says so when nothing matches, rather than showing an empty list", () => {
    render(<JumpTo open onClose={() => {}} items={items} onNavigate={() => {}} />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "zzz" } });
    expect(screen.getByRole("status").textContent).toMatch(/no page matches/i);
  });
});

describe("the sidebar's ⌘K palette", () => {
  const sections = [
    {
      id: "hunt",
      label: "Hunt",
      icon: Flame,
      items: [
        { label: "Opportunities", href: "/acme/opportunities", icon: Flame },
        { label: "Companies", href: "/acme/companies", icon: Flame, unbuilt: true },
      ],
    },
  ];

  it("binds nothing without a palette to open — the NAV-03 rule", () => {
    render(<Sidebar sections={sections} activeHref="" />);
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(screen.queryByRole("option")).toBeNull();
  });

  it("opens on ⌘K / Ctrl+K and offers only built destinations", () => {
    render(<Sidebar sections={sections} activeHref="" jumpTo={{ onNavigate: () => {} }} />);

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });

    const options = screen.getAllByRole("option").map((o) => o.textContent);
    expect(options.some((t) => t?.includes("Opportunities"))).toBe(true);
    expect(options.some((t) => t?.includes("Companies"))).toBe(false);
  });
});
