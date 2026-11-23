import { beforeEach, describe, expect, it, vi } from "vitest";
import { CAMPAIGN_NOT_RUNNING } from "@huntloop/jobs";

/**
 * Two pass-20 P0 fixes, against a stand-in database.
 *
 * PANEL-301 — `saveCampaignAction`. The engine parks every enrollment it
 * reaches while a campaign is draft, paused or archived. Starting the
 * campaign must release exactly those rows, and nothing else, or enrolling
 * first and starting second drafts nothing, ever.
 *
 * PANEL-302 — `retrySendAction`. Messages stranded by the old behaviour
 * (an `error` that `schedule_sends` treats as final) can be released by a
 * person, without touching the approval and without skipping a check.
 */

const ORG_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const CAMPAIGN = "22222222-2222-4222-8222-222222222222";
const MESSAGE = "33333333-3333-4333-8333-333333333333";

interface Recorded {
  table: string;
  verb: string;
  payload?: unknown;
  filters: [string, ...unknown[]][];
}

let calls: Recorded[] = [];
let responses: Record<string, { data: unknown; error: { message: string } | null }> = {};

function fakeDb() {
  return {
    from(table: string) {
      const record: Recorded = { table, verb: "select", filters: [] };
      calls.push(record);
      const chain: Record<string, unknown> = {};
      for (const m of ["select", "eq", "is", "not", "in", "order", "limit", "maybeSingle", "single"]) {
        chain[m] = (...args: unknown[]) => {
          if (m === "eq" || m === "is" || m === "not" || m === "in") record.filters.push([m, ...args]);
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

const outreach = () => import("../../app/(app)/[org]/outreach/actions");
const inbox = () => import("../../app/(app)/[org]/inbox/actions");

const campaign = (status: "draft" | "active" | "paused" | "archived") => ({
  id: CAMPAIGN,
  name: "Q4 fintech",
  icpId: "",
  productId: "",
  autonomyLevel: 0,
  status,
});

beforeEach(() => {
  calls = [];
  responses = {};
});

describe("saveCampaignAction — PANEL-301", () => {
  it("starting a campaign releases the enrollments parked because it was not running", async () => {
    responses["select:campaigns"] = { data: { started_at: null }, error: null };
    responses["update:enrollments"] = { data: [{ id: "e1" }, { id: "e2" }], error: null };

    const { saveCampaignAction } = await outreach();
    const before = Date.now();
    const result = await saveCampaignAction("acme", campaign("active"));

    expect(result.ok).toBe(true);
    expect(result.ok && result.message).toMatch(/2 waiting enrollments resumed/);

    const release = calls.find((c) => c.table === "enrollments" && c.verb === "update");
    const payload = release?.payload as { status: string; parked_reason: null; next_action_at: string };
    expect(payload.status).toBe("active");
    expect(payload.parked_reason).toBeNull();
    expect(Date.parse(payload.next_action_at)).toBeGreaterThanOrEqual(before);
    /* Only this campaign's rows, in this workspace, parked for this reason:
       a row parked for a rejected draft or a missing address still needs a
       person. */
    expect(release?.filters).toContainEqual(["eq", "org_id", ORG_ID]);
    expect(release?.filters).toContainEqual(["eq", "campaign_id", CAMPAIGN]);
    expect(release?.filters).toContainEqual(["eq", "status", "parked"]);
    expect(release?.filters).toContainEqual(["eq", "parked_reason", CAMPAIGN_NOT_RUNNING]);
  });

  it("matches the exact text the engine parks with", () => {
    expect(CAMPAIGN_NOT_RUNNING).toBe("The campaign is not running.");
  });

  it.each(["draft", "paused", "archived"] as const)("saving a %s campaign releases nothing", async (status) => {
    responses["select:campaigns"] = { data: { started_at: null }, error: null };

    const { saveCampaignAction } = await outreach();
    const result = await saveCampaignAction("acme", campaign(status));

    expect(result.ok).toBe(true);
    expect(calls.some((c) => c.table === "enrollments")).toBe(false);
  });

  it("says so when the campaign started but its enrollments could not be released", async () => {
    responses["select:campaigns"] = { data: { started_at: null }, error: null };
    responses["update:enrollments"] = { data: null, error: { message: "permission denied" } };

    const { saveCampaignAction } = await outreach();
    const result = await saveCampaignAction("acme", campaign("active"));

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toMatch(/Resume them from the enrollment list/);
  });
});

describe("retrySendAction — PANEL-302", () => {
  it("clears the reason and the wait, and keeps the approval", async () => {
    responses["update:messages"] = { data: { id: MESSAGE }, error: null };

    const { retrySendAction } = await inbox();
    const result = await retrySendAction("acme", MESSAGE);

    expect(result.ok).toBe(true);
    const update = calls.find((c) => c.table === "messages" && c.verb === "update");
    expect(update?.payload).toEqual({ error: null, not_before: null });
    /* Approved, unsent, never attempted, and in this workspace: anything else
       is not a stranded message. */
    expect(update?.filters).toContainEqual(["eq", "org_id", ORG_ID]);
    expect(update?.filters).toContainEqual(["eq", "direction", "outbound"]);
    expect(update?.filters).toContainEqual(["not", "scheduled_at", "is", null]);
    expect(update?.filters).toContainEqual(["is", "sent_at", null]);
    expect(update?.filters).toContainEqual(["is", "send_attempted_at", null]);
  });

  it("refuses a message that is not stranded", async () => {
    responses["update:messages"] = { data: null, error: null };

    const { retrySendAction } = await inbox();
    const result = await retrySendAction("acme", MESSAGE);

    expect(result.ok).toBe(false);
  });

  it("refuses a malformed id before touching the database", async () => {
    const { retrySendAction } = await inbox();
    const result = await retrySendAction("acme", "not-a-uuid");

    expect(result.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });
});
