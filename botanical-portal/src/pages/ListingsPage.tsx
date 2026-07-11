import { useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { useFinishedGoods } from "@/hooks/useFinishedGoods"
import { useActivePathways } from "@/hooks/useActivePathways"
import { PageHeader } from "@bmc/ui"
import { MetricCard } from "@bmc/ui"
import { QueryState } from "@bmc/ui"
import { Tabs } from "@bmc/ui"
import { EmptyState } from "@bmc/ui"
import { DataTable, type Column } from "@bmc/ui"
import { iconForOutput } from "@/lib/pathways"
import { money, classNames } from "@bmc/portal-kit"
import type { FinishedGood } from "@/types"

// A finished good is listable on the storefront once it's available, in stock,
// and its label passed review. Everything here derives from finished goods —
// Order Cycles and subscription boxes plug into the same rows as follow-ups.
function listingBlockers(g: FinishedGood): string[] {
  const blockers: string[] = []
  if (g.status !== "available") blockers.push(g.status)
  if (g.quantity_on_hand <= 0) blockers.push("out of stock")
  if (!g.label_approved) blockers.push("label review")
  if (g.coa_required && !g.coa_url) blockers.push("COA missing")
  return blockers
}

export function ListingsPage() {
  const { data: goods = [], isLoading, isError } = useFinishedGoods()
  const { data: pathways = [] } = useActivePathways()
  const [tab, setTab] = useState("all")

  const shown = useMemo(
    () => (tab === "all" ? goods : goods.filter((g) => g.pathway_id === tab)),
    [goods, tab]
  )

  const live = goods.filter((g) => listingBlockers(g).length === 0)
  const blocked = goods.filter((g) => listingBlockers(g).length > 0)
  const wholesaleToggled = goods.filter((g) => g.is_wholesale_eligible)

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
      key: "retail",
      header: "Retail",
      render: (g) => <span className="text-cream-100">{money(g.retail_price_cents)}</span>,
      sortValue: (g) => g.retail_price_cents,
    },
    {
      key: "wholesale",
      header: "Wholesale",
      render: (g) =>
        g.is_wholesale_eligible ? (
          <span className="text-cream-100">{money(g.wholesale_price_cents)}</span>
        ) : (
          <span className="text-ghost">retail only</span>
        ),
      sortValue: (g) => (g.is_wholesale_eligible ? g.wholesale_price_cents : -1),
    },
    {
      key: "stock",
      header: "Stock",
      render: (g) => (
        <span className={classNames(g.quantity_on_hand <= 10 ? "text-amber-300" : "text-cream-100")}>
          {g.quantity_on_hand} × {g.unit_size}
        </span>
      ),
      sortValue: (g) => g.quantity_on_hand,
    },
    {
      key: "listing",
      header: "Listing",
      render: (g) => {
        const blockers = listingBlockers(g)
        return blockers.length === 0 ? (
          <span className="text-xs text-forest-300">● live</span>
        ) : (
          <span className="text-xs text-amber-300">{blockers.join(" · ")}</span>
        )
      },
      sortValue: (g) => listingBlockers(g).length,
    },
  ]

  return (
    <div>
      <PageHeader
        title="Listings & Order Cycles"
        subtitle="What's publishable to the FBM storefront right now, straight from finished-goods inventory."
        action={
          <Link to="/finished" className="btn-ghost text-sm">
            Manage inventory →
          </Link>
        }
      />
      <QueryState isLoading={isLoading} isError={isError}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <MetricCard label="Live listings" value={live.length} icon="🏷️" />
            <MetricCard
              label="Blocked"
              value={blocked.length}
              subtitle="label / COA / stock issues"
              icon="⚠️"
            />
            <MetricCard
              label="Wholesale toggled"
              value={wholesaleToggled.length}
              subtitle={`of ${goods.length} SKUs`}
              icon="📦"
            />
            <MetricCard
              label="Storefront value"
              value={money(
                live.reduce((s, g) => s + g.quantity_on_hand * g.retail_price_cents, 0)
              )}
              subtitle="live stock at retail"
              icon="💰"
            />
          </div>

          <Tabs
            active={tab}
            onChange={setTab}
            tabs={[
              { key: "all", label: "All pathways", count: goods.length },
              ...pathways.map((p) => ({
                key: p.id,
                label: p.name,
                count: goods.filter((g) => g.pathway_id === p.id).length,
              })),
            ]}
          />

          {shown.length === 0 ? (
            <EmptyState
              icon="🏷️"
              title="Nothing to list here"
              message="Finished goods from this pathway will appear once a run completes."
            />
          ) : (
            <DataTable columns={cols} rows={shown} exportName="listings" />
          )}
        </div>
      </QueryState>
    </div>
  )
}
