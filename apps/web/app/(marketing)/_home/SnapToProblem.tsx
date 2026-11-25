"use client";

import { useEffect } from "react";
import { reducedMotion } from "./motion";

const HEADER = 68;

/**
 * One wheel gesture from the hero lands on the problem, and one gesture up
 * from there returns. Everything below scrolls normally, and the gesture is
 * never taken from zooming, sideways scrolling or a visitor who prefers
 * reduced motion.
 */
export function SnapToProblem() {
  useEffect(() => {
    let until = 0;
    const glide = (top: number) => {
      until = performance.now() + 750;
      window.scrollTo({ top, behavior: "smooth" });
    };
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY) || reducedMotion()) return;
      const problem = document.getElementById("problem");
      if (!problem) return;
      const top = problem.getBoundingClientRect().top + window.scrollY - HEADER;
      if (performance.now() < until) return e.preventDefault();
      if (window.scrollY < top - 40 && e.deltaY > 0) {
        e.preventDefault();
        glide(top);
      } else if (window.scrollY <= top + 8 && window.scrollY > 0 && e.deltaY < 0) {
        e.preventDefault();
        glide(0);
      }
    };
    window.addEventListener("wheel", onWheel, { passive: false });
    return () => window.removeEventListener("wheel", onWheel);
  }, []);
  return null;
}
