import { redirect } from "next/navigation";

/**
 * The root route sends visitors to sign-in.
 *
 * It used to redirect to `/kitchen-sink`, the internal component gallery —
 * which is also the canonical URL in the sitemap and the Open Graph `url`, so
 * the first thing every crawler, link preview and first-time visitor saw was a
 * page of buttons and badges (audit SEO-04).
 *
 * `/login` is the deliberate minimum, not a placeholder for a landing page:
 * Huntloop is an authenticated product with no public content, and until there
 * is marketing copy worth serving, the honest front door is the one that gets
 * you into the product. When a landing page does land, this file is where it
 * goes — and Phase 8 of the audit (content SEO) becomes applicable for the
 * first time.
 *
 * `redirect()` issues a 307. Deliberately not permanent: a 308 is cached by
 * browsers more or less forever, so shipping one here would make the eventual
 * landing page invisible to everyone who had already visited.
 */
export default function Home() {
  redirect("/login");
}
