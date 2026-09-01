import LocalizedClientLink from "@/components/molecules/LocalizedLink/LocalizedLink"
import { convertToLocale } from "@/lib/helpers/money"
import {
  needsVendorAction,
  vendorOrderStage,
  vendorOrderStageLabel,
} from "@/lib/helpers/vendor-orders"
import type { VendorOrderSummary } from "@/lib/data/vendor-orders"

const stageTone: Record<string, string> = {
  awaiting_fulfillment: "bg-action-secondary text-action-on-secondary",
  ready_to_ship: "bg-action text-action-on-primary",
  in_transit: "bg-action-secondary text-action-on-secondary",
  closed: "bg-disabled text-disabled",
}

const buyerName = (order: VendorOrderSummary): string => {
  const first = order.shipping_address?.first_name ?? ""
  const last = order.shipping_address?.last_name ?? ""
  const name = `${first} ${last}`.trim()
  return name || "Customer"
}

const place = (order: VendorOrderSummary): string =>
  [order.shipping_address?.city, order.shipping_address?.province]
    .filter(Boolean)
    .join(", ")

export const VendorOrderList = ({
  orders,
}: {
  orders: VendorOrderSummary[]
}) => {
  if (orders.length === 0) {
    return (
      <div className="border rounded-sm p-6 text-center">
        <p className="label-lg mb-1">No orders yet</p>
        <p className="label-md text-secondary">
          New orders will appear here, and we&apos;ll notify you on this device.
        </p>
      </div>
    )
  }

  const open = orders.filter(needsVendorAction)

  return (
    <div className="flex flex-col gap-4">
      <p className="label-md text-secondary" data-testid="vendor-open-count">
        {open.length === 0
          ? "Nothing needs you right now."
          : `${open.length} order${open.length === 1 ? "" : "s"} need${
              open.length === 1 ? "s" : ""
            } you.`}
      </p>

      <ul className="flex flex-col gap-3">
        {orders.map((order) => {
          const stage = vendorOrderStage(order)
          return (
            <li key={order.id}>
              <LocalizedClientLink
                href={`/vendor/orders/${order.id}`}
                className="block border rounded-sm p-4 hover:bg-action-secondary-hover transition-colors"
              >
                <div className="flex justify-between items-start gap-3 mb-2">
                  <span className="label-lg">
                    #{order.display_id ?? order.id}
                  </span>
                  <span
                    className={`label-sm rounded-full px-3 py-1 whitespace-nowrap ${
                      stageTone[stage] ?? stageTone.awaiting_fulfillment
                    }`}
                  >
                    {vendorOrderStageLabel(stage)}
                  </span>
                </div>
                <div className="flex justify-between items-center gap-3">
                  <span className="label-md text-secondary truncate">
                    {buyerName(order)}
                    {place(order) ? ` · ${place(order)}` : ""}
                  </span>
                  <span className="label-md whitespace-nowrap">
                    {convertToLocale({
                      amount: order.total ?? 0,
                      currency_code: order.currency_code ?? "",
                    })}
                  </span>
                </div>
              </LocalizedClientLink>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
