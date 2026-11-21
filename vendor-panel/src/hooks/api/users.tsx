import { FetchError } from "@medusajs/js-sdk"
import { HttpTypes } from "@medusajs/types"
import {
  QueryClient,
  QueryKey,
  UseMutationOptions,
  UseQueryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import {
  backendUrl,
  clearAuthToken,
  fetchQuery,
  getAuthToken,
  getAuthTokenPayload,
} from "../../lib/client"
import { queryClient } from "../../lib/query-client"
import { queryKeysFactory } from "../../lib/query-key-factory"
import {
  TokenRefreshFailed,
  upgradeApprovedSellerToken,
} from "../../lib/seller-token"
import { StoreVendor, TeamMemberProps } from "../../types/user"

const USERS_QUERY_KEY = "users" as const
export const usersQueryKeys = {
  ...queryKeysFactory(USERS_QUERY_KEY),
  me: () => [USERS_QUERY_KEY, "me"],
  registrationStatus: () => [USERS_QUERY_KEY, "registration-status"],
  session: () => [USERS_QUERY_KEY, "session"],
}

/**
 * Registration status response from the backend
 */
export interface RegistrationStatusResponse {
  status: "approved" | "pending" | "rejected" | "cancelled" | "no_request" | "unauthenticated" | "unknown" | "error"
  seller_id?: string
  seller?: {
    id: string
    store_status?: "ACTIVE" | "SUSPENDED" | "INACTIVE" | null
  }
  store_status?: "ACTIVE" | "SUSPENDED" | "INACTIVE" | null
  request_id?: string
  message: string
  created_at?: string
  reviewer_note?: string
}

export interface SellerSessionResponse {
  registration_status: RegistrationStatusResponse
  seller: StoreVendor | null
}

export const fetchRegistrationStatus = async (
  token: string
): Promise<RegistrationStatusResponse> => {
  const response = await fetch(`${backendUrl}/auth/seller/registration-status`, {
    method: "GET",
    credentials: "include",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  })

  if (!response.ok) {
    const body = await response.json().catch(() => ({ message: response.statusText }))
    const error: any = new Error(body.message || `Request failed with status ${response.status}`)
    error.status = response.status
    error.retry_after = body.retry_after
    throw error
  }

  const result = await response.json()
  return result as RegistrationStatusResponse
}

export const fetchSellerSession = async (
  token: string
): Promise<SellerSessionResponse> => {
  const response = await fetch(`${backendUrl}/auth/seller/session`, {
    method: "GET",
    credentials: "include",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  })

  if (!response.ok) {
    const body = await response.json().catch(() => ({ message: response.statusText }))
    const error: any = new Error(body.message || `Request failed with status ${response.status}`)
    error.status = response.status
    error.retry_after = body.retry_after
    throw error
  }

  const result = await response.json()
  return result as SellerSessionResponse
}

/** The backend says this login's store is approved and names it. */
const isApprovedSeller = (status: RegistrationStatusResponse | undefined) =>
  status?.status === "approved" && Boolean(status.seller_id)

/**
 * Called by every read that has just learnt the store is approved: a token
 * stored at sign-up names no actor, so it is refreshed once before any
 * `/vendor/*` call is made with it (lib/seller-token.ts). Rejects with
 * `TokenRefreshFailed` when the backend refused the refresh, which the
 * protected layout and the pending-approval page answer by signing the vendor
 * out to the login page with its message; and with `TokenRefreshUnavailable`
 * when it got no usable answer (a 429, a 5xx, the network), which both show
 * with a way to try again.
 */
const upgradeTokenOnApproval = async (
  status: RegistrationStatusResponse | undefined
) => {
  if (
    isApprovedSeller(status) &&
    (await upgradeApprovedSellerToken()) === "sign_in_again"
  ) {
    throw new TokenRefreshFailed()
  }
}

export const hydrateSellerSessionCache = (
  queryClient: QueryClient,
  session: SellerSessionResponse
) => {
  queryClient.setQueryData(
    usersQueryKeys.registrationStatus(),
    session.registration_status
  )

  if (session.seller) {
    queryClient.setQueryData(usersQueryKeys.me(), { seller: session.seller })
  }
}

/**
 * Hook to check the registration status of the current user.
 * This is useful for determining if a user's seller account is:
 * - approved (can access dashboard)
 * - pending (waiting for admin approval)
 * - rejected/cancelled (needs to re-register or contact support)
 * - no_request (needs to complete registration)
 */
export const useRegistrationStatus = (
  options?: Omit<
    UseQueryOptions<RegistrationStatusResponse, Error, RegistrationStatusResponse, QueryKey>,
    "queryFn" | "queryKey"
  >
) => {
  const queryClient = useQueryClient()

  const { data, ...rest } = useQuery({
    queryFn: async (): Promise<RegistrationStatusResponse> => {
      const token = getAuthToken()
      if (!token) {
        return {
          status: "unauthenticated",
          message: "No authentication token found.",
        }
      }

      const status = await fetchRegistrationStatus(token)
      await upgradeTokenOnApproval(status)

      // The protected layout reads the session, cached for ten minutes and
      // not refetched on mount. One cached before this status changed (the
      // pending applicant who presses "Check Status" after approval) would
      // send the vendor back here while this page sends them to the
      // dashboard, so it is dropped and the layout reads it afresh.
      const cachedSession = queryClient.getQueryData<SellerSessionResponse>(
        usersQueryKeys.session()
      )
      if (
        cachedSession &&
        cachedSession.registration_status?.status !== status.status
      ) {
        queryClient.removeQueries({
          queryKey: usersQueryKeys.session(),
          exact: true,
        })
      }

      return status
    },
    queryKey: usersQueryKeys.registrationStatus(),
    // Don't refetch too often
    staleTime: 30000, // 30 seconds
    // Don't retry on error - status endpoint handles all cases
    retry: false,
    ...options,
  })

  return {
    registrationStatus: data,
    ...rest,
  }
}

export const useSellerSession = (
  options?: Omit<
    UseQueryOptions<SellerSessionResponse, Error, SellerSessionResponse, QueryKey>,
    "queryFn" | "queryKey"
  >
) => {
  const queryClient = useQueryClient()

  const { data, ...rest } = useQuery({
    queryFn: async (): Promise<SellerSessionResponse> => {
      const token = getAuthToken()
      if (!token) {
        return {
          registration_status: {
            status: "unauthenticated",
            message: "No authentication token found.",
          },
          seller: null,
        }
      }

      const session = await fetchSellerSession(token)
      await upgradeTokenOnApproval(session.registration_status)
      hydrateSellerSessionCache(queryClient, session)
      return session
    },
    queryKey: usersQueryKeys.session(),
    staleTime: 30000,
    retry: false,
    ...options,
  })

  return {
    session: data,
    ...rest,
  }
}

export const useMe = (
  options?: UseQueryOptions<
    HttpTypes.AdminUserResponse,
    FetchError,
    HttpTypes.AdminUserResponse & {
      seller: StoreVendor
    },
    QueryKey
  >
) => {
  const queryClient = useQueryClient()

  const { data, ...rest } = useQuery({
    queryFn: async () => {
      const token = getAuthToken()
      if (!token) {
        return null
      }

      const cachedStatus = queryClient.getQueryData<RegistrationStatusResponse>(
        usersQueryKeys.registrationStatus()
      )
      const status = cachedStatus ?? (await fetchRegistrationStatus(token))
      if (status.status !== "approved" || !status.seller_id) {
        return null
      }
      // This runs at the app's root, beside the protected layout's session
      // read: never call /vendor with a token that names no actor.
      if ((await upgradeApprovedSellerToken()) === "sign_in_again") {
        return null
      }

      const payload = getAuthTokenPayload()
      const actorType = payload?.actor_type
      if (actorType && actorType !== "seller") {
        clearAuthToken()
        return null
      }

      return fetchQuery("/vendor/sellers/me", {
        method: "GET",
        query: {
          fields:
            "id,name,handle,description,phone,email,media,address_line,postal_code,country_code,city,metadata,tax_id,photo,store_status,website_url,social_links,storefront_links,certifications,vendor_type,enabled_extensions",
        },
      })
    },
    queryKey: usersQueryKeys.me(),
    retry: false,
    ...options,
  })

  return {
    seller: data?.seller,
    ...rest,
  }
}

export const useUpdateMe = (
  options?: UseMutationOptions<
    HttpTypes.AdminUserResponse,
    FetchError,
    StoreVendor,
    QueryKey
  >
) => {
  return useMutation({
    mutationFn: async (body) => {
      const normalizedBody: Record<string, unknown> = {
        ...(body as Record<string, unknown>),
      }

      try {
        return await fetchQuery("/vendor/sellers/me", {
          method: "POST",
          body: normalizedBody,
        })
      } catch (error) {
        const metadata = normalizedBody.metadata
        const metadataRecord =
          metadata && typeof metadata === "object" && !Array.isArray(metadata)
            ? (metadata as Record<string, unknown>)
            : undefined

        const enabledExtensionsValue =
          normalizedBody.enabled_extensions ?? metadataRecord?.enabled_extensions

        const hasEnabledExtensionsField =
          Array.isArray(enabledExtensionsValue) || enabledExtensionsValue === null

        if (!hasEnabledExtensionsField) {
          throw error
        }

        const errorMessage =
          error && typeof error === "object" && "message" in error
            ? String((error as { message?: string }).message ?? "")
            : ""

        const lowerErrorMessage = errorMessage.toLowerCase()
        const mentionsMetadata = lowerErrorMessage.includes("metadata")
        const mentionsEnabledExtensions = lowerErrorMessage.includes("enabled_extensions")

        if (!mentionsMetadata && !mentionsEnabledExtensions) {
          throw error
        }

        const hasTopLevelEnabledExtensions =
          normalizedBody.enabled_extensions !== undefined

        const fallbackToTopLevel =
          !hasTopLevelEnabledExtensions || mentionsMetadata

        const fallbackBody: Record<string, unknown> = { ...normalizedBody }

        if (fallbackToTopLevel) {
          fallbackBody.enabled_extensions = enabledExtensionsValue
          delete fallbackBody.metadata
        } else {
          fallbackBody.metadata = {
            ...(metadataRecord ?? {}),
            enabled_extensions: enabledExtensionsValue,
          }
          delete fallbackBody.enabled_extensions
        }

        return fetchQuery("/vendor/sellers/me", {
          method: "POST",
          body: fallbackBody,
        })
      }
    },
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({
        queryKey: usersQueryKeys.lists(),
      })

      queryClient.invalidateQueries({
        queryKey: usersQueryKeys.me(),
      })

      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

export const useUpdateMyEnabledExtensions = (
  options?: UseMutationOptions<
    HttpTypes.AdminUserResponse,
    FetchError,
    { enabled_extensions: string[] | null },
    QueryKey
  >
) => {
  return useMutation({
    mutationFn: (body) => {
      return fetchQuery("/vendor/sellers/me/extensions", {
        method: "POST",
        body,
      })
    },
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({
        queryKey: usersQueryKeys.lists(),
      })

      queryClient.invalidateQueries({
        queryKey: usersQueryKeys.me(),
      })

      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

export const useOnboarding = () => {
  const queryClient = useQueryClient()
  const { data, ...rest } = useQuery({
    queryFn: async () => {
      const token = getAuthToken()
      if (!token) {
        return undefined
      }

      const cachedStatus = queryClient.getQueryData<RegistrationStatusResponse>(
        usersQueryKeys.registrationStatus()
      )
      const status = cachedStatus ?? (await fetchRegistrationStatus(token))
      if (status.status !== "approved" || !status.seller_id) {
        return undefined
      }
      if ((await upgradeApprovedSellerToken()) === "sign_in_again") {
        return undefined
      }

      return fetchQuery("/vendor/sellers/me/onboarding", {
        method: "GET",
      })
    },
    queryKey: ["onboarding"],
    staleTime: 0,
    enabled: Boolean(getAuthToken()),
  })

  return {
    ...(data ?? {}),
    ...rest,
  }
}

export const useUpdateOnboarding = () => {
  return useMutation({
    mutationFn: () =>
      fetchQuery("/vendor/sellers/me/onboarding", {
        method: "POST",
        body: {},
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["onboarding"],
      })
    },
  })
}

export const useUserMe = (
  query?: HttpTypes.AdminUserParams,
  options?: Omit<
    UseQueryOptions<
      HttpTypes.AdminUserResponse,
      FetchError,
      HttpTypes.AdminUserResponse & {
        member: TeamMemberProps
      },
      QueryKey
    >,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryFn: () =>
      fetchQuery(`/vendor/me`, {
        method: "GET",
        query: query as { [key: string]: string | number },
      }),
    queryKey: [USERS_QUERY_KEY, "user", "me"],
    ...options,
  })

  return { ...data, ...rest }
}

export const useStatistics = ({ from, to }: { from: string; to: string }) => {
  const { data, ...rest } = useQuery({
    queryFn: () =>
      fetchQuery(
        `/vendor/statistics?time_from=${from}T00:00:00Z&time_to=${to}T23:59:59Z`,
        {
          method: "GET",
        }
      ),
    queryKey: [USERS_QUERY_KEY, "statistics", from, to],
  })

  return { ...data, ...rest }
}

export const useUser = (
  id: string,
  query?: HttpTypes.AdminUserParams,
  options?: Omit<
    UseQueryOptions<
      HttpTypes.AdminUserResponse,
      FetchError,
      HttpTypes.AdminUserResponse & {
        member: TeamMemberProps
      },
      QueryKey
    >,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryFn: () =>
      fetchQuery(`/vendor/members/${id}`, {
        method: "GET",
        query: query as { [key: string]: string | number },
      }),
    queryKey: usersQueryKeys.detail(id),
    ...options,
  })

  return { ...data, ...rest }
}

export const useUsers = (
  query?: HttpTypes.AdminUserListParams,
  options?: Omit<
    UseQueryOptions<
      HttpTypes.AdminUserListResponse,
      FetchError,
      HttpTypes.AdminUserListResponse & { members: any[] },
      QueryKey
    >,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryFn: () =>
      fetchQuery("/vendor/members", {
        method: "GET",
        query: query as { [key: string]: string | number },
      }),
    queryKey: usersQueryKeys.list(query),
    ...options,
  })

  return { ...data, ...rest }
}

