import { describe, expect, it } from "vitest";
import { mergeStoredJson } from "./icp";

/**
 * `ICP-03`. The settings form owns five of `criteria`'s fifteen keys and used
 * to write the object wholesale, deleting the ten it does not render. These
 * hold the merge down, because the failure mode has no symptom: the reader
 * degrades a missing key to an empty list — correctly, for a profile written
 * by an older version — so the only visible effect is that scores quietly stop
 * reflecting most of what the user said.
 */
describe("mergeStoredJson", () => {
  it("keeps stored keys the caller does not own", () => {
    const merged = mergeStoredJson(
      {
        segments: ["Fintech"],
        technologies: ["Kubernetes"],
        painPoints: ["No policy layer"],
        employeeRange: { min: 51, max: 200 },
      },
      { segments: ["Payments"], sizes: ["51–200"] },
    );

    expect(merged).toEqual({
      segments: ["Payments"],
      sizes: ["51–200"],
      technologies: ["Kubernetes"],
      painPoints: ["No policy layer"],
      employeeRange: { min: 51, max: 200 },
    });
  });

  it("lets an owned key be emptied rather than treating empty as absent", () => {
    /* "Stated as none" is a real answer and distinct from "not stated" — the
       whole ICP parser is built on that difference. A merge that skipped empty
       values would make it impossible to clear a list from the form. */
    const merged = mergeStoredJson({ segments: ["Fintech"] }, { segments: [] });
    expect(merged.segments).toEqual([]);
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["an array", ["Fintech"]],
    ["a string", "Fintech"],
    ["a number", 7],
  ])("treats %s as having no keys to preserve", (_label, stored) => {
    /* jsonb accepts all of these. Spreading an array would produce
       `{ 0: "Fintech" }` — a row that parses as an object and asserts nothing
       — which is a worse outcome than the erasure this guards against. */
    expect(mergeStoredJson(stored, { segments: ["Payments"] })).toEqual({
      segments: ["Payments"],
    });
  });

  it("does not mutate the stored object", () => {
    const stored = { technologies: ["Kubernetes"] };
    mergeStoredJson(stored, { segments: ["Payments"] });
    expect(stored).toEqual({ technologies: ["Kubernetes"] });
  });
});
