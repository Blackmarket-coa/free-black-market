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

export type PartnerDirectory = {
  partners: Partner[]
  count: number
  kinds: PartnerKind[]
  serves: PartnerServes[]
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
