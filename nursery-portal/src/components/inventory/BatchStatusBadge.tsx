import type { BatchStatus } from "@/types"
import { classNames } from "@/lib/format"

const META: Record<BatchStatus, { label: string; icon: string; cls: string }> = {
  started: { label: "Started", icon: "•", cls: "text-mist border-moss" },
  germinating: { label: "Germinating", icon: "🌱", cls: "text-leaf border-forest-700" },
  rooting: { label: "Rooting", icon: "✂️", cls: "text-forest-300 border-forest-700" },
  growing_out: { label: "Growing out", icon: "🪴", cls: "text-forest-300 border-forest-600" },
  ready: { label: "Ready", icon: "✅", cls: "text-forest-400 border-forest-500" },
  listed: { label: "Listed", icon: "🏷️", cls: "text-amber-300 border-amber-700" },
  sold_out: { label: "Sold out", icon: "📦", cls: "text-ghost border-moss" },
  failed: { label: "Failed", icon: "✕", cls: "text-clay border-clay/50" },
}

export function BatchStatusBadge({ status }: { status: BatchStatus }) {
  const m = META[status]
  return (
    <span
      className={classNames(
        "inline-flex items-center gap-1 rounded-xs border px-1.5 py-0.5 text-xs",
        m.cls
      )}
    >
      <span aria-hidden>{m.icon}</span>
      {m.label}
    </span>
  )
}
