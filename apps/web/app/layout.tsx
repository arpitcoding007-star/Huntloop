import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { siteUrl } from "../lib/site-url";
import "./globals.css";

/**
 * The design tokens have named Inter and JetBrains Mono since the system was
 * written, and until now neither was ever loaded — every user fell through to
 * `system-ui` and `ui-monospace` (audit UI-04). That is not only cosmetic: the
 * type scale, the letter-spacing on `.hl-label`, and the `hl-tabular` numeric
 * alignment were all tuned against Inter, so the design rendered differently
 * on every platform and nobody had seen the intended one.
 *
 * `next/font/google` rather than a `<link>` to fonts.googleapis.com: it
 * downloads the files at build time and serves them from our own origin, so
 * there is no third-party request on first paint, no extra DNS + TLS
 * handshake in the critical path, and no font CDN in the eventual CSP.
 *
 * `display: "swap"` — text renders immediately in the fallback and swaps when
 * the webfont arrives. The alternative, `block`, hides text for up to 3s;
 * on a dashboard whose whole job is to be read, invisible text is worse than
 * briefly differently-shaped text.
 *
 * Exposed as CSS variables rather than a className on <body>, because the
 * families are consumed by `tokens.css` in `packages/ui` — which must not know
 * that Next exists. The token reads `var(--font-inter, "Inter")`, so the
 * package still works standalone with the plain family name.
 */
const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-jetbrains-mono",
});

/**
 * `title.template` rather than a bare string: every page that sets its own
 * title was already writing "· Huntloop" by hand, which is the kind of thing
 * that stays consistent right up until someone adds a page and forgets.
 *
 * `metadataBase` is what makes the relative URLs in `openGraph` resolve to
 * absolute ones. Without it Next emits a build-time warning and falls back to
 * localhost, which is how a production deployment ends up publishing
 * `http://localhost:3100` as its canonical Open Graph URL.
 */
export const metadata: Metadata = {
  metadataBase: siteUrl(),
  title: {
    default: "Huntloop",
    template: "%s · Huntloop",
  },
  description:
    "AI-powered closed-loop outbound growth engine — discover, qualify, enrich, reach out, track, learn, improve.",
  applicationName: "Huntloop",
  openGraph: {
    type: "website",
    siteName: "Huntloop",
    title: "Huntloop",
    description:
      "Know who needs you before you reach out. Qualified opportunities with evidence, not lead lists.",
    url: "/",
  },
  twitter: {
    card: "summary_large_image",
    title: "Huntloop",
    description:
      "Know who needs you before you reach out. Qualified opportunities with evidence, not lead lists.",
  },
  // No `images` on either card yet, and none invented. A card that points at a
  // nonexistent asset renders worse than one with no image at all — the
  // scraper fetches a 404 and some clients then cache the failure.
};

/**
 * Every page renders per request, so the CSP nonce reaches all of them.
 *
 * A statically prerendered page has its HTML — including Next's inline
 * hydration scripts — generated at build time, necessarily before any request
 * and therefore before any nonce exists. Under the enforcing policy those
 * scripts are blocked, and the failure is the quiet kind: the page renders
 * perfectly and never hydrates, so forms submit nothing and filters do not
 * filter. The Playwright CSP suite caught it first on `/login` and then, after
 * a round of per-route fixes, on the 404.
 *
 * Set once here rather than on each segment, because the per-route version was
 * a list that had to be kept complete: every page added later would default to
 * static and silently opt out of the policy. This inverts that — the next page
 * is covered by default, and a page that wants prerendering has to say so and
 * explain how it handles the nonce.
 *
 * What it costs, measured rather than assumed: nothing meaningful. Every route
 * in this app except the three metadata ones was already dynamic (`ƒ` in the
 * build output) because they read cookies or params. The two that were not —
 * `/login` and `/_not-found` — fetch no data, so rendering them per request is
 * React producing a string, with no database call to make it slow.
 *
 * `robots.ts` and `sitemap.ts` opt back out explicitly with `force-static`.
 * They ship no scripts, so they need no nonce, and they are the two responses
 * most worth serving from a cache.
 */
export const dynamic = "force-dynamic";

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrainsMono.variable}`}>
      {/* `font-sans` explicitly rather than relying on Tailwind's preflight
          picking up the theme's --font-sans: the token indirection above is
          worth nothing if the family is only applied by a default that a
          future preflight change could move. */}
      <body className="min-h-screen bg-canvas font-sans text-fg antialiased">
        {children}
      </body>
    </html>
  );
}
