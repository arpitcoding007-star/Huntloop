import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ScorePill } from "./ScorePill";

afterEach(cleanup);

describe("ScorePill", () => {
  it("prints the number and names the band in its accessible name", () => {
    render(<ScorePill score={93} explanation="Fresh trigger, strong fit." />);
    const pill = screen.getByRole("button", { name: /Score 93 of 100\. Exceptional opportunity/ });
    expect(pill.textContent).toBe("93");
  });

  it("says Unknown for an unmeasured score rather than drawing a 0", () => {
    render(<ScorePill score={null} explanation="Nothing on file yet." />);
    const pill = screen.getByRole("button", { name: /Score unknown\. Nothing on file yet\./ });
    expect(pill.textContent).toBe("Unknown");
    expect(pill.textContent).not.toContain("0");
  });
});
