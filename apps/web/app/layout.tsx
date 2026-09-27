import type { Metadata } from "next";
import { ToastProvider } from "@huntloop/ui";
import { Geist, Geist_Mono } from "next/font/google";
import { cookies, headers } from "next/headers";
import { siteUrl } from "../lib/site-url";
import "./globals.css";
import {
  parseThemePreference,
  THEME_COOKIE_NAME,
  THEME_INIT_SCRIPT,
  type ThemePreference,
} from "../lib/theme";

/**
 * Geist and Geist Mono — the Meridian brief names them, and the type scale,
 * the tracking on `.hl-label` and the `hl-tabular` numerals in `tokens.css`
 * are tuned against them. They replaced Inter and JetBrains Mono, which are
 * no longer loaded anywhere. (Audit UI-04 is why a family is loaded at all:
 * before that, every user fell through to `system-ui`.)
 *
 * `next/font/google` rather than a `<link>` to fonts.googleapis.com or the
 * `geist` npm package: it downloads the files at build time and serves them
 * from our own origin — no third-party request on first paint, no font CDN
 * in the CSP, and no new dependency.
 *
 * `display: "swap"` — text renders immediately in the fallback and swaps when
 * the webfont arrives. The alternative, `block`, hides text for up to 3s;
 * on a dashboard whose whole job is to be read, invisible text is worse than
 * briefly differently-shaped text.
 *
 * Exposed as CSS variables rather than a className on <body>, because the
 * families are consumed by `tokens.css` in `packages/ui` — which must not know
 * that Next exists. The token reads `var(--font-geist, "Geist")`, so the
 * package still works standalone with the plain family name.
 */
const geist = Geist({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-geist",
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-geist-mono",
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
  // `images` is not set here on purpose, and is no longer absent either.
  // `app/opengraph-image.tsx` is a file convention: Next discovers it,
  // generates the PNG, and injects `og:image` and `twitter:image` with the
  // right absolute URL and dimensions on every page that does not override
  // them. Listing it here as well would produce two tags for one image.
  //
  // The note this replaces said no card was better than a card pointing at a
  // 404, which was true while there was nothing to point at. There is now,
  // and it is generated rather than committed, so it cannot become a 404.
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

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  /*
   * Theme preference, resolved server-side so an explicit choice never
   * flashes: "light"/"dark" go straight onto `data-theme` in the HTML this
   * renders. "system" can't be resolved here — the server doesn't know the
   * visitor's OS setting — so `data-theme` is left unset for it and the
   * bootstrap script below (nonce'd, first thing in <body>, synchronous)
   * resolves it from `matchMedia` before anything else paints. See
   * lib/theme.ts for the full reasoning.
   */
  const preference: ThemePreference = parseThemePreference(
    (await cookies()).get(THEME_COOKIE_NAME)?.value,
  );
  const resolvedTheme = preference === "system" ? undefined : preference;

  /*
   * Same per-request nonce lib/csp.ts mints and proxy.ts attaches as
   * `x-nonce` — reused here rather than minting a second one, so this
   * script is covered by the same `script-src 'nonce-…'` the rest of the
   * document's inline scripts already need.
   */
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    <html
      lang="en"
      data-theme={resolvedTheme}
      data-theme-preference={preference}
      /*
       * The bootstrap script mutates `data-theme` for the "system" case
       * (and re-applies it, as a no-op, otherwise) before React hydrates —
       * exactly the kind of server/client attribute drift this prop exists
       * to silence. Nothing else about hydration is affected.
       */
      suppressHydrationWarning
      className={`${geist.variable} ${geistMono.variable}`}
    >
      {/* `font-sans` explicitly rather than relying on Tailwind's preflight
          picking up the theme's --font-sans: the token indirection above is
          worth nothing if the family is only applied by a default that a
          future preflight change could move. */}
      <body className="min-h-screen bg-canvas font-sans text-fg antialiased">
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        {/* At the root rather than inside the app shell, so the marketing,
            auth and onboarding trees can confirm an action too. The live
            region it renders is empty until something is put in it, and it
            has to exist beforehand — an aria-live element that appears at
            the same moment as its text is frequently not announced. */}
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
