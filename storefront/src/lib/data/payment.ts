"use server"

import { sdk } from "../config"
import { offeredAtCheckout } from "@/lib/constants/payment-providers"
import { getAuthHeaders, getCacheOptions } from "./cookies"
import { HttpTypes } from "@medusajs/types"

export const listCartPaymentMethods = async (regionId: string) => {
  const headers = {
    ...(await getAuthHeaders()),
  }

  const next = {
    ...(await getCacheOptions("payment_providers")),
  }

  return sdk.client
    .fetch<HttpTypes.StorePaymentProviderListResponse>(
      `/store/payment-providers`,
      {
        method: "GET",
        query: { region_id: regionId },
        headers,
        next,
        cache: "force-cache",
      }
    )
    .then(({ payment_providers }) =>
      payment_providers
        // Never Medusa's manual provider outside a development build: it
        // places orders that are recorded as paid and never charged
        // (lib/constants/payment-providers.ts).
        .filter((provider) => offeredAtCheckout(provider.id, process.env.NODE_ENV))
        .sort((a, b) => {
          return a.id > b.id ? 1 : -1
        })
    )
    .catch(() => {
      return null
    })
}
