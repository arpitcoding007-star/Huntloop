/**
 * Profile pictures (V-18): what a stored picture may be, and how an upload is
 * cleaned before it is stored.
 *
 * ── Why a data URL in `profiles.avatar_url`, not Supabase Storage ────────
 *
 * A profile picture here is one small image per person, drawn at 36px. The
 * browser shrinks it to 256×256 JPEG before it leaves (roughly 15–30 kB), so
 * it fits in the column that already holds the identity provider's picture
 * URL. Storage would add a bucket, its policies and a second service to
 * operate in production for that, and neither the PGlite migration suite nor
 * the isolated live backend can exercise it. Migration 0072 bounds the column
 * to what this file produces, so the choice does not leave the column open.
 *
 * ── Why the server strips metadata again ─────────────────────────────────
 *
 * Re-encoding through a canvas already drops EXIF (location, camera, date).
 * The server action is callable without the page, so it cannot rely on that:
 * it accepts JPEG only and removes every APP1–APP15 segment and comment
 * before storing, whatever the client sent.
 */

/** The prefix every stored upload carries. */
export const AVATAR_PREFIX = "data:image/jpeg;base64,";
/** Characters, prefix included. About 36 kB of JPEG; 0072 enforces the same bound. */
export const AVATAR_MAX_LENGTH = 48_000;
/** The edge the browser resizes to. */
export const AVATAR_EDGE = 256;

/** A picture that is safe to put in `<img src>`: the provider's https URL, or an upload. */
export function isRenderableAvatar(src: string | null | undefined): src is string {
  if (!src) return false;
  if (src.startsWith(AVATAR_PREFIX)) return src.length <= AVATAR_MAX_LENGTH;
  try {
    return new URL(src).protocol === "https:" && src.length <= 2048;
  } catch {
    return false;
  }
}

export type AvatarResult = { ok: true; dataUrl: string } | { ok: false; error: string };

/** Validates an uploaded data URL and returns it with every metadata segment removed. */
export function cleanAvatarDataUrl(input: unknown): AvatarResult {
  if (typeof input !== "string" || !input.startsWith(AVATAR_PREFIX)) {
    return { ok: false, error: "Choose a JPEG, PNG or WebP picture." };
  }
  if (input.length > AVATAR_MAX_LENGTH) {
    return { ok: false, error: "That picture is too large. Choose a smaller one." };
  }
  const b64 = input.slice(AVATAR_PREFIX.length);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) return { ok: false, error: "That picture could not be read." };

  const bytes = Uint8Array.from(Buffer.from(b64, "base64"));
  const stripped = stripJpegMetadata(bytes);
  if (!stripped) return { ok: false, error: "That picture could not be read." };
  return { ok: true, dataUrl: AVATAR_PREFIX + Buffer.from(stripped).toString("base64") };
}

/**
 * The JPEG with APP1–APP15 (EXIF, XMP, ICC, Photoshop) and COM segments
 * removed, or null when the bytes are not a well-formed JPEG header.
 *
 * Walks the marker segments up to Start of Scan; everything from SOS on is
 * image data and is copied as-is. APP0 (JFIF) is kept: it carries the pixel
 * density, not anything about the person.
 */
export function stripJpegMetadata(bytes: Uint8Array): Uint8Array | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  const out: number[] = [0xff, 0xd8];
  let i = 2;
  while (i < bytes.length) {
    if (bytes[i] !== 0xff) return null;
    /* Fill bytes: any number of 0xFF may precede a marker. */
    while (bytes[i] === 0xff && i < bytes.length) i++;
    if (i >= bytes.length) return null;
    const marker = bytes[i]!;
    i++;
    /* Standalone markers carry no length. TEM and RST should not appear
       before SOS; tolerated rather than refused. EOI before SOS means no image. */
    if (marker === 0xd9) return null;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      out.push(0xff, marker);
      continue;
    }
    if (i + 1 >= bytes.length) return null;
    const length = (bytes[i]! << 8) | bytes[i + 1]!;
    if (length < 2 || i + length > bytes.length) return null;
    const metadata = (marker >= 0xe1 && marker <= 0xef) || marker === 0xfe;
    if (marker === 0xda) {
      /* Start of Scan: the header and all image data that follows, unchanged. */
      for (let k = i - 2; k < bytes.length; k++) out.push(bytes[k]!);
      return Uint8Array.from(out);
    }
    if (!metadata) {
      out.push(0xff, marker);
      for (let k = i; k < i + length; k++) out.push(bytes[k]!);
    }
    i += length;
  }
  return null;
}
