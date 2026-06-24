"use client"

import { useEffect, useRef } from "react"

import { useBlackoutEffects } from "@/components/providers"
import { toast } from "@/lib/helpers/toast"

const LEVEL_KEY = "fbm_seen_level"
const TITLES_KEY = "fbm_seen_titles"
const UNLOCKS_KEY = "fbm_seen_unlocks"

/**
 * App-wide progression watcher: on any page, the first time a person crosses a
 * new overall level, earns a new title, or unlocks a new threshold privilege
 * (vs. what they last saw, persisted locally), play the calm milestone
 * celebration and show a warm toast. Renders nothing.
 *
 * Shares the same localStorage baseline keys as the character-page
 * `ProgressWatcher` so the two never double-fire for the same milestone.
 */
export function GlobalProgressClient({
  overallLevel,
  titleCount,
  unlockedCount,
}: {
  overallLevel: number
  titleCount: number
  unlockedCount: number
}) {
  const { celebrate } = useBlackoutEffects()
  const fired = useRef(false)

  useEffect(() => {
    if (fired.current) return
    fired.current = true

    let leveledUp = false
    let newTitle = false
    let newUnlock = false
    try {
      const seenLevel = Number(localStorage.getItem(LEVEL_KEY) ?? "NaN")
      const seenTitles = Number(localStorage.getItem(TITLES_KEY) ?? "NaN")
      const seenUnlocks = Number(localStorage.getItem(UNLOCKS_KEY) ?? "NaN")

      // Only celebrate against a prior baseline, so a first-ever visit is silent.
      leveledUp = Number.isFinite(seenLevel) && overallLevel > seenLevel
      newTitle = Number.isFinite(seenTitles) && titleCount > seenTitles
      newUnlock = Number.isFinite(seenUnlocks) && unlockedCount > seenUnlocks

      localStorage.setItem(LEVEL_KEY, String(overallLevel))
      localStorage.setItem(TITLES_KEY, String(titleCount))
      localStorage.setItem(UNLOCKS_KEY, String(unlockedCount))
    } catch {
      return
    }

    if (leveledUp) {
      toast.success({ title: `Level ${overallLevel} reached`, description: "Your standing in the cooperative grew." })
    } else if (newUnlock) {
      toast.success({ title: "New privilege unlocked", description: "You crossed an XP threshold." })
    } else if (newTitle) {
      toast.success({ title: "New title earned", description: "A new role title joined your character sheet." })
    }

    // The "you're close" next-unlock guidance is surfaced passively on the
    // character/rewards pages, never as a toast — only real milestones celebrate.
    if (leveledUp || newTitle || newUnlock) {
      celebrate("milestone")
    }
  }, [overallLevel, titleCount, unlockedCount, celebrate])

  return null
}
