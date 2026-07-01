import type { NurseryOrder, OrderFulfillmentStatus } from "@/types"
import { ComplianceBadge } from "./ComplianceBadge"
import { HeatPackAlert } from "./HeatPackAlert"
import { LabelButton } from "./LabelButton"
import { money, shortDate, daysUntil, classNames } from "@bmc/portal-kit"

const STATUS_LABEL: Record<OrderFulfillmentStatus, string> = {
  unfulfilled: "Unfulfilled",
  label_requested: "Label requested",
  label_ready: "Label ready",
  packed: "Packed",
  shipped: "Shipped",
}

export function OrderCard({
  order,
  onRequestLabel,
  onMarkPacked,
  onMarkShipped,
}: {
  order: NurseryOrder
  onRequestLabel?: (o: NurseryOrder) => void
  onMarkPacked?: (o: NurseryOrder) => void
  onMarkShipped?: (o: NurseryOrder) => void
}) {
  const days = daysUntil(order.ship_by)
  const urgent = days !== null && days <= 1 && order.status !== "shipped"

  return (
    <div className={classNames("panel-pad", urgent && "border-amber-700/60")}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-medium text-cream-50">#{order.id.replace("ord_", "")}</span>
            <span className="text-xs text-mist">{order.buyer_name}</span>
            <span className="text-xs text-ghost">→ {order.destination_state}</span>
          </div>
          <div className="text-xs text-mist mt-1">
            {order.lines.map((l) => `${l.qty}× ${l.species_name}`).join(", ")}
          </div>
        </div>
        <div className="text-right">
          <div className="text-sm text-cream-100">{money(order.total_cents)}</div>
          <div
            className={classNames(
              "text-xs mt-0.5",
              urgent ? "text-amber-300" : "text-ghost"
            )}
          >
            Ship by {shortDate(order.ship_by)}
            {days !== null && days >= 0 && ` (${days}d)`}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 mt-3">
        <span className="text-xs rounded-xs border border-moss px-1.5 py-0.5 text-mist">
          {STATUS_LABEL[order.status]}
        </span>
        <ComplianceBadge state={order.destination_state} />
        <HeatPackAlert />
      </div>

      <div className="flex flex-wrap gap-2 mt-3">
        <LabelButton order={order} onRequest={onRequestLabel} />
        {(order.status === "label_ready" || order.status === "label_requested") && (
          <button className="btn-ghost text-xs" onClick={() => onMarkPacked?.(order)}>
            Mark packed
          </button>
        )}
        {order.status === "packed" && (
          <button className="btn-ghost text-xs" onClick={() => onMarkShipped?.(order)}>
            Mark shipped
          </button>
        )}
        {order.status === "shipped" && order.tracking_number && (
          <span className="text-xs text-mist self-center">
            Tracking {order.tracking_number}
          </span>
        )}
      </div>
    </div>
  )
}
