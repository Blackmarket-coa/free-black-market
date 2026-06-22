"use client"

import type { EarconKind } from "@/lib/audio/earcons"

/**
 * A transient, full-screen warm "bloom" glow that fades in and out to
 * acknowledge a positive moment. Reuses the solarpunk amber/forest palette and
 * is purely decorative (`aria-hidden`, `pointer-events-none`).
 *
 * Motion is driven by the `blackout-bloom` keyframes in globals.css, which are
 * suppressed under `prefers-reduced-motion: reduce`.
 */
export function Bloom({
  kind = "confirm",
  onDone,
}: {
  kind?: EarconKind
  onDone: () => void
}) {
  // Bigger moments glow a touch larger / warmer.
  const scale =
    kind === "milestone" ? "70vmax" : kind === "celebrate" ? "55vmax" : "40vmax"

  return (
    <div
      aria-hidden
      onAnimationEnd={onDone}
      className="blackout-bloom pointer-events-none fixed inset-0 z-[60] flex items-center justify-center"
    >
      <span
        className="blackout-bloom__glow block rounded-full"
        style={{ width: scale, height: scale }}
      />
    </div>
  )
}
