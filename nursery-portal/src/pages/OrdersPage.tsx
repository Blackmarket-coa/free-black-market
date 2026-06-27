import { useMemo, useState } from "react"
import { useOrders } from "@/hooks/useOrders"
import { PageHeader } from "@/components/ui/PageHeader"
import { Tabs } from "@/components/ui/Tabs"
import { QueryState } from "@/components/ui/QueryState"
import { DataTable, type Column } from "@/components/ui/DataTable"
import { OrderCard } from "@/components/orders/OrderCard"
import { EmptyState } from "@/components/ui/EmptyState"
import type { NurseryOrder, DoaClaim } from "@/types"
import { money, shortDate } from "@/lib/format"

export function OrdersPage() {
  const { data, isLoading, isError } = useOrders()
  const [tab, setTab] = useState("queue")

  // Fulfillment queue = anything not yet shipped, soonest ship-by first.
  const queue = useMemo(
    () =>
      (data?.orders ?? [])
        .filter((o) => o.status !== "shipped")
        .sort((a, b) => a.ship_by.localeCompare(b.ship_by)),
    [data]
  )

  const historyCols: Column<NurseryOrder>[] = [
    { key: "id", header: "Order", render: (o) => `#${o.id.replace("ord_", "")}`, sortValue: (o) => o.id },
    { key: "buyer", header: "Buyer", render: (o) => <span className="text-mist">{o.buyer_name}</span>, sortValue: (o) => o.buyer_name },
    { key: "species", header: "Items", render: (o) => <span className="text-mist">{o.lines.map((l) => `${l.qty}× ${l.species_name}`).join(", ")}</span> },
    { key: "state", header: "To", render: (o) => o.destination_state, sortValue: (o) => o.destination_state },
    { key: "ship", header: "Ship by", render: (o) => shortDate(o.ship_by), sortValue: (o) => o.ship_by },
    { key: "status", header: "Status", render: (o) => <span className="capitalize text-mist">{o.status.replace("_", " ")}</span>, sortValue: (o) => o.status },
    { key: "total", header: "Total", render: (o) => money(o.total_cents), sortValue: (o) => o.total_cents },
  ]

  return (
    <div>
      <PageHeader title="Orders" subtitle="Fulfillment queue, history, and DOA claims" />
      <Tabs
        active={tab}
        onChange={setTab}
        tabs={[
          { key: "queue", label: "Fulfillment queue", count: queue.length },
          { key: "all", label: "All orders", count: data?.orders.length },
          { key: "doa", label: "DOA claims", count: data?.doa_claims.length },
        ]}
      />

      <QueryState isLoading={isLoading} isError={isError}>
        {data && (
          <>
            {tab === "queue" &&
              (queue.length === 0 ? (
                <EmptyState icon="✅" title="All caught up" message="No orders waiting on you." />
              ) : (
                <div className="grid lg:grid-cols-2 gap-3">
                  {queue.map((o) => (
                    <OrderCard
                      key={o.id}
                      order={o}
                      onRequestLabel={() => {}}
                      onMarkPacked={() => {}}
                      onMarkShipped={() => {}}
                    />
                  ))}
                </div>
              ))}

            {tab === "all" && (
              <DataTable columns={historyCols} rows={data.orders} exportName="orders" />
            )}

            {tab === "doa" &&
              (data.doa_claims.length === 0 ? (
                <EmptyState icon="🌿" title="No open claims" message="No DOA or return claims right now." />
              ) : (
                <div className="space-y-3">
                  {data.doa_claims.map((c: DoaClaim) => (
                    <div key={c.id} className="panel-pad">
                      <div className="flex items-center justify-between">
                        <span className="text-cream-100">
                          #{c.order_id.replace("ord_", "")} · {c.species_name}
                        </span>
                        <span className="text-xs text-amber-300">Opened {shortDate(c.opened_at)}</span>
                      </div>
                      <p className="text-sm text-mist mt-1">{c.buyer_reason}</p>
                      <textarea
                        placeholder="Grower response (posts to Blackout hub-ops)…"
                        className="mt-2 w-full bg-soil border border-moss rounded-sm px-3 py-2 text-sm text-cream-100 placeholder:text-ghost focus:outline-none focus:border-forest-600"
                        rows={2}
                      />
                      <div className="flex gap-2 mt-2">
                        <button className="btn-primary text-xs">Refund</button>
                        <button className="btn-ghost text-xs">Replacement</button>
                        <button className="btn-ghost text-xs">Decline</button>
                      </div>
                    </div>
                  ))}
                </div>
              ))}
          </>
        )}
      </QueryState>
    </div>
  )
}
