"use server"

import { medusaFetch } from "../config"
import { getAuthHeaders } from "./cookies"

/**
 * Push-token registration for the native shell (mobile/).
 *
 * Server actions so the customer's `_medusa_jwt` cookie rides along — an
 * authenticated registration attaches the device to the customer, which
 * is what customer-scoped sends (backend `native-push` module) target.
 * Anonymous registrations are stored token-only and attach on the next
 * authenticated refresh.
 */

export type NativePushPlatform = "ios" | "android"

export async function registerNativePushToken(input: {
  token: string
  platform: NativePushPlatform
}): Promise<{ ok: boolean; attached_to_customer?: boolean }> {
  try {
    return await medusaFetch<{ ok: boolean; attached_to_customer?: boolean }>(
      "/store/native/push-tokens",
      {
        method: "POST",
        body: input,
        cache: "no-cache",
        headers: (await getAuthHeaders()) ?? {},
      }
    )
  } catch {
    // Token registration is best-effort — the shell re-registers on every
    // launch, so a transient failure self-heals.
    return { ok: false }
  }
}

export async function unregisterNativePushToken(
  token: string
): Promise<{ ok: boolean }> {
  try {
    return await medusaFetch<{ ok: boolean }>("/store/native/push-tokens", {
      method: "DELETE",
      body: { token },
      cache: "no-cache",
      headers: (await getAuthHeaders()) ?? {},
    })
  } catch {
    return { ok: false }
  }
}
