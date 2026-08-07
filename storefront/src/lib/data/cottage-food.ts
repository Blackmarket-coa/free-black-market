import { sdk } from "../config"
import type { HomeKitchenDisclosureData } from "@/components/molecules/HomeKitchenDisclosure/HomeKitchenDisclosure"

/**
 * Home-kitchen disclosure for a food producer.
 *
 * Returns null when the producer has no cottage-food profile or hasn't opted
 * into publishing one — the backend already withholds anything unpublished, so
 * a null here means "nothing to show", not "request failed". Errors resolve to
 * null as well: a missing disclosure block should never take a product page
 * down with it.
 */
export const getHomeKitchenDisclosure = async (
  producerHandle: string
): Promise<HomeKitchenDisclosureData | null> => {
  if (!producerHandle) return null

  return sdk.client
    .fetch<{ disclosure: HomeKitchenDisclosureData | null }>(
      `/store/cottage-food/producers/${producerHandle}/disclosure`,
      { cache: "no-cache" }
    )
    .then(({ disclosure }) => disclosure ?? null)
    .catch(() => null)
}
