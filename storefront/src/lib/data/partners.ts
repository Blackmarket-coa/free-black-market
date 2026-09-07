"use server"

import { medusaFetch } from "@/lib/config"

export type PartnerKind =
  | "cdfi"
  | "credit_union"
  | "community_bank"
  | "microlender"
  | "crowdfunder"
  | "legal"
  | "back_office"
  | "fiscal_sponsor"

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
