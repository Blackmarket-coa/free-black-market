import { useMemo, useState } from "react"
import { useListings } from "@/hooks/useListings"
import { PageHeader } from "@bmc/ui"
import { Tabs } from "@bmc/ui"
import { QueryState } from "@bmc/ui"
import { DataTable, type Column } from "@bmc/ui"
import { EmptyState } from "@bmc/ui"
import type { NurseryListing, ListingStatus, OrderCycleStatus } from "@/types"
import { money, shortDate, classNames } from "@bmc/portal-kit"

const STATUS_LABEL: Record<ListingStatus, { label: string; className: string }> = {
  active: { label: "Active", className: "text-forest-300" },
  paused: { label: "Paused", className: "text-amber-300" },
  sold_out: { label: "Sold out", className: "text-clay" },
}

const CYCLE_STATUS: Record<OrderCycleStatus, { label: string; className: string }> = {
  upcoming: { label: "Upcoming", className: "text-mist" },
  open: { label: "Open — taking orders", className: "text-forest-300" },
  fulfilling: { label: "Fulfilling", className: "text-amber-300" },
  closed: { label: "Closed", className: "text-ghost" },
}

export function ListingsPage() {
  const { data, isLoading, isError } = useListings()
  const [tab, setTab] = useState("listings")
  const [category, setCategory] = useState("all")

  const categories = useMemo(
    () => Array.from(new Set((data?.listings ?? []).map((l) => l.category))).sort(),
    [data]
  )

  const filtered = useMemo(
    () =>
      (data?.listings ?? []).filter(
        (l) => category === "all" || l.category === category
      ),
    [data, category]
  )

  const listingCols: Column<NurseryListing>[] = [
    { key: "species", header: "Species", render: (l) => <span className="text-cream-100">{l.species_name}</span>, sortValue: (l) => l.species_name },
    { key: "category", header: "Category", render: (l) => <span className="text-mist">{l.category}</span>, sortValue: (l) => l.category },
    { key: "pot", header: "Pot", render: (l) => l.pot_size },
    { key: "price", header: "Price", render: (l) => money(l.price_cents), sortValue: (l) => l.price_cents },
    {
      key: "stock",
      header: "Stock",
      render: (l) =>
        l.stock === 0 ? (
          <span className="text-clay">0</span>
        ) : l.stock <= 5 ? (
          <span className="text-amber-300">{l.stock}</span>
        ) : (
          l.stock
        ),
      sortValue: (l) => l.stock,
    },
    { key: "orders", header: "Orders (30d)", render: (l) => <span className="text-mist">{l.orders_30d ?? "—"}</span>, sortValue: (l) => l.orders_30d ?? 0 },
    {
      key: "status",
      header: "Status",
      render: (l) => (
        <span className={STATUS_LABEL[l.status].className}>
          {STATUS_LABEL[l.status].label}
        </span>
      ),
      sortValue: (l) => l.status,
    },
    {
      key: "actions",
      header: "",
      render: (l) => (
        <div className="flex gap-2 justify-end">
          <button className="btn-ghost text-xs">Edit</button>
          <button className="btn-ghost text-xs">
            {l.status === "paused" ? "Resume" : "Pause"}
          </button>
        </div>
      ),
    },
  ]

  return (
    <div>
      <PageHeader
        title="Listings & Order Cycles"
        subtitle="Your FBM storefront — listings, cycles, and demand-pool activation"
        action={<button className="btn-primary text-sm">+ New listing</button>}
      />

      <Tabs
        active={tab}
        onChange={setTab}
        tabs={[
          { key: "listings", label: "Active listings", count: data?.listings.length },
          { key: "cycles", label: "Order cycles", count: data?.order_cycles.length },
          { key: "demand", label: "Demand pool", count: data?.demand_pool.length },
        ]}
      />

      <QueryState isLoading={isLoading} isError={isError}>
        {data && (
          <>
            {tab === "listings" && (
              <div className="space-y-3">
                <div className="flex flex-wrap gap-1.5">
                  {["all", ...categories].map((c) => (
                    <button
                      key={c}
                      onClick={() => setCategory(c)}
                      className={classNames(
                        "px-2.5 py-1 rounded-full text-xs border transition-colors",
                        category === c
                          ? "border-forest-500 text-cream-50 bg-forest-500/10"
                          : "border-moss text-mist hover:text-cream-100"
                      )}
                    >
                      {c === "all" ? "All categories" : c}
                    </button>
                  ))}
                </div>
                <DataTable
                  columns={listingCols}
                  rows={filtered}
                  exportName="listings"
                  empty="No listings in this category."
                />
              </div>
            )}

            {tab === "cycles" &&
              (data.order_cycles.length === 0 ? (
                <EmptyState
                  icon="🔄"
                  title="No order cycles yet"
                  message="Run a cycle to batch orders around a drop or a season."
                  cta={<button className="btn-primary text-sm">Create a cycle</button>}
                />
              ) : (
                <div className="grid sm:grid-cols-2 gap-3">
                  {data.order_cycles.map((c) => (
                    <div key={c.id} className="panel-pad">
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-cream-100">{c.name}</span>
                        <span className={classNames("text-xs", CYCLE_STATUS[c.status].className)}>
                          {CYCLE_STATUS[c.status].label}
                        </span>
                      </div>
                      <div className="text-xs text-mist mt-1">
                        {shortDate(c.opens_at)} → {shortDate(c.closes_at)}
                      </div>
                      <div className="flex items-center justify-between mt-3 text-sm">
                        <span className="text-cream-100">
                          {c.order_count}{" "}
                          <span className="text-ghost text-xs">orders</span>
                        </span>
                        <span className="text-cream-100">{money(c.gross_cents)}</span>
                      </div>
                      {c.status === "fulfilling" && (
                        <button className="btn-ghost text-xs mt-2">
                          Open fulfillment queue →
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              ))}

            {tab === "demand" && (
              <div className="space-y-3">
                <p className="text-xs text-mist">
                  Species buyers have requested but nobody is growing. Activating
                  adds it to your propagation plan and tells the Hub you have it
                  covered.
                </p>
                <div className="panel divide-y divide-moss/50">
                  {data.demand_pool.map((d) => (
                    <div
                      key={d.id}
                      className="flex items-center justify-between gap-3 px-3 py-2.5"
                    >
                      <div className="min-w-0">
                        <div className="text-sm text-cream-100">{d.species_name}</div>
                        <div className="text-xs text-mist">
                          {d.requests} requests · top states {d.top_states.join(", ")} ·{" "}
                          <span className="capitalize">{d.suggested_method}</span>
                        </div>
                      </div>
                      {d.activated ? (
                        <span className="text-xs text-forest-300 shrink-0">
                          In production ✓
                        </span>
                      ) : (
                        <button className="btn-primary text-xs shrink-0">
                          Activate production
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </QueryState>
    </div>
  )
}
