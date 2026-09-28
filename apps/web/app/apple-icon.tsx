import { ImageResponse } from "next/og";
import { BRAND_MARK_DOT_R, BRAND_MARK_PATH } from "@huntloop/ui/brand";

/**
 * The home-screen icon iOS asks for (`/apple-icon`, 180×180). Without it
 * Safari screenshots the page for a home-screen shortcut.
 *
 * The favicon's tile at full size: white loop and blue target on the light
 * theme's ink, the one ground that reads on any wallpaper. iOS rounds the
 * corners itself, so the tile is square. Literals, as in `app/icon.svg` —
 * the image renderer has no stylesheet to resolve tokens against.
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
          background: "#0d1422",
        }}
      >
        <svg width="124" height="124" viewBox="0 0 32 32">
          <path
            d={BRAND_MARK_PATH}
            fill="none"
            stroke="#ffffff"
            strokeWidth={3.2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="16" cy="16" r={BRAND_MARK_DOT_R + 0.1} fill="#4f84ff" />
        </svg>
      </div>
    ),
    size,
  );
}
