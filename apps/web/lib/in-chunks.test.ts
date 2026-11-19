import { describe, expect, it } from "vitest";
import { IN_CHUNK, inChunks } from "./in-chunks";

describe("inChunks", () => {
  it("splits values into chunks and merges the rows", async () => {
    const seen: number[] = [];
    const values = Array.from({ length: 250 }, (_, i) => `v${i}`);
    const { data, error } = await inChunks(values, async (chunk) => {
      seen.push(chunk.length);
      return { data: chunk.map((v) => ({ v })), error: null };
    });
    expect(error).toBeNull();
    expect(seen).toEqual([IN_CHUNK, IN_CHUNK, 50]);
    expect(data).toHaveLength(250);
  });

  it("asks for each value once", async () => {
    const seen: string[] = [];
    await inChunks(["a", "a", "b"], async (chunk) => {
      seen.push(...chunk);
      return { data: [], error: null };
    });
    expect(seen).toEqual(["a", "b"]);
  });

  it("makes no request for no values", async () => {
    let calls = 0;
    const { data } = await inChunks([], async () => {
      calls++;
      return { data: [], error: null };
    });
    expect(calls).toBe(0);
    expect(data).toEqual([]);
  });

  it("stops at the first error and returns no partial rows", async () => {
    let calls = 0;
    const { data, error } = await inChunks(Array.from({ length: 300 }, (_, i) => `${i}`), async () => {
      calls++;
      return calls === 2 ? { data: null, error: { message: "boom" } } : { data: [{}], error: null };
    });
    expect(error?.message).toBe("boom");
    expect(data).toEqual([]);
    expect(calls).toBe(2);
  });

  it("keeps a 1,000-domain import's URLs short", async () => {
    const domains = Array.from({ length: 1000 }, (_, i) => `company-number-${i}.example.com`);
    let longest = 0;
    await inChunks(domains, async (chunk) => {
      longest = Math.max(longest, encodeURIComponent(`in.(${chunk.join(",")})`).length);
      return { data: [], error: null };
    });
    expect(longest).toBeLessThan(4096);
  });
});
