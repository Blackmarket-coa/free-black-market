import { FetchError } from "@medusajs/js-sdk"
import {
  useMutation,
  UseMutationOptions,
  useQuery,
  UseQueryOptions,
} from "@tanstack/react-query"
import { fetchQuery } from "../../lib/client"
import { queryClient } from "../../lib/query-client"
import { queryKeysFactory } from "../../lib/query-key-factory"

const WOO_CONNECTION_KEY = "woo_connection" as const
export const wooConnectionQueryKeys = queryKeysFactory(WOO_CONNECTION_KEY)

const WOO_PREVIEW_KEY = "woo_preview" as const
export const wooPreviewQueryKeys = queryKeysFactory(WOO_PREVIEW_KEY)

const WOO_IMPORT_KEY = "woo_import" as const
export const wooImportQueryKeys = queryKeysFactory(WOO_IMPORT_KEY)

// --- Connection ---

export const useWooConnection = (
  options?: Omit<UseQueryOptions<any, FetchError, any>, "queryKey" | "queryFn">
) => {
  const { data, ...rest } = useQuery({
    queryFn: () =>
      fetchQuery("/vendor/woocommerce/connection", { method: "GET" }),
    queryKey: wooConnectionQueryKeys.details(),
    ...options,
  })
  return { ...data, ...rest }
}

export const useConnectWooCommerce = (
  options?: UseMutationOptions<
    any,
    FetchError,
    { store_url: string; consumer_key: string; consumer_secret: string }
  >
) => {
  return useMutation({
    mutationFn: (payload) =>
      fetchQuery("/vendor/woocommerce/connection", {
        method: "POST",
        body: payload,
      }),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({
        queryKey: wooConnectionQueryKeys.all,
      })
      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

export const useDisconnectWooCommerce = (
  options?: UseMutationOptions<any, FetchError, void>
) => {
  return useMutation({
    mutationFn: () =>
      fetchQuery("/vendor/woocommerce/connection", { method: "DELETE" }),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({
        queryKey: wooConnectionQueryKeys.all,
      })
      queryClient.invalidateQueries({
        queryKey: wooPreviewQueryKeys.all,
      })
      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

// --- Preview ---

export const useWooPreview = (
  options?: Omit<UseQueryOptions<any, FetchError, any>, "queryKey" | "queryFn">
) => {
  const { data, ...rest } = useQuery({
    queryFn: () =>
      fetchQuery("/vendor/woocommerce/preview", { method: "GET" }),
    queryKey: wooPreviewQueryKeys.details(),
    ...options,
  })
  return { ...data, ...rest }
}

// --- Import ---

export const useWooImport = (
  options?: UseMutationOptions<
    any,
    FetchError,
    { import_as_draft?: boolean; enable_inventory_sync?: boolean }
  >
) => {
  return useMutation({
    mutationFn: (payload) =>
      fetchQuery("/vendor/woocommerce/import", {
        method: "POST",
        body: payload,
      }),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({
        queryKey: wooImportQueryKeys.all,
      })
      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

export const useWooImportHistory = (
  options?: Omit<UseQueryOptions<any, FetchError, any>, "queryKey" | "queryFn">
) => {
  const { data, ...rest } = useQuery({
    queryFn: () =>
      fetchQuery("/vendor/woocommerce/import", { method: "GET" }),
    queryKey: wooImportQueryKeys.lists(),
    ...options,
  })
  return { ...data, ...rest }
}

// --- Sync ---


export const useWooSyncStatus = (
  options?: Omit<UseQueryOptions<any, FetchError, any>, "queryKey" | "queryFn">
) => {
  const { data, ...rest } = useQuery({
    queryFn: () => fetchQuery("/vendor/woocommerce/sync", { method: "GET" }),
    queryKey: wooConnectionQueryKeys.detail("sync-status"),
    ...options,
  })

  return { ...data, ...rest }
}

export const useWooSync = (
  options?: UseMutationOptions<any, FetchError, void>
) => {
  return useMutation({
    mutationFn: () =>
      fetchQuery("/vendor/woocommerce/sync", { method: "POST" }),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({
        queryKey: wooConnectionQueryKeys.all,
      })
      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}
