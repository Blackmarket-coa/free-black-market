import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { sdk } from "@lib/client"
import { queryKeysFactory } from "@lib/query-key-factory"
import type {
  AdminDisputeListParams,
  AdminDisputeListResponse,
  AdminDisputeResponse,
  AdminDisputeUpdateBody,
  AdminDisputeUpdateResponse,
} from "@custom-types/dispute"

/**
 * Buyer disputes (order claims): `GET /admin/disputes`,
 * `GET /admin/disputes/:id` and `PATCH /admin/disputes/:id`.
 *
 * Not Medusa's own order claims (`claims.tsx`), which are the returns-based
 * exchange flow. These are a buyer's complaint against a vendor, filed from
 * the storefront's claim form, and decided here.
 */
export const disputeQueryKeys = queryKeysFactory("order_dispute")

/** No params is the backend's queue: open and under review, oldest first. */
export const useDisputes = (params?: AdminDisputeListParams) => {
  const { data, ...rest } = useQuery({
    queryKey: disputeQueryKeys.list(params ?? { status: "queue" }),
    queryFn: () =>
      sdk.client.fetch<AdminDisputeListResponse>("/admin/disputes", {
        query: params,
      }),
  })

  return { ...rest, disputes: data?.disputes, count: data?.count }
}

export const useDispute = (id: string) => {
  const { data, ...rest } = useQuery({
    queryKey: disputeQueryKeys.detail(id),
    queryFn: () =>
      sdk.client.fetch<AdminDisputeResponse>(`/admin/disputes/${encodeURIComponent(id)}`),
    enabled: !!id,
  })

  return { ...rest, dispute: data?.dispute, events: data?.events }
}

export const useUpdateDispute = (id: string) => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (body: AdminDisputeUpdateBody) =>
      sdk.client.fetch<AdminDisputeUpdateResponse>(`/admin/disputes/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: disputeQueryKeys.detail(id) })
      queryClient.invalidateQueries({ queryKey: disputeQueryKeys.lists() })
    },
  })
}
