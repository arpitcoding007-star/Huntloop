import { describe, expect, it } from "vitest";
import { looksLikeUrl, paletteActions } from "./palette-actions";

describe("looksLikeUrl", () => {
  it("accepts bare domains and URLs", () => {
    expect(looksLikeUrl("acme.com")).toBe(true);
    expect(looksLikeUrl("https://www.acme.co.uk/pricing?x=1")).toBe(true);
    expect(looksLikeUrl("sub.acme.io:8080/a")).toBe(true);
  });

  it("rejects words, sentences and things that only contain a dot", () => {
    expect(looksLikeUrl("acme")).toBe(false);
    expect(looksLikeUrl("acme inc.com")).toBe(false);
    expect(looksLikeUrl("v1.2")).toBe(false);
    expect(looksLikeUrl("")).toBe(false);
  });
});

describe("paletteActions", () => {
  const labels = (q: string) => paletteActions("acme", q).map((a) => a.label);

  it("offers nothing until two characters are typed", () => {
    expect(paletteActions("acme", "")).toEqual([]);
    expect(paletteActions("acme", "a")).toEqual([]);
  });

  it("offers to analyze a domain, first, without starting the run", () => {
    const [first] = paletteActions("acme", "stripe.com");
    expect(first.label).toBe("Analyze stripe.com");
    expect(first.href).toBe("/acme/analyze?url=stripe.com");
    /* `?run=1` would spend AI budget on Enter (PANEL-216). */
    expect(first.href).not.toContain("run=");
  });

  it("does not offer Analyze for a plain word", () => {
    expect(labels("stripe").some((l) => l.startsWith("Analyze"))).toBe(false);
  });

  it("filters opportunities to a company, with the query encoded", () => {
    const action = paletteActions("acme", "Smith & Co").find((a) => a.label.startsWith("Opportunities at"));
    expect(action?.href).toBe("/acme/opportunities?company=Smith%20%26%20Co");
  });

  it("offers the priority views when the query names them", () => {
    expect(labels("hot")).toContain("Show hot opportunities");
    expect(labels("hot")).not.toContain("Show warm opportunities");
    expect(labels("watch")).toContain("Show watch-list opportunities");
    expect(paletteActions("acme", "warm").find((a) => a.label === "Show warm opportunities")?.href).toBe(
      "/acme/opportunities?priority=warm",
    );
  });

  it("encodes the workspace slug and bounds the query", () => {
    const long = "x".repeat(500);
    const action = paletteActions("my org", long).find((a) => a.label.startsWith("Opportunities at"));
    expect(action?.href.startsWith("/my%20org/opportunities?company=")).toBe(true);
    expect(decodeURIComponent(action!.href.split("company=")[1]).length).toBe(200);
  });

  it("labels every verb as an action", () => {
    expect(paletteActions("acme", "acme.com").every((a) => a.group === "Action")).toBe(true);
  });
});
