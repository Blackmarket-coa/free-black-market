import { PageHeader } from "@bmc/ui"
import { QueryState } from "@bmc/ui"
import { DataTable, Column } from "@bmc/ui"
import { usePhysicalProducts } from "@/hooks/useWellness"
import { money, classNames } from "@bmc/portal-kit"
import type { PhysicalProduct } from "@/types"

export function PhysicalProductsPage() {
  const { data, isLoading, isError } = usePhysicalProducts()

  const columns: Column<PhysicalProduct>[] = [
    { key: "name", header: "Name", sortValue: (r) => r.name, render: (r) => (
      <span className="text-cream-100">
        {r.name}
        {r.bmc_sourced && <span className="ml-2 text-[10px] text-forest-300">BMC sourced</span>}
      </span>
    ) },
    { key: "category", header: "Category", sortValue: (r) => r.category, render: (r) => <span className="text-mist">{r.category}</span> },
    { key: "sku", header: "SKU", render: (r) => <span className="text-ghost text-xs">{r.sku}</span> },
    { key: "stock", header: "Stock", sortValue: (r) => r.stock, render: (r) => (
      <span className={classNames(r.stock <= 5 ? "text-clay" : "text-mist")}>
        {r.stock}
        {r.stock <= 5 && " ⚠️"}
      </span>
    ) },
    { key: "price", header: "Price", sortValue: (r) => r.price_amount, render: (r) => <span className="text-cream-100">{money(r.price_amount)}</span> },
    { key: "sales", header: "Sales/mo", sortValue: (r) => r.sales_per_month ?? 0, render: (r) => <span className="text-mist">{r.sales_per_month ?? 0}</span> },
  ]

  const lowStock = (data ?? []).filter((p) => p.stock <= 5)

  return (
    <div className="space-y-5">
      <PageHeader
        title="Physical Products"
        subtitle="Tinctures, ritual oils, candles, and wellness goods. Ships physically."
        action={<button className="btn-primary text-sm">New product</button>}
      />

      {lowStock.length > 0 && (
        <div className="panel-pad border-clay/40">
          <div className="heading text-sm text-clay mb-2">Low stock</div>
          <div className="space-y-1 text-sm">
            {lowStock.map((p) => (
              <div key={p.id} className="flex items-center justify-between">
                <span className="text-cream-100">
                  {p.name} — {p.stock} left
                </span>
                <button className="btn-ghost text-xs">
                  {p.bmc_sourced ? "Request from network" : "Restock"}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <QueryState isLoading={isLoading} isError={isError}>
        <DataTable columns={columns} rows={data ?? []} exportName="wellness-products" />
      </QueryState>

      <div className="panel-pad text-sm text-mist">
        <div className="heading text-sm text-cream-50 mb-1">Subscription boxes</div>
        Curate a monthly box, generate a packing list, and manage subscribers. BMC-sourced
        ingredients surface the cooperative supply-chain story on each listing.
      </div>
    </div>
  )
}
