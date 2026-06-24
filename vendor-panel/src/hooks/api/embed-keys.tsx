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

const EMBED_KEYS_QUERY_KEY = "embed_keys" as const
export const embedKeysQueryKeys = queryKeysFactory(EMBED_KEYS_QUERY_KEY)

export type EmbedKey = {
  id: string
  label: string | null
  masked: string
  last_used_at: string | null
  revoked_at: string | null
  created_at: string
  active: boolean
}

export type EmbedKeysResponse = { keys: EmbedKey[] }

export type CreateEmbedKeyResponse = {
  // Plaintext — surfaced exactly once at creation time.
  key: string
  embed_key: Omit<EmbedKey, "last_used_at" | "revoked_at">
}

/** GET /vendor/embed-keys — this vendor's publishable keys (masked). */
export const useEmbedKeys = (
  options?: Omit<
    UseQueryOptions<EmbedKeysResponse, FetchError>,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryFn: () => fetchQuery("/vendor/embed-keys", { method: "GET" }),
    queryKey: embedKeysQueryKeys.list(),
    ...options,
  })
  return { keys: (data?.keys ?? []) as EmbedKey[], ...rest }
}

/** POST /vendor/embed-keys — create a key; returns plaintext once. */
export const useCreateEmbedKey = (
  options?: UseMutationOptions<
    CreateEmbedKeyResponse,
    FetchError,
    { label?: string }
  >
) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: { label?: string }) =>
      fetchQuery("/vendor/embed-keys", { method: "POST", body }),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({ queryKey: embedKeysQueryKeys.list() })
      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

/** DELETE /vendor/embed-keys/:id — revoke a key. */
export const useRevokeEmbedKey = (
  options?: UseMutationOptions<{ id: string; revoked: boolean }, FetchError, string>
) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      fetchQuery(`/vendor/embed-keys/${id}`, { method: "DELETE" }),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({ queryKey: embedKeysQueryKeys.list() })
      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}
