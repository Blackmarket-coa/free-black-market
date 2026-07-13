import { useMutation, useQuery } from "@tanstack/react-query"
import { sdk } from "../../lib/sdk"
import type { PosOrderPayload } from "../../lib/pos-helpers"

export const usePosConfig = () =>
  useQuery({
    queryKey: ["pos-config"],
    queryFn: async () => sdk.client.fetch<any>("/vendor/pos/config"),
  })

export const usePosCheckout = () =>
  useMutation({
    mutationFn: async (payload: any) => sdk.client.fetch<any>("/vendor/pos/checkout", { method: "POST", body: payload }),
  })

export type PosCreateOrderResponse = {
  order: { id: string; display_id?: number; currency_code?: string }
  channel: string
}

/** Ring up an in-person sale as a real `pos`-channel order. */
export const usePosCreateOrder = () =>
  useMutation({
    mutationFn: async (payload: PosOrderPayload) =>
      sdk.client.fetch<PosCreateOrderResponse>("/vendor/pos/orders", {
        method: "POST",
        body: payload,
      }),
  })