export const useUpdateUser = (
  id: string,
  options?: UseMutationOptions<
    TeamMemberProps,
    FetchError,
    {
      name?: string
      photo?: string
      language?: string
      phone?: string
      bio?: string
      metadata?: Record<string, unknown>
    },
    QueryKey
  >
) => {
  return useMutation({
    mutationFn: (body) =>
      fetchQuery(`/vendor/members/${id}`, {
        method: "POST",
        body,
      }),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({
        queryKey: usersQueryKeys.detail(id),
      })
      queryClient.invalidateQueries({
        queryKey: usersQueryKeys.lists(),
      })

      // We invalidate the me query in case the user updates their own profile
      queryClient.invalidateQueries({
        queryKey: [USERS_QUERY_KEY, "user", "me"],
      })

      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

export const useDeleteUser = (
  id: string,
  options?: UseMutationOptions<
    HttpTypes.AdminUserDeleteResponse,
    FetchError,
    void
  >
) => {
  return useMutation({
    mutationFn: () =>
      fetchQuery(`/vendor/members/${id}`, {
        method: "DELETE",
      }),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({
        queryKey: usersQueryKeys.detail(id),
      })
      queryClient.invalidateQueries({
        queryKey: usersQueryKeys.lists(),
      })

      // We invalidate the me query in case the user updates their own profile
      queryClient.invalidateQueries({
        queryKey: usersQueryKeys.me(),
      })

      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}
