import { permanentRedirect } from "next/navigation";

/**
 * UX-301 (pass 17). Only the `/for/*` pages exist, so a visitor who trims the
 * URL to `/for` used to get the 404 page. The landing page links every one of
 * them from its footer, so it is the index.
 */
export default function ForIndex(): never {
  permanentRedirect("/");
}
