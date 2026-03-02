import { useMutation, useQuery } from "@tanstack/react-query"
import { sdk } from "../../lib/sdk"

export const usePosConfig = () =>
  useQuery({
    queryKey: ["pos-config"],
    queryFn: async () => sdk.client.fetch<any>("/vendor/pos/config"),
  })

export const usePosCheckout = () =>
  useMutation({
    mutationFn: async (payload: any) => sdk.client.fetch<any>("/vendor/pos/checkout", { method: "POST", body: payload }),
  })
