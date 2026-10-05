"use client"

import { useState, useEffect, useCallback } from "react"
import { hawalaRequest, type HawalaRequest } from "@/lib/data/hawala"

export interface WalletBalance {
  account_number: string
  balance: number
  pending_balance: number
  available_balance: number
  currency_code: string
}

export interface WalletAccount {
  id: string
  account_number: string
  account_type: string
  status: string
  created_at: string
}

export interface Transaction {
  id: string
  entry_type: string
  amount: number
  signed_amount: number
  direction: "CREDIT" | "DEBIT"
  description: string
  created_at: string
  status: string
}

export interface BankAccount {
  id: string
  bank_name: string
  account_last_four: string
  verification_status: string
  is_default: boolean
}

/**
 * The nonprofit carrier of a pool, when it has one: the verified partner org
 * that holds and administers the pool's funds on its own accounts. Free Black
 * Market keeps the record and holds nothing. `verification_status` and
 * `verified_as_of` are the IRS file's answer and date at assignment time —
 * show them as given; never collapse them into a yes/no.
 */
export interface PoolCarrier {
  org_key: string
  verification_status: string
  verified_as_of: string | null
}

export interface Investment {
  id: string
  pool_id: string
  amount: number
  actual_return: number
  status: string
  source: string
  invested_at: string
  pool?: {
    id: string
    name: string
    producer_id: string
    roi_type: string
    status: string
    carrier?: PoolCarrier | null
  }
}

export interface InvestmentPool {
  id: string
  name: string
  description?: string
  producer_id: string
  target_amount: number
  total_raised: number
  minimum_investment: number
  roi_type: string
  /** What GET /store/hawala/pools returns: the pool's `roi_rate` or `fixed_roi_rate` (an annual percentage), or null. */
  roi_rate?: number | null
  fixed_roi_rate?: number
  revenue_share_percentage?: number
  product_credit_multiplier?: number
  total_investors: number
  progress_percentage: number
  /** A ledger figure on BMC's books; `null` for a carried pool, whose funds the carrier holds. */
  current_balance: number | null
  carrier?: PoolCarrier | null
  start_date?: string
  end_date?: string
}

/**
 * What `POST /store/hawala/pools/:id/contributions` answers: a PaymentIntent
 * the API created ON the carrier's own Stripe account (confirm it with
 * Stripe.js loaded for `stripe_account_id`), and the PENDING record FBM wrote
 * for it. Free Black Market never holds the funds and takes no fee; the pool's
 * total updates when the carrier's processor confirms the payment (via the
 * Connect webhook), not when this returns.
 */
export interface CarriedPoolContributionIntent {
  pool_id: string
  pool_name: string
  carrier_org_key: string
  carrier_org_name: string
  payment_collection_id: string
  payment_session_id: string
  stripe_payment_intent_id: string
  stripe_account_id: string
  client_secret: string | null
  currency_code: string
  gross_cents: number
  bmc_fee_cents: 0
  carrier_verification_status: string
  carrier_verified_as_of: string | null
  record_status: "PENDING"
  disclosure: string
}

/**
 * A refused hawala request, with the server's `type` beside its message
 * (`feature_disabled`, `not_allowed`, `pool_not_open`, `no_carrier`,
 * `fee_not_zero`, `below_minimum`, ...). Legacy handlers that answer only
 * `{ error }` surface as `request_failed`.
 */
export class HawalaRequestError extends Error {
  readonly type: string
  readonly status: number

  constructor(type: string, message: string, status: number) {
    super(message)
    this.name = "HawalaRequestError"
    this.type = type
    this.status = status
  }
}

/**
 * One idempotency key per user-initiated money movement.
 *
 * The backend derives a fallback key when this header is absent, but an
 * explicit client key is what makes the retry boundary exact: a transport-level
 * retry of the same request replays the original operation instead of starting
 * a second one. Generated per action, never per render.
 *
 * Uses `crypto` rather than `Math.random`, matching connect.js's convention.
 */
function newIdempotencyKey(): string {
  if (typeof crypto !== "undefined") {
    if (typeof crypto.randomUUID === "function") {
      return crypto.randomUUID()
    }
    if (typeof crypto.getRandomValues === "function") {
      const bytes = crypto.getRandomValues(new Uint8Array(16))
      return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")
    }
  }
  // Last resort: the server still derives a deterministic key from the payload.
  return ""
}

/**
 * Every hawala call goes through the `hawalaRequest` server action, which sends
 * the publishable key and the signed-in customer's bearer (from the httpOnly
 * `_medusa_jwt` cookie, which this browser code cannot read). Calling the API
 * from here directly carried neither, so no request reached the backend as the
 * customer.
 *
 * Legacy handlers answer `{ error }`; the pool refusals (409 carried_pool /
 * no_carrier / pool_not_open, 403 not_allowed) answer `{ type, message }`.
 * Either way the refusal surfaces as a HawalaRequestError with the type beside
 * the message.
 */
// `any`, as `response.json()` was before: callers read the documented response
// shapes field by field.
async function fetchWithAuth(path: string, options: Omit<HawalaRequest, "path"> = {}): Promise<any> {
  const result = await hawalaRequest<unknown>({ path, ...options })
  if (!result.ok) {
    throw new HawalaRequestError(result.type, result.message, result.status)
  }
  return result.data
}

