import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearDraftRequest, readDraftRequest, saveDraftRequest } from "./draft-request";

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
});

describe("the request typed before there is an account", () => {
  it("survives sign-up, and is cleared once used", () => {
    saveDraftRequest("200 cards", 1000);
    expect(readDraftRequest(2000)).toBe("200 cards");
    clearDraftRequest();
    expect(readDraftRequest(2000)).toBe("");
  });
  it("is forgotten after a day", () => {
    saveDraftRequest("200 cards", 0);
    expect(readDraftRequest(25 * 3_600_000)).toBe("");
    expect(store.size).toBe(0);
  });
  it("treats damage or blocked storage as nothing", () => {
    store.set("huntloop.find", "{");
    expect(readDraftRequest()).toBe("");
    vi.stubGlobal("localStorage", undefined);
    expect(() => saveDraftRequest("x")).not.toThrow();
    expect(readDraftRequest()).toBe("");
  });
});
