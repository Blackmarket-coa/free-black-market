import { differenceInCalendarDays, parseISO } from "date-fns"
import { getRunStatusLabel } from "@/lib/pathways"
import { classNames } from "@bmc/portal-kit"
import type { ProductionPathway, ProductionRun } from "@/types"

// Cure progress bar for pathways with a cure time (tincture macerating, ferment
// conditioning, fire-cider mellowing). Renders nothing when the pathway has no
// cure time or the run hasn't started — callers can mount it unconditionally.
export function CureTimer({
  run,
  pathway,
  className,
}: {
  run: ProductionRun
  pathway?: ProductionPathway
  className?: string
}) {
  const total = pathway?.default_cure_time_days ?? 0
  if (total <= 0 || !run.actual_start_date) return null
  if (run.status === "complete" || run.status === "failed") return null

  const elapsed = Math.max(
    0,
    Math.min(total, differenceInCalendarDays(new Date(), parseISO(run.actual_start_date)))
  )
  const progress = total > 0 ? elapsed / total : 0
  // The cure phase is described by the pathway's "curing" label where present,
  // otherwise the active-status label.
  const phaseLabel =
    pathway?.production_status_labels?.curing ?? getRunStatusLabel(pathway, run.status)

  return (
    <div className={className}>
      <div className="flex items-center justify-between text-xs text-mist">
        <span>{phaseLabel}</span>
        <span>
          {elapsed} of {total} days
        </span>
      </div>
      <div className="mt-1 h-1.5 rounded-full bg-moss overflow-hidden">
        <div
          className={classNames(
            "h-full",
            progress >= 1 ? "bg-forest-400" : "bg-amber-400"
          )}
          style={{ width: `${Math.round(progress * 100)}%` }}
        />
      </div>
    </div>
  )
}
