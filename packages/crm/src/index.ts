/**
 * Public surface of @huntloop/crm.
 *
 * A thin re-export, deliberately — see `contract.ts` for why this package is
 * one HubSpot module rather than a registry. A caller imports from here, not
 * from `./hubspot.ts` directly, so the day a second CRM exists the import
 * site does not have to change, even though today it would be a strange
 * indirection to route through for a single implementation.
 */
export {
  verifyHubspotToken,
  ensureDealProperties,
  upsertCompany,
  upsertContact,
  createDeal,
  updateDealHuntloopFields,
  associate,
  getDealStage,
  getStageLabels,
} from "./hubspot.ts";

export {
  CrmError,
  type CrmCompanyInput,
  type CrmContactInput,
  type CrmDealInput,
  type CrmDealStage,
  type CrmErrorReason,
  type CrmUpsertResult,
} from "./contract.ts";
