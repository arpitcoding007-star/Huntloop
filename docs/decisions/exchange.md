---
description: >-
  The five decisions Huntloop Exchange needs from a person before P0 starts:
  the options, a recommendation, and what each answer changes in the build.
---

# Exchange: decisions before P0

> **Layer:** Internal · **Audience:** product, leadership, engineering · **Status:** ❓ All open

These are the questions from [§15 of the Exchange spec](../product/marketplace-spec.md#15-open-questions),
written as decision records. Each one changes the schema or the routing, so
each must be settled before P0 code is written. The recommendation is the
author's. **None of these has been decided.** When one is, change its status,
write down who decided and when, and copy the one-line outcome into the
[decision log](README.md#open-decisions).

Two decisions already open in the log come first: **#1 Billing** (P1 depends on
it) and **#4 GDPR lawful basis** (EX-2 takes it further).

***

## EX-1 · Buyer-side brand and domain

**Status:** ❓ Open · **Blocks:** routing, auth, onboarding copy

**The question.** Do buyers sign up for "Huntloop" on the same domain as the
seller product, or for a separately branded buyer site?

**Why it matters.** Huntloop's seller customers send cold email. Some future
buyers will have received one. Asking those people to tell "Huntloop" what they
plan to buy relies on a trust the brand may not have with them.

| Option | For | Against |
|---|---|---|
| **A · Same brand, same app** (`app/(exchange)` route group) | One codebase, one sign-in, shared design system, cheapest | Buyer trust is tied to the cold-outreach brand. Hard to separate later. |
| **B · Separate buyer brand, same app and database** (own domain routed to the same Next.js app) | Buyer trust is separate. Infrastructure stays shared. The provider side stays "Huntloop". | Second domain, second set of email templates, a brand to design |
| **C · Separate app and project** | Strongest separation, which also strengthens the spec's §6 firewall | Two deployments, two auth systems, cross-project matching. Too much for P0. |

**Recommendation: B.** Build it in one app (`app/(exchange)`) behind a host check
in `proxy.ts`, so A and B differ only in a domain and a name until the brand
is ready. That keeps the decision reversible during P0.

**What changes if decided:** `proxy.ts` host routing, auth redirect URLs,
email sender identity, privacy notice title.

***

## EX-2 · Launch region and currency

**Status:** ❓ Open · **Blocks:** `needs` budget columns, privacy notice, data residency

**The question.** Is v1 India-first or global from the start?

| Option | For | Against |
|---|---|---|
| **A · India-first** (INR, DPDP Act 2023 notice, India-hosted data if required) | One legal regime and one currency. Easier to get enough buyers in one category. | Many SaaS providers price in USD. Global providers are part of the supply. |
| **B · Global** (multi-currency, GDPR and DPDP) | Bigger market for buyers and providers | Two legal regimes in P0, currency conversion in budget matching, buyers spread thinly across regions |

**Recommendation: A, with the schema ready for B.** Store `currency` per need
and per offering from day one, and match budgets in the need's currency using a
stored rate. Launch marketing and the legal notice for India only. This
depends on where the first 50 buyers come from (see the spec's validation step);
if they are not in India, choose B's region instead.

**What changes if decided:** the privacy notice, the `region` list in the
category attributes, where the database is hosted, decision log #4 (GDPR
lawful basis) becomes a P1 item instead of P0.

***

## EX-3 · Can non-customers claim a provider profile?

**Status:** ❓ Open · **Blocks:** `provider_profiles.org_id` nullability, plans

**The question.** If a provider company is not a paying Huntloop seller
customer, can it still claim and manage its Exchange profile?

| Option | For | Against |
|---|---|---|
| **A · Yes, free, with limits** (profile and offerings, a small monthly intro allowance, no market-demand analytics) | Grows supply fast. Every claim is a lead for the paid seller product. Buyers see more choice. | More moderation. A free tier to support. |
| **B · Customers only** | Simple. Every provider pays. | Little supply at launch. Buyers see few matches and leave. Match coverage target (80%) is unlikely. |
| **C · Unclaimed listings only, no claiming without paying** | Full catalog for buyers | Providers cannot correct wrong listings, which damages trust on both sides |

**Recommendation: A.** Claiming requires a seller org (even a free one), so
claimed profiles still go through SEC-302 domain verification. `org_id` is
null only while a profile is unclaimed.

**What changes if decided:** adds a free Exchange-only plan in
`plans-and-quotas.md`, a quota for intro requests, and the signup path for a
provider who is not a seller.

***

## EX-4 · Is a verified company domain required for level 3?

**Status:** ❓ Open · **Blocks:** onboarding, intro acceptance, demand weighting

**The question.** Before a buyer can set a need to level 3 (open to intros),
must they confirm an email address at their company's domain?

| Option | For | Against |
|---|---|---|
| **A · Required for level 3** | Providers trust intros. Fake buyers are expensive to create. Level-3 intros are what providers pay for. | Founders who use a personal Gmail have extra work. Very early companies may not have a domain yet. |
| **B · Optional, shown as a badge** | Fewer steps at signup | Providers will filter out unverified buyers anyway. Fake-buyer spam is cheap. |

**Recommendation: A for level 3, not required for levels 0 to 2.** An
unverified buyer still gets matches and can still request intros themselves.
They cannot be found by providers as a named lead. Unverified needs count in
aggregates with less weight (spec §13).

**What changes if decided:** a `buyer_profiles.domain_verified_at` column, a
check in the intro-acceptance function, a step in buyer onboarding.

***

## EX-5 · The first category list

**Status:** ❓ Open · **Blocks:** `categories` seed, onboarding, matching quality

**The question.** Which roughly 40 leaf categories does v1 launch with, and
what attributes can a need in each one specify?

**Why it matters more than the model.** Matching filters on category first. A
list that is too broad ("Software") matches everyone to everyone. A list that
is too fine ("CRM for real estate agents in Pune") leaves most categories empty.

**Proposed approach (not a list yet):**

1. Take the categories that Huntloop's **current seller customers sell in**.
   That is the supply that exists on day one. Read it from their `products`
   and `icps`, with each org's consent. This is a one-off manual review, not
   a cross-tenant query.
2. Group them into about 8 parents (for example Sales & CRM, Finance &
   Accounting, HR & Payroll, Marketing, Developer tools, Security & IT, Legal
   & Compliance, Business services).
3. For each leaf, define 3 to 6 attributes that change which provider fits
   (seats, required integrations, deployment, compliance needs).
4. **Launch with only the leaves that have at least 5 providers**, and hide
   the rest until they do.

**Recommendation:** have the product owner draft the list from step 1 and
review it with three real buyers before seeding it. The list is data
(`categories` rows), so it can change without a migration. Only the parent
structure needs to stay stable.

**What changes if decided:** the `categories` seed, the onboarding category
picker, and which leaves the demand-validation form tests first.

***

## Related

* [Exchange spec](../product/marketplace-spec.md)
* [Decision log](README.md)
* [Plans, quotas and billing](../product/plans-and-quotas.md)
