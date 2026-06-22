/**
 * Response shapes for the admin donations / tenancy-onboarding endpoints.
 * These custom endpoints have no Medusa SDK type; the fields here are modelled
 * from how the donations, donations-report, and onboarding-checklist pages
 * consume the responses. Optional where the UI guards with optional chaining.
 */

export type DonationBeneficiary = {
  id: string
  name: string
  verification_status: string
}

export type StorefrontTemplate = {
  key: string
  name: string
  tier: string
}

export type DonationImportError = {
  row: number
  field: string
  message: string
}

export type DonationImportResult = {
  total_rows?: number
  valid_rows?: number
  errors?: DonationImportError[]
}

export type DonationSettings = {
  settlement_mode?: "split_processor" | "ledger_batch"
}

export type DonationsReport = {
  totals?: {
    accrued?: number
    disbursed?: number
    outstanding?: number
  }
  beneficiaries?: Array<{
    beneficiary_id: string
    beneficiary_name: string
    total_accrued: number
    total_disbursed: number
    outstanding: number
  }>
}

export type FirstListingChecklistState = {
  first_listing_created?: boolean
  payout_configured?: boolean
  first_order_simulated?: boolean
}
