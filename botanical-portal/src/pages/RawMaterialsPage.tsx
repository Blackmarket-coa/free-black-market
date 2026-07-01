import { useMemo, useState } from "react"
import { useRawMaterials } from "@/hooks/useRawMaterials"
import { useActivePathways } from "@/hooks/useActivePathways"
import { PageHeader } from "@/components/ui/PageHeader"
import { QueryState } from "@/components/ui/QueryState"
import { Tabs } from "@/components/ui/Tabs"
import { MetricCard } from "@/components/ui/MetricCard"
import { DataTable, type Column } from "@/components/ui/DataTable"
import { getMaterialCategoryLabel } from "@/lib/pathways"
import { money, shortDate, classNames } from "@bmc/portal-kit"
import type { ProductionPathway, RawMaterial, RawMaterialLot } from "@/types"

export function RawMaterialsPage() {
  const { data: materials = [], isLoading, isError } = useRawMaterials()
  const { data: pathways = [] } = useActivePathways()
  const [tab, setTab] = useState("stock")

  const pathwayById = (id?: string): ProductionPathway | undefined =>
    pathways.find((p) => p.id === id)

  // Portfolio-wide BMC-sourced % — one combined metric across ALL pathways,
  // by lot cost. This is the headline cooperative number.
  const bmcPct = useMemo(() => {
    let bmc = 0
    let total = 0
    for (const m of materials) {
      for (const lot of m.lots) {
        total += lot.cost_cents
        if (lot.source === "bmc_nursery") bmc += lot.cost_cents
      }
    }
    return total > 0 ? Math.round((bmc / total) * 100) : 0
  }, [materials])

  const allLots = useMemo(
    () =>
      materials.flatMap((m) =>
        m.lots.map((lot) => ({ material: m, lot }))
      ),
    [materials]
  )

  const bmcLots = allLots.filter((x) => x.lot.source === "bmc_nursery")
  const externalLots = allLots.filter((x) => x.lot.source !== "bmc_nursery")

  return (
    <div>
      <PageHeader
        title="Raw Materials"
        subtitle="Ingredient inventory. Category names adapt to the pathway each material serves."
      />
      <QueryState isLoading={isLoading} isError={isError}>
        {/* Headline cooperative metric */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
          <MetricCard
            label="BMC-sourced (portfolio)"
            value={`${bmcPct}%`}
            subtitle="across all pathways, by cost"
            icon="🌐"
          />
          <MetricCard label="Materials tracked" value={materials.length} icon="🌾" />
          <MetricCard label="Lots on hand" value={allLots.length} icon="📦" />
          <MetricCard
            label="Below reorder"
            value={materials.filter((m) => m.current_stock <= m.reorder_threshold).length}
            icon="⚠️"
          />
        </div>

        <Tabs
          tabs={[
            { key: "stock", label: "Stock", count: materials.length },
            { key: "bmc", label: "BMC Network", count: bmcLots.length },
            { key: "external", label: "External Suppliers", count: externalLots.length },
            { key: "lots", label: "Lot History", count: allLots.length },
          ]}
          active={tab}
          onChange={setTab}
        />

        {tab === "stock" && (
          <div className="space-y-2">
            {materials.map((m) => (
              <StockRow key={m.id} material={m} pathway={pathwayById(m.pathway_id)} />
            ))}
          </div>
        )}

        {tab === "bmc" && <LotTable rows={bmcLots} />}
        {tab === "external" && <LotTable rows={externalLots} />}
        {tab === "lots" && <LotTable rows={allLots} />}
      </QueryState>
    </div>
  )
}

function StockRow({
  material,
  pathway,
}: {
  material: RawMaterial
  pathway?: ProductionPathway
}) {
  const low = material.current_stock <= material.reorder_threshold
  const categoryLabel = getMaterialCategoryLabel(pathway, material.category)
  return (
    <div className="panel-pad flex items-center justify-between gap-3">
      <div className="min-w-0">
        <div className="text-sm text-cream-50 truncate">
          {material.name}
          {material.botanical_name && (
            <span className="text-ghost italic text-xs ml-2">{material.botanical_name}</span>
          )}
        </div>
        <div className="mt-1 flex items-center gap-2">
          <span className="text-[10px] rounded-sm bg-moss text-mist px-1.5 py-0.5">
            {categoryLabel}
          </span>
          {material.source_default === "bmc_nursery" && (
            <span className="text-[10px] rounded-sm bg-forest-900/40 text-forest-200 px-1.5 py-0.5">
              BMC default
            </span>
          )}
        </div>
      </div>
      <div className="text-right shrink-0">
        <div className={classNames("text-sm", low ? "text-clay" : "text-cream-100")}>
          {material.current_stock} {material.stock_unit}
        </div>
        <div className="text-[11px] text-ghost">reorder ≤ {material.reorder_threshold}</div>
      </div>
    </div>
  )
}

function LotTable({ rows }: { rows: { material: RawMaterial; lot: RawMaterialLot }[] }) {
  const columns: Column<{ material: RawMaterial; lot: RawMaterialLot }>[] = [
    {
      key: "lot",
      header: "Lot",
      render: (r) => <span className="font-mono text-xs">{r.lot.lot_number}</span>,
      sortValue: (r) => r.lot.lot_number,
    },
    {
      key: "material",
      header: "Material",
      render: (r) => r.material.name,
      sortValue: (r) => r.material.name,
    },
    {
      key: "source",
      header: "Source",
      render: (r) =>
        r.lot.source === "bmc_nursery" ? (
          <span className="text-forest-300">
            BMC {r.lot.bmc_grower_node?.replace("node_", "").toUpperCase()}
          </span>
        ) : (
          <span className="text-mist">{r.lot.source.replace(/_/g, " ")}</span>
        ),
      sortValue: (r) => r.lot.source,
    },
    {
      key: "remaining",
      header: "Remaining",
      render: (r) => `${r.lot.remaining} ${r.lot.unit}`,
      sortValue: (r) => r.lot.remaining,
    },
    {
      key: "purchased",
      header: "Purchased",
      render: (r) => shortDate(r.lot.purchase_date),
      sortValue: (r) => r.lot.purchase_date,
    },
    {
      key: "cost",
      header: "Cost",
      render: (r) => money(r.lot.cost_cents),
      sortValue: (r) => r.lot.cost_cents,
    },
  ]
  return <DataTable columns={columns} rows={rows} exportName="raw-material-lots" empty="No lots" />
}
