import { createHash, createHmac } from "node:crypto";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  canonicalJson,
  hashSigningKey,
  INNGEST_FUNCTION_ID,
  registrationPayload,
  stripSigningKeyPrefix,
  verifyInngestSignature,
} from "./inngest";

/*
 * The expected values are built here from the protocol as Inngest's SDK spec
 * and both official SDKs state it (inngest-js `signDataWithKey`,
 * inngestgo `Sign`): HMAC-SHA256 keyed by the signing key with its
 * `signkey-<env>-` prefix removed, used as UTF-8 text, over body then
 * timestamp. Inngest publishes no fixed vector, so the test states the
 * algorithm independently rather than calling the code under test.
 */
const SECRET = "9f2c7a1b4d6e8f0a1b2c3d4e5f60718293a4b5c6d7e8f90112233445566778899";
const KEY = `signkey-prod-${SECRET}`;
const NOW = 1_795_000_000_000;
const T = String(Math.floor(NOW / 1000));

function inngestSigns(body: string, t = T, secret = SECRET) {
  const s = createHmac("sha256", secret).update(body + t).digest("hex");
  return `t=${t}&s=${s}`;
}

describe("Inngest request signature", () => {
  const body = '{"event":{"name":"inngest/scheduled.timer"},"ctx":{"run_id":"01H"}}';

  it("accepts what Inngest sends: body then timestamp, prefix stripped, key as text", () => {
    expect(verifyInngestSignature(inngestSigns(body), body, KEY, NOW)).toEqual({ ok: true });
  });

  it("refuses the order and key handling the route used before (timestamp first, hex-decoded key)", () => {
    const old = createHmac("sha256", Buffer.from(SECRET, "hex")).update(T).update(body).digest("hex");
    expect(verifyInngestSignature(`t=${T}&s=${old}`, body, KEY, NOW).ok).toBe(false);
  });

  it("accepts a signature over the canonical (JCS) form when the wire bytes are not canonical", () => {
    const wire = '{ "ctx": {"run_id": "01H"}, "event": {"name": "inngest/scheduled.timer"} }';
    const canonical = canonicalJson(JSON.parse(wire));
    expect(canonical).toBe('{"ctx":{"run_id":"01H"},"event":{"name":"inngest/scheduled.timer"}}');
    expect(verifyInngestSignature(inngestSigns(canonical), wire, KEY, NOW)).toEqual({ ok: true });
  });

  it("refuses a tampered body", () => {
    expect(verifyInngestSignature(inngestSigns(body), body.replace("01H", "01X"), KEY, NOW).ok).toBe(false);
  });

  it("refuses a signature made with another key", () => {
    const other = inngestSigns(body, T, SECRET.replace(/^9/, "8"));
    expect(verifyInngestSignature(other, body, KEY, NOW).ok).toBe(false);
  });

  it("refuses a replay outside five minutes, and accepts one just inside", () => {
    const stale = String(Number(T) - 301);
    expect(verifyInngestSignature(inngestSigns(body, stale), body, KEY, NOW)).toEqual({
      ok: false,
      reason: "That signature is outside the five-minute window.",
    });
    const fresh = String(Number(T) - 299);
    expect(verifyInngestSignature(inngestSigns(body, fresh), body, KEY, NOW).ok).toBe(true);
  });

  it("refuses a missing key, header, or malformed header", () => {
    expect(verifyInngestSignature(inngestSigns(body), body, undefined, NOW).ok).toBe(false);
    expect(verifyInngestSignature(null, body, KEY, NOW).ok).toBe(false);
    expect(verifyInngestSignature("t=abc&s=00", body, KEY, NOW).ok).toBe(false);
    expect(verifyInngestSignature(`s=00`, body, KEY, NOW).ok).toBe(false);
  });

  it("works with a key that has no prefix", () => {
    expect(verifyInngestSignature(inngestSigns(body), body, SECRET, NOW).ok).toBe(true);
  });
});

describe("Inngest signing-key hash (register bearer token)", () => {
  it("keeps the prefix and replaces the secret with SHA-256 of its hex-decoded bytes", () => {
    const expected = createHash("sha256").update(Buffer.from(SECRET, "hex")).digest("hex");
    expect(hashSigningKey(KEY)).toBe(`signkey-prod-${expected}`);
    expect(hashSigningKey(KEY)).not.toContain(SECRET);
    expect(stripSigningKeyPrefix(KEY)).toBe(SECRET);
  });
});

describe("JCS canonical JSON", () => {
  it("sorts keys at every depth and drops whitespace", () => {
    expect(canonicalJson({ b: 1, a: [{ d: true, c: null }], e: "x\"y" })).toBe(
      '{"a":[{"c":null,"d":true}],"b":1,"e":"x\\"y"}',
    );
  });
});

