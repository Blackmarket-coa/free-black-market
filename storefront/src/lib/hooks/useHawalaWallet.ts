"use client"

import { useState, useEffect, useCallback } from "react"

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
  fixed_roi_rate?: number
  revenue_share_percentage?: number
  product_credit_multiplier?: number
  total_investors: number
  progress_percentage: number
  current_balance: number
  start_date?: string
  end_date?: string
}

const API_BASE = process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL || "http://localhost:9000"

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

async function fetchWithAuth(url: string, options: RequestInit = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...options.headers,
  }

  const response = await fetch(`${API_BASE}${url}`, {
    ...options,
    headers,
    credentials: "include",
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: "Request failed" }))
    throw new Error(error.error || "Request failed")
  }

  return response.json()
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
      const data = await fetchWithAuth(`/store/hawala/transactions?limit=${limit}`)
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
      body: JSON.stringify({ email, return_url: returnUrl }),
    })
  }, [])

  const completeLinking = useCallback(async (
    stripeCustomerId: string,
    financialConnectionsAccountId: string
  ) => {
    const data = await fetchWithAuth("/store/hawala/bank-accounts/link", {
      method: "POST",
      body: JSON.stringify({
        stripe_customer_id: stripeCustomerId,
        financial_connections_account_id: financialConnectionsAccountId,
      }),
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
        headers: { "Idempotency-Key": newIdempotencyKey() },
        body: JSON.stringify({ bank_account_id: bankAccountId, amount }),
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
        headers: { "Idempotency-Key": newIdempotencyKey() },
        body: JSON.stringify({ bank_account_id: bankAccountId, amount }),
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
      headers: { "Idempotency-Key": newIdempotencyKey() },
      body: JSON.stringify({ pool_id: poolId, amount }),
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
      const url = producerId
        ? `/store/hawala/pools?producer_id=${producerId}`
        : "/store/hawala/pools"
      const data = await fetchWithAuth(url)
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
