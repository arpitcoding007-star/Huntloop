import { describe, expect, it } from "vitest";
import {
  AVATAR_MAX_LENGTH,
  AVATAR_PREFIX,
  cleanAvatarDataUrl,
  isRenderableAvatar,
  stripJpegMetadata,
} from "./avatar";

/* A minimal JPEG header: SOI, then segments, then SOS and two bytes of
   "image data" and EOI. Enough for the parser, which stops at SOS. */
const seg = (marker: number, payload: number[]) => [0xff, marker, (payload.length + 2) >> 8, (payload.length + 2) & 0xff, ...payload];
const exif = seg(0xe1, [...Buffer.from("Exif\0\0GPS 51.5N 0.1W")]);
const xmp = seg(0xe1, [...Buffer.from("http://ns.adobe.com/xap/1.0/")]);
const comment = seg(0xfe, [...Buffer.from("taken at home")]);
const jfif = seg(0xe0, [...Buffer.from("JFIF\0"), 1, 1, 0, 0, 1, 0, 1, 0, 0]);
const dqt = seg(0xdb, [0, ...Array(64).fill(1)]);
const sos = [...seg(0xda, [1, 1, 0, 0, 0x3f, 0]), 0x12, 0x34, 0xff, 0xd9];

const jpeg = (...parts: number[][]) => Uint8Array.from([0xff, 0xd8, ...parts.flat()]);
const dataUrl = (bytes: Uint8Array) => AVATAR_PREFIX + Buffer.from(bytes).toString("base64");
const contains = (bytes: Uint8Array, text: string) => Buffer.from(bytes).includes(Buffer.from(text));

describe("stripJpegMetadata", () => {
  it("removes EXIF, XMP and comments, and keeps JFIF, tables and image data", () => {
    const out = stripJpegMetadata(jpeg(jfif, exif, xmp, comment, dqt, sos))!;
    expect(out).not.toBeNull();
    expect(contains(out, "GPS")).toBe(false);
    expect(contains(out, "adobe")).toBe(false);
    expect(contains(out, "taken at home")).toBe(false);
    expect([...out]).toEqual([0xff, 0xd8, ...jfif, ...dqt, ...sos]);
  });

  it("leaves a clean JPEG byte-for-byte unchanged", () => {
    const clean = jpeg(jfif, dqt, sos);
    expect([...stripJpegMetadata(clean)!]).toEqual([...clean]);
  });

  it("refuses what is not a JPEG, or a header that runs off the end", () => {
    expect(stripJpegMetadata(Uint8Array.from([0x89, 0x50, 0x4e, 0x47]))).toBeNull();
    expect(stripJpegMetadata(jpeg([0xff, 0xe1, 0x40, 0x00, 1, 2]))).toBeNull();
    expect(stripJpegMetadata(jpeg(jfif))).toBeNull();
    expect(stripJpegMetadata(jpeg([0xff, 0xd9]))).toBeNull();
  });
});

describe("cleanAvatarDataUrl", () => {
  it("returns the upload with its metadata removed", () => {
    const res = cleanAvatarDataUrl(dataUrl(jpeg(jfif, exif, dqt, sos)));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.dataUrl.startsWith(AVATAR_PREFIX)).toBe(true);
    expect(contains(Buffer.from(res.dataUrl.slice(AVATAR_PREFIX.length), "base64"), "GPS")).toBe(false);
  });

  it("accepts JPEG only", () => {
    expect(cleanAvatarDataUrl("data:image/png;base64,iVBORw0KGgo=")).toEqual({ ok: false, error: expect.stringMatching(/JPEG/) });
    expect(cleanAvatarDataUrl("https://example.com/me.jpg").ok).toBe(false);
    expect(cleanAvatarDataUrl(42).ok).toBe(false);
  });

  it("refuses an oversized upload before decoding it", () => {
    const big = AVATAR_PREFIX + "A".repeat(AVATAR_MAX_LENGTH);
    expect(cleanAvatarDataUrl(big)).toEqual({ ok: false, error: expect.stringMatching(/too large/) });
  });

  it("refuses base64 with stray characters, and bytes that are not a JPEG", () => {
    expect(cleanAvatarDataUrl(AVATAR_PREFIX + "abc$def").ok).toBe(false);
    expect(cleanAvatarDataUrl(AVATAR_PREFIX + Buffer.from("not an image").toString("base64")).ok).toBe(false);
  });
});

describe("isRenderableAvatar", () => {
  it("allows the provider's https URL and a bounded upload", () => {
    expect(isRenderableAvatar("https://lh3.googleusercontent.com/a/x")).toBe(true);
    expect(isRenderableAvatar(dataUrl(jpeg(jfif, dqt, sos)))).toBe(true);
  });

  it("refuses everything else", () => {
    expect(isRenderableAvatar(null)).toBe(false);
    expect(isRenderableAvatar("")).toBe(false);
    expect(isRenderableAvatar("http://example.com/me.jpg")).toBe(false);
    expect(isRenderableAvatar("javascript:alert(1)")).toBe(false);
    expect(isRenderableAvatar("data:image/svg+xml;base64,PHN2Zz4=")).toBe(false);
    expect(isRenderableAvatar(AVATAR_PREFIX + "A".repeat(AVATAR_MAX_LENGTH))).toBe(false);
  });
});
