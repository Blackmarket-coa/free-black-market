"use server"

import { medusaFetch } from "@/lib/config"
import { getAuthHeaders } from "@/lib/data/cookies"

/**
 * The mutual-aid board.
 *
 * The shape here is exactly what `lib/aid-location.ts` publishes and no more.
 * That projection is whitelist-only and never emits coordinates: precise ones
 * describe where a person in need actually lives, and a public board is the
 * easiest place to leak that. `locality` — a neighbourhood or town someone
 * typed — is the only location this surface ever has, so nothing here should be
 * rendered as a map, a distance, or a pin.
 */
export type AidPost = {
  id: string
  title: string
  description: string
  category: string | null
  status: string
  quantity: number | null
  unit_of_measure: string | null
  locality: string | null
  created_at: string | null
}

/**
 * What a person sees of their own rows, from `/mine`. Three management fields
 * the public board withholds, and still no coordinates — the poster knows where
 * they are, and echoing the pair back would cost the property that makes
 * "coordinates never leave the server" absolute rather than conditional.
 */
export type OwnAidPost = AidPost & {
  urgency: string | null
  needed_by: string | null
  matched_at: string | null
}

export async function listAidRequests(query?: { category?: string }) {
  const response = await medusaFetch<{ requests: AidPost[] }>(
    "/store/mutual-aid/requests",
    { method: "GET", query, cache: "no-store" }
  )

  return response.requests || []
}

export async function listAidOffers(query?: { category?: string }) {
  const response = await medusaFetch<{ offers: AidPost[] }>(
    "/store/mutual-aid/offers",
    { method: "GET", query, cache: "no-store" }
  )

  return response.offers || []
}

/**
 * The caller's own rows, in every status.
 *
 * Returns an empty list rather than throwing when signed out: "your asks" is a
 * section of a public page, and a signed-out visitor should see the board, not
 * an error.
 */
export async function listMyAidRequests(): Promise<OwnAidPost[]> {
  const authHeaders = await getAuthHeaders()
  if (!authHeaders) return []

  const response = await medusaFetch<{ requests: OwnAidPost[] }>(
    "/store/mutual-aid/requests/mine",
    { method: "GET", headers: authHeaders, cache: "no-store" }
  )

  return response.requests || []
}

export async function listMyAidOffers(): Promise<OwnAidPost[]> {
  const authHeaders = await getAuthHeaders()
  if (!authHeaders) return []

  const response = await medusaFetch<{ offers: OwnAidPost[] }>(
    "/store/mutual-aid/offers/mine",
    { method: "GET", headers: authHeaders, cache: "no-store" }
  )

  return response.offers || []
}

export type CreateAidRequestInput = {
  title: string
  description: string
  category?: string
  urgency?: "ROUTINE" | "SOON" | "URGENT"
  quantity?: number
  unit_of_measure?: string
  locality?: string
  needed_by?: string
}

/**
 * Note what is absent: `latitude` / `longitude`. The API accepts them, and this
 * surface deliberately does not collect them. Asking someone in need for their
 * exact position to make matching tidier is the wrong trade, and a coarse
 * locality is what the board can show anyway.
 */
export async function createAidRequest(input: CreateAidRequestInput) {
  const authHeaders = await getAuthHeaders()
  if (!authHeaders) {
    throw new Error("You must be signed in to post a request")
  }

  return medusaFetch<{ request: AidPost }>("/store/mutual-aid/requests", {
    method: "POST",
    headers: authHeaders,
    body: input,
    cache: "no-store",
  })
}

export type CreateAidOfferInput = {
  title: string
  description: string
  category?: string
  quantity?: number
  unit_of_measure?: string
  locality?: string
  available_until?: string
}

export async function createAidOffer(input: CreateAidOfferInput) {
  const authHeaders = await getAuthHeaders()
  if (!authHeaders) {
    throw new Error("You must be signed in to post an offer")
  }

  return medusaFetch<{ offer: AidPost }>("/store/mutual-aid/offers", {
    method: "POST",
    headers: authHeaders,
    body: input,
    cache: "no-store",
  })
}

export async function withdrawAidRequest(id: string) {
  const authHeaders = await getAuthHeaders()
  if (!authHeaders) {
    throw new Error("You must be signed in to withdraw a request")
  }

  return medusaFetch<{ withdrawn: boolean; status: string }>(
    `/store/mutual-aid/requests/${id}/withdraw`,
    { method: "POST", headers: authHeaders, cache: "no-store" }
  )
}

export async function withdrawAidOffer(id: string) {
  const authHeaders = await getAuthHeaders()
  if (!authHeaders) {
    throw new Error("You must be signed in to withdraw an offer")
  }

  return medusaFetch<{ withdrawn: boolean; status: string }>(
    `/store/mutual-aid/offers/${id}/withdraw`,
    { method: "POST", headers: authHeaders, cache: "no-store" }
  )
}

/**
 * A helper takes on a request. Deliberately returns no contact details — the
 * API's own `next_step` string says where the conversation continues.
 */
export async function matchAidRequest(id: string) {
  const authHeaders = await getAuthHeaders()
  if (!authHeaders) {
    throw new Error("You must be signed in to offer help")
  }

  return medusaFetch<{ matched: boolean; status: string; next_step?: string }>(
    `/store/mutual-aid/requests/${id}/match`,
    { method: "POST", headers: authHeaders, body: {}, cache: "no-store" }
  )
}
