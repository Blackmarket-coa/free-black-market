// Propagation-window domain knowledge. This is stable horticultural reference
// data, NOT database state (per the build spec). Windows reference USDA zone 7b;
// adjust ±2 weeks per zone of difference via shiftWindowForZone().

export interface PropagationWindow {
  species: string
  method: string
  // inclusive month range, 1 = January
  start_month: number
  end_month: number
  notes: string
  success_rate?: number // 0..1, rough guide
  weeks_to_saleable?: number
}

export const REFERENCE_ZONE = "7b"

export const PROPAGATION_WINDOWS: PropagationWindow[] = [
  { species: "Fig", method: "hardwood cutting", start_month: 1, end_month: 2, notes: "Take dormant hardwood cuttings.", success_rate: 0.8, weeks_to_saleable: 26 },
  { species: "Elderberry", method: "hardwood cutting", start_month: 1, end_month: 2, notes: "Dormant season hardwood.", success_rate: 0.85, weeks_to_saleable: 20 },
  { species: "Muscadine", method: "hardwood cutting", start_month: 12, end_month: 1, notes: "Late dormancy, bottom heat helps.", success_rate: 0.55, weeks_to_saleable: 30 },
  { species: "Beautyberry", method: "softwood cutting", start_month: 6, end_month: 8, notes: "Softwood from new growth.", success_rate: 0.75, weeks_to_saleable: 16 },
  { species: "Sweet potato", method: "slip", start_month: 3, end_month: 5, notes: "Start tubers in Feb to slip Mar–May.", success_rate: 0.9, weeks_to_saleable: 8 },
  { species: "Persimmon", method: "seed", start_month: 3, end_month: 3, notes: "Sow after 90-day cold stratification.", success_rate: 0.6, weeks_to_saleable: 52 },
  { species: "Banana", method: "division", start_month: 4, end_month: 9, notes: "Pup division in any warm month.", success_rate: 0.95, weeks_to_saleable: 12 },
  { species: "General woody", method: "air layering", start_month: 4, end_month: 6, notes: "Air layer during active growth.", success_rate: 0.7, weeks_to_saleable: 14 },
  { species: "General softwood", method: "softwood cutting", start_month: 6, end_month: 8, notes: "Most softwoods root in summer.", success_rate: 0.7, weeks_to_saleable: 16 },
  { species: "General hardwood", method: "hardwood cutting", start_month: 12, end_month: 2, notes: "Dormant-season hardwood window.", success_rate: 0.65, weeks_to_saleable: 26 },
]

const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
]

export function monthName(m: number): string {
  return MONTH_NAMES[(m - 1 + 12) % 12]
}

// Is the window open in the given month? Handles wrap-around (e.g. Dec–Feb).
export function isWindowOpen(w: PropagationWindow, month: number): boolean {
  if (w.start_month <= w.end_month) {
    return month >= w.start_month && month <= w.end_month
  }
  // wraps year boundary
  return month >= w.start_month || month <= w.end_month
}

export function windowsOpenIn(month: number): PropagationWindow[] {
  return PROPAGATION_WINDOWS.filter((w) => isWindowOpen(w, month))
}

export function windowLabel(w: PropagationWindow): string {
  return `${monthName(w.start_month)}–${monthName(w.end_month)}`
}

// Shift a window by whole zones from the 7b reference. Each zone difference is
// ~2 weeks (~0.5 month). Returns a copy with adjusted month bounds.
export function shiftWindowForZone(
  w: PropagationWindow,
  zoneDelta: number
): PropagationWindow {
  const monthShift = Math.round(zoneDelta * 0.5)
  const wrap = (m: number) => ((m - 1 + monthShift + 12 * 4) % 12) + 1
  return { ...w, start_month: wrap(w.start_month), end_month: wrap(w.end_month) }
}
