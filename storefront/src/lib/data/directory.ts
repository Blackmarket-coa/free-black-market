"use server"

import { medusaFetch } from "@/lib/config"

export type ExternalStore = {
  platform: string
  name: string
  url: string
}

export type DirectoryProducer = {
  id: string
  name: string
  handle: string
  description?: string | null
  region?: string | null
  state?: string | null
  photo?: string | null
  cover_image?: string | null
  featured?: boolean
  verified?: boolean
  external_stores: ExternalStore[]
}

/**
 * Unified Commerce Hub directory: producers + the external stores they sell
 * through. Backed by GET /store/directory (producer + seller_metadata).
 */
export async function listDirectory(query?: {
  q?: string
  region?: string
  platform?: string
  featured?: boolean
  limit?: number
  offset?: number
}) {
  const params: Record<string, string | number | boolean> = {}
  if (query?.q) params.q = query.q
  if (query?.region) params.region = query.region
  if (query?.platform) params.platform = query.platform
  if (query?.featured) params.featured = true
  if (query?.limit) params.limit = query.limit
  if (query?.offset) params.offset = query.offset

  const response = await medusaFetch<{
    producers: DirectoryProducer[]
    count: number
  }>("/store/directory", {
    method: "GET",
    query: params,
    cache: "no-store",
  })

  return response.producers || []
}
