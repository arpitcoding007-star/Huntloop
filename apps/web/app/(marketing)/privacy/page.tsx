import { COOKIES, IDENTITY, PROCESSORS, PROSPECT_FIELDS, legalIsComplete } from "../../../lib/legal";
import { ScrollRegion } from "@huntloop/ui";
import { Fact, LegalPage, Pending, Section } from "../legal/LegalPage";

/**
 * The privacy notice.
 *
 * ── Why it is this long, and this specific ───────────────────────────────
 *
 * Because of what the product does. Most SaaS privacy policies describe
 * processing the user consented to by signing up. Huntloop also processes
 * personal data about people who have never heard of it — prospects, sourced
 * from a data broker and from public pages, then scored and emailed. That is
 * GDPR Article 14, and Article 14 asks for things a generic policy does not
 * contain: the categories of data, where they came from, and who they go to.
 *
 * Every one of those is knowable from the code, so every one of them is
 * written out rather than summarised. The section for prospects comes before
 * the section for users because it is the part a reader is least likely to
 * expect and most likely to need.
 */
export default function PrivacyPolicyPage() {
  return (
    <LegalPage title="Privacy Policy" updated="21 September 2026">
      <Section title="Who is responsible for your data">
        <p>
          Huntloop is operated by{" "}
          <Fact
            value={IDENTITY.entityName}
            what="registered entity name"
            why="The controller has to be identifiable by name. Inventing one would make this document false on its first line."
          />
          {IDENTITY.registeredAddress ? `, of ${IDENTITY.registeredAddress}` : " "}
          {!IDENTITY.registeredAddress && (
            <Pending
              what="registered address"
              why="Required for identification, and separately required in every commercial email we send on a customer's behalf."
            />
          )}
          .
        </p>
        <p>
          For anything in this notice, or to make a request about your data,
          contact{" "}
          <Fact
            value={IDENTITY.privacyContactEmail}
            what="privacy contact address"
            why="A data-subject request needs somewhere to arrive. This must be a monitored mailbox."
          />
          .
        </p>
        {IDENTITY.art27Required === null ? (
          <p>
            <Pending
              what="GDPR Article 27 representative"
              why="Whether an EU/UK representative is required depends on where the business is established and whether it targets people in those territories. It has not been assessed."
            />
          </p>
        ) : IDENTITY.art27Required && IDENTITY.euRepresentative ? (
          <p>Our representative in the EU/UK is {IDENTITY.euRepresentative}.</p>
        ) : (
          <p>
            We have assessed Article 27 and no EU/UK representative is required
            for our establishment.
          </p>
        )}
      </Section>

      <Section title="If you are not a Huntloop user">
        <p>
          You may be reading this because you received an email from somebody
          using Huntloop, or because you found us in a company&rsquo;s list of
          tools. Huntloop may hold data about you even though you have never
          used it. This section is about you, and it comes first because it is
          the part most people do not expect.
        </p>
        <p>
          <strong className="font-medium text-fg">What we hold.</strong> For a
          person identified as a possible buyer by one of our customers:
        </p>
        <ul className="ml-5 list-disc space-y-1">
          {PROSPECT_FIELDS.map((field) => (
            <li key={field}>{field}</li>
          ))}
        </ul>
        <p>
          <strong className="font-medium text-fg">Where it came from.</strong>{" "}
          Business data providers — Apollo, and where a customer enables them
          Hunter and ZeroBounce — and publicly available pages such as company
          websites, news coverage, job listings and public filings. Every
          factual claim is stored with the address of the page it was read
          from, and the software cannot save one without it. Anything Huntloop
          concluded rather than read is labelled an inference wherever it
          appears.
        </p>
        <p>
          <strong className="font-medium text-fg">
            Who is responsible for it.
          </strong>{" "}
          The Huntloop customer who added you to their workspace is the
          controller of that data. Huntloop is their processor. If you want your
          data removed, you can ask either of us — if you ask us, we will
          identify the customer and pass the request on.
        </p>
        <p>
          <strong className="font-medium text-fg">The legal basis.</strong>{" "}
          <Fact
            value={IDENTITY.prospectLawfulBasis}
            what="lawful basis for prospect data"
            why="Normally legitimate interests, which requires a documented balancing test weighing the business case against the effect on the individual. The test has to exist before it can be cited."
          />
        </p>
        <p>
          <strong className="font-medium text-fg">Stopping it.</strong>{" "}
          Every email sent through Huntloop carries a working unsubscribe link
          and a one-click unsubscribe header. Using either suppresses your
          address across the whole of that customer&rsquo;s workspace
          immediately, and no account is needed. Suppression deliberately
          survives erasure: we keep a one-way hash of your address after
          deleting the address itself, because otherwise erasing you would make
          you contactable again.
        </p>
        <p>
          <strong className="font-medium text-fg">Erasure.</strong> When a
          request is honoured, contact points, enrichment records and the
          person record are deleted and message bodies are redacted. It is a
          deletion, not a flag.
        </p>
      </Section>

      <Section title="If you are a Huntloop user">
        <p>
          We hold your email address, your name if you give one, your role in
          each workspace, and what you configure and write — your ideal
          customer profile, product descriptions, scoring rules, notes and
          message drafts. There are no passwords, because Huntloop does not use
          them: you sign in with a one-time link or with Google.
        </p>
        <p>
          We process this to provide the product to you under our contract with
          you, and to keep it secure and working.
        </p>
        <p>
          You can export your workspace and delete your account from{" "}
          <span className="font-mono text-[13px] text-fg">
            Settings → Data &amp; privacy
          </span>
          , without asking us.
        </p>
      </Section>

      <Section title="Who else sees it">
        <p>
          The list below is complete and is generated from the integrations
          that exist in the software. &ldquo;Optional&rdquo; means it runs only
          where the deployment has been configured for it;
          &ldquo;customer-connected&rdquo; means nothing happens until a
          customer authorises it.
        </p>
        <ScrollRegion label="Sub-processors">
          <table className="mt-2 w-full border-collapse text-left text-[13px]">
            <thead>
              <tr className="border-b border-line">
                <th scope="col" className="py-2 pr-3 font-medium text-fg">Who</th>
                <th scope="col" className="px-3 py-2 font-medium text-fg">Why</th>
                <th scope="col" className="px-3 py-2 font-medium text-fg">What</th>
                <th scope="col" className="py-2 pl-3 font-medium text-fg">When</th>
              </tr>
            </thead>
            <tbody>
              {PROCESSORS.map((p) => (
                <tr key={p.name} className="border-b border-line-subtle align-top">
                  <th scope="row" className="py-2.5 pr-3 font-medium text-fg-secondary">
                    {p.name}
                  </th>
                  <td className="px-3 py-2.5 text-fg-secondary">{p.purpose}</td>
                  <td className="px-3 py-2.5 text-fg-muted">{p.data}</td>
                  <td className="py-2.5 pl-3 text-fg-muted">{p.when}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollRegion>
        <p>
          We do not sell personal data, we run no advertising and we have no
          advertising trackers. Our AI provider does not train models on data
          sent through the API.{" "}
          {!legalIsComplete() && (
            <Pending
              what="data processing agreements"
              why="Each processor above needs a signed DPA, and each US-hosted one needs a documented transfer mechanism, before this section can be relied on."
            />
          )}
        </p>
      </Section>

      <Section title="Cookies">
        <p>
          Huntloop sets four cookies and all four are strictly necessary. There
          is no analytics cookie, no advertising cookie and no third-party
          storage on your device — our product analytics runs entirely on the
          server and our error monitoring sets nothing. This is why you are not
          being shown a consent banner: there is nothing to consent to.
        </p>
        <ScrollRegion label="Cookies this site sets">
          <table className="mt-2 w-full border-collapse text-left text-[13px]">
            <thead>
              <tr className="border-b border-line">
                <th scope="col" className="py-2 pr-3 font-medium text-fg">Cookie</th>
                <th scope="col" className="px-3 py-2 font-medium text-fg">What it is for</th>
                <th scope="col" className="py-2 pl-3 font-medium text-fg">How long</th>
              </tr>
            </thead>
            <tbody>
              {COOKIES.map((c) => (
                <tr key={c.name} className="border-b border-line-subtle align-top">
                  <th scope="row" className="py-2.5 pr-3 font-mono text-[12px] font-normal text-fg-secondary">
                    {c.name}
                  </th>
                  <td className="px-3 py-2.5 text-fg-secondary">{c.purpose}</td>
                  <td className="py-2.5 pl-3 text-fg-muted">{c.duration}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollRegion>
        <p>
          Fonts are served from our own servers rather than from a font CDN, so
          loading a Huntloop page makes no request to a third party.
        </p>
      </Section>

      <Section title="How long we keep it">
        <p>
          Workspace data is kept while the workspace exists. A deleted
          workspace is retained for a recovery period and then removed.
        </p>
        <p>
          Contact details for prospects have a retention window each customer
          sets for their own workspace, with a minimum of 30 days. Where one is
          set, details for people who have never been messaged are deleted
          automatically once they pass it. Where none is set, they are kept —
          we do not pick a period on a customer&rsquo;s behalf and start
          deleting their data.
        </p>
      </Section>

      <Section title="Your rights">
        <p>
          Access, correction, erasure, restriction, objection and portability,
          exercisable by contacting{" "}
          <Fact
            value={IDENTITY.privacyContactEmail}
            what="privacy contact address"
            why="Same address as above."
          />
          . Huntloop users can export and delete without asking, from Settings →
          Data &amp; privacy.
        </p>
        <p>
          You also have the right to complain to a supervisory authority.{" "}
          <Fact
            value={IDENTITY.jurisdiction}
            what="lead supervisory authority"
            why="Which authority is the right one follows from where the business is established."
          />
        </p>
      </Section>
    </LegalPage>
  );
}

export const metadata = {
  title: "Privacy Policy",
  alternates: { canonical: "/privacy" },
  /* Kept out of the index until every fact is supplied. `robots.ts` says the
     same thing for crawlers that read it; this covers the ones that only
     read the page. */
  robots: legalIsComplete() ? undefined : { index: false, follow: false },
};
