"use server"

import { medusaFetch } from "../config"
import { logger } from "../logger"
import type { OrderClaimReason } from "../constants/order-claims"

// `CLAIM_WINDOW_DAYS` and `CLAIM_REASON_LABELS` live in
// `lib/constants/order-claims.ts`: a `"use server"` module may export only
// async functions, so a constant here fails `next build`.

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
