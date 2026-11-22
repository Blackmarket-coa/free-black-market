import {
  useIsMutating,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { getAuthToken } from "../../lib/client"
import {
  createProductInStore,
  publishFirstListing,
  readDeliverySetup,
  readSellingSetup,
  recordStock,
  setUpDelivery,
  type DeliverySetup,
  type DeliverySetupInput,
  type DeliverySetupResult,
  type SellingSetup,
} from "../../lib/selling-setup"
import { HttpTypes } from "@medusajs/types"
import { inventoryItemsQueryKeys } from "./inventory"
import { productsQueryKeys } from "./products"
import { shippingOptionsQueryKeys } from "./shipping-options"
import { stockLocationsQueryKeys } from "./stock-locations"

export const sellingSetupQueryKey = ["selling-setup"] as const

/** The keys the screens read to disable a button while its write is in flight. */
export const sellingSetupMutationKeys = {
  listing: ["selling-setup", "listing"] as const,
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
 * The delivery half alone (where stock is held, what buyers can choose), for
 * screens that do not need the listings looked into: the product form.
 */
export const useDeliverySetup = (options?: { enabled?: boolean }) =>
  useQuery<DeliverySetup>({
    queryKey: [...sellingSetupQueryKey, "delivery"],
    queryFn: readDeliverySetup,
    enabled: Boolean(getAuthToken()) && (options?.enabled ?? true),
    staleTime: 0,
    refetchOnMount: "always",
    // The product form sends a vendor with no stock location to set one up
    // in another tab; coming back, the form must see it.
    refetchOnWindowFocus: true,
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

export type CreateProductWithStockInput = {
  payload: HttpTypes.AdminCreateProduct
  /**
   * The quantities the vendor entered for the variants that track stock, and
   * the stock location that holds them. Left out when there is nothing to
   * record: no tracked variant, or no stock location yet.
   */
  stock?: {
    locationId: string
    entries: Array<{ variant_rank: number; quantity: number }>
  }
  /**
   * The vendor chose a new product beside one the store already has under
   * this listing's handle (after `SimilarProductExists`).
   */
  separate?: boolean
}

export type CreateProductWithStockResult = HttpTypes.AdminProductResponse & {
  /**
   * Set when the product was created and its stock was not recorded. The
   * product exists either way, so this resolves rather than rejects: a
   * rejection would invite a second attempt and a second product.
   */
  stockError?: Error
}

/**
 * Create a product and record how many of it are in stock: what the product
 * form and the launch wizard's listing step both do.
 *
 * It creates with `createProductInStore` (`POST /vendor/seller-products`,
 * with a handle of the store's own, and the product a lost answer made is
 * found again rather than made twice), then writes the levels with
 * `recordStock`. It is one mutation, so its key covers the whole of it: a
 * second press while either request is in flight is the same press.
 */
export const useCreateProductWithStock = () => {
  const client = useQueryClient()

  return useMutation<
    CreateProductWithStockResult,
    Error,
    CreateProductWithStockInput
  >({
    mutationKey: sellingSetupMutationKeys.listing,
    // A `SimilarProductExists` rejection writes no stock: the vendor chooses.
    mutationFn: async ({ payload, stock, separate }) => {
      const created = (await createProductInStore(
        payload as unknown as Parameters<typeof createProductInStore>[0],
        { separate }
      )) as unknown as HttpTypes.AdminProductResponse
      if (!stock || stock.entries.length === 0) {
        return created
      }
      try {
        await recordStock({
          productId: created.product.id,
          locationId: stock.locationId,
          stock: stock.entries,
        })
        return created
      } catch (error) {
        return {
          ...created,
          stockError:
            error instanceof Error ? error : new Error("Unknown error"),
        }
      }
    },
    onSettled: () => {
      client.invalidateQueries({ queryKey: sellingSetupQueryKey })
      client.invalidateQueries({ queryKey: productsQueryKeys.lists() })
      client.invalidateQueries({ queryKey: inventoryItemsQueryKeys.all })
    },
  })
}
