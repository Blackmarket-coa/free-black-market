import {
  useIsMutating,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { getAuthToken } from "../../lib/client"
import {
  publishFirstListing,
  readSellingSetup,
  recordStock,
  setUpDelivery,
  type DeliverySetupInput,
  type DeliverySetupResult,
  type SellingSetup,
} from "../../lib/selling-setup"
import { inventoryItemsQueryKeys } from "./inventory"
import { productsQueryKeys } from "./products"
import { shippingOptionsQueryKeys } from "./shipping-options"
import { stockLocationsQueryKeys } from "./stock-locations"

export const sellingSetupQueryKey = ["selling-setup"] as const

/** The keys the screens read to disable a button while its write is in flight. */
export const sellingSetupMutationKeys = {
  delivery: ["selling-setup", "delivery"] as const,
  stock: ["selling-setup", "stock"] as const,
  publish: ["selling-setup", "publish"] as const,
}

/**
 * Whether a buyer could check out from this store now, and what is missing
 * (lib/selling-setup.ts). Read afresh whenever a screen opens: it decides
 * whether the dashboard says setup is done.
 */
export const useSellingSetup = (options?: { enabled?: boolean }) =>
  useQuery<SellingSetup>({
    queryKey: sellingSetupQueryKey,
    queryFn: readSellingSetup,
    enabled: Boolean(getAuthToken()) && (options?.enabled ?? true),
    staleTime: 0,
    refetchOnMount: "always",
    retry: false,
  })

/**
 * A write to one of the keys above is in flight. Read from the mutation cache,
 * so it holds for every button on the page and for a second click that lands
 * before the page has re-rendered.
 */
export const useIsBusy = (mutationKey: readonly unknown[]) => {
  const client = useQueryClient()
  const pending = useIsMutating({ mutationKey }) > 0
  return {
    pending,
    /** Checked inside a click handler, where `pending` may be a render old. */
    isBusyNow: () => client.isMutating({ mutationKey }) > 0,
  }
}

/** The guided delivery setup: see `setUpDelivery`. */
export const useSetUpDelivery = () => {
  const client = useQueryClient()
  return useMutation<DeliverySetupResult, Error, DeliverySetupInput>({
    mutationKey: sellingSetupMutationKeys.delivery,
    mutationFn: setUpDelivery,
    // Whatever was made before a step failed is there too.
    onSettled: () => {
      client.invalidateQueries({ queryKey: sellingSetupQueryKey })
      client.invalidateQueries({ queryKey: stockLocationsQueryKeys.all })
      client.invalidateQueries({ queryKey: shippingOptionsQueryKeys.all })
      client.invalidateQueries({ queryKey: ["onboarding"] })
    },
  })
}

/** Set a product's stock at a location: see `recordStock`. */
export const useRecordStock = () => {
  const client = useQueryClient()
  return useMutation({
    mutationKey: sellingSetupMutationKeys.stock,
    mutationFn: recordStock,
    onSettled: () => {
      client.invalidateQueries({ queryKey: sellingSetupQueryKey })
      client.invalidateQueries({ queryKey: inventoryItemsQueryKeys.all })
    },
  })
}

/** Publish the store's first listing: see `publishFirstListing`. */
export const usePublishFirstListing = () => {
  const client = useQueryClient()
  return useMutation({
    mutationKey: sellingSetupMutationKeys.publish,
    mutationFn: publishFirstListing,
    onSettled: () => {
      client.invalidateQueries({ queryKey: sellingSetupQueryKey })
      client.invalidateQueries({ queryKey: productsQueryKeys.all })
      client.invalidateQueries({ queryKey: ["onboarding"] })
    },
  })
}
