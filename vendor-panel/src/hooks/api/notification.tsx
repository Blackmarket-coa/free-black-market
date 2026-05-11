import { QueryKey, UseQueryOptions, useQuery } from "@tanstack/react-query"

import { HttpTypes } from "@medusajs/types"
import { fetchQuery, sdk } from "../../lib/client"
import { queryKeysFactory } from "../../lib/query-key-factory"
import { FetchError } from "@medusajs/js-sdk"

const NOTIFICATION_QUERY_KEY = "notification" as const
export const notificationQueryKeys = queryKeysFactory(NOTIFICATION_QUERY_KEY)

export const useNotification = (
  id: string,
  query?: Record<string, any>,
  options?: Omit<
    UseQueryOptions<
      HttpTypes.AdminNotificationResponse,
      FetchError,
      HttpTypes.AdminNotificationResponse,
      QueryKey
    >,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryKey: notificationQueryKeys.detail(id),
    queryFn: async () => sdk.admin.notification.retrieve(id, query),
    ...options,
  })

  return { ...data, ...rest }
}

export const useNotifications = (
  query?: HttpTypes.AdminNotificationListParams,
  options?: Omit<
    UseQueryOptions<
      HttpTypes.AdminNotificationListResponse,
      FetchError,
      HttpTypes.AdminNotificationListResponse,
      QueryKey
    >,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryFn: () =>
      fetchQuery("/vendor/notifications", {
        method: "GET",
        query: query as Record<string, string | number>,
      }),
    queryKey: notificationQueryKeys.list(query),
    ...options,
  })

  return { ...data, ...rest }
}

export type NotificationBucket = "awaits_me" | "about_me" | "fyi"

export type NotificationBucketsResponse = {
  counts: Record<NotificationBucket, number>
  samples: Record<
    NotificationBucket,
    Array<{
      id: string
      template: string | null
      data: Record<string, unknown> | null
      created_at: string
    }>
  >
}

/**
 * Three-bucket notification counts + per-bucket samples. Backed by
 * `GET /vendor/notifications/buckets`. Refetches on a 30s interval so
 * the bell badge stays accurate without forcing the drawer open.
 */
export const useNotificationBuckets = (
  query?: { limit?: number; since?: string },
  options?: Omit<
    UseQueryOptions<NotificationBucketsResponse, FetchError, NotificationBucketsResponse, QueryKey>,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery<NotificationBucketsResponse, FetchError>({
    queryFn: () =>
      fetchQuery("/vendor/notifications/buckets", {
        method: "GET",
        query: query as Record<string, string | number>,
      }) as Promise<NotificationBucketsResponse>,
    queryKey: [...notificationQueryKeys.lists(), "buckets", query] as QueryKey,
    refetchInterval: 30_000,
    ...options,
  })

  return { data, ...rest }
}
