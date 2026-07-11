import { useWholesale } from "@/hooks/useWholesale"
import { useRole } from "@/hooks/useRole"
import { PageHeader } from "@bmc/ui"
import { MetricCard } from "@bmc/ui"
import { QueryState } from "@bmc/ui"
import { DataTable, type Column } from "@bmc/ui"
import { EmptyState } from "@bmc/ui"
import type { WholesalePriceRow, WholesaleRequestStatus } from "@/types"
import { money, shortDate, classNames } from "@bmc/portal-kit"

const REQUEST_STATUS: Record<WholesaleRequestStatus, { label: string; className: string }> = {
  new: { label: "New", className: "text-amber-300" },
  quoted: { label: "Quoted", className: "text-forest-300" },
  accepted: { label: "Accepted", className: "text-forest-400" },
  declined: { label: "Declined", className: "text-ghost" },
}

// Hub only — also guarded at the route level in App.tsx.
export function WholesalePage() {
  const { isHub } = useRole()
  const { data, isLoading, isError } = useWholesale()

  if (!isHub) {
    return (
      <EmptyState
        icon="📦"
        title="Hub access only"
        message="Wholesale is run by the Hub. Node wholesale contributions route through the plug pipeline."
      />
    )
  }

  const priceCols: Column<WholesalePriceRow>[] = [
    { key: "species", header: "Species", render: (r) => <span className="text-cream-100">{r.species_name}</span>, sortValue: (r) => r.species_name },
    { key: "format", header: "Format", render: (r) => <span className="text-mist">{r.format}</span> },
    { key: "price", header: "Unit price", render: (r) => money(r.unit_price_cents), sortValue: (r) => r.unit_price_cents },
    { key: "min", header: "Min order", render: (r) => <span className="text-mist">{r.min_order_qty}</span>, sortValue: (r) => r.min_order_qty },
    {
      key: "avail",
      header: "Available",
      render: (r) =>
        r.available_qty === 0 ? (
          <span className="text-clay">0</span>
        ) : (
          r.available_qty
        ),
      sortValue: (r) => r.available_qty,
    },
    {
      key: "lead",
      header: "Lead time",
      render: (r) =>
        r.lead_time_weeks === 0 ? (
          <span className="text-forest-300">In stock</span>
        ) : (
          <span className="text-mist">{r.lead_time_weeks} wk</span>
        ),
      sortValue: (r) => r.lead_time_weeks,
    },
  ]

  return (
    <div>
      <PageHeader
        title="Wholesale"
        subtitle="B2B channel — plug trays, minimums, and buyer requests"
        action={<button className="btn-primary text-sm">+ Add sheet item</button>}
      />
      <QueryState isLoading={isLoading} isError={isError}>
        {data && (
          <div className="space-y-6">
            {/* Row 1 — channel at a glance */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <MetricCard label="Sheet items" value={data.price_sheet.length} icon="🧾" />
              <MetricCard
                label="Trays in stock"
                value={data.price_sheet.reduce((s, r) => s + r.available_qty, 0)}
                icon="🌱"
              />
              <MetricCard
                label="Open requests"
                value={
                  data.buyer_requests.filter(
                    (r) => r.status === "new" || r.status === "quoted"
                  ).length
                }
                icon="📨"
              />
              <MetricCard
                label="Accepted this month"
                value={data.buyer_requests.filter((r) => r.status === "accepted").length}
                icon="🤝"
              />
            </div>

            {/* Section 1 — price sheet (CSV export doubles as the sheet itself) */}
            <section>
              <div className="flex items-center justify-between mb-2">
                <h2 className="heading text-base">Wholesale price sheet</h2>
                <span className="text-xs text-ghost">
                  Export CSV to send the sheet to buyers
                </span>
              </div>
              <DataTable
                columns={priceCols}
                rows={data.price_sheet}
                exportName="wholesale-price-sheet"
                empty="Nothing on the sheet yet."
              />
            </section>

            {/* Section 2 — buyer requests */}
            <section>
              <h2 className="heading text-base mb-2">Buyer requests</h2>
              {data.buyer_requests.length === 0 ? (
                <EmptyState
                  icon="📨"
                  title="No buyer requests"
                  message="Requests from shops, landscapers, and restoration contractors land here."
                />
              ) : (
                <div className="space-y-3">
                  {data.buyer_requests.map((r) => (
                    <div key={r.id} className="panel-pad">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <span className="text-sm text-cream-100">{r.buyer_name}</span>
                          <span className="text-xs text-ghost ml-2">
                            {r.org_type} · {r.state}
                          </span>
                        </div>
                        <span
                          className={classNames(
                            "text-xs shrink-0",
                            REQUEST_STATUS[r.status].className
                          )}
                        >
                          {REQUEST_STATUS[r.status].label}
                        </span>
                      </div>
                      <div className="text-sm text-mist mt-1">
                        {r.qty}× {r.species_name}
                        <span className="text-ghost text-xs ml-2">
                          requested {shortDate(r.requested_at)}
                        </span>
                      </div>
                      {r.notes && <p className="text-xs text-ghost mt-1">{r.notes}</p>}
                      {r.status === "new" && (
                        <div className="flex gap-2 mt-2">
                          <button className="btn-primary text-xs">Send quote</button>
                          <button className="btn-ghost text-xs">Decline</button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        )}
      </QueryState>
    </div>
  )
}
