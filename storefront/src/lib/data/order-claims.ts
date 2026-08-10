"use server"

import { medusaFetch } from "../config"
import { logger } from "../logger"

/**
 * How long after an order a claim can be filed. Mirrors `CLAIM_WINDOW_DAYS`
 * in `backend/src/api/store/order-claims/route.ts` — the backend enforces it,
 * this copy is for stating it on the policy page before a buyer tries.
 */
export const CLAIM_WINDOW_DAYS = 30

export type OrderClaimReason =
  | "not_received"
  | "not_as_described"
  | "damaged"
  | "missing_items"

export type OrderClaim = {
  id: string
  status: "pending" | "accepted" | "rejected" | "completed" | "cancelled"
  reviewer_note: string | null
  created_at: string
  data: {
    order_id: string
    reason: OrderClaimReason
    description: string
    evidence_urls?: string[]
    contacted_seller?: boolean
  }
}

export const CLAIM_REASON_LABELS: Record<OrderClaimReason, string> = {
  not_received: "It never arrived",
  not_as_described: "It isn't what was described",
  damaged: "It arrived damaged",
  missing_items: "Part of the order is missing",
}

export async function listOrderClaims(): Promise<OrderClaim[]> {
  try {
    const res = await medusaFetch<{ claims: OrderClaim[] }>(
      "/store/order-claims",
      { method: "GET", cache: "no-cache" }
    )
    return res.claims ?? []
  } catch (error) {
    logger.error("[listOrderClaims] failed:", error)
    return []
  }
}

export type FileClaimInput = {
  order_id: string
  reason: OrderClaimReason
  description: string
  contacted_seller: boolean
}

export type FileClaimResult =
  | { ok: true; claim: OrderClaim }
  | { ok: false; message: string }

/**
 * File a claim. Returns the backend's message on failure rather than a generic
 * one — the useful cases (outside the window, already an open claim) each
 * explain what the buyer should do instead, and flattening them to "something
 * went wrong" would strand someone who still has a card dispute available.
 */
export async function fileOrderClaim(
  input: FileClaimInput
): Promise<FileClaimResult> {
  try {
    const res = await medusaFetch<{ claim: OrderClaim }>("/store/order-claims", {
      method: "POST",
      body: input,
    })
    return { ok: true, claim: res.claim }
  } catch (error) {
    logger.error("[fileOrderClaim] failed:", error)
    const message =
      (error as { message?: string })?.message ||
      "We couldn't file that claim. Please try again."
    return { ok: false, message }
  }
}
