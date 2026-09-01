"use client"

import { useEffect } from "react"
import { refreshSellerSession } from "@/lib/data/vendor-auth"

/**
 * Renews the seller token when it is close to expiring.
 *
 * This lives in a client component for a concrete reason: Next.js seals
 * cookies during a Server Component render, so the refresh cannot happen
 * where the session is read. Invoking the server action from the client
 * puts the request store in the 'action' phase, where the cookie write is
 * allowed. Without this, a vendor's session would simply die after a day
 * — the worst possible failure for a "tap the push, ship the order" flow.
 *
 * Safe to mount unconditionally: with no session, or a token that is not
 * near expiry, the action is a no-op.
 */
export const VendorSessionKeeper = () => {
  useEffect(() => {
    void refreshSellerSession()
  }, [])

  return null
}
