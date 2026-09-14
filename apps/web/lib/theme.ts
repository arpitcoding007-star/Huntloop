export type ThemePreference = "system" | "light" | "dark";

/**
 * Read server-side in layout.tsx for a flash-free `data-theme` on first
 * paint, and written client-side by `ThemeToggle` (packages/ui) on every
 * change — kept in sync with that file's own copy of the name, since a
 * shared constants module for one string crossing the package boundary
 * would be more machinery than the duplication it avoids.
 */
export const THEME_COOKIE_NAME = "hl-theme";

export function parseThemePreference(value: string | undefined): ThemePreference {
  return value === "light" || value === "dark" ? value : "system";
}

/**
 * Resolves "system" before first paint and keeps it resolved live.
 *
 * Only needed for the "system" case: an explicit light/dark preference is
 * rendered straight into `data-theme` server-side (see layout.tsx) and this
 * script is a same-value no-op for it. For "system" the server cannot know
 * the OS preference, so `data-theme` is left unset on the server-rendered
 * HTML and this — the first thing to run in <body>, synchronous, before any
 * later content paints — sets it from `matchMedia` immediately. The `change`
 * listener is what makes System keep following the OS live while the app
 * stays open, without ever overriding an explicit choice (it re-reads
 * `data-theme-preference` on every firing rather than closing over a stale
 * value, so a later switch to/from "system" via the toggle is respected).
 */
export const THEME_INIT_SCRIPT = `(function(){try{
var d=document.documentElement;
var mql=window.matchMedia('(prefers-color-scheme: dark)');
function resolve(p){return p==='system'?(mql.matches?'dark':'light'):p;}
function apply(){d.setAttribute('data-theme',resolve(d.getAttribute('data-theme-preference')||'system'));}
apply();
mql.addEventListener('change',apply);
}catch(e){}})();`;
