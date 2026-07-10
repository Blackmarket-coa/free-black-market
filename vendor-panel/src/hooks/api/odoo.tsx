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

const ODOO_CONNECTION_KEY = "odoo_connection" as const
export const odooConnectionQueryKeys = queryKeysFactory(ODOO_CONNECTION_KEY)

const ODOO_PREVIEW_KEY = "odoo_preview" as const
export const odooPreviewQueryKeys = queryKeysFactory(ODOO_PREVIEW_KEY)

const ODOO_IMPORT_KEY = "odoo_import" as const
export const odooImportQueryKeys = queryKeysFactory(ODOO_IMPORT_KEY)

// --- Connection ---

export const useOdooConnection = (
  options?: Omit<UseQueryOptions<any, FetchError, any>, "queryKey" | "queryFn">
) => {
  const { data, ...rest } = useQuery({
    queryFn: () => fetchQuery("/vendor/odoo/connection", { method: "GET" }),
    queryKey: odooConnectionQueryKeys.details(),
    ...options,
  })
  return { ...data, ...rest }
}

export const useConnectOdoo = (
  options?: UseMutationOptions<
    any,
    FetchError,
    { url: string; db_name: string; username: string; api_key: string }
  >
) => {
  return useMutation({
    mutationFn: (payload) =>
      fetchQuery("/vendor/odoo/connection", { method: "POST", body: payload }),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({ queryKey: odooConnectionQueryKeys.all })
      queryClient.invalidateQueries({ queryKey: odooPreviewQueryKeys.all })
      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

export const useDisconnectOdoo = (
  options?: UseMutationOptions<any, FetchError, void>
) => {
  return useMutation({
    mutationFn: () =>
      fetchQuery("/vendor/odoo/connection", { method: "DELETE" }),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({ queryKey: odooConnectionQueryKeys.all })
      queryClient.invalidateQueries({ queryKey: odooPreviewQueryKeys.all })
      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

// --- Preview ---

export const useOdooPreview = (
  options?: Omit<UseQueryOptions<any, FetchError, any>, "queryKey" | "queryFn">
) => {
  const { data, ...rest } = useQuery({
    queryFn: () => fetchQuery("/vendor/odoo/preview", { method: "GET" }),
    queryKey: odooPreviewQueryKeys.details(),
    ...options,
  })
  return { ...data, ...rest }
}

// --- Import ---

export const useOdooImport = (
  options?: UseMutationOptions<any, FetchError, { import_as_draft?: boolean }>
) => {
  return useMutation({
    mutationFn: (payload) =>
      fetchQuery("/vendor/odoo/import", { method: "POST", body: payload }),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({ queryKey: odooImportQueryKeys.all })
      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

export const useOdooImportHistory = (
  options?: Omit<UseQueryOptions<any, FetchError, any>, "queryKey" | "queryFn">
) => {
  const { data, ...rest } = useQuery({
    queryFn: () => fetchQuery("/vendor/odoo/import", { method: "GET" }),
    queryKey: odooImportQueryKeys.lists(),
    ...options,
  })
  return { ...data, ...rest }
}
