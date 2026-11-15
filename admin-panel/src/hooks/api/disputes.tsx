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
    // Never resent automatically. The app-wide default retries a failed
    // mutation once, whatever the status (lib/query-client.ts), so a 409
    // ("someone else decided this") or a 400 went to the server twice and
    // the operator waited for the second refusal; a decision whose response
    // was lost would be re-sent without anyone choosing to. Found by the
    // browser smoke (e2e/tests/admin-disputes.spec.ts), which counts PATCHes.
    retry: false,
    mutationFn: (body: AdminDisputeUpdateBody) =>
      sdk.client.fetch<AdminDisputeUpdateResponse>(`/admin/disputes/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body,
      }),
    // On a refusal too: a 409 means the case changed on the server (another
    // operator decided it), and the page should show what it is now rather
    // than keep offering a decision that can no longer be made.
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: disputeQueryKeys.detail(id) })
      queryClient.invalidateQueries({ queryKey: disputeQueryKeys.lists() })
    },
  })
}
