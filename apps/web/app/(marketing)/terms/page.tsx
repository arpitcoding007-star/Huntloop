import Link from "next/link";
import { IDENTITY, legalIsComplete } from "../../../lib/legal";
import { Fact, LegalPage, Pending, Section } from "../legal/LegalPage";

/**
 * Terms of service.
 *
 * ── The one section that is not boilerplate ──────────────────────────────
 *
 * "Your obligations when sending" exists because of what this product is.
 * Huntloop drafts cold outbound email and sends it through the customer's own
 * mailbox, which makes the customer the sender in the eyes of CAN-SPAM, CASL
 * and PECR, and makes Huntloop the thing that facilitated it. Terms that did
 * not say so would leave both parties with a different idea of who is
 * responsible for a complaint — and the answer matters most at the moment
 * somebody is angry.
 *
 * The commercial sections are deliberately thin. There is no payment path in
 * the product, so terms describing billing, refunds and renewal would be
 * describing a thing that does not exist; that is the same failure the audit
 * found on the pricing page. They are marked as required-before-launch
 * instead.
 */
export default function TermsPage() {
  return (
    <LegalPage title="Terms of Service" updated="21 September 2026">
      <Section title="Who you are agreeing with">
        <p>
          These terms are between you and{" "}
          <Fact
            value={IDENTITY.entityName}
            what="registered entity name"
            why="A contract needs a named counterparty."
          />
          {IDENTITY.registrationNumber ? ` (registered number ${IDENTITY.registrationNumber})` : ""}
          . They are governed by the law of{" "}
          <Fact
            value={IDENTITY.jurisdiction}
            what="governing law and venue"
            why="Which law applies and where disputes are heard cannot be inferred from the code."
          />
          .
        </p>
        <p>
          By creating an account you accept these terms and the{" "}
          <Link
            href="/privacy"
            className="hl-focusable rounded-sm text-brand-text underline underline-offset-2"
          >
            Privacy Policy
          </Link>
          .
        </p>
      </Section>

      <Section title="What the service does">
        <p>
          Huntloop identifies companies that may be worth contacting, explains
          why with cited evidence, and drafts outreach. It is a research and
          drafting tool. It does not send anything on its own: a person
          approves every message, and there is no autonomous sending mode.
        </p>
        <p>
          Huntloop&rsquo;s output includes inferences made by an AI model. They
          are labelled as inferences throughout the product, and they can be
          wrong. You are responsible for deciding what to act on.
        </p>
      </Section>

      <Section title="Accounts">
        <p>
          You need a working email address. You are responsible for what
          happens under your account and for the people you invite into your
          workspace. You must be old enough to enter a contract where you live,
          and Huntloop is a business tool that is not offered to children.
        </p>
        <p>
          You can delete your account at any time from Settings → Data &amp;
          privacy. An owner can delete a whole workspace from the same screen.
        </p>
      </Section>

      <Section title="Your obligations when sending">
        <p>
          When you send through Huntloop you are the sender. That carries
          obligations that are yours and not ours, and the software will hold
          you to some of them rather than let you breach them quietly:
        </p>
        <ul className="ml-5 list-disc space-y-1.5">
          <li>
            You must supply a real postal address for your organisation. Every
            outbound message includes it, and Huntloop refuses to send until
            one is set.
          </li>
          <li>
            Every message carries an unsubscribe link and a one-click
            unsubscribe header. You may not remove, obscure or disable them.
            Huntloop refuses to send a message it cannot attach them to.
          </li>
          <li>
            An unsubscribe suppresses that address across your entire
            workspace, immediately and permanently. You may not re-add a
            suppressed address.
          </li>
          <li>
            You must not use misleading sender names or subject lines.
          </li>
          <li>
            You are responsible for having a lawful basis to contact the people
            you contact, and for complying with the marketing law of their
            jurisdiction as well as your own. Rules differ — consent is
            required in some places where legitimate interest suffices in
            others.
          </li>
        </ul>
        <p>
          These duties come from CAN-SPAM, CASL, PECR and the GDPR among
          others. The list above is not a summary of your obligations; it is
          the subset the product can help with.
        </p>
      </Section>

      <Section title="Acceptable use">
        <p>
          Separate and binding: see the{" "}
          <Link
            href="/acceptable-use"
            className="hl-focusable rounded-sm text-brand-text underline underline-offset-2"
          >
            Acceptable Use Policy
          </Link>
          .
        </p>
      </Section>

      <Section title="Your data and ours">
        <p>
          Your workspace data is yours. We do not sell it, and we do not use it
          to train models. We process it to provide the service, as described
          in the Privacy Policy.
        </p>
        <p>
          Where your workspace contains personal data about third parties —
          which it will — you are the controller and we are your processor.
        </p>
        <p>
          Huntloop&rsquo;s software, design and documentation remain ours.
        </p>
      </Section>

      <Section title="Paid plans">
        {legalIsComplete() ? (
          <p>
            <Pending
              what="billing, refund, cancellation and renewal terms"
              why="No payment path exists in the product yet. Terms describing billing would describe something that does not happen."
            />
          </p>
        ) : (
          <p>
            Huntloop currently has no payment path. Paid plans are shown on the
            pricing page so you can see what is planned, and accounts are
            created on the free plan. Billing, refund, cancellation and renewal
            terms will be published here before anything can be purchased, and
            nothing will be charged without a separate, explicit agreement.
          </p>
        )}
      </Section>

      <Section title="Availability, liability and changes">
        <p>
          The service is provided as-is. We do not guarantee that it will be
          uninterrupted, or that the AI&rsquo;s conclusions will be correct.
        </p>
        <p>
          <Pending
            what="limitation of liability, indemnities and warranty disclaimers"
            why="These have to be drafted against the governing law and the commercial model, and an incorrect limitation clause is often unenforceable in exactly the situation it was written for."
          />
        </p>
        <p>
          We may change these terms. Material changes will be notified before
          they take effect, and continuing to use Huntloop after that means you
          accept them.
        </p>
      </Section>

      <Section title="Contact">
        <p>
          <Fact
            value={IDENTITY.contactEmail}
            what="contact address"
            why="Required for the footer, for these terms, and separately for sender identification in commercial email."
          />
        </p>
      </Section>
    </LegalPage>
  );
}

export const metadata = {
  title: "Terms of Service",
  alternates: { canonical: "/terms" },
  robots: legalIsComplete() ? undefined : { index: false, follow: false },
};
