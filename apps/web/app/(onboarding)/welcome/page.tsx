import { OrgForm } from "./OrgForm";
import { captureForViewer } from "../../../lib/analytics";

/**
 * Step one of the funnel.
 *
 * The four `onboarding_step_viewed` events plus the matching `_completed` ones
 * are what make drop-off readable: onboarding is a pipeline where each step
 * feeds the next, and until now nothing measured where people stopped (audit
 * ANL-01b). Recorded server-side — see lib/analytics.ts for why there is no
 * browser SDK.
 */
export default async function WelcomePage() {
  await captureForViewer("onboarding_step_viewed", { step: "organisation" });

  return (
    <>
      <h1 className="text-[26px] leading-8 font-semibold text-fg">
        Name your organisation
      </h1>
      <p className="mt-1.5 max-w-lg text-[14px] leading-[1.6] text-fg-muted">
        Everything in Huntloop belongs to an organisation — your companies,
        opportunities, sources and outreach. Teammates you invite join this one.
      </p>

      <div className="mt-6 max-w-md">
        <OrgForm />
      </div>
    </>
  );
}

export const metadata = { title: "Set up" };
