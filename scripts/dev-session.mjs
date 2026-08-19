/**
 * Mint a browser session for the seeded owner, for local verification.
 *
 * Sign-in is a magic link, and a test cannot read one out of an inbox. This
 * verifies the same one-time token the mail would have carried, then prints
 * the auth cookie in the exact shape `@supabase/ssr` writes it — `base64-`
 * plus base64url JSON, chunked at 3180 bytes — so a browser can be handed a
 * genuine session rather than a forged one.
 *
 * Development only. Needs the secret key; never imported by the app.
 *
 *   node scripts/dev-session.mjs          # prints document.cookie statements
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

for (const line of readFileSync("apps/web/.env.local", "utf8").split(/\r?\n/)) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
  if (m && m[2]) process.env[m[1]] ??= m[2].trim().replace(/^["']|["']$/g, "");
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const admin = createClient(url, process.env.SUPABASE_SECRET_KEY, {
  auth: { persistSession: false },
});

const { data: list, error: listErr } = await admin.auth.admin.listUsers();
if (listErr) throw listErr;

const { data: members } = await admin.from("memberships").select("user_id");
const memberIds = new Set((members ?? []).map((m) => m.user_id));
const user = list.users.find((u) => memberIds.has(u.id)) ?? list.users[0];
if (!user) throw new Error("No auth users. Run db:seed --email you@example.com --create-user");

const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
  type: "magiclink",
  email: user.email,
});
if (linkErr) throw linkErr;

// A second, anonymous client: verifyOtp must run as the user, not the service
// role, or the session it returns is not the user's.
const anon = createClient(
  url,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  { auth: { persistSession: false } },
);
const { data: verified, error: verifyErr } = await anon.auth.verifyOtp({
  token_hash: link.properties.hashed_token,
  type: "email",
});
if (verifyErr) throw verifyErr;

const s = verified.session;
const ref = new URL(url).hostname.split(".")[0];
const name = `sb-${ref}-auth-token`;

const payload =
  "base64-" +
  Buffer.from(
    JSON.stringify({
      access_token: s.access_token,
      refresh_token: s.refresh_token,
      expires_at: s.expires_at,
      expires_in: s.expires_in,
      token_type: s.token_type,
      user: s.user,
    }),
  ).toString("base64url");

const CHUNK = 3180;
const chunks = [];
for (let i = 0; i < payload.length; i += CHUNK) chunks.push(payload.slice(i, i + CHUNK));

const statements =
  chunks.length === 1
    ? [`document.cookie=${JSON.stringify(`${name}=${chunks[0]}; path=/; max-age=3600`)}`]
    : chunks.map(
        (c, i) =>
          `document.cookie=${JSON.stringify(`${name}.${i}=${c}; path=/; max-age=3600`)}`,
      );

console.log(statements.join(";") + ";'signed-in as " + user.email + "'");
