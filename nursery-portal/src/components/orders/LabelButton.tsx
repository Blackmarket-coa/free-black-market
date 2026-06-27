import { useState } from "react"
import type { NurseryOrder } from "@/types"
import { requiresPhyto } from "./ComplianceBadge"

// Request/download label flow. When the destination needs a phyto cert and none
// is on file, the request is blocked until a cert is uploaded (mocked here).
export function LabelButton({
  order,
  onRequest,
}: {
  order: NurseryOrder
  onRequest?: (o: NurseryOrder) => void
}) {
  const [requested, setRequested] = useState(order.status === "label_requested")
  const blocked = requiresPhyto(order.destination_state) && order.status === "unfulfilled"

  if (order.status === "label_ready") {
    return (
      <a className="btn-primary text-xs" href="#" onClick={(e) => e.preventDefault()}>
        ⬇ Download label
      </a>
    )
  }

  if (order.status === "shipped" || order.status === "packed") {
    return <span className="text-xs text-mist self-center">Label handled</span>
  }

  return (
    <button
      className="btn-primary text-xs"
      disabled={blocked || requested}
      title={blocked ? "Upload a phyto cert first" : undefined}
      onClick={() => {
        setRequested(true)
        onRequest?.(order)
      }}
    >
      {requested ? "Label requested…" : "Request label"}
    </button>
  )
}
