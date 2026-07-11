import { useMemo } from "react"
import { useFinishedGoods } from "@/hooks/useFinishedGoods"
import { useActivePathways } from "@/hooks/useActivePathways"
import { PageHeader } from "@bmc/ui"
import { MetricCard } from "@bmc/ui"
import { QueryState } from "@bmc/ui"
import { EmptyState } from "@bmc/ui"
import { DataTable, type Column } from "@bmc/ui"
import { iconForOutput } from "@/lib/pathways"
import { money, pct, classNames } from "@bmc/portal-kit"
import type { FinishedGood, ProductionPathway } from "@/types"

// The B2B price sheet is derived from wholesale-toggled finished goods. COA
// enforcement comes from the pathway config (coa_required_for_wholesale) OR a
// per-batch coa_required flag — a batch without its COA can't be sold B2B.

export function WholesalePage() {
  const { data: goods = [], isLoading, isError } = useFinishedGoods()
  const { data: pathways = [] } = useActivePathways()

  const pathwayById = (id: string): ProductionPathway | undefined =>
    pathways.find((p) => p.id === id)

  const needsCoa = (g: FinishedGood): boolean =>
    g.coa_required || (pathwayById(g.pathway_id)?.coa_required_for_wholesale ?? false)

  const eligible = useMemo(
    () => goods.filter((g) => g.is_wholesale_eligible && g.status === "available"),
    [goods]
  )
  const coaMissing = eligible.filter((g) => needsCoa(g) && !g.coa_url)
  const coaPathways = pathways.filter((p) => p.coa_required_for_wholesale)

  const cols: Column<FinishedGood>[] = [
    {
      key: "sku",
      header: "SKU",
      render: (g) => <span className="font-mono text-[11px] text-mist">{g.sku}</span>,
      sortValue: (g) => g.sku,
    },
    {
      key: "product",
      header: "Product",
      render: (g) => (
        <span className="flex items-center gap-2">
          <span>{iconForOutput(g.output_category)}</span>
          <span className="min-w-0">
            <span className="text-cream-100 block truncate">{g.product_name}</span>
            <span className="text-[11px] text-ghost font-mono">{g.batch_number}</span>
          </span>
        </span>
      ),
      sortValue: (g) => g.product_name,
    },
    {
      key: "wholesale",
      header: "Wholesale",
      render: (g) => <span className="text-cream-100">{money(g.wholesale_price_cents)}</span>,
      sortValue: (g) => g.wholesale_price_cents,
    },
    {
      key: "margin_vs_retail",
      header: "vs retail",
      render: (g) => (
        <span className="text-mist">
          {g.retail_price_cents > 0
            ? pct((g.wholesale_price_cents / g.retail_price_cents) * 100)
            : "—"}
        </span>
      ),
      sortValue: (g) =>
        g.retail_price_cents > 0 ? g.wholesale_price_cents / g.retail_price_cents : 0,
    },
    {
      key: "stock",
      header: "Available",
      render: (g) => (
        <span className={classNames(g.quantity_on_hand <= 10 ? "text-amber-300" : "text-cream-100")}>
          {g.quantity_on_hand} × {g.unit_size}
        </span>
      ),
      sortValue: (g) => g.quantity_on_hand,
    },
    {
      key: "coa",
      header: "COA",
      render: (g) =>
        !needsCoa(g) ? (
          <span className="text-xs text-ghost">not required</span>
        ) : g.coa_url ? (
          <span className="text-xs text-forest-300">✓ attached</span>
        ) : (
          <span className="text-xs">
            <span className="text-clay">required — missing</span>
            <button className="btn-ghost text-[11px] ml-2">Upload</button>
          </span>
        ),
      sortValue: (g) => (!needsCoa(g) ? 0 : g.coa_url ? 1 : 2),
    },
  ]

  return (
    <div>
      <PageHeader
        title="Wholesale"
        subtitle="B2B price sheet built from wholesale-toggled finished goods, with per-batch COA enforcement."
      />
      <QueryState isLoading={isLoading} isError={isError}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <MetricCard label="Wholesale SKUs" value={eligible.length} icon="📦" />
            <MetricCard
              label="Units available"
              value={eligible.reduce((s, g) => s + g.quantity_on_hand, 0)}
              icon="🫙"
            />
            <MetricCard
              label="Sheet value"
              value={money(
                eligible.reduce((s, g) => s + g.quantity_on_hand * g.wholesale_price_cents, 0)
              )}
              subtitle="available stock at wholesale"
              icon="💰"
            />
            <MetricCard
              label="COA gaps"
              value={coaMissing.length}
              subtitle={coaMissing.length > 0 ? "blocking B2B sale" : "all clear"}
              icon={coaMissing.length > 0 ? "⚠️" : "✅"}
            />
          </div>

          {/* COA enforcement note — driven by the pathway config, not hardcoded */}
          {coaPathways.length > 0 && (
            <div className="panel-pad text-xs text-mist">
              🧪 COA required for wholesale on:{" "}
              {coaPathways.map((p) => (
                <span key={p.id} className="text-cream-100 mr-2">
                  {p.name}
                </span>
              ))}
              — batches from these pathways can't ship B2B without an attached certificate of
              analysis.
            </div>
          )}

          {eligible.length === 0 ? (
            <EmptyState
              icon="📦"
              title="No wholesale-eligible goods"
              message="Toggle wholesale eligibility on a finished good to build your price sheet."
            />
          ) : (
            <DataTable columns={cols} rows={eligible} exportName="wholesale-price-sheet" />
          )}
        </div>
      </QueryState>
    </div>
  )
}
