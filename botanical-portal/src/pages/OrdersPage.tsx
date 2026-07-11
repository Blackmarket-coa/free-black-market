import { useMemo, useState } from "react"
import { useOrders } from "@/hooks/useOrders"
import { PageHeader } from "@bmc/ui"
import { QueryState } from "@bmc/ui"
import { Tabs } from "@bmc/ui"
import { EmptyState } from "@bmc/ui"
import { DataTable, type Column } from "@bmc/ui"
import { money, shortDate, daysUntil, classNames } from "@bmc/portal-kit"
import type { BotanicalOrder, BotanicalOrderLine, OrderFulfillmentStatus } from "@/types"

const STATUS_STYLE: Record<OrderFulfillmentStatus, string> = {
  unfulfilled: "text-amber-300",
  picking: "text-cream-100",
  packed: "text-cream-100",
  label_ready: "text-forest-300",
  shipped: "text-mist",
}

// Per-line compliance check: everything that must be true before this batch
// may ship. Blockers stop pick/pack; warnings ship with a flag.
function lineIssues(line: BotanicalOrderLine): { blockers: string[]; warnings: string[] } {
  const blockers: string[] = []
  const warnings: string[] = []
  if (!line.label_approved) blockers.push("label review outstanding")
  if (line.coa_required && !line.coa_attached) blockers.push("COA missing")
  const days = daysUntil(line.expiry_date)
  if (days != null && days < 0) blockers.push("batch expired")
  else if (days != null && days <= 30) warnings.push(`expires in ${days}d`)
  return { blockers, warnings }
}

function orderIssues(order: BotanicalOrder) {
  const blockers: string[] = []
  const warnings: string[] = []
  for (const line of order.lines) {
    const { blockers: b, warnings: w } = lineIssues(line)
    blockers.push(...b)
    warnings.push(...w)
  }
  return { blockers, warnings }
}

export function OrdersPage() {
  const { data: orders = [], isLoading, isError } = useOrders()
  const [tab, setTab] = useState("queue")

  // Fulfillment queue = anything not yet shipped, soonest ship-by first.
  const queue = useMemo(
    () =>
      orders
        .filter((o) => o.status !== "shipped")
        .sort((a, b) => a.ship_by.localeCompare(b.ship_by)),
    [orders]
  )
  const blockedCount = queue.filter((o) => orderIssues(o).blockers.length > 0).length

  const allCols: Column<BotanicalOrder>[] = [
    {
      key: "id",
      header: "Order",
      render: (o) => <span className="font-mono text-[11px]">#{o.id.replace("ord_", "")}</span>,
      sortValue: (o) => o.id,
    },
    {
      key: "buyer",
      header: "Buyer",
      render: (o) => <span className="text-cream-100">{o.buyer_name}</span>,
      sortValue: (o) => o.buyer_name,
    },
    {
      key: "channel",
      header: "Channel",
      render: (o) => (
        <span className={o.channel === "wholesale" ? "text-forest-300" : "text-mist"}>
          {o.channel}
        </span>
      ),
      sortValue: (o) => o.channel,
    },
    {
      key: "lines",
      header: "Lines",
      render: (o) => (
        <span className="text-mist">
          {o.lines.map((l) => `${l.qty}× ${l.product_name}`).join(", ")}
        </span>
      ),
    },
    {
      key: "ship_by",
      header: "Ship by",
      render: (o) => shortDate(o.ship_by),
      sortValue: (o) => o.ship_by,
    },
    {
      key: "status",
      header: "Status",
      render: (o) => (
        <span className={classNames("text-xs capitalize", STATUS_STYLE[o.status])}>
          {o.status.replace("_", " ")}
        </span>
      ),
      sortValue: (o) => o.status,
    },
    {
      key: "total",
      header: "Total",
      render: (o) => <span className="text-cream-100">{money(o.total_cents)}</span>,
      sortValue: (o) => o.total_cents,
    },
  ]

  return (
    <div>
      <PageHeader
        title="Orders"
        subtitle="Retail + wholesale orders. Every line is pinned to a batch and compliance-checked before dispatch."
      />
      <QueryState isLoading={isLoading} isError={isError}>
        <Tabs
          active={tab}
          onChange={setTab}
          tabs={[
            { key: "queue", label: "Fulfillment queue", count: queue.length },
            { key: "all", label: "All orders", count: orders.length },
          ]}
        />

        {tab === "queue" &&
          (queue.length === 0 ? (
            <EmptyState icon="✅" title="All caught up" message="No orders waiting on you." />
          ) : (
            <div className="space-y-4">
              {blockedCount > 0 && (
                <div className="text-xs text-amber-300">
                  ⚠️ {blockedCount} of {queue.length} open orders blocked by a compliance check.
                </div>
              )}
              <div className="grid lg:grid-cols-2 gap-3">
                {queue.map((o) => (
                  <OrderCard key={o.id} order={o} />
                ))}
              </div>
            </div>
          ))}

        {tab === "all" && (
          <DataTable columns={allCols} rows={orders} exportName="botanical-orders" />
        )}
      </QueryState>
    </div>
  )
}

