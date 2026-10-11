import { ImageResponse } from "next/og";
import { BRAND_MARK_DOT_R, BRAND_MARK_PATH, BRAND_MARK_STROKE } from "@huntloop/ui/brand";

/**
 * The mark for the product email header (`packages/jobs/src/email/templates.ts`).
 *
 * Mail clients drop inline SVG, so the header needs a raster. The logo board
 * puts "mark + wordmark" in the email header; the wordmark is live text in
 * the email itself, and this is the mark, as supplied — the light-ground
 * colours (#0D1422 loop, #2F6BFF target) on a transparent square, drawn at
 * 3× the 24px it is displayed at.
 *
 * The `.png` in the path keeps it outside the proxy's matcher, so a mail
 * client fetching it is never redirected to /login.
 */
export const dynamic = "force-static";

const SIZE = 72;

export function GET() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <svg width={SIZE} height={SIZE} viewBox="0 0 32 32">
          <path
            d={BRAND_MARK_PATH}
            fill="none"
            stroke="#0d1422"
            strokeWidth={BRAND_MARK_STROKE}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="16" cy="16" r={BRAND_MARK_DOT_R} fill="#2f6bff" />
        </svg>
      </div>
    ),
    { width: SIZE, height: SIZE },
  );
}
