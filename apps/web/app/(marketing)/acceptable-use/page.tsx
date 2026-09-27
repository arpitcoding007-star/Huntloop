import { IDENTITY, legalIsComplete } from "../../../lib/legal";
import { Fact, LegalPage, Section } from "../legal/LegalPage";

/**
 * Acceptable use.
 *
 * ── Why this is a separate document and not a clause ─────────────────────
 *
 * Because it is the one that gets cited. Huntloop drafts and sends cold
 * outbound email, which means the difference between "our customer spammed
 * people" and "we facilitated spam" is whether there was a rule and whether
 * it was enforced. A paragraph buried in section nine of the terms is not a
 * rule anybody was told about; a short page with its own address is.
 *
 * It is written as prohibitions rather than as principles on purpose. "Use
 * the service responsibly" is unenforceable — both parties can believe they
 * were reasonable. A list of specific things you may not do can be pointed
 * at.
 */
export default function AcceptableUsePage() {
  return (
    <LegalPage title="Acceptable Use Policy" updated="21 September 2026">
      <Section title="What this covers">
        <p>
          This policy is part of the Terms of Service and applies to everyone
          using Huntloop. It exists because Huntloop can send email to people
          who did not ask to hear from you, and that capability needs limits
          that are written down rather than assumed.
        </p>
      </Section>

      <Section title="Outreach">
        <p>You may not use Huntloop to:</p>
        <ul className="ml-5 list-disc space-y-1.5">
          <li>
            Send to purchased, scraped or rented address lists, or to any
            address you obtained other than through Huntloop&rsquo;s own
            providers or your own legitimate business relationships.
          </li>
          <li>
            Contact anybody who has unsubscribed, or attempt to work around a
            suppression by using a different address, domain or workspace.
          </li>
          <li>
            Send to a jurisdiction whose marketing law you have not met.
            Consent-based regimes exist and Huntloop does not know which one
            applies to a given recipient.
          </li>
          <li>
            Misrepresent who you are, who you work for, or why you are
            writing — including false sender names, misleading subject lines
            and fabricated prior relationships.
          </li>
          <li>
            Send bulk messages of a kind unrelated to a genuine business
            proposition: political campaigning, fundraising, chain messages,
            or anything better described as a newsletter you signed people up
            to.
          </li>
          <li>
            Contact individuals in their personal capacity. Huntloop is for
            business-to-business outreach, and a personal address is not a
            business one because somebody uses it at work.
          </li>
        </ul>
      </Section>

      <Section title="Data">
        <p>You may not:</p>
        <ul className="ml-5 list-disc space-y-1.5">
          <li>
            Upload personal data you have no lawful basis to process, or
            special-category data — health, religion, politics, sexual
            orientation, union membership, biometrics. Huntloop is not built
            for it and asking it to hold such data breaches this policy.
          </li>
          <li>
            Use Huntloop to build a profile of an individual for any purpose
            other than assessing a business opportunity at their employer.
          </li>
          <li>
            Ignore a data-subject request you receive. Settings → Data &amp;
            privacy will export or erase everything held about one person; use
            it.
          </li>
          <li>
            Export another person&rsquo;s data from Huntloop and use it outside
            the purpose you collected it for.
          </li>
        </ul>
      </Section>

      <Section title="The service itself">
        <p>You may not:</p>
        <ul className="ml-5 list-disc space-y-1.5">
          <li>
            Work around rate limits, quotas or spend controls, or run Huntloop
            through automation designed to do so.
          </li>
          <li>
            Attempt to reach another workspace&rsquo;s data, or test for the
            ability to. If you believe you have found a way, tell us — see
            below.
          </li>
          <li>
            Resell Huntloop, or run outreach for third parties as a service,
            without a written agreement covering it.
          </li>
          <li>
            Present Huntloop&rsquo;s inferences as verified facts to anybody
            else. The product labels them; keeping that label is your
            obligation as well as our design.
          </li>
        </ul>
      </Section>

      <Section title="What happens if you breach it">
        <p>
          We may suspend sending, suspend an account, or terminate it,
          depending on severity and whether it is repeated. Where sending is
          the problem, we will normally stop sending first and talk second —
          a deliverability complaint affects every other customer sending from
          the same infrastructure, so it cannot wait for a conversation.
        </p>
      </Section>

      <Section title="Reporting">
        <p>
          To report a breach of this policy, a security issue, or a message you
          received that you believe broke it, contact{" "}
          <Fact
            value={IDENTITY.contactEmail}
            what="abuse and security contact"
            why="A reporting route that does not exist is the same as no policy. This should be monitored by someone who can act."
          />
          .
        </p>
      </Section>
    </LegalPage>
  );
}

export const metadata = {
  title: "Acceptable Use Policy",
  alternates: { canonical: "/acceptable-use" },
  robots: legalIsComplete() ? undefined : { index: false, follow: false },
};
