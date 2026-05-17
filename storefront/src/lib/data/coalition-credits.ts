"use server"

import { medusaFetch } from "../config"
import { getAuthHeaders } from "./cookies"

export type CoalitionCreditsWallet = {
  id: string
  account_number: string
  balance: number
  pending_balance: number
  available_balance: number
  currency_code: string
}

export type CoalitionCreditsTransaction = {
  id: string
  entry_type: string
  amount: number
  description: string | null
  created_at: string
  reference_type?: string | null
  reference_id?: string | null
  direction: "debit" | "credit"
}

/**
 * Fetch the customer's Coalition Credits wallet (USER_WALLET account)
 * with balance details. Wraps `/store/hawala/wallet` so the storefront
 * can render a simple `{ wallet, balance }` shape.
 */
export const getCoalitionCreditsWallet = async (): Promise<{
  wallet: CoalitionCreditsWallet
  balance: {
    balance: number
    pending_balance: number
    available_balance: number
    currency_code: string
  }
} | null> => {
  const authHeaders = await getAuthHeaders()
  if (!authHeaders) return null

  try {
    return await medusaFetch<{
      wallet: CoalitionCreditsWallet
      balance: {
        balance: number
        pending_balance: number
        available_balance: number
        currency_code: string
      }
    }>("/store/hawala/wallet", {
      method: "GET",
      headers: authHeaders,
      cache: "no-store",
    })
  } catch {
    return null
  }
}

/**
 * Fetch the customer's recent ledger transactions. Backed by
 * `/store/hawala/transactions`.
 */
export const listCoalitionCreditsTransactions = async (params?: {
  limit?: number
  offset?: number
}): Promise<{ transactions: CoalitionCreditsTransaction[] } | null> => {
  const authHeaders = await getAuthHeaders()
  if (!authHeaders) return null

  const query = new URLSearchParams()
  if (params?.limit) query.set("limit", String(params.limit))
  if (params?.offset) query.set("offset", String(params.offset))
  const qs = query.toString()
  const path = `/store/hawala/transactions${qs ? `?${qs}` : ""}`

  try {
    return await medusaFetch<{ transactions: CoalitionCreditsTransaction[] }>(
      path,
      {
        method: "GET",
        headers: authHeaders,
        cache: "no-store",
      }
    )
  } catch {
    return null
  }
}
