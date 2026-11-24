/**
 * What a visitor typed on /find, kept in their own browser until they have a
 * workspace to file it in (DN-74). It is never sent anywhere before then: no
 * URL, no server, no model. A day is long enough to read a sign-in email.
 */
const KEY = "huntloop.find";
const TTL_MS = 24 * 60 * 60 * 1000;

export function saveDraftRequest(text: string, now = Date.now()): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ text: text.slice(0, 2000), at: now }));
  } catch {
    // Storage is blocked: they type it again after signing up.
  }
}

export function readDraftRequest(now = Date.now()): string {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "null") as { text?: unknown; at?: unknown } | null;
    if (typeof saved?.text === "string" && typeof saved.at === "number" && now - saved.at < TTL_MS) return saved.text;
    localStorage.removeItem(KEY);
  } catch {
    // Unreadable is the same as absent.
  }
  return "";
}

export function clearDraftRequest(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing to clear.
  }
}
