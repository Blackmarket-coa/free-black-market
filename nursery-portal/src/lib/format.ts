import { differenceInCalendarDays, format, parseISO } from "date-fns"

export function money(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format((cents ?? 0) / 100)
}

export function shortDate(iso?: string | null): string {
  if (!iso) return "—"
  try {
    return format(parseISO(iso), "MMM d")
  } catch {
    return "—"
  }
}

export function monthLabel(ym: string): string {
  // "2026-05" -> "May 2026"
  try {
    return format(parseISO(`${ym}-01`), "MMM yyyy")
  } catch {
    return ym
  }
}

// Days from today (2026-anchored at runtime) to the given ISO date.
export function daysUntil(iso?: string | null): number | null {
  if (!iso) return null
  try {
    return differenceInCalendarDays(parseISO(iso), new Date())
  } catch {
    return null
  }
}

export function pct(n: number): string {
  return `${Math.round(n)}%`
}

export function classNames(...xs: (string | false | null | undefined)[]): string {
  return xs.filter(Boolean).join(" ")
}
