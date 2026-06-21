"use client"

import { useEffect, useRef } from "react"

import type { EarconKind } from "@/lib/audio/earcons"
import { useBlackoutEffects } from "./context"

/**
 * Fires a single calm celebration when mounted — a drop-in for server-rendered
 * pages (e.g. order confirmation) that mark a positive moment.
 *
 * Pass a stable `dedupeKey` (such as an order id) to ensure the cue plays only
 * once per real event, even across refreshes or React StrictMode double-mounts.
 */
export function CelebrateOnMount({
  kind = "celebrate",
  dedupeKey,
}: {
  kind?: EarconKind
  dedupeKey?: string
}) {
  const { celebrate } = useBlackoutEffects()
  const fired = useRef(false)

  useEffect(() => {
    if (fired.current) return
    fired.current = true

    if (dedupeKey) {
      const storeKey = `fbm_celebrated:${dedupeKey}`
      try {
        if (sessionStorage.getItem(storeKey)) return
        sessionStorage.setItem(storeKey, "1")
      } catch {
        // sessionStorage unavailable — fall through and celebrate anyway.
      }
    }

    celebrate(kind)
  }, [celebrate, kind, dedupeKey])

  return null
}
