"use client"

import { useEffect, useState } from "react"
import { useParams } from "next/navigation"
import { Button } from "@/components/atoms"
import { logger } from "@/lib/logger"
import { isNativeApp } from "@/lib/native/native-app-context"
import {
  getExternalPurchasePolicy,
  openExternalUrl,
} from "@/lib/native/external-purchase"

/**
 * The native shell's region-gated "complete purchase on web" button
 * (mobile/README.md).
 *
 * Renders nothing on the plain web, and nothing on iOS outside the US
 * storefront (Apple's no-entitlement external purchase link rule is
 * US-only — the policy lives in lib/native/external-purchase.ts and
 * fails closed). When shown, it asks
 * `POST /api/native/checkout-handoff` for a signed handoff URL so the
 * external system browser adopts this WebView's cart, then opens it via
 * the Browser plugin. If the handoff surface is disabled
 * (NATIVE_HANDOFF_SECRET unset), it degrades to opening checkout without
 * the cart transfer.
 */
export const BuyOnWebButton = ({
  redirectPath,
  className,
}: {
  /** Same-origin path the external browser should land on. */
  redirectPath?: string
  className?: string
}) => {
  const params = useParams<{ locale?: string }>()
  const [allowed, setAllowed] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    if (!isNativeApp()) return
    getExternalPurchasePolicy().then((policy) => {
      if (!cancelled) setAllowed(policy.allowed)
    })
    return () => {
      cancelled = true
    }
  }, [])

  if (!allowed) return null

  const locale = params?.locale
  const target =
    redirectPath ?? (locale ? `/${locale}/checkout?step=address` : "/checkout?step=address")

  const openOnWeb = async () => {
    setBusy(true)
    try {
      let url = new URL(target, window.location.origin).toString()
      try {
        const response = await fetch("/api/native/checkout-handoff", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ redirect: target }),
        })
        if (response.ok) {
          const data = (await response.json()) as { url?: string }
          if (data?.url) url = data.url
        }
      } catch (error) {
        logger.warn("[buy-on-web] handoff unavailable, opening checkout directly", error)
      }
      await openExternalUrl(url)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Button
      variant="tonal"
      loading={busy}
      disabled={busy}
      className={className ?? "w-full py-3 mt-2 flex justify-center items-center"}
      onClick={() => void openOnWeb()}
      data-testid="buy-on-web-button"
    >
      Complete purchase on web
    </Button>
  )
}
