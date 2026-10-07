import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { sdk } from "../../lib/client"

// Custom hook for fetching vendor financial dashboard
export const useVendorDashboard = () => {
  const { data, error, ...rest } = useQuery({
    queryKey: ["hawala", "dashboard"],
    queryFn: async () => {
      const response = await sdk.client.fetch("/vendor/hawala/dashboard", {
        method: "GET",
      })
      return response as { dashboard: VendorDashboard }
    },
    retry: false,
  })

  return {
    dashboard: data?.dashboard,
    error,
    ...rest,
  }
}

// Custom hook for fetching payout options
export const usePayoutOptions = () => {
  const { data, ...rest } = useQuery({
    queryKey: ["hawala", "payout-options"],
    queryFn: async () => {
      const response = await sdk.client.fetch("/vendor/hawala/payouts", {
        method: "GET",
      })
      return response as { payout_options: PayoutOptions }
    },
  })

  return {
    payoutOptions: data?.payout_options,
    ...rest,
  }
}

// Custom hook for requesting payout
export const useRequestPayout = () => {
  const queryClient = useQueryClient()
  
  return useMutation({
    mutationFn: async (data: {
      amount: number
      payout_tier: "INSTANT" | "SAME_DAY" | "NEXT_DAY" | "WEEKLY"
      bank_account_id?: string
    }) => {
      const response = await sdk.client.fetch("/vendor/hawala/payouts", {
        method: "POST",
        body: data,
      })
      return response
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["hawala"] })
    },
  })
}

// Custom hook for fetching advance eligibility
export const useAdvanceEligibility = () => {
  const { data, ...rest } = useQuery({
    queryKey: ["hawala", "advances"],
    queryFn: async () => {
      const response = await sdk.client.fetch("/vendor/hawala/advances", {
        method: "GET",
      })
      return response as { eligibility: AdvanceEligibility; advances: Advance[] }
    },
  })

  return {
    eligibility: data?.eligibility,
    advances: data?.advances,
    ...rest,
  }
}

// Custom hook for requesting advance
export const useRequestAdvance = () => {
  const queryClient = useQueryClient()
  
  return useMutation({
    mutationFn: async (data: {
      amount: number
      fee_rate: number
      term_days: number
      repayment_rate?: number
    }) => {
      const response = await sdk.client.fetch("/vendor/hawala/advances", {
        method: "POST",
        body: data,
      })
      return response
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["hawala"] })
    },
  })
}

// Custom hook for V2V payments
export const useVendorPayments = () => {
  const { data, ...rest } = useQuery({
    queryKey: ["hawala", "payments"],
    queryFn: async () => {
      const response = await sdk.client.fetch("/vendor/hawala/payments", {
        method: "GET",
      })
      return response as { sent: VendorPayment[]; received: VendorPayment[] }
    },
  })

  return {
    sentPayments: data?.sent,
    receivedPayments: data?.received,
    ...rest,
  }
}

// Custom hook for creating V2V payment
export const useCreateVendorPayment = () => {
  const queryClient = useQueryClient()
  
  return useMutation({
    mutationFn: async (data: {
      payee_vendor_id: string
      amount: number
      payment_type: string
      invoice_number?: string
      reference_note?: string
    }) => {
      const response = await sdk.client.fetch("/vendor/hawala/payments", {
        method: "POST",
        body: data,
      })
      return response
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["hawala"] })
    },
  })
}

// Types
export interface VendorDashboard {
  available_balance: number
  pending_balance: number
  total_balance: number
  currency: string
  today: { revenue: number; transaction_count: number }
  week: { revenue: number; transaction_count: number }
  month: { revenue: number; transaction_count: number }
  projections: {
    avg_daily_revenue: number
    projected_week: number
    projected_month: number
  }
  recent_transactions: Array<{
    id: string
    amount: number
    direction: "CREDIT" | "DEBIT"
    entry_type: string
    description: string
    created_at: string
  }>
  /**
   * What the vendor owes: card processing retained on refunded orders that
   * their earnings could not cover at the time, and card refunds issued
   * after they were paid out (`kind: "refund"`). Taken from the next sales,
   * and before any payout. Absent from older API builds; `kind` and
   * `by_kind` are absent from builds before refunds were added (every item
   * is then card processing).
   */
  card_processing_owed?: {
    outstanding: number
    by_kind?: { card_processing: number; refund: number }
    open: Array<{ kind?: OwedKind; order_id: string | null; amount: number; since: string | null }>
    /** Forgiven after 180 days unrepaid; never collected. Absent from older APIs. */
    forgiven?: Array<{ kind?: OwedKind; order_id: string | null; amount: number; since: string | null; forgiven_at: string }>
  }
  advance: {
    has_active: boolean
    principal?: number
    outstanding?: number
    repaid?: number
    expected_end?: string
    eligible?: any
  }
  payout: {
    default_tier: string
    auto_enabled: boolean
    instant_eligible: boolean
  } | null
  investment_pools: Array<{
    id: string
    name: string
    target: number
    raised: number
    status: string
    /**
     * The verified nonprofit carrying this pool, when it has one: it holds
     * the funds on its own accounts; the platform keeps the record only.
     */
    carrier: {
      org_key: string
      verification_status: string
      verified_as_of: string | null
    } | null
  }>
}

/** What an owed amount is for (backend hawala-ledger/card-processing.ts). */
export type OwedKind = "card_processing" | "refund"

export interface PayoutOptions {
  available_balance: number
  /** What a payout can take now: available less everything owed; zero while held. Absent from older API builds. */
  payable_balance?: number
  /** Card processing owed, repaid before any payout. */
  card_processing_owed?: number
  /** Refunds issued after payout, owed and repaid before any payout. Absent from older API builds. */
  refund_owed?: number
  /** Everything owed. Absent from older API builds. */
  total_owed?: number
  /**
   * Payouts held while a refund on a shared checkout is not yet assigned to
   * a vendor. Absent from older API builds.
   */
  payout_hold?: { held: boolean; since: string; reason: string } | null
  currency: string
  options: Array<{
    tier: string
    name: string
    speed: string
    method: string
    fee_rate: number
    fee_rate_display: string
    fee_amount: number
    net_amount: number
    available: boolean
  }>
  default_tier: string
  instant_payout_eligible: boolean
  instant_payout_daily_limit: number
  instant_payout_remaining: number
}

export interface AdvanceEligibility {
  eligible: boolean
  reason?: string
  max_advance: number
  suggested_term_days: number
  daily_repayment_capacity: number
  fee_options?: Array<{
    type: string
    rate: number
    total_repayment: number
    apr_equivalent: string
  }>
  metrics?: {
    last_30_days_revenue: number
    transaction_count: number
    avg_daily_revenue: number
  }
}

export interface Advance {
  id: string
  principal: number
  outstanding: number
  repaid: number
  fee_rate: number
  repayment_rate: number
  term_days: number
  start_date: string
  expected_end_date: string
  actual_end_date?: string
  status: string
}

export interface VendorPayment {
  id: string
  payer_vendor_id?: string
  payee_vendor_id?: string
  amount: number
  payment_type: string
  invoice_number?: string
  reference_note?: string
  status: string
  created_at: string
}
