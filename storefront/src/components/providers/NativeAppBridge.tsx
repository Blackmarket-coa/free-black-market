"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import {
  getCapacitorBridge,
  isNativeApp,
  type CapacitorAppListenerHandle,
} from "@/lib/native/native-app-context"
import { deepLinkToPath } from "@/lib/native/deep-links"
import { registerNativePushNotifications } from "@/lib/native/push-notifications"

/**
 * Client-side bridge to the FBM Capacitor shell (mobile/). Mounted once
 * in the root layout; a no-op on the plain web, where the injected
 * `window.Capacitor` bridge doesn't exist.
 *
 * - Routes `fbm://` deep links (appUrlOpen) to the matching storefront
 *   path via the Next router.
 * - Kicks off push registration when NEXT_PUBLIC_NATIVE_PUSH=true —
 *   tokens surface as `fbm:push-token` CustomEvents
 *   (lib/native/push-notifications.ts).
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

    if (process.env.NEXT_PUBLIC_NATIVE_PUSH === "true") {
      void registerNativePushNotifications()
    }

    return () => {
      cancelled = true
      if (listenerHandle) void listenerHandle.remove()
    }
  }, [router])

  return null
}
