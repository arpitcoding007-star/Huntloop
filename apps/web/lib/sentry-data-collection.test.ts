import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SENTRY_DATA_COLLECTION } from "./sentry-data-collection";

/**
 * Sentry v11 collects personal data by default (`dataCollection`). These tests
 * keep the v10 decision this app made, "nothing personal leaves", from being
 * undone by a default, a typo or one runtime forgetting the setting.
 */

const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const INIT_FILES = ["sentry.server.config.ts", "sentry.edge.config.ts", "instrumentation-client.ts"];

describe("Sentry data collection", () => {
  it("collects nothing personal", () => {
    const c = SENTRY_DATA_COLLECTION;
    expect(c.userInfo).toBe(false);
    expect(c.cookies).toBe(false);
    expect(c.httpHeaders).toBe(false);
    expect(c.httpBodies).toEqual([]);
    expect(c.urlQueryParams).toBe(false);
    expect(c.graphQL).toEqual({ document: false, variables: false });
    expect(c.genAI).toEqual({ inputs: false, outputs: false });
    expect(c.mcp).toEqual({ inputs: false, outputs: false });
    expect(c.databaseQueryData).toBe(false);
    expect(c.queues).toBe(false);
    expect(c.stackFrameVariables).toBe(false);
  });

  it.each(INIT_FILES)("%s passes the shared setting and nothing that would override it", (file) => {
    const source = readFileSync(path.join(web, file), "utf8");
    expect(source).toContain("dataCollection: SENTRY_DATA_COLLECTION");
    // Option lines only: the comments explain the old `sendDefaultPii` setting by name.
    expect(source).not.toMatch(/^\s*sendDefaultPii\s*:/m);
    expect(source).not.toMatch(/^\s*dataCollection:\s*\{/m);
  });
});
