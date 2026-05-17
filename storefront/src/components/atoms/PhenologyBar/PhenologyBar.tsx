import { cn } from "@/lib/utils"
import {
  formatMonthAriaLabel,
  MONTH_LABELS,
  PHENOLOGY_STATUSES,
  sanitizePhenologyYear,
  STATUS_BG_CLASS,
  STATUS_LABELS,
  type PhenologyYear,
  type PhenologyStatus,
} from "./phenology"

interface PhenologyBarProps {
  /** 12-element seasonality, Jan..Dec. Wrong-length inputs throw. */
  year: ReadonlyArray<PhenologyStatus | unknown>
  /** If true, render J-F-M-...-D under the bar. Defaults to true. */
  showLabels?: boolean
  /** 0-11; if provided, the cell renders with a focus ring. */
  currentMonth?: number
  /** If true, render a small legend below the bar. */
  showLegend?: boolean
  className?: string
  /** Accessible heading for the bar. Defaults to "Seasonality". */
  "aria-label"?: string
}

/**
 * A small twelve-month seasonality bar.
 *
 * Each cell is coloured by status (`phenology.ts`'s STATUS_BG_CLASS).
 * The bar is intentionally tiny so it can sit in a vendor card without
 * dominating; pair with `<PlaybookSignature />` for a complete identity
 * row.
 *
 * The component is purely presentational. Source of truth for what
 * status each month carries lives on the vendor's `garden_season` data
 * (or, until that lands, a hand-rolled `metadata.phenology_year` array
 * on the seller).
 */
export function PhenologyBar({
  year,
  showLabels = true,
  currentMonth,
  showLegend = false,
  className,
  ...rest
}: PhenologyBarProps) {
  const sanitized: PhenologyYear = sanitizePhenologyYear(year)
  const label = rest["aria-label"] ?? "Seasonality"

  return (
    <div className={cn("inline-flex flex-col gap-1", className)} role="group" aria-label={label}>
      <div className="flex gap-px overflow-hidden rounded-sm border border-gray-200">
        {sanitized.map((status, idx) => (
          <span
            key={idx}
            className={cn(
              "h-3 w-3 sm:h-4 sm:w-4",
              STATUS_BG_CLASS[status],
              currentMonth === idx && "ring-2 ring-black ring-offset-1"
            )}
            role="img"
            aria-label={formatMonthAriaLabel(idx, status)}
            title={formatMonthAriaLabel(idx, status)}
          />
        ))}
      </div>
      {showLabels && (
        <div className="flex gap-px text-[10px] text-gray-500" aria-hidden={true}>
          {MONTH_LABELS.map((m, idx) => (
            <span key={idx} className="w-3 sm:w-4 text-center">
              {m}
            </span>
          ))}
        </div>
      )}
      {showLegend && (
        <div className="mt-1 flex flex-wrap gap-2 text-[11px] text-gray-700">
          {PHENOLOGY_STATUSES.map((status) => (
            <span key={status} className="inline-flex items-center gap-1">
              <span className={cn("inline-block h-3 w-3 rounded-sm border border-gray-200", STATUS_BG_CLASS[status])} />
              {STATUS_LABELS[status]}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
