import { isStripeAccountId } from "../../shared/stripe-direct-charge"
import type { PoolCarrierSnapshot } from "../hawala-ledger/carrier"
import {
  IRS_AFFIRMED_VERIFICATION,
  NON_IRS_ORG_TYPES,
  type PartnerOrgType,
  type PartnerOrgVerification,
} from "./org-types"

/**
 * May this partner org carry an investment pool (hold and administer its funds
 * on its own accounts)? docs/BMC_SURVIVAL_PROGRAMS.md Decision 6b; legal
 * checkpoints L26, L11.
 *
 * Pure, structural input, one code per reason — the same shape as
 * `donation/direct-split-guard.ts`'s `donationRecipientRefusal`, and the same
 * rules, so the two Phase 1 "verified org" predicates cannot drift: published;
 * a connected account to hold funds on; IRS-affirmed (`pub78_eligible`,
 * `bmf_only`) or a coop / unincorporated org (publishable only with the
 * operator's ack already recorded). `not_found` and `revoked` are refused as
 * `not_verified`, never collapsed into "not a charity" in any message the
 * caller shows: the caller maps every non-null answer to `forbidden()` (403,
 * one body) and logs the code server-side only.
 *
 * Lives in partner-directory so hawala-ledger does not import from donation.
 */
export type CarrierRefusalCode = "not_found" | "not_published" | "no_connected_account" | "not_verified"

export type CarrierOrgShape = {
  key: string
  published: boolean
  stripe_connect_account_id: string | null
  org_type: PartnerOrgType | null
  verification_status: PartnerOrgVerification
  verified_as_of: Date | null
}

export function partnerOrgCarrierRefusal(
  org: Omit<CarrierOrgShape, "key" | "verified_as_of"> | null | undefined
): CarrierRefusalCode | null {
  if (!org) return "not_found"
  if (org.published !== true) return "not_published"
  if (!isStripeAccountId(org.stripe_connect_account_id)) return "no_connected_account"
  if (carrierStatusEligible(org.org_type, org.verification_status)) return null
  return "not_verified"
}

function carrierStatusEligible(orgType: PartnerOrgType | null, status: PartnerOrgVerification): boolean {
  if (IRS_AFFIRMED_VERIFICATION.has(status)) return true
  return orgType !== null && NON_IRS_ORG_TYPES.has(orgType)
}

/**
 * Freeze what is true about the carrier now (L11), in the shape
 * `assertCarrierSnapshot` validates before the pool is written. The connected
 * account's presence is recorded, never its id: the pool is a record that the
 * carrier holds funds elsewhere, not a destination.
 */
export function buildCarrierSnapshot(org: CarrierOrgShape, at: Date): PoolCarrierSnapshot {
  return {
    org_key: org.key,
    org_type: org.org_type,
    verification_status: org.verification_status,
    verified_as_of: org.verified_as_of instanceof Date ? org.verified_as_of.toISOString() : null,
    stripe_connect_account_present: isStripeAccountId(org.stripe_connect_account_id),
    snapshot_at: at.toISOString(),
  }
}