/**
 * Start a contribution to a nonprofit-CARRIED pool: the API mints a
 * PaymentIntent ON the carrier's connected account (BMC takes 0, the carrier
 * bears card processing) and records a PENDING row; the caller then confirms
 * the intent with Stripe.js for `stripe_account_id`. One Idempotency-Key per
 * submission, so a transport retry reuses the same intent and record.
 * Rejects with a `HawalaRequestError` carrying the server's `{ type, message }`.
 */
export async function contributeToCarriedPool(poolId: string, amountCents: number): Promise<CarriedPoolContributionIntent> {
  return fetchWithAuth(`/store/hawala/pools/${encodeURIComponent(poolId)}/contributions`, {
    method: "POST",
    idempotencyKey: newIdempotencyKey(),
    body: { amount_cents: Math.round(amountCents), currency_code: "usd" },
  })
}

export function useWallet() {
  const [wallet, setWallet] = useState<WalletAccount | null>(null)
  const [balance, setBalance] = useState<WalletBalance | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchWallet = useCallback(async () => {
    try {
      setLoading(true)
      const data = await fetchWithAuth("/store/hawala/wallet")
      setWallet(data.wallet)
      setBalance(data.balance)
      setError(null)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchWallet()
  }, [fetchWallet])

  const createWallet = useCallback(async () => {
    const data = await fetchWithAuth("/store/hawala/wallet", { method: "POST" })
    setWallet(data.wallet)
    setBalance(data.balance)
    return data
  }, [])

  return { wallet, balance, loading, error, refetch: fetchWallet, createWallet }
}

export function useTransactions(limit = 50) {
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchTransactions = useCallback(async () => {
    try {
      setLoading(true)
      const data = await fetchWithAuth("/store/hawala/transactions", { query: { limit } })
      setTransactions(data.transactions)
      setError(null)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [limit])

  useEffect(() => {
    fetchTransactions()
  }, [fetchTransactions])

  return { transactions, loading, error, refetch: fetchTransactions }
}

export function useBankAccounts() {
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchBankAccounts = useCallback(async () => {
    try {
      setLoading(true)
      const data = await fetchWithAuth("/store/hawala/bank-accounts")
      setBankAccounts(data.bank_accounts)
      setError(null)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchBankAccounts()
  }, [fetchBankAccounts])

  const startLinking = useCallback(async (email: string, returnUrl: string) => {
    return fetchWithAuth("/store/hawala/bank-accounts", {
      method: "POST",
      body: { email, return_url: returnUrl },
    })
  }, [])

  const completeLinking = useCallback(async (
    stripeCustomerId: string,
    financialConnectionsAccountId: string
  ) => {
    const data = await fetchWithAuth("/store/hawala/bank-accounts/link", {
      method: "POST",
      body: {
        stripe_customer_id: stripeCustomerId,
        financial_connections_account_id: financialConnectionsAccountId,
      },
    })
    await fetchBankAccounts()
    return data
  }, [fetchBankAccounts])

  return {
    bankAccounts,
    loading,
    error,
    refetch: fetchBankAccounts,
    startLinking,
    completeLinking,
  }
}

export function useDeposit() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const deposit = useCallback(async (bankAccountId: string, amount: number) => {
    try {
      setLoading(true)
      setError(null)
      const data = await fetchWithAuth("/store/hawala/deposit", {
        method: "POST",
        idempotencyKey: newIdempotencyKey(),
        body: { bank_account_id: bankAccountId, amount },
      })
      return data
    } catch (err) {
      setError((err as Error).message)
      throw err
    } finally {
      setLoading(false)
    }
  }, [])

  return { deposit, loading, error }
}

export function useWithdraw() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const withdraw = useCallback(async (bankAccountId: string, amount: number) => {
    try {
      setLoading(true)
      setError(null)
      const data = await fetchWithAuth("/store/hawala/withdraw", {
        method: "POST",
        idempotencyKey: newIdempotencyKey(),
        body: { bank_account_id: bankAccountId, amount },
      })
      return data
    } catch (err) {
      setError((err as Error).message)
      throw err
    } finally {
      setLoading(false)
    }
  }, [])

  return { withdraw, loading, error }
}

export function useInvestments() {
  const [investments, setInvestments] = useState<Investment[]>([])
  const [summary, setSummary] = useState({
    total_invested: 0,
    total_returns: 0,
    active_investments: 0,
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchInvestments = useCallback(async () => {
    try {
      setLoading(true)
      const data = await fetchWithAuth("/store/hawala/investments")
      setInvestments(data.investments)
      setSummary(data.summary)
      setError(null)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchInvestments()
  }, [fetchInvestments])

  const invest = useCallback(async (poolId: string, amount: number) => {
    const data = await fetchWithAuth("/store/hawala/investments", {
      method: "POST",
      idempotencyKey: newIdempotencyKey(),
      body: { pool_id: poolId, amount },
    })
    await fetchInvestments()
    return data
  }, [fetchInvestments])

  return { investments, summary, loading, error, refetch: fetchInvestments, invest }
}

export function useInvestmentPools(producerId?: string) {
  const [pools, setPools] = useState<InvestmentPool[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchPools = useCallback(async () => {
    try {
      setLoading(true)
      const data = await fetchWithAuth("/store/hawala/pools", {
        query: producerId ? { producer_id: producerId } : undefined,
      })
      setPools(data.pools)
      setError(null)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [producerId])

  useEffect(() => {
    fetchPools()
  }, [fetchPools])

  return { pools, loading, error, refetch: fetchPools }
}
