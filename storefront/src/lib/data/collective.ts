"use server"

import { medusaFetch } from "@/lib/config"
import { getAuthHeaders } from "@/lib/data/cookies"

export type DemandPool = {
  id: string
  title: string
  description: string
  category?: string | null
  target_quantity: number
  min_quantity: number
  committed_quantity: number
  unit_of_measure?: string
  currency_code?: string
  status: string
  deadline?: string | null
  attractiveness_score?: number
}

export type DemandPoolDetails = DemandPool & {
  participants?: {
    total: number
    committed_quantity: number
    target_quantity: number
    progress_percent: number
    list: Array<Record<string, unknown>>
  }
  proposals?: {
    total: number
    list: Array<Record<string, unknown>>
  }
  bounties?: {
    total: number
    total_amount: number
    list: Array<Record<string, unknown>>
  }
}

export async function listDemandPools(query?: {
  category?: string
  delivery_region?: string
  sort_by?: "attractiveness" | "deadline" | "quantity" | "bounty"
  limit?: number
  offset?: number
}) {
  const response = await medusaFetch<{ demand_pools: DemandPool[] }>(
    "/store/collective/demand-pools",
    {
      method: "GET",
      query,
      cache: "no-store",
    }
  )

  return response.demand_pools || []
}

export async function getDemandPool(id: string) {
  const response = await medusaFetch<{ demand_pool: DemandPoolDetails }>(
    `/store/collective/demand-pools/${id}`,
    {
      method: "GET",
      cache: "no-store",
    }
  )

  return response.demand_pool
}

// ── Collective campaigns ───────────────────────────────────────────────────
//
// Campaign-scoped funding, not vendor equity, and the distinction is
// load-bearing: campaign funds buy approved material line items direct from
// suppliers and never pass through vendor hands, the vendor takes a maker fee
// released against milestones, and a backer is either a PRE_ORDER (buying
// finished units) or a MICRO_INVESTOR (a revenue share capped by
// `return_cap_multiplier`). See docs/TRANSMUTATION_STRATEGY.md §3.1 and
// docs/COLLECTIVE_BUYS_MICRO_INVESTMENT_SPEC.md.

export type Campaign = {
  id: string
  vendor_id: string
  name: string
  description: string
  campaign_type: string
  status: string
  campaign_goal: number | string
  total_backed_amount: number | string
  pre_order_backed_amount: number | string
  investor_backed_amount: number | string
  per_unit_backer_cost: number | string
  batch_minimum?: number | null
  estimated_production_days?: number | null
  media?: unknown
}

export type CampaignMaterialLineItem = {
  id: string
  description?: string | null
  quantity?: number | null
  unit_cost?: number | string | null
  total_cost?: number | string | null
  supplier_name?: string | null
}

export type CampaignDashboard = {
  campaign: Campaign
  /** Where a backer's money goes. The reason this screen exists. */
  allocation_breakdown: {
    material_total: number | string
    maker_fee_subtotal: number | string
    platform_fee_subtotal: number | string
    shipping_subtotal: number | string
  }
  material_line_items: CampaignMaterialLineItem[]
  sourcing_timeline: Array<Record<string, unknown>>
  backing_summary: {
    total_backed_amount: number | string
    pre_order_backed_amount: number | string
    investor_backed_amount: number | string
    investor_payout_cap_progress: Array<{
      backing_id: string
      cap_amount: number | string
      released_amount: number | string
    }>
  }
  yield_reports: Array<Record<string, unknown>>
}

export async function listCampaigns(query?: {
  status?: string
  campaign_type?: string
  limit?: number
  offset?: number
}) {
  const response = await medusaFetch<{ campaigns: Campaign[] }>(
    "/store/collective/campaigns",
    { method: "GET", query, cache: "no-store" }
  )

  return response.campaigns || []
}

export async function getCampaign(id: string) {
  const response = await medusaFetch<{ campaign_dashboard: CampaignDashboard }>(
    `/store/collective/campaigns/${id}`,
    { method: "GET", cache: "no-store" }
  )

  return response.campaign_dashboard
}

export async function createDemandPool(input: {
  title: string
  description: string
  category?: string
  target_quantity: number
  min_quantity: number
  unit_of_measure?: string
  target_price?: number
  currency_code?: string
}) {
  const authHeaders = await getAuthHeaders()
  if (!authHeaders) {
    throw new Error("You must be logged in to create a demand pool")
  }

  return medusaFetch<{ demand_post: DemandPool }>("/store/collective/demand-pools", {
    method: "POST",
    headers: authHeaders,
    body: input,
    cache: "no-store",
  })
}

export async function publishDemandPool(id: string) {
  const authHeaders = await getAuthHeaders()
  if (!authHeaders) {
    throw new Error("You must be logged in to publish a demand pool")
  }

  return medusaFetch<{ demand_post: DemandPool }>(
    `/store/collective/demand-pools/${id}`,
    {
      method: "PATCH",
      headers: authHeaders,
      body: { action: "publish" },
      cache: "no-store",
    }
  )
}

// ── Coalition (cooperative) storefront surfaces ──────────────────────────────

export type CoalitionNeed = {
  id: string
  title: string
  description: string
  category?: string | null
  status: string
  product_id?: string | null
  target_quantity: number
  committed_quantity: number
  total_bounty_amount: number
}

export type CoalitionListing = {
  id: string
  name: string
  product_id?: string | null
  unified_price?: number | null
  currency_code?: string | null
  featured?: boolean
  launch_id?: string | null
}

export type CoalitionSummary = {
  id: string
  handle: string
  name: string
  description?: string | null
  cover_image?: string | null
}

/** Open needs raised under a coalition (the coalition needs board). */
export async function getCoalitionNeeds(handle: string) {
  const response = await medusaFetch<{
    cooperative: CoalitionSummary
    needs: CoalitionNeed[]
    count: number
  }>(`/store/cooperatives/${handle}/needs`, {
    method: "GET",
    cache: "no-store",
  })

  return response
}

/** Products a coalition hosts/displays (transaction stays in FBM). */
export async function getCoalitionListings(handle: string) {
  const response = await medusaFetch<{
    cooperative: CoalitionSummary
    listings: CoalitionListing[]
    count: number
  }>(`/store/cooperatives/${handle}/listings`, {
    method: "GET",
    cache: "no-store",
  })

  return response
}

export async function joinDemandPool(
  id: string,
  input: { quantity_committed: number; price_willing_to_pay?: number }
) {
  const authHeaders = await getAuthHeaders()
  if (!authHeaders) {
    throw new Error("You must be logged in to join a demand pool")
  }

  return medusaFetch<{ participant: Record<string, unknown> }>(
    `/store/collective/demand-pools/${id}/join`,
    {
      method: "POST",
      headers: authHeaders,
      body: input,
      cache: "no-store",
    }
  )
}
