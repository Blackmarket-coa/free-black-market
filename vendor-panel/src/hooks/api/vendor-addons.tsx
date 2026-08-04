import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { UseMutationOptions, UseQueryOptions } from "@tanstack/react-query"

import { FetchError } from "@medusajs/js-sdk"
import { fetchQuery } from "../../lib/client"
import { vendorBillingQueryKeys, type VendorChargeStatus } from "./vendor-billing"

const VENDOR_ADDONS_QUERY_KEY = "vendor_addons" as const

export type AddonOwnership = {
  code: string
  active: boolean
  expires_at: string | null
}

export type VendorAddon = {
  code: string
  display_name: string
  description: string
  price_amount: number
  currency_code: string
  duration_days: number
  feature_keys: string[]
  owned: AddonOwnership
}

export type VendorAddonsResponse = {
  addons: VendorAddon[]
  /** Whether self-serve checkout is open on this deployment. */
  purchasable: boolean
}

export const useVendorAddons = (
  options?: Omit<
    UseQueryOptions<VendorAddonsResponse, FetchError>,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryFn: () => fetchQuery("/vendor/addons", { method: "GET" }),
    queryKey: [VENDOR_ADDONS_QUERY_KEY, "list"],
    retry: false,
    ...options,
  })

  const response = data as VendorAddonsResponse | undefined

  return {
    addons: response?.addons ?? [],
    purchasable: response?.purchasable ?? false,
    ...rest,
  }
}

export type PurchaseAddonResponse = {
  charge: {
    id: string
    status: VendorChargeStatus
    amount: number
    currency_code: string
  }
  execution: { executed: boolean; reason: string | null }
  addon: AddonOwnership
  replayed: boolean
}

export const usePurchaseAddon = (
  options?: UseMutationOptions<
    PurchaseAddonResponse,
    FetchError,
    { code: string; idempotency_key?: string }
  >
) => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (body) =>
      fetchQuery("/vendor/addons/purchase", {
        method: "POST",
        body,
      }) as Promise<PurchaseAddonResponse>,
    onSuccess: (data, variables, context) => {
      // A purchase moves both what the vendor owns and their balance.
      queryClient.invalidateQueries({ queryKey: [VENDOR_ADDONS_QUERY_KEY] })
      queryClient.invalidateQueries({ queryKey: vendorBillingQueryKeys.all })
      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

export type AddonPurchaseFeedback = {
  tone: "success" | "info" | "error"
  message: string
  /** True when the fix is to add a payment method, not to retry. */
  needsPaymentMethod: boolean
}

/**
 * Turn a purchase execution into the one line the panel should show.
 *
 * Mirrors `interpretPurchase` for promotions, and for the same reason: the
 * load-bearing distinction is that `no_payment_method` is not a failure to
 * retry — it means "add a card first", so the UI sends the vendor to the
 * billing page instead of showing a generic error.
 */
export function interpretAddonPurchase(
  result: PurchaseAddonResponse
): AddonPurchaseFeedback {
  if (result.charge.status === "paid" || result.addon.active) {
    return {
      tone: "success",
      message: "Your add-on is active.",
      needsPaymentMethod: false,
    }
  }
  if (result.execution.reason === "no_payment_method") {
    return {
      tone: "info",
      message: "Add a payment method to complete your purchase.",
      needsPaymentMethod: true,
    }
  }
  if (result.charge.status === "processing") {
    return {
      tone: "info",
      message: "Payment is processing. Your add-on unlocks once it settles.",
      needsPaymentMethod: false,
    }
  }
  return {
    tone: "error",
    message: "We could not complete the charge. Please try again.",
    needsPaymentMethod: false,
  }
}

/**
 * Days left on an add-on window, or null when it is not running.
 *
 * Rounds up, so the last partial day still reads as "1 day left" rather than
 * "0" — a vendor with hours remaining has not run out yet.
 */
export function daysRemaining(
  owned: AddonOwnership,
  now: Date = new Date()
): number | null {
  if (!owned.active || !owned.expires_at) return null
  const expires = new Date(owned.expires_at)
  if (Number.isNaN(expires.getTime())) return null
  const ms = expires.getTime() - now.getTime()
  if (ms <= 0) return null
  return Math.ceil(ms / 86_400_000)
}
