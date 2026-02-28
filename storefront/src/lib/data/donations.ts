"use server"

import { medusaFetch } from "../config"
import { updateCart } from "./cart"

export type DonationBeneficiary = {
  id: string
  name: string
  verification_status: "pending" | "verified" | "rejected"
}

export async function listDonationBeneficiaries() {
  const res = await medusaFetch<{ beneficiaries: DonationBeneficiary[] }>("/store/donations/beneficiaries", {
    method: "GET",
    cache: "no-cache",
  })

  return res.beneficiaries
}

export async function getDonationSettings() {
  return medusaFetch<{ settings: { default_percentage: number; round_up_enabled: boolean } }>("/store/donations/config", {
    method: "GET",
    cache: "no-cache",
  }).then((r) => r.settings)
}

export async function setCartDonationPreferences(input: {
  donation_percent: number
  round_up: boolean
  beneficiary_id?: string
  donation_total?: number
}) {
  return updateCart({
    metadata: {
      donation_percent: input.donation_percent,
      donation_round_up: input.round_up,
      donation_beneficiary_id: input.beneficiary_id,
      donation_total: input.donation_total,
    },
  })
}
