import {
  QueryKey,
  UseMutationOptions,
  UseQueryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { fetchQuery } from "../../lib/client"

// ===========================================
// TYPES
// ===========================================

export interface DeliveryZone {
  id: string
  name: string
  code: string
  boundary: {
    type: "Polygon"
    coordinates: number[][][]
  }
  center_latitude: number
  center_longitude: number
  base_delivery_fee: number // In cents
  per_mile_fee: number // In cents
  minimum_order: number | null // In cents
  service_hours: Record<string, { open: string; close: string }> | null
  active: boolean
  priority: number
  created_at: string
  updated_at: string
}

export interface CreateDeliveryZoneInput {
  name: string
  code: string
  boundary: {
    type: "Polygon"
    coordinates: number[][][]
  }
  center_latitude: number
  center_longitude: number
  radius_miles?: number
  base_delivery_fee: number // In dollars (will be converted to cents)
  per_mile_fee: number // In dollars
  minimum_order?: number // In dollars
  service_hours?: Record<string, { open: string; close: string }>
  active?: boolean
  priority?: number
}

export interface UpdateDeliveryZoneInput {
  name?: string
  boundary?: {
    type: "Polygon"
    coordinates: number[][][]
  }
  center_latitude?: number
  center_longitude?: number
  radius_miles?: number
  base_delivery_fee?: number
  per_mile_fee?: number
  minimum_order?: number | null
  service_hours?: Record<string, { open: string; close: string }> | null
  active?: boolean
  priority?: number
}

interface ListDeliveryZonesResponse {
  zones: DeliveryZone[]
  count: number
  limit: number
  offset: number
}

// ===========================================
// QUERY KEYS
// ===========================================

export const deliveryZonesQueryKeys = {
  all: ["delivery-zones"] as const,
  lists: () => [...deliveryZonesQueryKeys.all, "list"] as const,
  list: (query?: Record<string, any>) =>
    [...deliveryZonesQueryKeys.lists(), query] as const,
  details: () => [...deliveryZonesQueryKeys.all, "detail"] as const,
  detail: (id: string) => [...deliveryZonesQueryKeys.details(), id] as const,
}

// ===========================================
// API FUNCTIONS
// ===========================================

async function listDeliveryZones(
  query?: { active?: boolean; limit?: number; offset?: number }
): Promise<ListDeliveryZonesResponse> {
  const response = await fetchQuery("/vendor/delivery-zones", {
    method: "GET",
    query: query as Record<string, string | number>,
  })
  return response
}

async function getDeliveryZone(id: string): Promise<{ zone: DeliveryZone }> {
  const response = await fetchQuery(`/vendor/delivery-zones/${id}`, {
    method: "GET",
  })
  return response
}

async function createDeliveryZone(
  data: CreateDeliveryZoneInput
): Promise<{ zone: DeliveryZone }> {
  const response = await fetchQuery("/vendor/delivery-zones", {
    method: "POST",
    body: data,
  })
  return response
}

async function updateDeliveryZone(
  id: string,
  data: UpdateDeliveryZoneInput
): Promise<{ zone: DeliveryZone }> {
  const response = await fetchQuery(`/vendor/delivery-zones/${id}`, {
    method: "POST",
    body: data,
  })
  return response
}

async function deleteDeliveryZone(id: string): Promise<void> {
  await fetchQuery(`/vendor/delivery-zones/${id}`, {
    method: "DELETE",
  })
}

// ===========================================
// HOOKS
// ===========================================

/**
 * List delivery zones
 */
export function useDeliveryZones(
  query?: { active?: boolean; limit?: number; offset?: number },
  options?: Omit<
    UseQueryOptions<
      ListDeliveryZonesResponse,
      Error,
      ListDeliveryZonesResponse,
      QueryKey
    >,
    "queryKey" | "queryFn"
  >
) {
  return useQuery({
    queryKey: deliveryZonesQueryKeys.list(query),
    queryFn: () => listDeliveryZones(query),
    ...options,
  })
}

/**
 * Get single delivery zone
 */
export function useDeliveryZone(
  id: string,
  options?: Omit<
    UseQueryOptions<
      { zone: DeliveryZone },
      Error,
      { zone: DeliveryZone },
      QueryKey
    >,
    "queryKey" | "queryFn"
  >
) {
  return useQuery({
    queryKey: deliveryZonesQueryKeys.detail(id),
    queryFn: () => getDeliveryZone(id),
    enabled: !!id,
    ...options,
  })
}

/**
 * Create delivery zone
 */
export function useCreateDeliveryZone(
  options?: UseMutationOptions<
    { zone: DeliveryZone },
    Error,
    CreateDeliveryZoneInput
  >
) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: createDeliveryZone,
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({
        queryKey: deliveryZonesQueryKeys.lists(),
      })
      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

/**
 * Update delivery zone
 */
export function useUpdateDeliveryZone(
  id: string,
  options?: UseMutationOptions<
    { zone: DeliveryZone },
    Error,
    UpdateDeliveryZoneInput
  >
) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data) => updateDeliveryZone(id, data),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({
        queryKey: deliveryZonesQueryKeys.detail(id),
      })
      queryClient.invalidateQueries({
        queryKey: deliveryZonesQueryKeys.lists(),
      })
      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

/**
 * Delete delivery zone
 */
export function useDeleteDeliveryZone(
  options?: UseMutationOptions<void, Error, string>
) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: deleteDeliveryZone,
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({
        queryKey: deliveryZonesQueryKeys.lists(),
      })
      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}
