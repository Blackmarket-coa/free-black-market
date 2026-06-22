"use client"

import { useEffect, useRef } from "react"

import { useBlackoutEffects } from "@/components/providers"

const LEVEL_KEY = "fbm_seen_level"
const TITLES_KEY = "fbm_seen_titles"

/**
 * Watches the rendered character sheet and plays a calm milestone celebration
 * the first time a person sees a new overall level or a newly earned title
 * (compared to what they last saw, persisted locally). Renders nothing.
 */
export function ProgressWatcher({
  overallLevel,
  titleCount,
}: {
  overallLevel: number
  titleCount: number
}) {
  const { celebrate } = useBlackoutEffects()
  const fired = useRef(false)

  useEffect(() => {
    if (fired.current) return
    fired.current = true

    let leveledUp = false
    let newTitle = false
    try {
      const seenLevel = Number(localStorage.getItem(LEVEL_KEY) ?? "NaN")
      const seenTitles = Number(localStorage.getItem(TITLES_KEY) ?? "NaN")

      // Only celebrate when we have a prior baseline to compare against, so a
      // first-ever visit doesn't fire spuriously.
      leveledUp = Number.isFinite(seenLevel) && overallLevel > seenLevel
      newTitle = Number.isFinite(seenTitles) && titleCount > seenTitles

      localStorage.setItem(LEVEL_KEY, String(overallLevel))
      localStorage.setItem(TITLES_KEY, String(titleCount))
    } catch {
      return
    }

    if (leveledUp || newTitle) {
      celebrate("milestone")
    }
  }, [overallLevel, titleCount, celebrate])

  return null
}
