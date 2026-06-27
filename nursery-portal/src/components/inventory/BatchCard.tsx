import type { PropagationBatch } from "@/types"
import { BatchStatusBadge } from "./BatchStatusBadge"
import { SpeciesIcon } from "./SpeciesIcon"
import { daysUntil, shortDate, classNames } from "@/lib/format"

// Progress 0..1 across the batch lifecycle, by status then by time as fallback.
function batchProgress(b: PropagationBatch): number {
  const order: PropagationBatch["status"][] = [
    "started",
    "germinating",
    "rooting",
    "growing_out",
    "ready",
  ]
  const idx = order.indexOf(b.status)
  if (b.status === "listed" || b.status === "sold_out") return 1
  if (idx >= 0) return idx / (order.length - 1)
  return 0
}

export function BatchCard({
  batch,
  onPhoto,
}: {
  batch: PropagationBatch
  onPhoto?: (b: PropagationBatch) => void
}) {
  const days = daysUntil(batch.expected_ready_at)
  const progress = batchProgress(batch)
  const overdue = days !== null && days < 0 && batch.status !== "ready"
  const close = days !== null && days >= 0 && days <= 14

  const daysColor = overdue
    ? "text-clay"
    : close
    ? "text-amber-300"
    : "text-forest-300"

  return (
    <div className="panel-pad">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <SpeciesIcon name={batch.species_name} />
            <span className="font-medium text-cream-50 truncate">
              {batch.species_name}
            </span>
            {batch.is_rare_species && (
              <span className="text-xs text-amber-300" title="Rare species">
                ★
              </span>
            )}
            {batch.hub_requested && (
              <span className="text-[10px] uppercase tracking-wide text-forest-300 border border-forest-700 rounded-xs px-1">
                Hub
              </span>
            )}
          </div>
          <div className="text-xs text-mist mt-0.5 capitalize">
            {batch.method} · {batch.qty_successful}/{batch.qty_started} ·{" "}
            {batch.pot_size}
          </div>
        </div>
        <BatchStatusBadge status={batch.status} />
      </div>

      <div className="mt-3 h-1.5 rounded-full bg-moss overflow-hidden">
        <div
          className="h-full bg-forest-500"
          style={{ width: `${Math.round(progress * 100)}%` }}
        />
      </div>

      <div className="flex items-center justify-between mt-2 text-xs">
        <span className="text-ghost">Started {shortDate(batch.started_at)}</span>
        <span className={classNames("font-medium", daysColor)}>
          {batch.status === "ready"
            ? "Ready to sell"
            : days === null
            ? "—"
            : overdue
            ? `${Math.abs(days)}d overdue`
            : `${days}d to ready`}
        </span>
      </div>

      {onPhoto && (
        <div className="mt-3 flex gap-2">
          <button onClick={() => onPhoto(batch)} className="btn-ghost text-xs">
            📸 Add photo
          </button>
          {batch.photo_verified_at ? (
            <span className="text-xs text-forest-400 self-center">Verified</span>
          ) : batch.photo_url ? (
            <span className="text-xs text-amber-300 self-center">
              Pending Hub approval
            </span>
          ) : null}
        </div>
      )}
    </div>
  )
}
