import { beforeEach, describe, expect, it, vi } from "vitest";
import { PROFILE_QUERY_NAME } from "@huntloop/jobs";

/**
 * PANEL-401 (audit pass 20): removing or replacing an ICP stops its paid
 * discovery search. Before this, a removed profile's search kept running
 * every day, and making active a profile whose criteria translate to no
 * search left the previous profile's search running.
 *
 * Migration 0057 is the guarantee in the database (verify-migrations.ts);
 * these cover what the two actions do themselves.
 */

const ORG_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const ICP = "44444444-4444-4444-8444-444444444444";

interface Recorded {
  table: string;
  verb: string;
  payload?: unknown;
  filters: [string, ...unknown[]][];
}

let calls: Recorded[] = [];
/** Per `verb:table`, answered in order; the last answer repeats. */
let responses: Record<string, { data: unknown; error: { message: string } | null }[]> = {};

function answer(key: string) {
  const queue = responses[key];
  if (!queue || queue.length === 0) return { data: null, error: null };
  return queue.length > 1 ? queue.shift()! : queue[0]!;
}

function fakeDb() {
  return {
    from(table: string) {
      const record: Recorded = { table, verb: "select", filters: [] };
      calls.push(record);
      const chain: Record<string, unknown> = {};
      for (const m of ["select", "eq", "neq", "is", "not", "in", "order", "limit", "maybeSingle", "single"]) {
        chain[m] = (...args: unknown[]) => {
          if (["eq", "neq", "is", "not", "in"].includes(m)) record.filters.push([m, ...args]);
          return chain;
        };
      }
      chain.update = (v: unknown) => {
        record.verb = "update";
        record.payload = v;
        return chain;
      };
      chain.then = (resolve: (v: unknown) => unknown) =>
        Promise.resolve(answer(`${record.verb}:${table}`)).then(resolve);
      return chain;
    },
  };
}

const followMock = vi.fn();

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("./engine", async (importActual) => {
  const actual = await importActual<typeof import("./engine")>();
  return { ...actual, followActiveIcp: (...args: unknown[]) => followMock(...args) };
});
vi.mock("./org", async (importActual) => {
  const actual = await importActual<typeof import("./org")>();
  return {
    ...actual,
    mutate: (_org: string, _caller: string, run: (ctx: unknown) => unknown) =>
      run({ db: fakeDb(), orgId: ORG_ID, viewer: { kind: "member", orgId: ORG_ID, role: "member" } }),
  };
});

const load = () => import("../../app/(app)/[org]/settings/icp/actions");

const retireOf = () =>
  calls.find((c) => c.table === "discovery_queries" && c.verb === "update");

beforeEach(() => {
  calls = [];
  responses = {};
  followMock.mockReset();
  followMock.mockResolvedValue({ searching: true });
});

describe("deleteIcpAction — PANEL-401", () => {
  it("removes an inactive ICP and stops its searches", async () => {
    responses["select:icps"] = [{ data: { id: ICP, is_active: false }, error: null }];

    const { deleteIcpAction } = await load();
    const result = await deleteIcpAction("acme", ICP);

    expect(result.ok).toBe(true);
    const retire = retireOf();
    expect(retire?.payload).toEqual({ is_enabled: false, next_run_at: null });
    expect(retire?.filters).toContainEqual(["eq", "org_id", ORG_ID]);
    expect(retire?.filters).toContainEqual(["eq", "icp_id", ICP]);
  });

  it("refuses the active ICP on the server, not only in the screen", async () => {
    responses["select:icps"] = [{ data: { id: ICP, is_active: true }, error: null }];

    const { deleteIcpAction } = await load();
    const result = await deleteIcpAction("acme", ICP);

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toMatch(/active ICP/);
    expect(calls.some((c) => c.verb === "update")).toBe(false);
  });

  it("refuses an ICP that no longer exists", async () => {
    const { deleteIcpAction } = await load();
    const result = await deleteIcpAction("acme", ICP);

    expect(result.ok).toBe(false);
    expect(calls.some((c) => c.verb === "update")).toBe(false);
  });
});

describe("activateIcpAction — PANEL-401", () => {
  it("stops every other profile's search, even when this one describes none", async () => {
    responses["select:icps"] = [{ data: { id: ICP }, error: null }];
    responses["update:icps"] = [
      { data: null, error: null },
      { data: { id: ICP }, error: null },
    ];
    followMock.mockResolvedValue({ searching: false, reason: "The profile has no searchable criteria." });

    const { activateIcpAction } = await load();
    const result = await activateIcpAction("acme", ICP);

    expect(result.ok).toBe(true);
    /* The audit's case: the new profile translates to no search, so nothing
       downstream would have retired the old one. */
    expect(result.ok && result.message).toMatch(/Discovery is off/);
    const retire = retireOf();
    expect(retire?.payload).toEqual({ is_enabled: false, next_run_at: null });
    expect(retire?.filters).toContainEqual(["eq", "name", PROFILE_QUERY_NAME]);
    expect(retire?.filters).toContainEqual(["neq", "icp_id", ICP]);
    expect(retire?.filters).toContainEqual(["eq", "org_id", ORG_ID]);
  });

  it("does not clear the active flag for an ICP that no longer exists", async () => {
    const { activateIcpAction } = await load();
    const result = await activateIcpAction("acme", ICP);

    expect(result.ok).toBe(false);
    expect(calls.some((c) => c.verb === "update")).toBe(false);
    expect(followMock).not.toHaveBeenCalled();
  });

  it("says so when the ICP vanished between the read and the update", async () => {
    responses["select:icps"] = [{ data: { id: ICP }, error: null }];
    responses["update:icps"] = [
      { data: null, error: null },
      { data: null, error: null },
    ];

    const { activateIcpAction } = await load();
    const result = await activateIcpAction("acme", ICP);

    expect(result.ok).toBe(false);
    expect(followMock).not.toHaveBeenCalled();
  });
});
