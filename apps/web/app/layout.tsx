import type { Metadata } from "next";
import { siteUrl } from "../lib/site-url";
import "./globals.css";

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

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-canvas text-fg antialiased">
        {children}
      </body>
    </html>
  );
}
