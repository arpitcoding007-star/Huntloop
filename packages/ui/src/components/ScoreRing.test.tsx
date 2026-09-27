import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ScoreRing, SCORE_RING_THRESHOLD } from "./ScoreRing";

afterEach(cleanup);

const arcClass = (score: number) => {
  render(<ScoreRing score={score} />);
  const circles = screen.getByRole("img").querySelectorAll("circle");
  return circles[1]?.getAttribute("class") ?? "";
};

describe("ScoreRing", () => {
  it("breaks at 75, which reproduces every ring in the Meridian comp", () => {
    expect(SCORE_RING_THRESHOLD).toBe(75);
    for (const green of [75, 78, 84, 89, 92]) {
      cleanup();
      expect(arcClass(green)).toContain("stroke-success");
    }
    cleanup();
    expect(arcClass(72)).toContain("stroke-warning");
  });

  it("always prints the number, so the verdict is never colour alone", () => {
    render(<ScoreRing score={87.4} />);
    expect(screen.getByRole("img", { name: "Score 87" }).textContent).toBe("87");
  });

  it("draws no arc for zero rather than a round-capped dot", () => {
    render(<ScoreRing score={0} />);
    expect(screen.getByRole("img").querySelectorAll("circle")).toHaveLength(1);
  });
});