describe("Inngest registration payload", () => {
  it("registers one cron function whose step URL is the configured endpoint with fnId and stepId", () => {
    const p = registrationPayload(new URL("https://app.example.com/api/inngest?x=1"));
    expect(p.url).toBe("https://app.example.com/api/inngest");
    expect(p.deployType).toBe("ping");
    expect(p.v).toBe("0.1");
    expect(p.functions).toHaveLength(1);
    const fn = p.functions[0]!;
    expect(fn.id).toBe(INNGEST_FUNCTION_ID);
    expect(fn.id.startsWith(`${p.appName}-`)).toBe(true);
    expect(fn.triggers).toEqual([{ cron: "*/5 * * * *" }]);
    const step = new URL(fn.steps.step.runtime.url);
    expect(step.origin + step.pathname).toBe("https://app.example.com/api/inngest");
    expect(step.searchParams.get("fnId")).toBe(INNGEST_FUNCTION_ID);
    expect(step.searchParams.get("stepId")).toBe("step");
  });
});

/* ── The route, with the engine and the network mocked ───────────────────── */

const jobs = vi.hoisted(() => ({
  configured: true,
  sweep: vi.fn(async () => undefined),
  tick: vi.fn(async () => ({ claimed: 0 }) as unknown),
}));

vi.mock("@huntloop/jobs", () => ({
  isInngestConfigured: () => jobs.configured,
  sweep: jobs.sweep,
  tick: jobs.tick,
  TICK_DEFAULTS: { limit: 5 },
}));

describe("/api/inngest", () => {
  const env = { ...process.env };

  beforeEach(() => {
    jobs.configured = true;
    jobs.sweep.mockClear();
    jobs.tick.mockReset().mockResolvedValue({ claimed: 0 });
    process.env.INNGEST_SIGNING_KEY = KEY;
    process.env.INNGEST_EVENT_KEY = "evt";
    process.env.NEXT_PUBLIC_SITE_URL = "https://app.example.com";
    delete process.env.INNGEST_API_BASE_URL;
    delete process.env.INNGEST_BASE_URL;
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  });

  afterEach(() => {
    process.env = { ...env };
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  async function route() {
    return import("../app/api/inngest/route");
  }

  function post(body: string, signature: string | null) {
    return new NextRequest("https://app.example.com/api/inngest?fnId=huntloop-tick&stepId=step", {
      method: "POST",
      body,
      headers: signature ? { "x-inngest-signature": signature } : {},
    });
  }

  it("runs sweep and tick for a correctly signed call, with the protocol headers", async () => {
    const { POST } = await route();
    const body = '{"event":{}}';
    const res = await POST(post(body, inngestSigns(body)));
    expect(res.status).toBe(200);
    expect(res.headers.get("x-inngest-req-version")).toBe("2");
    expect(res.headers.get("x-inngest-sdk")).toMatch(/^huntloop:v\d/);
    expect(jobs.sweep).toHaveBeenCalledOnce();
    expect(jobs.tick).toHaveBeenCalledOnce();
  });

  it("runs nothing for a bad signature and tells Inngest not to retry", async () => {
    const { POST } = await route();
    const res = await POST(post('{"event":{}}', "t=1&s=00"));
    expect(res.status).toBe(500);
    expect(res.headers.get("x-inngest-no-retry")).toBe("true");
    expect(jobs.sweep).not.toHaveBeenCalled();
    expect(jobs.tick).not.toHaveBeenCalled();
  });

  it("asks for a retry when the tick itself fails", async () => {
    jobs.tick.mockRejectedValueOnce(new Error("db down"));
    const { POST } = await route();
    const body = "{}";
    const res = await POST(post(body, inngestSigns(body)));
    expect(res.status).toBe(500);
    expect(res.headers.get("x-inngest-no-retry")).toBe("false");
  });

  it("is a 404 on every method when Inngest is not configured", async () => {
    jobs.configured = false;
    const { POST, PUT, GET } = await route();
    expect((await POST(post("{}", inngestSigns("{}")))).status).toBe(404);
    expect((await PUT()).status).toBe(404);
    expect((await GET()).status).toBe(404);
  });

  it("syncs on PUT: registers at /fn/register with the hashed key and the configured URL", async () => {
    const fetchMock = vi.fn(async () => new Response('{"ok":true,"modified":true}', { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { PUT } = await route();
    const res = await PUT();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ modified: true });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.inngest.com/fn/register");
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe(`Bearer ${hashSigningKey(KEY)}`);
    expect(headers.authorization).not.toContain(SECRET);
    const payload = JSON.parse(String(init.body));
    expect(payload.url).toBe("https://app.example.com/api/inngest");
  });

  it("reports a refused registration as a 500 with Inngest's reason", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response('{"error":"bad key"}', { status: 401 })));
    const { PUT } = await route();
    const res = await PUT();
    expect(res.status).toBe(500);
    expect((await res.json()).message).toContain("bad key");
  });

  it("honours INNGEST_API_BASE_URL for the register call", async () => {
    process.env.INNGEST_API_BASE_URL = "https://inngest.internal/";
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { PUT } = await route();
    await PUT();
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe("https://inngest.internal/fn/register");
  });
});
