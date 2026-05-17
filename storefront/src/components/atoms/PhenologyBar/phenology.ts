/**
 * Phenology data primitives.
 *
 * A phenology bar shows a vendor's twelve-month seasonal arc as a small
 * row of coloured cells: when crops are dormant, planted, growing,
 * harvested, or available as preserves. Most relevant for the Harvest,
 * Grove, Kitchen, and Cycle playbooks.
 *
 * This module is framework-free — pure data shapes + validators so the
 * React component (`PhenologyBar.tsx`) and unit tests can share them.
 */

export type PhenologyStatus =
  | "dormant"
  | "planting"
  | "growing"
  | "harvest"
  | "preserved"

export const PHENOLOGY_STATUSES: readonly PhenologyStatus[] = [
  "dormant",
  "planting",
  "growing",
  "harvest",
  "preserved",
] as const

/** A 12-month seasonality array, indexed 0..11 = Jan..Dec. */
export type PhenologyYear = readonly [
  PhenologyStatus,
  PhenologyStatus,
  PhenologyStatus,
  PhenologyStatus,
  PhenologyStatus,
  PhenologyStatus,
  PhenologyStatus,
  PhenologyStatus,
  PhenologyStatus,
  PhenologyStatus,
  PhenologyStatus,
  PhenologyStatus,
]

/** Short single-letter month labels, Jan..Dec. */
export const MONTH_LABELS: readonly string[] = [
  "J",
  "F",
  "M",
  "A",
  "M",
  "J",
  "J",
  "A",
  "S",
  "O",
  "N",
  "D",
] as const

/** Long month names, Jan..Dec, for aria-labels and tooltips. */
export const MONTH_NAMES_LONG: readonly string[] = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const

/** Human-friendly label for a status (used in aria-labels / legends). */
export const STATUS_LABELS: Record<PhenologyStatus, string> = {
  dormant: "Dormant",
  planting: "Planting",
  growing: "Growing",
  harvest: "Harvest",
  preserved: "Preserved",
}

/**
 * Tailwind background classes per status. Picked so the bar reads as a
 * cool-to-warm gradient from dormant through harvest, with a clearly
 * distinct purple for preserved.
 */
export const STATUS_BG_CLASS: Record<PhenologyStatus, string> = {
  dormant: "bg-gray-200",
  planting: "bg-amber-200",
  growing: "bg-emerald-300",
  harvest: "bg-orange-400",
  preserved: "bg-purple-300",
}

export function isPhenologyStatus(value: unknown): value is PhenologyStatus {
  return (
    typeof value === "string" &&
    (PHENOLOGY_STATUSES as readonly string[]).includes(value)
  )
}

/**
 * Validate a 12-cell year array. Returns a sanitized copy where invalid
 * entries are coerced to "dormant". Wrong-length input throws — that's
 * a programming error in the caller, not a data-cleanliness concern.
 */
export function sanitizePhenologyYear(
  year: ReadonlyArray<unknown>
): PhenologyYear {
  if (year.length !== 12) {
    throw new Error(
      `Phenology year must have exactly 12 entries; got ${year.length}.`
    )
  }
  return year.map((cell) =>
    isPhenologyStatus(cell) ? cell : "dormant"
  ) as unknown as PhenologyYear
}

/**
 * Compose the per-month aria-label, e.g. "March: Planting".
 */
export function formatMonthAriaLabel(
  monthIndex: number,
  status: PhenologyStatus
): string {
  const name = MONTH_NAMES_LONG[monthIndex] ?? `Month ${monthIndex + 1}`
  return `${name}: ${STATUS_LABELS[status]}`
}
