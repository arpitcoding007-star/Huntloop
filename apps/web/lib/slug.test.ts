import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { RESERVED_SLUGS } from "./slug";

/**
 * UX-005: a workspace slug is the first path segment, so it must not be the
 * name of any real top-level route. Read from the app directory rather than
 * listed, so adding a route without reserving its name fails here.
 */
const appDir = fileURLToPath(new URL("../app/", import.meta.url));

function topLevelSegments(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const name = entry.name;
    if (name.startsWith("_") || name.startsWith("[")) continue;
    if (name.startsWith("(") && name.endsWith(")")) {
      out.push(...topLevelSegments(`${dir}${name}/`));
      continue;
    }
    out.push(name);
  }
  return out;
}

describe("reserved workspace slugs", () => {
  it("covers every top-level route", () => {
    const missing = topLevelSegments(appDir).filter((s) => !RESERVED_SLUGS.has(s));
    expect(missing).toEqual([]);
  });
});
