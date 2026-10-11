import { ImageResponse } from "next/og";
import { BRAND_MARK_DOT_R, BRAND_MARK_PATH, BRAND_MARK_STROKE } from "@huntloop/ui/brand";

/**
 * The home-screen icon iOS asks for (`/apple-icon`, 180×180). Without it
 * Safari screenshots the page for a home-screen shortcut.
 *
 * The dark app icon from the logo board (01 — "App icon"): the approved
 * mark, as supplied, on the #111111 canvas — loop #ECECEA, target #6E9BFF,
 * the mark at 64% of the tile. iOS rounds the corners itself, so the tile
 * is square. Literals, as in `app/icon.svg` — the image renderer has no
 * stylesheet to resolve tokens against.
 */
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#111111",
        }}
      >
        <svg width="115" height="115" viewBox="0 0 32 32">
          <path
            d={BRAND_MARK_PATH}
            fill="none"
            stroke="#ececea"
            strokeWidth={BRAND_MARK_STROKE}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="16" cy="16" r={BRAND_MARK_DOT_R} fill="#6e9bff" />
        </svg>
      </div>
    ),
    size,
  );
}
