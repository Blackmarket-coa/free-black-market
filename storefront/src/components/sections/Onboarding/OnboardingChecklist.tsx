"use client"

import { useEffect, useMemo, useRef, useState } from "react"

import { useBlackoutEffects } from "@/components/providers"

export type OnboardingStep = {
  id: string
  label: string
  /** Short, encouraging "why this matters" line (epic-meaning framing). */
  hint: string
  done: boolean
}

const DISMISS_KEY = "fbm_onboarding_dismissed"
const SEEN_DONE_KEY = "fbm_onboarding_seen_done"

/**
 * White-hat "shaping" onboarding checklist.
 *
 * Behavioral design choices, all on the encouraging side of the ledger:
 *  - Endowed progress: the first step ("Account created") arrives pre-completed
 *    so a new member starts with momentum rather than at zero.
 *  - A progress *bar* communicates advancement without a bare "2 / 4" count, so
 *    the framing is "you're growing" rather than "you're behind".
 *  - Completing a step plays a calm celebration (competence signal), but there
 *    are deliberately NO streaks, countdowns, guilt prompts, or fake scarcity.
 *  - It is always dismissible and every step is optional.
 */
export function OnboardingChecklist({ steps }: { steps: OnboardingStep[] }) {
  const { celebrate } = useBlackoutEffects()
  const [dismissed, setDismissed] = useState(true) // assume dismissed until storage confirms otherwise
  const [hydrated, setHydrated] = useState(false)
  const celebrated = useRef(false)

  const doneCount = useMemo(() => steps.filter((s) => s.done).length, [steps])
  const total = steps.length
  const pct = total > 0 ? Math.round((doneCount / total) * 100) : 0
  const allDone = doneCount === total && total > 0

  // Hydrate dismissal state from storage.
  useEffect(() => {
    try {
      setDismissed(window.localStorage.getItem(DISMISS_KEY) === "1")
    } catch {
      setDismissed(false)
    }
    setHydrated(true)
  }, [])

  // Celebrate steps newly completed since the member last saw the checklist.
  useEffect(() => {
    if (!hydrated || dismissed || celebrated.current) return
    celebrated.current = true

    let seen = 0
    try {
      seen = Number(window.localStorage.getItem(SEEN_DONE_KEY) ?? "0") || 0
    } catch {
      seen = 0
    }

    if (doneCount > seen) {
      celebrate(allDone ? "milestone" : "celebrate")
    }

    try {
      window.localStorage.setItem(SEEN_DONE_KEY, String(doneCount))
    } catch {
      // best-effort persistence
    }
  }, [hydrated, dismissed, doneCount, allDone, celebrate])

  const dismiss = () => {
    setDismissed(true)
    try {
      window.localStorage.setItem(DISMISS_KEY, "1")
    } catch {
      // best-effort persistence
    }
  }

  // Avoid a hydration flash; render nothing until we know the dismissal state.
  if (!hydrated || dismissed || total === 0) return null

  return (
    <section
      aria-label="Getting started"
      className="card-organic max-w-2xl mx-auto mb-10 p-6"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="heading-sm">
            {allDone
              ? "You're growing the cooperative economy 🌿"
              : "Welcome — let's grow your roots"}
          </h2>
          <p className="text-secondary text-sm mt-1">
            {allDone
              ? "You've planted every starter step. Keep going at your own pace."
              : "A few gentle steps to find your place in the market. No rush — take them whenever you like."}
          </p>
        </div>
        <button
          type="button"
          onClick={dismiss}
          className="text-secondary text-sm underline shrink-0"
        >
          Dismiss
        </button>
      </div>

      {/* Progress bar (no raw count) */}
      <div
        className="mt-4 h-2 w-full rounded-full bg-[rgba(var(--neutral-200),0.6)] overflow-hidden"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Onboarding progress"
      >
        <div
          className="h-full gradient-solarpunk transition-all duration-700"
          style={{ width: `${pct}%` }}
        />
      </div>

      <ul className="mt-5 flex flex-col gap-3">
        {steps.map((step) => (
          <li key={step.id} className="flex items-start gap-3">
            <span
              aria-hidden
              className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs ${
                step.done
                  ? "bg-[rgb(var(--brand-500))] text-white"
                  : "border border-[rgb(var(--neutral-300))] text-transparent"
              }`}
            >
              ✓
            </span>
            <div>
              <p
                className={`label-md ${
                  step.done ? "text-secondary line-through" : "text-primary"
                }`}
              >
                {step.label}
              </p>
              {!step.done && (
                <p className="text-secondary text-sm mt-0.5">{step.hint}</p>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
