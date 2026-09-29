import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { canonical, SEAL_TTL_MS, sealVerdict, verifyVerdict } from "./seal";

/**
 * RT-001 / RT-002: a verdict is savable only if the server produced it.
 * These hold down the three ways that used to get through: an unsealed worked
 * example, a hand-built payload, and a real verdict edited on the way back.
 */

const verdict = {
  companyName: "Acme",
  score: 91,
  evidence: [{ claim: "They raised a Series A.", kind: "fact", sourceUrl: "https://acme.test/news" }],
  note: undefined,
};

let saved: string | undefined;
beforeEach(() => {
  saved = process.env.SUPABASE_SECRET_KEY;
  process.env.SUPABASE_SECRET_KEY = "test-secret-key";
});
afterEach(() => {
  if (saved === undefined) delete process.env.SUPABASE_SECRET_KEY;
  else process.env.SUPABASE_SECRET_KEY = saved;
});

describe("verdict seal", () => {
  it("verifies the verdict it signed", () => {
    const seal = sealVerdict("acme-org", verdict)!;
    expect(verifyVerdict("acme-org", verdict, seal)).toBe(true);
  });

  it("verifies regardless of key order and dropped undefined members", () => {
    const seal = sealVerdict("acme-org", verdict)!;
    const reordered = {
      evidence: [{ sourceUrl: "https://acme.test/news", kind: "fact", claim: "They raised a Series A." }],
      score: 91,
      companyName: "Acme",
    };
    expect(verifyVerdict("acme-org", reordered, seal)).toBe(true);
  });

  it("refuses a verdict edited after signing", () => {
    const seal = sealVerdict("acme-org", verdict)!;
    const forged = { ...verdict, evidence: [{ ...verdict.evidence[0], kind: "fact", sourceUrl: "https://evil.test" }] };
    expect(verifyVerdict("acme-org", forged, seal)).toBe(false);
    expect(verifyVerdict("acme-org", { ...verdict, score: 99 }, seal)).toBe(false);
  });

  it("refuses a seal issued for another organisation", () => {
    const seal = sealVerdict("acme-org", verdict)!;
    expect(verifyVerdict("other-org", verdict, seal)).toBe(false);
  });

  it("refuses a missing, malformed or expired seal", () => {
    expect(verifyVerdict("acme-org", verdict, undefined)).toBe(false);
    expect(verifyVerdict("acme-org", verdict, "not-a-seal")).toBe(false);
    const old = sealVerdict("acme-org", verdict, Date.now() - SEAL_TTL_MS - 1000)!;
    expect(verifyVerdict("acme-org", verdict, old)).toBe(false);
    const future = sealVerdict("acme-org", verdict, Date.now() + 60_000)!;
    expect(verifyVerdict("acme-org", verdict, future)).toBe(false);
  });

  it("neither seals nor verifies without a server key", () => {
    const seal = sealVerdict("acme-org", verdict)!;
    delete process.env.SUPABASE_SECRET_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    expect(sealVerdict("acme-org", verdict)).toBeNull();
    expect(verifyVerdict("acme-org", verdict, seal)).toBe(false);
  });

  it("canonicalises nested structures deterministically", () => {
    expect(canonical({ b: 1, a: [{ d: 2, c: null }] })).toBe('{"a":[{"c":null,"d":2}],"b":1}');
  });
});
