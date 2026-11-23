import { beforeEach, describe, expect, it } from "vitest";
import type { TenantClient } from "@huntloop/db";
import { resolveExistingCompanies, resolveOrInsertCompany } from "./company-resolve";

/**
 * RC-5 (audit pass 20): PANEL-202 (Analyze save overwrote provenance) and
 * PANEL-203 (CSV import failed on any removed or merged domain).
 */

const ORG = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

interface Row {
  org_id: string;
  id: string;
  canonical_domain: string;
  name: string;
  discovered_via: string;
  deleted_at: string | null;
  merged_into_id: string | null;
}

let rows: Row[] = [];
let writes: { verb: string; payload: unknown }[] = [];

/** A tiny in-memory `companies` table with just the chain methods the helper uses. */
function fakeDb(): TenantClient {
  return {
    from() {
      let verb = "select";
      let payload: unknown;
      const filters: ((r: Row) => boolean)[] = [];
      let single = false;
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.eq = (col: keyof Row, v: unknown) => (filters.push((r) => r[col] === v), chain);
      chain.in = (col: keyof Row, vs: unknown[]) => (filters.push((r) => vs.includes(r[col])), chain);
      chain.is = (col: keyof Row, v: unknown) => (filters.push((r) => r[col] === v), chain);
      chain.maybeSingle = () => ((single = true), chain);
      chain.single = () => ((single = true), chain);
      chain.update = (v: unknown) => ((verb = "update"), (payload = v), chain);
      chain.insert = (v: unknown) => ((verb = "insert"), (payload = v), chain);
      chain.then = (resolve: (v: unknown) => unknown) => {
        const match = rows.filter((r) => filters.every((f) => f(r)));
        if (verb === "update") {
          writes.push({ verb, payload });
          for (const r of match) Object.assign(r, payload);
          return Promise.resolve({ data: match, error: null }).then(resolve);
        }
        if (verb === "insert") {
          writes.push({ verb, payload });
          const p = payload as Row;
          if (rows.some((r) => r.canonical_domain === p.canonical_domain)) {
            return Promise.resolve({ data: null, error: { message: "duplicate", code: "23505" } }).then(resolve);
          }
          const row = { ...p, org_id: ORG, id: `new-${rows.length}`, deleted_at: null, merged_into_id: null } as Row;
          rows.push(row);
          return Promise.resolve({ data: { id: row.id }, error: null }).then(resolve);
        }
        return Promise.resolve({ data: single ? (match[0] ?? null) : match, error: null }).then(resolve);
      };
      return chain;
    },
  } as unknown as TenantClient;
}

const company = (over: Partial<Row>): Row => ({
  org_id: ORG,
  id: "c1",
  canonical_domain: "acme.com",
  name: "Acme",
  discovered_via: "competitor:x",
  deleted_at: null,
  merged_into_id: null,
  ...over,
});

beforeEach(() => {
  rows = [];
  writes = [];
});

describe("resolveOrInsertCompany", () => {
  it("uses a live company and never overwrites its provenance (PANEL-202)", async () => {
    rows = [company({})];
    const r = await resolveOrInsertCompany(fakeDb(), ORG, "acme.com", { name: "ACME!", discovered_via: "manual" });
    expect(r).toEqual({ kind: "live", id: "c1" });
    expect(writes).toEqual([]);
    expect(rows[0]!.discovered_via).toBe("competitor:x");
    expect(rows[0]!.name).toBe("Acme");
  });

  it("follows a merge to the live survivor", async () => {
    rows = [company({ id: "old", merged_into_id: "new" }), company({ id: "new", canonical_domain: "acme.io" })];
    const r = await resolveOrInsertCompany(fakeDb(), ORG, "acme.com", { name: "Acme" });
    expect(r).toEqual({ kind: "merged", id: "new", fromId: "old" });
  });

  it("refuses when the survivor was removed", async () => {
    rows = [
      company({ id: "old", merged_into_id: "new" }),
      company({ id: "new", canonical_domain: "acme.io", deleted_at: "2026-01-01" }),
    ];
    const r = await resolveOrInsertCompany(fakeDb(), ORG, "acme.com", { name: "Acme" });
    expect(r.kind).toBe("unavailable");
  });

  it("restores a removed company instead of inserting", async () => {
    rows = [company({ deleted_at: "2026-01-01" })];
    const r = await resolveOrInsertCompany(fakeDb(), ORG, "acme.com", { name: "Acme" });
    expect(r).toEqual({ kind: "restored", id: "c1" });
    expect(rows[0]!.deleted_at).toBeNull();
    expect(writes.map((w) => w.verb)).toEqual(["update"]);
  });

  it("inserts only a domain nobody holds", async () => {
    const r = await resolveOrInsertCompany(fakeDb(), ORG, "new.com", { name: "New", discovered_via: "manual" });
    expect(r.kind).toBe("inserted");
    expect(rows).toHaveLength(1);
  });
});

describe("resolveExistingCompanies (PANEL-203)", () => {
  it("maps live, removed and merged domains without failing", async () => {
    rows = [
      company({ id: "live", canonical_domain: "live.com" }),
      company({ id: "gone", canonical_domain: "gone.com", deleted_at: "2026-01-01" }),
      company({ id: "old", canonical_domain: "old.com", merged_into_id: "live" }),
    ];
    const { resolved, error } = await resolveExistingCompanies(fakeDb(), ORG, [
      "live.com",
      "gone.com",
      "old.com",
      "fresh.com",
    ]);
    expect(error).toBeNull();
    expect(resolved.get("live.com")).toEqual({ kind: "live", id: "live" });
    expect(resolved.get("gone.com")).toEqual({ kind: "restored", id: "gone" });
    expect(resolved.get("old.com")).toEqual({ kind: "merged", id: "live", fromId: "old" });
    expect(resolved.has("fresh.com")).toBe(false);
    expect(rows.find((r) => r.id === "gone")!.deleted_at).toBeNull();
  });
});