function OrderCard({ order }: { order: BotanicalOrder }) {
  const { blockers, warnings } = orderIssues(order)
  const shipDays = daysUntil(order.ship_by)
  const overdue = shipDays != null && shipDays < 0

  return (
    <div className="panel-pad">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm text-cream-50 font-medium truncate">{order.buyer_name}</div>
          <div className="text-[11px] text-ghost font-mono">
            #{order.id.replace("ord_", "")} ·{" "}
            <span className={order.channel === "wholesale" ? "text-forest-300" : ""}>
              {order.channel}
            </span>
          </div>
        </div>
        <div className="text-right shrink-0">
          <span className={classNames("text-xs capitalize", STATUS_STYLE[order.status])}>
            {order.status.replace("_", " ")}
          </span>
          <div className={classNames("text-[11px]", overdue ? "text-clay" : "text-ghost")}>
            ship by {shortDate(order.ship_by)}
            {overdue && " — overdue"}
          </div>
        </div>
      </div>

      {/* Lines with batch traceability + per-line compliance flags */}
      <div className="mt-3 divide-y divide-moss/50 border-t border-moss/50">
        {order.lines.map((l) => {
          const { blockers: b, warnings: w } = lineIssues(l)
          return (
            <div key={`${l.finished_good_id}-${l.batch_number}`} className="py-2 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="text-cream-100 truncate">
                  {l.qty}× {l.product_name}
                </span>
                <span className="text-mist shrink-0">{money(l.qty * l.unit_price_cents)}</span>
              </div>
              <div className="text-[11px] text-ghost font-mono">{l.batch_number}</div>
              {(b.length > 0 || w.length > 0) && (
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {b.map((x) => (
                    <span
                      key={x}
                      className="text-[11px] text-clay border border-clay/40 rounded-sm px-1.5 py-0.5"
                    >
                      ✕ {x}
                    </span>
                  ))}
                  {w.map((x) => (
                    <span
                      key={x}
                      className="text-[11px] text-amber-300 border border-amber-700/50 rounded-sm px-1.5 py-0.5"
                    >
                      ⚠ {x}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div className="mt-2 flex items-center justify-between">
        <div className="text-xs">
          {blockers.length > 0 ? (
            <span className="text-clay">Compliance check failed — resolve before dispatch</span>
          ) : warnings.length > 0 ? (
            <span className="text-amber-300">Passes with warnings</span>
          ) : (
            <span className="text-forest-300">✓ Compliance check passed</span>
          )}
        </div>
        <span className="heading text-base text-cream-50">{money(order.total_cents)}</span>
      </div>

      <div className="mt-3 flex items-center gap-2">
        <button className="btn-primary text-xs" disabled={blockers.length > 0}>
          Pick & pack
        </button>
        <button className="btn-ghost text-xs" disabled={blockers.length > 0}>
          Print label
        </button>
        <span className="ml-auto text-[11px] text-ghost">
          {order.blackout_notified ? "💬 dispatched to Blackout" : "💬 Blackout alert pending"}
        </span>
      </div>
    </div>
  )
}
