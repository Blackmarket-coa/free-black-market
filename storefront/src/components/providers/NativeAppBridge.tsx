"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import {
  getCapacitorBridge,
  getNativePlatform,
  isNativeApp,
  type CapacitorAppListenerHandle,
} from "@/lib/native/native-app-context"
import { deepLinkToPath } from "@/lib/native/deep-links"
import {
  PUSH_TOKEN_EVENT,
  registerNativePushNotifications,
} from "@/lib/native/push-notifications"
import { registerNativePushToken } from "@/lib/data/native-push"

/**
 * Client-side bridge to the FBM Capacitor shell (mobile/). Mounted once
 * in the root layout; a no-op on the plain web, where the injected
 * `window.Capacitor` bridge doesn't exist.
 *
 * - Routes `fbm://` deep links (appUrlOpen) to the matching storefront
 *   path via the Next router.
 * - Kicks off push registration when NEXT_PUBLIC_NATIVE_PUSH=true —
 *   tokens surface as `fbm:push-token` CustomEvents
 *   (lib/native/push-notifications.ts) and are forwarded to the backend
 *   registry (`/store/native/push-tokens`) via a server action so the
 *   customer's auth cookie attaches the device to their account.
 */
export const NativeAppBridge = () => {
  const router = useRouter()

  useEffect(() => {
    if (!isNativeApp()) return

    const app = getCapacitorBridge()?.Plugins?.App
    let cancelled = false
    let listenerHandle: CapacitorAppListenerHandle | null = null

    const attach = async () => {
      if (!app?.addListener) return
      const handle = await app.addListener("appUrlOpen", ((payload: {
        url?: string
      }) => {
        const path = deepLinkToPath(payload?.url)
        if (path) router.push(path)
      }) as (payload: never) => void)
      if (cancelled) void handle.remove()
      else listenerHandle = handle
    }
    void attach()

    const onPushToken = (event: Event) => {
      const token = (event as CustomEvent<{ token?: string }>).detail?.token
      const platform = getNativePlatform()
      if (!token || !platform) return
      void registerNativePushToken({ token, platform })
    }

    if (process.env.NEXT_PUBLIC_NATIVE_PUSH === "true") {
      window.addEventListener(PUSH_TOKEN_EVENT, onPushToken)
      void registerNativePushNotifications()
    }

    return () => {
      cancelled = true
      window.removeEventListener(PUSH_TOKEN_EVENT, onPushToken)
      if (listenerHandle) void listenerHandle.remove()
    }
  }, [router])

  return null
}
