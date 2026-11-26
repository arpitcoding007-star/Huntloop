import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const withMonitor = vi.fn(<T,>(_slug: string, run: () => T) => run());
const flush = vi.fn(async () => true);

vi.mock("@sentry/nextjs", () => ({ withMonitor, flush }));

const { ENGINE_MONITOR_CONFIG, ENGINE_MONITOR_SLUG, monitorEngineTick } = await import(
  "./engine-monitor"
);
const { STALLED_AFTER_SECONDS } = await import("./queue-health");

describe("monitorEngineTick", () => {
  const saved = process.env.SENTRY_DSN;
  beforeEach(() => {
    withMonitor.mockClear();
    flush.mockClear();
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.SENTRY_DSN;
    else process.env.SENTRY_DSN = saved;
  });

  it("without a DSN it only runs the tick", async () => {
    delete process.env.SENTRY_DSN;
    await expect(monitorEngineTick(async () => 7)).resolves.toBe(7);
    expect(withMonitor).not.toHaveBeenCalled();
    expect(flush).not.toHaveBeenCalled();
  });

  it("with a DSN it checks in under one slug, then flushes before the function can freeze", async () => {
    process.env.SENTRY_DSN = "https://key@example.ingest.sentry.io/1";
    await expect(monitorEngineTick(async () => "report")).resolves.toBe("report");
    expect(withMonitor).toHaveBeenCalledWith(ENGINE_MONITOR_SLUG, expect.any(Function), ENGINE_MONITOR_CONFIG);
    expect(flush).toHaveBeenCalledOnce();
  });

  it("a failed tick still flushes and still throws, so the route's own handling runs", async () => {
    process.env.SENTRY_DSN = "https://key@example.ingest.sentry.io/1";
    await expect(
      monitorEngineTick(async () => {
        throw new Error("database blip");
      }),
    ).rejects.toThrow("database blip");
    expect(flush).toHaveBeenCalledOnce();
  });

  it("alerts on the same fifteen minutes as the health check", () => {
    const expectedEverySeconds = 5 * 60;
    expect(expectedEverySeconds + ENGINE_MONITOR_CONFIG.checkinMargin * 60).toBe(STALLED_AFTER_SECONDS);
  });
});
