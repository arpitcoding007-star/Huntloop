import { permanentRedirect } from "next/navigation";

/**
 * UX-301 (pass 17). Only the `/compare/*` pages exist, so a visitor who trims the
 * URL to `/compare` used to get the 404 page. The landing page links every one of
 * them from its footer, so it is the index.
 */
export default function CompareIndex(): never {
  permanentRedirect("/");
}
