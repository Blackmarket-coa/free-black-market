import type { FetchError } from "@medusajs/js-sdk"
import type { HttpTypes } from "@medusajs/types"
import type { QueryKey, UseQueryOptions} from "@tanstack/react-query";
import { useQuery } from "@tanstack/react-query"
import { sdk } from "../../lib/client"
import { queryKeysFactory } from "../../lib/query-key-factory"

const PLUGINS_QUERY_KEY = "plugins" as const
export const pluginsQueryKeys = queryKeysFactory(PLUGINS_QUERY_KEY)

export const usePlugins = (
  options?: Omit<
    UseQueryOptions<
      any,
      FetchError,
      HttpTypes.AdminPluginsListResponse,
      QueryKey
    >,
    "queryKey" | "queryFn"
  >
) => {
  const { data, ...rest } = useQuery({
    queryFn: () => sdk.admin.plugin.list(),
    queryKey: pluginsQueryKeys.list(),
    ...options,
  })

  return { ...data, ...rest }
}
