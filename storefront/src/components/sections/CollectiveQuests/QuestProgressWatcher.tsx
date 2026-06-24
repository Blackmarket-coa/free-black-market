"use client"

import { useEffect, useRef } from "react"

import { useBlackoutEffects } from "@/components/providers"

const KEY = "fbm_seen_quest_completions"

/**
 * Celebrates collective wins: the first time the number of completed quests in
 * a den exceeds what the member last saw (persisted locally), play the calm
 * milestone celebration. Renders nothing. Mirrors the character-page
 * `ProgressWatcher` so cooperative wins feel like the individual ones.
 */
export function QuestProgressWatcher({ completedCount }: { completedCount: number }) {
  const { celebrate } = useBlackoutEffects()
  const fired = useRef(false)

  useEffect(() => {
    if (fired.current) return
    fired.current = true

    let newlyCompleted = false
    try {
      const seen = Number(localStorage.getItem(KEY) ?? "NaN")
      newlyCompleted = Number.isFinite(seen) && completedCount > seen
      localStorage.setItem(KEY, String(completedCount))
    } catch {
      return
    }

    if (newlyCompleted) celebrate("milestone")
  }, [completedCount, celebrate])

  return null
}
