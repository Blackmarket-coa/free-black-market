"use server"

import { medusaFetch } from "../config"
import { updateCart } from "./cart"
import { getStorefrontContext, setStorefrontContext } from "./cookies"

export type DonationBeneficiary = {
  id: string
  name: string
  verification_status: "pending" | "verified" | "rejected"
}

export type PublicStorefront = {
  id: string
  name: string
  organization_id: string
  tier: "tier0_public" | "tier1_verified" | "tier2_aligned_org"
}

const getStorefrontHeaders = async () => {
  const context = await getStorefrontContext()
  if (!context.organization_id || !context.storefront_id) {
    return {}
  }

  return {
    "x-organization-id": context.organization_id,
    "x-storefront-id": context.storefront_id,
  }
}

export async function listPublicStorefronts() {
  const res = await medusaFetch<{ storefronts: PublicStorefront[] }>("/store/tenancy/storefronts", {
    method: "GET",
    cache: "no-cache",
  })

  return res.storefronts
}

export async function selectStorefrontContext(input: { organization_id: string; storefront_id: string }) {
  await setStorefrontContext(input)
  return { ok: true }
}

export async function listDonationBeneficiaries() {
  const res = await medusaFetch<{ beneficiaries: DonationBeneficiary[] }>("/store/donations/beneficiaries", {
    method: "GET",
    cache: "no-cache",
    headers: await getStorefrontHeaders(),
  })

  return res.beneficiaries
}

export type DonationConfig = {
  settings: {
    default_percentage: number
    round_up_enabled: boolean
    /** Display name of the 501(c)(3) fiscal sponsor donations route through. */
    fiscal_sponsor_name: string | null
    /** Optional link to the sponsor's 501c3 page. */
    fiscal_sponsor_url: string | null
    /**
     * True only once the sponsorship agreement is live. Absent or false means
     * routing is pending and the widget must not claim 501(c)(3) receipts.
     */
    fiscal_sponsor_live?: boolean
  }
  feature_gates?: { donation_routing: boolean; advanced_automation: boolean }
  tier?: string
}

export async function getDonationSettings() {
  return medusaFetch<DonationConfig>("/store/donations/config", {
    method: "GET",
    cache: "no-cache",
    headers: await getStorefrontHeaders(),
  })
}

export async function setCartDonationPreferences(input: {
  donation_percent: number
  round_up: boolean
  beneficiary_id?: string
  donation_total?: number
}) {
  const context = await getStorefrontContext()
  return updateCart({
    metadata: {
      donation_percent: input.donation_percent,
      donation_round_up: input.round_up,
      donation_beneficiary_id: input.beneficiary_id,
      donation_total: input.donation_total,
      storefront_id: context.storefront_id,
      organization_id: context.organization_id,
    },
  })
}
