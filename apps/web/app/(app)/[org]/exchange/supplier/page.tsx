import { notFound } from "next/navigation";
import { exchangeMetadata, isExchangeEnabled } from "../../../../../lib/exchange/flag";
import { Note } from "@huntloop/ui";
import { getExchangeQuotas, getIntroList, getMatchedCards, getSupplier, listExchangeCategories } from "../../../../../lib/data/exchange";
import { canAdmin, canWrite, currentViewer } from "../../../../../lib/data/membership";
import { OfferingsEditor, ProfileForm } from "./SupplierForms";
import { MatchedRequests } from "./MatchedRequests";

/**
 * The supply side: this workspace's supplier profile and what it offers.
 * Active offerings are what buyers' requests are matched against.
 */
export default async function SupplierPage({ params }: { params: Promise<{ org: string }> }) {
  if (!isExchangeEnabled()) notFound();
  const { org } = await params;
  const viewer = await currentViewer(org);
  if (!viewer) notFound();
  const [{ data: supplier }, { data: categories }, { data: cards }, { data: intros }, { data: quotas }] = await Promise.all([
    getSupplier(org),
    listExchangeCategories(),
    getMatchedCards(org),
    getIntroList(org),
    getExchangeQuotas(org),
  ]);

  return (
    <div className="mx-auto w-full max-w-[1100px] px-6 py-8 lg:px-8">
      <header>
        <h1 className="hl-heading text-fg">Supplier profile</h1>
        <p className="mt-1 text-[13px] text-fg-muted">
          What you sell on the Exchange. Buyers&apos; requests are matched against your active offerings — buyers stay anonymous unless they choose otherwise.
        </p>
      </header>

      <div className="mt-6 space-y-6">
        {quotas.filter((q) => q.metric === "intro_requests").map((q) => (
          <Note key={q.metric} tone={q.used >= q.quota ? "warning" : "info"}>
            {q.used} of {q.quota} introduction requests used this month. The count starts again on the 1st (UTC).
          </Note>
        ))}
        {supplier.profile?.verified && <Note tone="success">This profile is verified by Huntloop.</Note>}
        <ProfileForm org={org} profile={supplier.profile} canEdit={canAdmin(viewer)} />
        {supplier.profile ? (
          <OfferingsEditor
            org={org}
            offerings={supplier.offerings}
            categories={categories}
            products={supplier.products}
            canEdit={canWrite(viewer)}
          />
        ) : (
          <Note tone="info">Create the profile first. Offerings are listed under it.</Note>
        )}
        {supplier.profile && <MatchedRequests org={org} cards={cards} intros={intros} canWrite={canWrite(viewer)} />}
      </div>
    </div>
  );
}

export const generateMetadata = exchangeMetadata("Supplier profile");
