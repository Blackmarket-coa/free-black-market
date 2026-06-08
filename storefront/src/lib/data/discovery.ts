"use server"

import { medusaFetch } from "@/lib/config"

// ── §5 Opportunity Engine ──
export type OpportunityRow = {
  id: string
  subject_key: string
  subject_label?: string
  region: string
  opportunity_score: number
  demand: number
  competition: number
  startup_cost: number
}

export async function listOpportunities(query?: {
  region?: string
  limit?: number
}): Promise<OpportunityRow[]> {
  const params: Record<string, string | number> = {}
  if (query?.region) params.region = query.region
  if (query?.limit) params.limit = query.limit
  try {
    const r = await medusaFetch<{ opportunities: OpportunityRow[] }>(
      "/store/opportunities",
      { method: "GET", query: params, cache: "no-store" }
    )
    return r.opportunities || []
  } catch {
    return []
  }
}

export async function getOpportunity(
  subject: string,
  region = "US"
): Promise<any | null> {
  try {
    return await medusaFetch<any>(
      `/store/opportunities/${encodeURIComponent(subject)}`,
      { method: "GET", query: { region }, cache: "no-store" }
    )
  } catch {
    return null
  }
}

// ── §5/§15 Price tracker ──
export type PriceTrack = {
  category: string
  region: string
  trend: { direction: string; pctChange: number; latestCents: number | null }
  series: { price_cents: number; unit: string; observed_at: string }[]
}

export async function getPriceTracker(query?: {
  category?: string
  region?: string
}): Promise<PriceTrack[]> {
  const params: Record<string, string> = {}
  if (query?.category) params.category = query.category
  if (query?.region) params.region = query.region
  try {
    const r = await medusaFetch<{ tracks: PriceTrack[] }>(
      "/store/price-tracker",
      { method: "GET", query: params, cache: "no-store" }
    )
    return r.tracks || []
  } catch {
    return []
  }
}

// ── §14 Knowledge Base ──
export type KbArticleSummary = {
  slug: string
  title: string
  type: string
  summary: string
  category?: string | null
  difficulty?: string
  climate_zone?: string | null
  space?: string | null
}

export async function listKnowledgeBase(query?: {
  type?: string
  category?: string
  difficulty?: string
  q?: string
}): Promise<KbArticleSummary[]> {
  const params: Record<string, string> = {}
  for (const k of ["type", "category", "difficulty", "q"] as const) {
    const v = query?.[k]
    if (v) params[k] = v
  }
  try {
    const r = await medusaFetch<{ articles: KbArticleSummary[] }>(
      "/store/knowledge-base",
      { method: "GET", query: params, cache: "no-store" }
    )
    return r.articles || []
  } catch {
    return []
  }
}

export async function getKbArticle(slug: string): Promise<any | null> {
  try {
    const r = await medusaFetch<{ article: any }>(
      `/store/knowledge-base/${encodeURIComponent(slug)}`,
      { method: "GET", cache: "no-store" }
    )
    return r.article || null
  } catch {
    return null
  }
}

// ── §12 Startup guides ──
export type StartupGuideSummary = {
  slug: string
  title: string
  category: string
  summary: string
  estimated_startup_cost_cents: number
  difficulty: string
}

export async function listStartupGuides(): Promise<StartupGuideSummary[]> {
  try {
    const r = await medusaFetch<{ guides: StartupGuideSummary[] }>(
      "/store/startup-guides",
      { method: "GET", cache: "no-store" }
    )
    return r.guides || []
  } catch {
    return []
  }
}

export async function getStartupGuide(slug: string): Promise<any | null> {
  try {
    return await medusaFetch<any>(
      `/store/startup-guides/${encodeURIComponent(slug)}`,
      { method: "GET", cache: "no-store" }
    )
  } catch {
    return null
  }
}
