/** Digests, their unsubscribe link and the email templates. */
import { DEFAULT_PREFERENCE, digestDue, digestFilter, localTime } from "../../src/handlers/send-digests.ts";
import { digestUnsubscribeToken, verifyDigestUnsubscribeToken } from "../../src/email/digest-token.ts";
import { digestEmail, escapeHtml, invitationEmail } from "../../src/email/templates.ts";
import { expect, expectEqual } from "./harness.ts";

console.log("\nsend_digests — once a day, at the person's own hour");
{
  // 13:30 UTC is 15:30 in Paris (CEST, UTC+2) on this date.
  const now = new Date("2026-10-06T13:30:00Z");
  expectEqual("local time follows the zone", localTime(now, "Europe/Paris"), { date: "2026-10-06", hour: 15 });
  expectEqual("an unknown zone falls back to UTC", localTime(now, "Not/AZone"), { date: "2026-10-06", hour: 13 });
  expect("due once the hour has passed", digestDue({ ...DEFAULT_PREFERENCE, digestHour: 8 }, now).due);
  expect("not before the hour", !digestDue({ ...DEFAULT_PREFERENCE, digestHour: 20 }, now).due);
  expect(
    "not twice on the same local day",
    !digestDue({ ...DEFAULT_PREFERENCE, lastDigestOn: "2026-10-06" }, now).due,
  );
  expect("never when turned off", !digestDue({ ...DEFAULT_PREFERENCE, dailyDigest: false }, now).due);
  expectEqual("an account executive sees their own accounts", digestFilter("sales"), "mine");
  expectEqual("everyone else sees the workspace", digestFilter("founder"), "everyone");
}

console.log("\ndigest unsubscribe link — signed, and bound to one person");
{
  const previous = process.env.SUPABASE_SECRET_KEY;
  process.env.SUPABASE_SECRET_KEY = "test-secret-for-verify-jobs";
  const org = "11111111-1111-4111-8111-111111111111";
  const user = "22222222-2222-4222-8222-222222222222";
  const token = digestUnsubscribeToken(org, user)!;
  expectEqual("a token verifies to the ids it was issued for", verifyDigestUnsubscribeToken(token), {
    orgId: org,
    userId: user,
  });
  const other = "33333333-3333-4333-8333-333333333333";
  expectEqual(
    "and cannot be pointed at somebody else",
    verifyDigestUnsubscribeToken(token.replace(user, other)),
    null,
  );
  expectEqual("garbage is refused", verifyDigestUnsubscribeToken("not.a.token"), null);
  if (previous === undefined) delete process.env.SUPABASE_SECRET_KEY;
  else process.env.SUPABASE_SECRET_KEY = previous;
}

console.log("\nemail templates — every value people typed is escaped");
{
  expectEqual("html is escaped", escapeHtml('<b>"x"</b>'), "&lt;b&gt;&quot;x&quot;&lt;/b&gt;");
  const invite = invitationEmail({
    orgName: "<script>alert(1)</script>",
    inviterName: "Mallory",
    role: "admin",
    url: "https://example.com/invite/abc",
    expiresAt: "2026-10-13T00:00:00Z",
  });
  expect("an org name cannot inject markup", !invite.html.includes("<script>"));
  expect("and the plain-text part carries the link", invite.text.includes("https://example.com/invite/abc"));
  const digest = digestEmail({
    orgName: "Acme",
    firstName: "Sam",
    items: [{ title: "Reply: Northwind", why: "They replied 2 days ago.", href: "https://x.test/a" }],
    total: 3,
    needsYouUrl: "https://x.test/needs-you",
    preferencesUrl: "https://x.test/settings",
    unsubscribeUrl: "https://x.test/unsub",
  });
  expect("a digest says how many need you", digest.subject.startsWith("3 things need you"));
  expect("and links to stop it", digest.text.includes("https://x.test/unsub"));
}

