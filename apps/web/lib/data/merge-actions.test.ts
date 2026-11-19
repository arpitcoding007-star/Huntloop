import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The merge-review actions (TEST-001), against a stand-in database.
 *
 * `mutate` is replaced by a pass-through that hands the action a recording
 * client, so each test is about the action's own decisions: which pair, which
 * survivor, and what a decided proposal refuses.
 */

const ORG_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const CANDIDATE = "11111111-1111-4111-8111-111111111111";
const A = "22222222-2222-4222-8222-222222222222";
const B = "33333333-3333-4333-8333-333333333333";
const STRANGER = "44444444-4444-4444-8444-444444444444";

interface Recorded {
  table: string;
  verb: string;
  payload?: unknown;
  filters: [string, unknown][];
}

let calls: Recorded[] = [];
let responses: Record<string, { data: unknown; error: { message: string } | null }> = {};

function fakeDb() {
  return {
    from(table: string) {
      const record: Recorded = { table, verb: "select", filters: [] };
      calls.push(record);
      const chain: Record<string, unknown> = {};
      for (const m of ["select", "eq", "is", "not", "order", "limit", "maybeSingle", "single"]) {
        chain[m] = (...args: unknown[]) => {
          if (m === "eq") record.filters.push([String(args[0]), args[1]]);
          return chain;
        };
      }
      chain.update = (v: unknown) => {
        record.verb = "update";
        record.payload = v;
        return chain;
      };
      chain.then = (resolve: (v: unknown) => unknown) =>
        Promise.resolve(responses[`${record.verb}:${table}`] ?? { data: null, error: null }).then(resolve);
      return chain;
    },
    rpc(fn: string, args: unknown) {
      calls.push({ table: fn, verb: "rpc", payload: args, filters: [] });
      return Promise.resolve(responses[`rpc:${fn}`] ?? { data: null, error: null });
    },
  };
}

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("./org", async (importActual) => {
  const actual = await importActual<typeof import("./org")>();
  return {
    ...actual,
    mutate: (_org: string, _caller: string, run: (ctx: unknown) => unknown) =>
      run({ db: fakeDb(), orgId: ORG_ID, viewer: { kind: "member", orgId: ORG_ID, role: "member" } }),
  };
});

const load = () => import("../../app/(app)/[org]/companies/actions");

const pending = { company_a_id: A, company_b_id: B, status: "pending", matched_on: "name" };

beforeEach(() => {
  calls = [];
  responses = {};
});

describe("mergeCompaniesAction", () => {
  it("merges the pair, keeping the company the person chose", async () => {
    responses["select:merge_candidates"] = { data: pending, error: null };
    const { mergeCompaniesAction } = await load();
    const result = await mergeCompaniesAction("acme", CANDIDATE, B);

    expect(result.ok).toBe(true);
    const merge = calls.find((c) => c.table === "merge_companies_for_org");
    expect(merge?.payload).toMatchObject({ p_org: ORG_ID, p_winner: B, p_loser: A });
  });

  it("reads the proposal only within the caller's organisation", async () => {
    responses["select:merge_candidates"] = { data: pending, error: null };
    const { mergeCompaniesAction } = await load();
    await mergeCompaniesAction("acme", CANDIDATE, A);
    const read = calls.find((c) => c.table === "merge_candidates");
    expect(read?.filters).toContainEqual(["org_id", ORG_ID]);
  });

  it("refuses a survivor that is not one of the two", async () => {
    responses["select:merge_candidates"] = { data: pending, error: null };
    const { mergeCompaniesAction } = await load();
    const result = await mergeCompaniesAction("acme", CANDIDATE, STRANGER);
    expect(result.ok).toBe(false);
    expect(calls.some((c) => c.verb === "rpc")).toBe(false);
  });

  it("refuses a proposal already decided", async () => {
    responses["select:merge_candidates"] = { data: { ...pending, status: "merged" }, error: null };
    const { mergeCompaniesAction } = await load();
    const result = await mergeCompaniesAction("acme", CANDIDATE, A);
    expect(result.ok).toBe(false);
    expect(calls.some((c) => c.verb === "rpc")).toBe(false);
  });

  it("refuses an id that is not a uuid, before reading anything", async () => {
    const { mergeCompaniesAction } = await load();
    const result = await mergeCompaniesAction("acme", "not-a-uuid", A);
    expect(result.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("says so when the merge itself fails", async () => {
    responses["select:merge_candidates"] = { data: pending, error: null };
    responses["rpc:merge_companies_for_org"] = { data: null, error: { message: "not a member" } };
    const { mergeCompaniesAction } = await load();
    const result = await mergeCompaniesAction("acme", CANDIDATE, A);
    expect(result.ok).toBe(false);
  });
});

describe("rejectMergeAction", () => {
  it("marks a pending proposal rejected, in this organisation only", async () => {
    responses["update:merge_candidates"] = { data: [{ id: CANDIDATE }], error: null };
    const { rejectMergeAction } = await load();
    const result = await rejectMergeAction("acme", CANDIDATE);

    expect(result.ok).toBe(true);
    const update = calls.find((c) => c.table === "merge_candidates" && c.verb === "update");
    expect(update?.payload).toMatchObject({ status: "rejected" });
    expect(update?.filters).toContainEqual(["org_id", ORG_ID]);
    expect(update?.filters).toContainEqual(["status", "pending"]);
  });

  it("reports a proposal someone else already decided", async () => {
    responses["update:merge_candidates"] = { data: [], error: null };
    const { rejectMergeAction } = await load();
    const result = await rejectMergeAction("acme", CANDIDATE);
    expect(result.ok).toBe(false);
  });
});
