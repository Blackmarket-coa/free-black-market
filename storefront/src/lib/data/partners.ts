"use server"

import { medusaFetch } from "@/lib/config"

/**
 * Mirrors `backend/src/modules/partner-directory/types.ts` `PARTNER_KINDS`,
 * which is the source of truth. `certifier` was missing here while the
 * backend and the page's label map both had it — the page's `label()` helper
 * falls back to the raw key, so the drift showed up as a tidy-looking
 * "certifier" heading rather than as an error.
 */
export type PartnerKind =
  | "cdfi"
  | "credit_union"
  | "community_bank"
  | "microlender"
  | "crowdfunder"
  | "legal"
  | "back_office"
  | "certifier"
  | "fiscal_sponsor"
  | "abatement"
  | "deconstruction"
  | "reuse_center"
  | "test_lab"

export type PartnerServes = "sole_proprietor" | "cooperative" | "nonprofit" | "farm"

export type Partner = {
  key: string
  name: string
  url: string
  tagline: string
  kind: PartnerKind
  states: "national" | string[]
  serves: PartnerServes[]
  products: string
}

/**
 * Mirrors `backend/src/modules/partner-directory/org-types.ts`. Verification
 * is written only by the IRS-file ingest; the storefront never renders these
 * keys raw — `lib/helpers/partner-org-badge.ts` turns each into copy with
 * the IRS file's as-of date (legal checkpoint L11).
 */
export type PartnerOrgType = "irs_501c3" | "irs_501c4" | "coop" | "unincorporated"

export type PartnerOrgVerification =
  | "unverified"
  | "pending"
  | "pub78_eligible"
  | "bmf_only"
  | "not_found"
  | "revoked"

export type PartnerOrgRelationship = "standalone" | "fiscal_host" | "sponsored_collective"

/**
 * A published pilot-partner record, as `GET /store/partners` serialises it
 * through its allow-list (`PUBLIC_PARTNER_ORG_FIELDS`). No EIN, no Stripe
 * account, no check timestamp — only the IRS file date (`verified_as_of`).
 */
export type PartnerOrg = {
  key: string
  name: string
  org_type: PartnerOrgType | null
  verification_status: PartnerOrgVerification
  /** ISO timestamp of the IRS file that produced the status; null when never checked. */
  verified_as_of: string | null
  relationship: PartnerOrgRelationship
  fiscal_host_key: string | null
  url: string | null
  tagline: string | null
  states: string[]
  serves: PartnerServes[]
}

export type PartnerDirectory = {
  partners: Partner[]
  count: number
  kinds: PartnerKind[]
  serves: PartnerServes[]
  /** Present only while the API's FF_NONPROFIT_PARITY_V1 is on. */
  orgs?: PartnerOrg[]
}

/**
 * The refer-out partner directory behind `/partners`. Backed by
 * `GET /store/partners`; FBM links out and never intermediates, so nothing
 * about the viewer is sent.
 */
export async function listPartners(query?: {
  kind?: string
  state?: string
  serves?: string
}): Promise<PartnerDirectory> {
  const params: Record<string, string> = {}
  if (query?.kind) params.kind = query.kind
  if (query?.state) params.state = query.state
  if (query?.serves) params.serves = query.serves

  return medusaFetch<PartnerDirectory>("/store/partners", {
    method: "GET",
    query: params,
    next: { revalidate: 3600 },
  })
}
