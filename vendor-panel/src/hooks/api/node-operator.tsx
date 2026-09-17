import {
  UseMutationOptions,
  UseQueryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"

import { FetchError } from "@medusajs/js-sdk"
import { fetchQuery } from "../../lib/client"
import { queryKeysFactory } from "../../lib/query-key-factory"

const NODE_OPERATOR_QUERY_KEY = "node_operator" as const
export const nodeOperatorQueryKeys = queryKeysFactory(NODE_OPERATOR_QUERY_KEY)

export type NodeOperatorCredential = {
  key_id: string
  status: string
  issued_at: string | null
  revoked_at: string | null
}

export type NodeOperatorState = {
  opted_in: boolean
  credential: NodeOperatorCredential | null
  /** Plaintext — returned exactly once, when opting in. */
  secret?: string | null
  provisioned?: boolean
}

export type NodeOperatorResponse = { node_operator: NodeOperatorState }

/** GET /vendor/node-operator — opt-in state and the credential's key id. */
export const useNodeOperator = (
  options?: Omit<
    UseQueryOptions<NodeOperatorResponse, FetchError, NodeOperatorResponse>,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryKey: nodeOperatorQueryKeys.details(),
    queryFn: async () =>
      (await fetchQuery("/vendor/node-operator", {
        method: "GET",
      })) as NodeOperatorResponse,
    ...options,
  })
  return { ...data, ...rest }
}

/**
 * POST /vendor/node-operator — turn node operating on or off.
 *
 * Turning it on returns the credential secret once, in the response. It is
 * never readable again, so the caller must surface it immediately.
 */
export const useSetNodeOperatorOptIn = (
  options?: UseMutationOptions<NodeOperatorResponse, FetchError, { opted_in: boolean }>
) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (payload) =>
      (await fetchQuery("/vendor/node-operator", {
        method: "POST",
        body: payload,
      })) as NodeOperatorResponse,
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({ queryKey: nodeOperatorQueryKeys.all })
      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}
