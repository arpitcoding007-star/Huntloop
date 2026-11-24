import { notFound } from "next/navigation";
import { exchangeMetadata, isExchangeEnabled } from "../../../../../lib/exchange/flag";
import { getExchangePrefs, listExchangeCategories } from "../../../../../lib/data/exchange";
import { currentViewer } from "../../../../../lib/data/membership";
import { NotificationSettings } from "./NotificationSettings";

/**
 * Exchange notification settings (build plan DN-36, DN-79): alerts off,
 * digest or instant, which categories, introduction and message emails, and
 * quiet hours. Per person, per workspace.
 */
export default async function ExchangeNotificationsPage({ params }: { params: Promise<{ org: string }> }) {
  if (!isExchangeEnabled()) notFound();
  const { org } = await params;
  const viewer = await currentViewer(org);
  if (!viewer) notFound();
  const [{ data: prefs }, { data: categories }] = await Promise.all([getExchangePrefs(org), listExchangeCategories()]);

  return (
    <div className="mx-auto w-full max-w-[820px] px-6 py-8 lg:px-8">
      <header>
        <h1 className="hl-heading text-fg">Exchange notifications</h1>
        <p className="mt-1 text-[13px] text-fg-muted">
          What the Exchange tells you, and when. Everything also appears under Updates, whatever you choose here.
        </p>
      </header>
      <div className="mt-6">
        <NotificationSettings
          org={org}
          prefs={prefs}
          categories={categories.filter((c) => prefs.offeredCategoryIds.includes(c.id) || prefs.categoryIds.includes(c.id))}
        />
      </div>
    </div>
  );
}

export const generateMetadata = exchangeMetadata("Exchange notifications");
