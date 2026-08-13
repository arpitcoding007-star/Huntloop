import { OrgForm } from "./OrgForm";

export default function WelcomePage() {
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
