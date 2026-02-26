import { useMutation } from "@tanstack/react-query"
import { sdk } from "../../lib/client"

export type VendorHermesToolCall = {
  action: string
  parameters: Record<string, unknown>
}

export type VendorHermesRuntimePayload =
  | {
      tool_call: VendorHermesToolCall
      confirmation?: {
        explicitIntentInCurrentThread?: boolean
        impactSummarized?: boolean
        explicitConfirmationTurn?: boolean
        scopeChangedAfterConfirmation?: boolean
        reconfirmedAfterScopeChange?: boolean
      }
    }
  | {
      chat_message: string
      history?: Array<{
        role: "assistant" | "user"
        content: string
      }>
    }

export const useVendorHermesRuntime = () => {
  return useMutation({
    mutationFn: async (payload: VendorHermesRuntimePayload) => {
      return sdk.client.fetch("/vendor/hermes/runtime", {
        method: "POST",
        body: payload,
      })
    },
  })
}
