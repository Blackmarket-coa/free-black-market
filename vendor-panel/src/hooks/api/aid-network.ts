import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { fetchQuery } from "../../lib/client"

/**
 * Aid network — hubs, in-kind intake, cross-hub allocation and transfers.
 *
 * The allocation plan is a mutation rather than a query even though it writes
 * nothing: the demand list is the payload, and the backend takes it by POST.
 */
export const aidNetworkQueryKeys = {
  all: ["aid-network"] as const,
  nodes: () => ["aid-network", "nodes"] as const,
  transfers: () => ["aid-network", "transfers"] as const,
  surplus: (withinDays: number) =>
    ["aid-network", "surplus", withinDays] as const,
}

export const useNetworkNodes = () =>
  useQuery({
    queryKey: aidNetworkQueryKeys.nodes(),
    queryFn: () => fetchQuery("/vendor/aid-network/nodes", { method: "GET" }),
  })

export const useNodeTransfers = () =>
  useQuery({
    queryKey: aidNetworkQueryKeys.transfers(),
    queryFn: () => fetchQuery("/vendor/aid-network/transfers", { method: "GET" }),
  })

/** Stock that will spoil within the window and is not already committed. */
export const useSurplus = (withinDays = 3) =>
  useQuery({
    queryKey: aidNetworkQueryKeys.surplus(withinDays),
    queryFn: () =>
      fetchQuery("/vendor/aid-network/surplus", {
        method: "GET",
        query: { within_days: withinDays },
      }),
  })

export const useCreateNetworkNode = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      fetchQuery("/vendor/aid-network/nodes", { method: "POST", body: payload }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: aidNetworkQueryKeys.all })
    },
  })
}

export const useRecordIntake = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      fetchQuery("/vendor/aid-network/intake", { method: "POST", body: payload }),
    // Intake creates stock, which changes what is allocatable and what counts
    // as surplus, so the whole tree is invalidated.
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: aidNetworkQueryKeys.all })
    },
  })
}

/**
 * Runs the allocation planner. Read-only on the backend — nothing moves until
 * a transfer is opened from the result.
 */
export const usePlanAllocation = () =>
  useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      fetchQuery("/vendor/aid-network/allocation-plan", {
        method: "POST",
        body: payload,
      }),
  })

export const useRequestTransfer = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      fetchQuery("/vendor/aid-network/transfers", {
        method: "POST",
        body: payload,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: aidNetworkQueryKeys.all })
    },
  })
}

export const useReceiveTransfer = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      transferId,
      ...payload
    }: { transferId: string } & Record<string, unknown>) =>
      fetchQuery(`/vendor/aid-network/transfers/${transferId}/receive`, {
        method: "POST",
        body: payload,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: aidNetworkQueryKeys.all })
    },
  })
}
