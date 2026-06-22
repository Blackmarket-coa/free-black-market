"use client"

import { createContext, useContext } from "react"

import type { EarconKind } from "@/lib/audio/earcons"

/** User-controllable effect preferences. All sensory effects default ON. */
export type BlackoutEffectPrefs = {
  /** Play calm earcons on positive interactions. */
  soundEnabled: boolean
  /** Render the warm "bloom" glow on positive interactions. */
  lightsEnabled: boolean
  /** Shift the UI toward a warm, low-strain night palette. */
  nightGrading: boolean
  /** Earcon master volume, 0..1. */
  volume: number
}

export const DEFAULT_PREFS: BlackoutEffectPrefs = {
  soundEnabled: true,
  lightsEnabled: true,
  nightGrading: false,
  volume: 0.18,
}

/** localStorage key for persisted preferences. */
export const BLACKOUT_PREFS_KEY = "fbm_blackout_prefs"

export type BlackoutEffectsContextValue = {
  prefs: BlackoutEffectPrefs
  /** Whether prefs have been hydrated from storage (avoids SSR/first-paint flashes). */
  ready: boolean
  setPref: <K extends keyof BlackoutEffectPrefs>(
    key: K,
    value: BlackoutEffectPrefs[K]
  ) => void
  /**
   * Acknowledge a positive moment: plays an earcon (if sound is on) and shows
   * a bloom (if lights are on). Honors `prefers-reduced-motion` for the visual.
   */
  celebrate: (kind?: EarconKind) => void
}

export const BlackoutEffectsContext =
  createContext<BlackoutEffectsContextValue | null>(null)

export function useBlackoutEffects(): BlackoutEffectsContextValue {
  const context = useContext(BlackoutEffectsContext)
  if (!context) {
    throw new Error(
      "useBlackoutEffects must be used within a BlackoutEffectsProvider"
    )
  }
  return context
}

/**
 * Merge an unknown persisted value with defaults, dropping anything malformed.
 * Pure + exported so the persistence logic is unit-testable.
 */
export function normalizePrefs(raw: unknown): BlackoutEffectPrefs {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_PREFS }
  const r = raw as Partial<Record<keyof BlackoutEffectPrefs, unknown>>
  return {
    soundEnabled:
      typeof r.soundEnabled === "boolean"
        ? r.soundEnabled
        : DEFAULT_PREFS.soundEnabled,
    lightsEnabled:
      typeof r.lightsEnabled === "boolean"
        ? r.lightsEnabled
        : DEFAULT_PREFS.lightsEnabled,
    nightGrading:
      typeof r.nightGrading === "boolean"
        ? r.nightGrading
        : DEFAULT_PREFS.nightGrading,
    volume:
      typeof r.volume === "number" && r.volume >= 0 && r.volume <= 1
        ? r.volume
        : DEFAULT_PREFS.volume,
  }
}
