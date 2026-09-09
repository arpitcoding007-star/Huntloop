import type { Icp, IcpCriteria, IcpExclusions } from "@huntloop/db/icp";
import type { IcpStepValues } from "../validation";

/**
 * The ICP step's form values as an `Icp`.
 *
 * ── Why every key is written out, and none of them spread ────────────────
 *
 * `IcpCriteria` distinguishes "not stated" (`null`) from "stated as none"
 * (`[]`), and the whole of `packages/db/src/icp.ts` is built on that
 * difference. A spread of the form payload would turn every field the screen
 * does not render into `undefined` — which `serializeCriteria` drops and
 * `parseIcp` then reads back as null. The same answer, arrived at by
 * accident. Writing it out keeps it deliberate.
 *
 * ── Why it is here rather than beside one of its callers ─────────────────
 *
 * Three things need it: the save, the reach counter, and the look-alike
 * preview. It was written twice before the third arrived, which is how a
 * sixteenth key ends up in one copy and not the other — and the failure mode
 * of that is silent, because a missing key reads back as "not stated" rather
 * than as an error. It cannot live in either caller: both are `"use server"`
 * modules, which may only export async functions.
 */
export function stepIcp(v: IcpStepValues): Icp {
  const criteria: IcpCriteria = {
    segments: v.segments ?? null,
    sizes: v.sizes ?? null,
    regions: v.regions ?? null,
    triggers: v.triggers ?? null,
    industries: v.industries ?? null,
    employeeRange: v.employeeRange ?? null,
    revenueBands: null,
    technologies: v.technologies ?? null,
    businessModels: v.businessModels ?? null,
    painPoints: v.painPoints ?? null,
    useCases: v.useCases ?? null,
    buyingSignals: null,
    keywords: null,
    exampleCompanies: v.exampleCompanies ?? null,
    notes: null,
  };

  const exclusions: IcpExclusions = {
    exclusions: v.exclusions ?? null,
    industries: null,
    regions: null,
    sizes: null,
    technologies: null,
    businessModels: null,
    employeeRange: null,
    keywords: null,
    domains: v.excludeDomains ?? null,
    signals: null,
    notes: null,
  };

  return { criteria, exclusions };
}
