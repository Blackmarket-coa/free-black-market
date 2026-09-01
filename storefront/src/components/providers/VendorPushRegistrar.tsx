"use client"

import { useEffect } from "react"
import {
  getNativePlatform,
  isNativeApp,
} from "@/lib/native/native-app-context"
import {
  PUSH_TOKEN_EVENT,
  getLastPushToken,
} from "@/lib/native/push-notifications"
import { registerSellerPushToken } from "@/lib/data/vendor-auth"

/**
 * Attach this device to the signed-in seller so order pushes reach them.
 *
 * Mounted only where a seller session already exists. The device usually
 * registered with FCM at launch — well before the vendor signed in — so
 * this reads the remembered token first and also listens, in case
 * registration is still in flight.
 *
 * A no-op on the web, where there is no device to attach.
 */
export const VendorPushRegistrar = () => {
  useEffect(() => {
    if (!isNativeApp()) return

    const platform = getNativePlatform()
    if (!platform) return

    let done = false
    const attach = (token: string | null | undefined) => {
      if (done || !token) return
      done = true
      void registerSellerPushToken({ token, platform })
    }

    attach(getLastPushToken())

    const onToken = (event: Event) =>
      attach((event as CustomEvent<{ token?: string }>).detail?.token)

    window.addEventListener(PUSH_TOKEN_EVENT, onToken)
    return () => window.removeEventListener(PUSH_TOKEN_EVENT, onToken)
  }, [])

  return null
}
