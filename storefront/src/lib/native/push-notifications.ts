import { logger } from "@/lib/logger"
import { getCapacitorBridge, isNativeApp } from "./native-app-context"

/**
 * Push registration for the native shell (order/marketplace alerts).
 *
 * The shell exposes `@capacitor/push-notifications` over the injected
 * bridge; this helper requests permission, registers with FCM/APNs, and
 * re-broadcasts plugin events as DOM CustomEvents so any storefront
 * feature can consume them without touching the bridge:
 *
 *   fbm:push-token     detail: { token }   — send this to the backend
 *   fbm:push-received  detail: <notification>  (app in foreground)
 *   fbm:push-action    detail: <action>        (user tapped one)
 */

export const PUSH_TOKEN_EVENT = "fbm:push-token"
export const PUSH_RECEIVED_EVENT = "fbm:push-received"
export const PUSH_ACTION_EVENT = "fbm:push-action"

const dispatch = (name: string, detail: unknown) => {
  window.dispatchEvent(new CustomEvent(name, { detail }))
}

/**
 * Returns true when registration was kicked off (token arrives via the
 * `fbm:push-token` event); false on web, denied permission, or a missing
 * plugin. Safe to call multiple times.
 */
export async function registerNativePushNotifications(): Promise<boolean> {
  if (!isNativeApp()) return false
  const push = getCapacitorBridge()?.Plugins?.PushNotifications
  if (!push?.addListener || !push.requestPermissions || !push.register) {
    return false
  }

  try {
    // Listeners first so the registration event can't race the register call.
    await push.addListener("registration", ((payload: { value?: string }) => {
      dispatch(PUSH_TOKEN_EVENT, { token: payload?.value })
    }) as (payload: never) => void)
    await push.addListener("registrationError", ((payload: unknown) => {
      logger.warn("[native-push] registration failed", payload)
    }) as (payload: never) => void)
    await push.addListener("pushNotificationReceived", ((payload: unknown) => {
      dispatch(PUSH_RECEIVED_EVENT, payload)
    }) as (payload: never) => void)
    await push.addListener("pushNotificationActionPerformed", ((
      payload: unknown
    ) => {
      dispatch(PUSH_ACTION_EVENT, payload)
    }) as (payload: never) => void)

    const permission = await push.requestPermissions()
    if (permission?.receive !== "granted") return false
    await push.register()
    return true
  } catch (error) {
    logger.warn("[native-push] unavailable", error)
    return false
  }
}
