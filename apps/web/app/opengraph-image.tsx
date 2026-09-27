import { ImageResponse } from "next/og";

/**
 * The Open Graph card.
 *
 * ── Why generated rather than a PNG in `public/` ─────────────────────────
 *
 * `app/layout.tsx` deliberately shipped no `images` on either card, with a
 * note explaining why: a card pointing at a nonexistent asset renders worse
 * than one with no image, because the scraper fetches a 404 and some clients
 * cache the failure. That was the right call while there was no asset. It
 * left the product with no card at all, which is the other failure.
 *
 * Generating it here removes the choice between the two. There is no binary
 * to commit, nothing to re-export when the wordmark changes, and the colours
 * cannot drift from the design system because they are the same hex values
 * `tokens.css` declares — restated as literals only because Satori resolves
 * no CSS variables and no external stylesheet.
 *
 * ── Why it says what it says ─────────────────────────────────────────────
 *
 * A social card is read at thumbnail size in a feed, so it gets the
 * position and nothing else. The three claim labels are the product's actual
 * argument — fact, inference, unknown, never allowed to look alike — and
 * rendering them in the palette they carry in the app makes the card a small
 * true sample of the interface rather than a decorated logo.
 */
export const runtime = "edge";
export const alt =
  "Huntloop — know who needs you before you reach out. Every score shows its working.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/* Dark theme's leaves from packages/ui/src/tokens.css. Satori has no access
   to the stylesheet, so these are copies; they are the only copies in the
   codebase and they are here because the alternative is no card. */
const CANVAS = "#08090a";
const SURFACE = "#101113";
const BORDER = "#232427";
const TEXT = "#f5f5f6";
const MUTED = "#8a8d94";
/* Meridian: green is a verified fact, blue is the accent and the model. */
const FACT = "#4bc98a";
const FACT_SURFACE = "#243027";
const BRAND = "#6e9bff";
const BRAND_SURFACE = "#0e1931";
const BRAND_BORDER = "#1e3a6e";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: CANVAS,
          padding: 72,
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 44,
              height: 44,
              borderRadius: 10,
              background: BRAND_SURFACE,
              color: BRAND,
              fontSize: 26,
              fontWeight: 700,
            }}
          >
            H
          </div>
          <div style={{ color: TEXT, fontSize: 28, fontWeight: 600 }}>Huntloop</div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div
            style={{
              color: TEXT,
              fontSize: 68,
              fontWeight: 600,
              lineHeight: 1.1,
              letterSpacing: "-0.02em",
              maxWidth: 900,
            }}
          >
            Know who needs you before you reach out.
          </div>
          <div style={{ color: MUTED, fontSize: 28, lineHeight: 1.4, maxWidth: 820 }}>
            Every score shows its working. Every claim names its source. When we
            don&rsquo;t know, we say so.
          </div>
        </div>

        {/* The three kinds of thing the product distinguishes, in the colours
            it distinguishes them with. Green is a source-verified fact,
            blue is model output, gray is nothing on file. */}
        <div style={{ display: "flex", gap: 12 }}>
          <Chip label="FACT" color={FACT} background={FACT_SURFACE} border="#2f5a42" />
          <Chip label="INFERENCE" color={BRAND} background={BRAND_SURFACE} border={BRAND_BORDER} />
          <Chip label="UNKNOWN" color={MUTED} background={SURFACE} border={BORDER} />
        </div>
      </div>
    ),
    size,
  );
}

function Chip({
  label,
  color,
  background,
  border,
}: {
  label: string;
  color: string;
  background: string;
  border: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        padding: "10px 18px",
        borderRadius: 6,
        background,
        border: `1px solid ${border}`,
        color,
        fontSize: 20,
        fontWeight: 500,
        letterSpacing: "0.06em",
      }}
    >
      {label}
    </div>
  );
}
