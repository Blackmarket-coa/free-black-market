import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { fetchQuery } from "../../lib/client"

/**
 * Fund accounting — restricted funds and grants.
 *
 * Reports are read separately from the fund rows because balances are derived
 * from transactions on the backend rather than stored, so a fund row alone
 * never carries a balance to render.
 */
export const fundQueryKeys = {
  all: ["funds"] as const,
  list: () => ["funds", "list"] as const,
  portfolio: () => ["funds", "portfolio"] as const,
  report: (id: string) => ["funds", "report", id] as const,
  entries: (id: string) => ["funds", "entries", id] as const,
  settlements: () => ["funds", "settlements"] as const,
}

export const useFunds = () =>
  useQuery({
    queryKey: fundQueryKeys.list(),
    queryFn: () => fetchQuery("/vendor/funds", { method: "GET" }),
  })

/** Every fund's balances and violations at once, for the reconciliation view. */
export const useFundPortfolio = () =>
  useQuery({
    queryKey: fundQueryKeys.portfolio(),
    queryFn: () => fetchQuery("/vendor/funds/portfolio", { method: "GET" }),
  })

/**
 * Settlements an expenditure may cite — the seller's completed ledger outflows,
 * each with what is already attributed across funds and what is left.
 */
export const useFundSettlements = (enabled = true) =>
  useQuery({
    queryKey: fundQueryKeys.settlements(),
    queryFn: () => fetchQuery("/vendor/funds/settlements", { method: "GET" }),
    enabled,
  })

export const useFundReport = (fundId: string | null) =>
  useQuery({
    queryKey: fundQueryKeys.report(fundId ?? ""),
    queryFn: () => fetchQuery(`/vendor/funds/${fundId}/report`, { method: "GET" }),
    enabled: Boolean(fundId),
  })

export const useFundEntries = (fundId: string | null) =>
  useQuery({
    queryKey: fundQueryKeys.entries(fundId ?? ""),
    queryFn: () => fetchQuery(`/vendor/funds/${fundId}/entries`, { method: "GET" }),
    enabled: Boolean(fundId),
  })

export const useCreateFund = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      fetchQuery("/vendor/funds", { method: "POST", body: payload }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: fundQueryKeys.all })
    },
  })
}

export const useRecordFundEntry = (fundId: string) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      fetchQuery(`/vendor/funds/${fundId}/entries`, {
        method: "POST",
        body: payload,
      }),
    // An entry changes balances and can clear or raise a violation, so the
    // whole fund tree is invalidated rather than just the entry list.
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: fundQueryKeys.all })
    },
  })
}
