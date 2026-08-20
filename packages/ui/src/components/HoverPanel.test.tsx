import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { HoverPanel } from "./HoverPanel";

/** Explicit cleanup, because `globals: false`. See DataTable.test.tsx. */
afterEach(cleanup);

/**
 * UX-13, and why it needed a unit test rather than a browser one.
 *
 * The finding is that the score and priority explanations were unreachable on
 * a phone. Reproducing that end-to-end means a device with no hover, and
 * Playwright's mobile project emulates touch but still dispatches the
 * synthetic mouse events a real browser sends — so the browser suite would
 * have passed against the broken component for the same reason the bug
 * survived review.
 *
 * What is actually being tested is the state machine: a tap pins, a pinned
 * panel takes the pointer so it can be scrolled, and it stays until one of the
 * three dismissal gestures. Those are assertable directly and are what §51 and
 * §77 Principle 4 depend on — an explanation the user cannot read has not been
 * given.
 */

function renderPanel() {
  return render(
    <HoverPanel
      label="Score 91: strong fit and a fresh trigger"
      panel={<p>ICP fit 94. Trigger freshness 96.</p>}
    >
      <span>91</span>
    </HoverPanel>,
  );
}

const trigger = () => screen.getByRole("button");

describe("HoverPanel", () => {
  it("opens on hover, which is the pointer case", () => {
    renderPanel();
    expect(screen.queryByRole("tooltip")).toBeNull();

    fireEvent.mouseEnter(trigger());
    expect(screen.getByRole("tooltip")).toBeTruthy();

    fireEvent.mouseLeave(trigger());
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("opens on keyboard focus, so the explanation is not pointer-only", () => {
    renderPanel();
    fireEvent.focus(trigger());
    expect(screen.getByRole("tooltip")).toBeTruthy();
  });

  it("pins on click — the state a touch device can reach at all", () => {
    // The bug: with no hover, the panel opened on whatever synthetic mouse
    // event the browser emitted and closed on the next touch anywhere.
    renderPanel();
    fireEvent.click(trigger());

    expect(screen.getByRole("tooltip")).toBeTruthy();
    expect(trigger().getAttribute("aria-expanded")).toBe("true");
  });

  it("a pinned panel survives the pointer leaving the trigger", () => {
    /*
     * On a phone there is no "pointer leaving". On a desktop the tap that
     * pinned it also fires mouseenter/mouseleave, and if those closed a pinned
     * panel the click would be self-cancelling.
     */
    renderPanel();
    fireEvent.click(trigger());
    fireEvent.mouseLeave(trigger());

    expect(screen.getByRole("tooltip")).toBeTruthy();
  });

  it("a pinned panel takes the pointer, so it can be scrolled", () => {
    /*
     * The other half of UX-13. The panel carries `overflow-y-auto` for content
     * taller than the viewport, and carried `pointer-events-none` beside it —
     * a panel that advertises scrolling and refuses the pointer cannot be
     * scrolled by anybody.
     */
    renderPanel();

    fireEvent.mouseEnter(trigger());
    expect(screen.getByRole("tooltip").className).toContain("pointer-events-none");

    fireEvent.click(trigger());
    expect(screen.getByRole("tooltip").className).toContain("pointer-events-auto");
  });

  it("closes on Escape", () => {
    renderPanel();
    fireEvent.click(trigger());
    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("closes on a press outside it", () => {
    renderPanel();
    fireEvent.click(trigger());
    fireEvent.pointerDown(document.body);

    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("does not close when the press is inside the panel", () => {
    // Otherwise selecting the text of the explanation dismisses it, which is
    // the one interaction somebody reading a long score breakdown will try.
    renderPanel();
    fireEvent.click(trigger());
    fireEvent.pointerDown(screen.getByRole("tooltip"));

    expect(screen.getByRole("tooltip")).toBeTruthy();
  });

  it("pressing the trigger again closes it", () => {
    renderPanel();
    fireEvent.click(trigger());
    fireEvent.click(trigger());

    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("answers Enter and Space, because it claims to be a button", () => {
    renderPanel();
    fireEvent.keyDown(trigger(), { key: "Enter" });
    expect(screen.getByRole("tooltip")).toBeTruthy();

    fireEvent.keyDown(trigger(), { key: "Enter" });
    expect(screen.queryByRole("tooltip")).toBeNull();

    fireEvent.keyDown(trigger(), { key: " " });
    expect(screen.getByRole("tooltip")).toBeTruthy();
  });

  it("names the panel as the trigger's description while it is open", () => {
    // The label carries the whole explanation for a screen reader, and the
    // description points at the rendered detail. Neither is useful pointing at
    // an element that is not there, so it is only set while open.
    renderPanel();
    expect(trigger().getAttribute("aria-describedby")).toBeNull();

    fireEvent.click(trigger());
    expect(trigger().getAttribute("aria-describedby")).toBe(
      screen.getByRole("tooltip").getAttribute("id"),
    );
  });
});
