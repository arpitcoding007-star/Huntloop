import { describe, expect, it } from "vitest";
import {
  icpSchema,
  orgNameSchema,
  orgSlugSchema,
  parseInput,
  urlInputSchema,
  whyNowRequestSchema,
} from "./validation";

/**
 * The Server Action boundary.
 *
 * Server Actions are public POST endpoints and TypeScript is erased at
 * runtime, so these schemas are the only thing standing between a hand-rolled
 * request and the code below. The tests worth writing are therefore about what
 * is *rejected*, and specifically about the two properties the audit found
 * missing (API-01): correct handling of non-string input, and bounds.
 */

describe("orgNameSchema", () => {
  it("accepts an ordinary company name", () => {
    expect(orgNameSchema.parse("  Acme Inc  ")).toBe("Acme Inc");
  });

  it("rejects a File, which String() would have turned into an org", () => {
    /*
     * The real bug this was written for. `createOrganisation` did
     * `String(formData.get("name"))`, and a FormData entry is `string | File`.
     * `String(file)` yields "[object File]" — non-empty, slugifies to
     * "objectfile", and creates an organisation named after a type coercion.
     */
    const file = new File(["hello"], "payload.txt");
    expect(orgNameSchema.safeParse(file).success).toBe(false);

    // Guard the premise too: if String() ever stopped producing something
    // truthy here, this test would be passing for the wrong reason.
    expect(String(file).length).toBeGreaterThan(0);
  });

  it("rejects blank and whitespace-only names", () => {
    expect(orgNameSchema.safeParse("").success).toBe(false);
    expect(orgNameSchema.safeParse("   ").success).toBe(false);
  });

  it("bounds the length", () => {
    expect(orgNameSchema.safeParse("a".repeat(120)).success).toBe(true);
    expect(orgNameSchema.safeParse("a".repeat(121)).success).toBe(false);
  });
});

describe("orgSlugSchema", () => {
  it("accepts what slugify() produces", () => {
    for (const slug of ["acme", "acme-inc", "a1", "north-wind-2"]) {
      expect(orgSlugSchema.safeParse(slug).success, slug).toBe(true);
    }
  });

  it("rejects path traversal and separator abuse", () => {
    for (const slug of [
      "../etc",
      "acme/../other",
      "-acme",
      "acme-",
      "acme--inc",
      "Acme",
      "acme inc",
      "acme.inc",
      "",
    ]) {
      expect(orgSlugSchema.safeParse(slug).success, slug).toBe(false);
    }
  });
});

describe("urlInputSchema", () => {
  it("stays loose about shape — normalizeUrl owns that", () => {
    // People type a bare domain, and rejecting it here would break the thing
    // normalizeUrl exists to handle.
    expect(urlInputSchema.safeParse("acme.co").success).toBe(true);
    expect(urlInputSchema.safeParse("https://acme.co/about").success).toBe(true);
  });

  it("bounds the length, which is the actual job", () => {
    expect(urlInputSchema.safeParse("a".repeat(2048)).success).toBe(true);
    expect(urlInputSchema.safeParse("a".repeat(2049)).success).toBe(false);
  });
});

describe("whyNowRequestSchema — the cost bound", () => {
  const claim = {
    claim: "Closed a $12M Series A.",
    kind: "fact" as const,
    confidence: "high" as const,
    sourceUrl: "https://alphio.ai/blog",
    excerpt: "We raised $12M.",
  };

  const request = (evidence: unknown) => ({
    companyName: "Alphio AI",
    canonicalDomain: "alphio.ai",
    priority: "hot" as const,
    evidence,
  });

  it("accepts a realistic evidence list", () => {
    expect(whyNowRequestSchema.safeParse(request([claim])).success).toBe(true);
  });

  it("refuses to be handed 500 claims", () => {
    // The finding in one line: without a cap, a caller could hand this action
    // 500 claims of 50 kB each and we would pay Opus to read all of it.
    const many = Array.from({ length: 500 }, () => claim);
    expect(whyNowRequestSchema.safeParse(request(many)).success).toBe(false);

    // 40 is the documented ceiling; assert the edge, not just "big fails".
    expect(
      whyNowRequestSchema.safeParse(request(Array.from({ length: 40 }, () => claim)))
        .success,
    ).toBe(true);
    expect(
      whyNowRequestSchema.safeParse(request(Array.from({ length: 41 }, () => claim)))
        .success,
    ).toBe(false);
  });

  it("refuses a single enormous claim", () => {
    const huge = { ...claim, claim: "x".repeat(50_000) };
    expect(whyNowRequestSchema.safeParse(request([huge])).success).toBe(false);
  });

  it("rejects a claim kind outside the epistemic model", () => {
    // fact / inference / unknown is the whole model (§7). A fourth value
    // arriving from a public endpoint must not reach the prompt.
    const bogus = { ...claim, kind: "probably" };
    expect(whyNowRequestSchema.safeParse(request([bogus])).success).toBe(false);
  });
});

describe("icpSchema", () => {
  it("bounds every list, not just the object", () => {
    const base = {
      sells: "Custody permissioning.",
      segments: [],
      sizes: [],
      regions: [],
      triggers: [],
      exclusions: [],
    };
    expect(icpSchema.safeParse(base).success).toBe(true);
    expect(
      icpSchema.safeParse({
        ...base,
        segments: Array.from({ length: 51 }, () => "seg"),
      }).success,
    ).toBe(false);
  });
});

describe("parseInput", () => {
  it("returns rather than throws, so actions can render the failure", () => {
    const bad = parseInput(orgSlugSchema, "../etc", "organisation");
    expect(bad.ok).toBe(false);
  });

  it("never echoes the rejected value back to the caller", () => {
    // On a public endpoint, echoing input is both a reflection risk and a way
    // to map exactly what the parser accepts.
    const secret = "<script>alert(document.cookie)</script>";
    const bad = parseInput(orgSlugSchema, secret, "organisation");
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.error).not.toContain(secret);
      expect(bad.error).not.toContain("script");
    }
  });
});
