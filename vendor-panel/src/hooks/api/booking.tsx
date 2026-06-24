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

const AVAILABILITY_QUERY_KEY = "vendor_availability" as const
export const availabilityQueryKeys = queryKeysFactory(AVAILABILITY_QUERY_KEY)
const BOOKINGS_QUERY_KEY = "vendor_bookings" as const
export const bookingsQueryKeys = queryKeysFactory(BOOKINGS_QUERY_KEY)

export type AvailabilityWindow = {
  id?: string
  day_of_week: number
  start_time: string
  end_time: string
  is_active?: boolean
}

export type Booking = {
  id: string
  product_id: string
  customer_email: string
  customer_name: string | null
  starts_at: string
  ends_at: string
  status: string
  notes: string | null
}

/** GET /vendor/availability */
export const useAvailability = (
  options?: Omit<
    UseQueryOptions<{ availability: AvailabilityWindow[] }, FetchError>,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryFn: () => fetchQuery("/vendor/availability", { method: "GET" }),
    queryKey: availabilityQueryKeys.list(),
    ...options,
  })
  return { availability: (data?.availability ?? []) as AvailabilityWindow[], ...rest }
}

/** POST /vendor/availability — full overwrite of the weekly grid. */
export const useSaveAvailability = (
  options?: UseMutationOptions<
    { availability: AvailabilityWindow[] },
    FetchError,
    AvailabilityWindow[]
  >
) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (windows: AvailabilityWindow[]) =>
      fetchQuery("/vendor/availability", { method: "POST", body: { windows } }),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({ queryKey: availabilityQueryKeys.list() })
      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

/** GET /vendor/bookings */
export const useBookings = (
  status?: string,
  options?: Omit<
    UseQueryOptions<{ bookings: Booking[]; count: number }, FetchError>,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryFn: () =>
      fetchQuery(
        `/vendor/bookings${status ? `?status=${encodeURIComponent(status)}` : ""}`,
        { method: "GET" }
      ),
    queryKey: bookingsQueryKeys.list({ status }),
    ...options,
  })
  return {
    bookings: (data?.bookings ?? []) as Booking[],
    count: data?.count ?? 0,
    ...rest,
  }
}

/** PATCH /vendor/bookings/:id/status */
export const useUpdateBookingStatus = (
  options?: UseMutationOptions<
    { booking: Booking },
    FetchError,
    { id: string; status: string }
  >
) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      fetchQuery(`/vendor/bookings/${id}/status`, {
        method: "PATCH",
        body: { status },
      }),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({ queryKey: bookingsQueryKeys.lists() })
      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}
