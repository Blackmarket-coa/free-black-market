import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { UseMutationOptions, UseQueryOptions } from "@tanstack/react-query"

import { FetchError } from "@medusajs/js-sdk"
import { fetchQuery } from "../../lib/client"
import { queryKeysFactory } from "../../lib/query-key-factory"

const VENDOR_BILLING_QUERY_KEY = "vendor_billing" as const
export const vendorBillingQueryKeys = queryKeysFactory(VENDOR_BILLING_QUERY_KEY)

export type VendorChargeStatus =
  | "pending"
  | "processing"
  | "paid"
  | "failed"
  | "void"
  | "refunded"

export type VendorCharge = {
  id: string
  kind: "plan" | "promotion" | "usage" | "manual"
  status: VendorChargeStatus
  amount: number
  currency_code: string
  description: string
  period_start: string | null
  period_end: string | null
  failure_reason: string | null
  paid_at: string | null
}

export type VendorBillingResponse = {
  outstanding: { amount: number; currency_code: string | null }
  charges: VendorCharge[]
  /** Whether self-serve collection is enabled on this deployment. */
  billing_enabled: boolean
  /** Whether a Stripe customer exists — i.e. setup has been completed once. */
  has_payment_method: boolean
}

export const useVendorBilling = (
  options?: Omit<
    UseQueryOptions<VendorBillingResponse, FetchError>,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryFn: () => fetchQuery("/vendor/billing", { method: "GET" }),
    queryKey: vendorBillingQueryKeys.lists(),
    retry: false,
    ...options,
  })

  const response = data as VendorBillingResponse | undefined

  return {
    outstanding: response?.outstanding ?? { amount: 0, currency_code: null },
    charges: response?.charges ?? [],
    billingEnabled: response?.billing_enabled ?? false,
    hasPaymentMethod: response?.has_payment_method ?? false,
    ...rest,
  }
}

export type SetupIntentResponse = {
  client_secret: string | null
  stripe_customer_id: string
  /** Public Stripe key for Stripe.js; null when card capture is unavailable. */
  publishable_key: string | null
}

/**
 * Begin saving a payment method. Returns the SetupIntent `client_secret` the
 * card form confirms with Stripe.js — card details never pass through this
 * app, which is what keeps the panel out of PCI scope.
 */
export const useBillingSetupIntent = (
  options?: UseMutationOptions<SetupIntentResponse, FetchError, void>
) => {
  return useMutation({
    mutationFn: () =>
      fetchQuery("/vendor/billing/setup-intent", {
        method: "POST",
      }) as Promise<SetupIntentResponse>,
    ...options,
  })
}

export type PurchasePromotionResponse = {
  charge: {
    id: string
    status: VendorChargeStatus
    amount: number
    currency_code: string
  }
  execution: { executed: boolean; reason: string | null }
  promotion: { active: boolean; expires_at: string | null }
  replayed: boolean
}

export const usePurchasePromotion = (
  options?: UseMutationOptions<
    PurchasePromotionResponse,
    FetchError,
    { tier_code: string; idempotency_key?: string }
  >
) => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (body) =>
      fetchQuery("/vendor/promotion/purchase", {
        method: "POST",
        body,
      }) as Promise<PurchasePromotionResponse>,
    onSuccess: (data, variables, context) => {
      // A purchase can move both the promotion and the billing balance.
      queryClient.invalidateQueries({ queryKey: vendorBillingQueryKeys.all })
      queryClient.invalidateQueries({ queryKey: ["vendor_promotion"] })
      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

export type VendorPromotionResponse = {
  promotion: { active: boolean; expires_at: string | null }
  tiers: {
    code: string
    display_name: string
    description: string
    duration_days: number
    price_amount: number
    currency_code: string
  }[]
  purchasable: boolean
  contact_hint: string | null
}

export const useVendorPromotion = (
  options?: Omit<
    UseQueryOptions<VendorPromotionResponse, FetchError>,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryFn: () => fetchQuery("/vendor/promotion", { method: "GET" }),
    queryKey: ["vendor_promotion", "detail"],
    retry: false,
    ...options,
  })

  const response = data as VendorPromotionResponse | undefined

  return {
    promotion: response?.promotion ?? { active: false, expires_at: null },
    tiers: response?.tiers ?? [],
    purchasable: response?.purchasable ?? false,
    contactHint: response?.contact_hint ?? null,
    ...rest,
  }
}

/**
 * Turn a purchase execution into the one line the panel should show.
 *
 * The distinction that matters: `no_payment_method` is not a failure the
 * vendor should retry — it means "add a card first", and the UI should send
 * them to the payment-method form rather than showing a generic error.
 */
export type PurchaseFeedback = {
  tone: "success" | "info" | "error"
  message: string
  /** True when the fix is to add a payment method, not to retry. */
  needsPaymentMethod: boolean
}

export function interpretPurchase(
  result: PurchasePromotionResponse
): PurchaseFeedback {
  if (result.charge.status === "paid" || result.promotion.active) {
    return {
      tone: "success",
      message: "Your promoted placement is live.",
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
      message:
        "Payment is processing. Your placement goes live once it settles.",
      needsPaymentMethod: false,
    }
  }
  return {
    tone: "error",
    message: "We could not complete the charge. Please try again.",
    needsPaymentMethod: false,
  }
}
