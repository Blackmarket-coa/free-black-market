"use client"

import { useTransition } from "react"
import { useRouter } from "next/navigation"
import { sellerLogout } from "@/lib/data/vendor-auth"
import { getLastPushToken } from "@/lib/native/push-notifications"

/**
 * Vendor sign-out.
 *
 * Passes this device's push token so the seller is detached from it as
 * part of signing out — otherwise a signed-out phone would keep buzzing
 * with another account's order notifications. The shopper session on the
 * same device is untouched.
 */
export const VendorSessionControls = () => {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  const signOut = () => {
    startTransition(async () => {
      // Token when we have it; the server detaches every device for this
      // seller when we don't, so sign-out is never silently partial.
      await sellerLogout(getLastPushToken() ?? undefined)
      router.refresh()
    })
  }

  return (
    <div className="flex items-center justify-end gap-3">
      <button
        type="button"
        onClick={signOut}
        disabled={pending}
        className="label-md underline text-secondary whitespace-nowrap disabled:opacity-50"
        data-testid="vendor-sign-out"
      >
        {pending ? "Signing out…" : "Sign out"}
      </button>
    </div>
  )
}
