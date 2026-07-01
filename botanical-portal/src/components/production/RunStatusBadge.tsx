import { getRunStatusLabel } from "@/lib/pathways"
import { classNames } from "@bmc/portal-kit"
import type { ProductionPathway, RunStatus } from "@/types"

// Color by underlying status; label is pathway-specific ("Macerating", "Dyeing").
const STATUS_STYLE: Record<RunStatus, string> = {
  planned: "bg-moss text-mist border-ghost/40",
  in_progress: "bg-forest-900/40 text-forest-200 border-forest-700",
  curing: "bg-amber-900/30 text-amber-200 border-amber-700/50",
  testing: "bg-amber-900/30 text-amber-200 border-amber-700/50",
  complete: "bg-forest-800/40 text-forest-100 border-forest-600",
  failed: "bg-clay/20 text-clay border-clay/50",
  quarantine: "bg-clay/20 text-clay border-clay/50",
}

export function RunStatusBadge({
  pathway,
  status,
}: {
  pathway?: ProductionPathway
  status: RunStatus
}) {
  return (
    <span
      className={classNames(
        "shrink-0 rounded-sm border px-2 py-0.5 text-[11px] font-medium",
        STATUS_STYLE[status]
      )}
    >
      {getRunStatusLabel(pathway, status)}
    </span>
  )
}
