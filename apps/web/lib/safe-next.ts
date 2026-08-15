/**
 * Where to send someone after they sign in, given an attacker-controlled hint.
 *
 * `?next=` arrives on a URL the user clicked, so its value is untrusted in the
 * ordinary sense: whoever sent the link chose it. The failure this prevents is
 * an open redirect — `?next=https://evil.example` turning Huntloop's sign-in
 * into a legitimate-looking hop on a phishing chain, complete with our domain
 * in the address bar for the first half of it.
 *
 * The rule is: same-origin **paths** only, and everything else becomes `/`.
 *
 * ── What each clause is actually for ──────────────────────────────────────
 *
 * `startsWith("/")` rejects absolute URLs. That is the obvious half.
 *
 * `!startsWith("//")` rejects protocol-relative URLs. `//evil.example` is a
 * path only by appearance — every browser reads it as "same scheme, that
 * host". This is the clause people leave out.
 *
 * Backslashes are rejected anywhere in the value. This one needs explaining,
 * because it is *not* currently exploitable and is here anyway. Browsers and
 * the URL parser normalise `\` to `/`, so `/\evil.example` survives both
 * checks above and then becomes `//evil.example`. Today the callers compose
 * `${origin}${path}`, so the result is `https://huntloop.example//evil.example`
 * — still our origin, still safe. The protection is the origin prefix, not the
 * check. But that makes the safety of this function a property of how its
 * callers concatenate, and the next caller may not concatenate the same way.
 * Rejecting the backslash makes the value safe on its own terms.
 *
 * Control characters are rejected for the same reason: the URL parser strips
 * tabs and newlines during parsing, so `/\tevil` and `/evil` are the same
 * destination, and a value that changes meaning while being parsed should not
 * be forwarded.
 */
export function safeNextPath(next: string | null | undefined): string {
  if (!next) return "/";
  if (!next.startsWith("/")) return "/";
  if (next.startsWith("//")) return "/";
  if (next.includes("\\")) return "/";
  // A codepoint check rather than a regex literal: writing control characters
  // into source either embeds them invisibly or needs escaping that the next
  // editor may "tidy". This says what it means and needs no lint exemption.
  if ([...next].some((c) => c.charCodeAt(0) < 0x20)) return "/";
  return next;
}
