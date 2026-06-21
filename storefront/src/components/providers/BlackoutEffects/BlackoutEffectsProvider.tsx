"use client"

import {
  PropsWithChildren,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react"

import { playEarcon, type EarconKind } from "@/lib/audio/earcons"
import { Bloom } from "./Bloom"
import {
  BLACKOUT_PREFS_KEY,
  BlackoutEffectsContext,
  DEFAULT_PREFS,
  normalizePrefs,
  type BlackoutEffectPrefs,
} from "./context"

type ActiveBloom = { id: number; kind: EarconKind }

/**
 * Provides calm tone + light "effects" across the storefront, plus the
 * preferences (persisted to localStorage) that gate them. Effects default ON
 * and can be toggled off from account settings.
 */
export function BlackoutEffectsProvider({ children }: PropsWithChildren) {
  // Render with defaults on the server / first paint, then hydrate from storage.
  const [prefs, setPrefs] = useState<BlackoutEffectPrefs>(DEFAULT_PREFS)
  const [ready, setReady] = useState(false)
  const [blooms, setBlooms] = useState<ActiveBloom[]>([])
  const bloomId = useRef(0)

  // Hydrate persisted prefs once on mount.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(BLACKOUT_PREFS_KEY)
      if (raw) setPrefs(normalizePrefs(JSON.parse(raw)))
    } catch {
      // Ignore malformed / unavailable storage — defaults stand.
    }
    setReady(true)
  }, [])

  // Reflect night grading onto the document so global CSS can respond.
  useEffect(() => {
    if (typeof document === "undefined") return
    document.documentElement.toggleAttribute(
      "data-blackout-night",
      prefs.nightGrading
    )
  }, [prefs.nightGrading])

  const setPref = useCallback(
    <K extends keyof BlackoutEffectPrefs>(
      key: K,
      value: BlackoutEffectPrefs[K]
    ) => {
      setPrefs((prev) => {
        const next = { ...prev, [key]: value }
        try {
          window.localStorage.setItem(BLACKOUT_PREFS_KEY, JSON.stringify(next))
        } catch {
          // Storage may be unavailable (private mode) — keep in-memory state.
        }
        return next
      })
    },
    []
  )

  const prefersReducedMotion = useCallback(
    () =>
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    []
  )

  const celebrate = useCallback(
    (kind: EarconKind = "confirm") => {
      if (prefs.soundEnabled) {
        playEarcon(kind, { volume: prefs.volume })
      }
      // The bloom is motion; skip it when the user prefers reduced motion.
      if (prefs.lightsEnabled && !prefersReducedMotion()) {
        const id = ++bloomId.current
        setBlooms((prev) => [...prev, { id, kind }])
      }
    },
    [prefs.soundEnabled, prefs.lightsEnabled, prefs.volume, prefersReducedMotion]
  )

  const removeBloom = useCallback((id: number) => {
    setBlooms((prev) => prev.filter((b) => b.id !== id))
  }, [])

  return (
    <BlackoutEffectsContext.Provider
      value={{ prefs, ready, setPref, celebrate }}
    >
      {children}
      {blooms.map((b) => (
        <Bloom key={b.id} kind={b.kind} onDone={() => removeBloom(b.id)} />
      ))}
    </BlackoutEffectsContext.Provider>
  )
}
