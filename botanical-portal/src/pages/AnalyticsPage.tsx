import { useMemo } from "react"
import { useProductionRuns } from "@/hooks/useProductionRuns"
import { useFinishedGoods } from "@/hooks/useFinishedGoods"
import { useFormulas } from "@/hooks/useFormulas"
import { useActivePathways } from "@/hooks/useActivePathways"
import { useDashboardSummary } from "@/hooks/useDashboardSummary"
import { PageHeader } from "@bmc/ui"
import { MetricCard } from "@bmc/ui"
import { QueryState } from "@bmc/ui"
import { DataTable, type Column } from "@bmc/ui"
import { iconForOutput } from "@/lib/pathways"
import { money, pct, classNames } from "@bmc/portal-kit"
import type { Formula, ProductionPathway } from "@/types"

// Everything on this page is COMPUTED from the same hooks the operational
// pages use (runs + finished goods + formulas) — no separate analytics store.

interface PathwayRow {
  pathway: ProductionPathway
  runsTotal: number
  runsComplete: number
  plannedUnits: number
  actualUnits: number
  efficiencyPct: number | null // actual/planned across completed runs
  unitsOnHand: number
  onHandRetailCents: number
}

export function AnalyticsPage() {
  const runs = useProductionRuns()
  const goods = useFinishedGoods()
  const formulas = useFormulas()
  const { data: pathways = [] } = useActivePathways()
  const { data: dashboard } = useDashboardSummary()

  const isLoading = runs.isLoading || goods.isLoading || formulas.isLoading
  const isError = runs.isError || goods.isError || formulas.isError

  const rows: PathwayRow[] = useMemo(() => {
    return pathways.map((pathway) => {
      const pRuns = (runs.data ?? []).filter((r) => r.pathway_id === pathway.id)
      const completed = pRuns.filter((r) => r.status === "complete")
      const plannedUnits = completed.reduce((s, r) => s + r.planned_yield_units, 0)
      const actualUnits = completed.reduce((s, r) => s + (r.actual_yield_units ?? 0), 0)
      const pGoods = (goods.data ?? []).filter(
        (g) => g.pathway_id === pathway.id && g.status === "available"
      )
      return {
        pathway,
        runsTotal: pRuns.length,
        runsComplete: completed.length,
        plannedUnits,
        actualUnits,
        efficiencyPct: plannedUnits > 0 ? (actualUnits / plannedUnits) * 100 : null,
        unitsOnHand: pGoods.reduce((s, g) => s + g.quantity_on_hand, 0),
        onHandRetailCents: pGoods.reduce(
          (s, g) => s + g.quantity_on_hand * g.retail_price_cents,
          0
        ),
      }
    })
  }, [pathways, runs.data, goods.data])

  const totals = useMemo(() => {
    const completed = (runs.data ?? []).filter((r) => r.status === "complete")
    const planned = completed.reduce((s, r) => s + r.planned_yield_units, 0)
    const actual = completed.reduce((s, r) => s + (r.actual_yield_units ?? 0), 0)
    const available = (goods.data ?? []).filter((g) => g.status === "available")
    return {
      runsComplete: completed.length,
      runsActive: (runs.data ?? []).filter((r) => !["complete", "failed"].includes(r.status))
        .length,
      efficiencyPct: planned > 0 ? (actual / planned) * 100 : null,
      unitsOnHand: available.reduce((s, g) => s + g.quantity_on_hand, 0),
      onHandRetailCents: available.reduce(
        (s, g) => s + g.quantity_on_hand * g.retail_price_cents,
        0
      ),
    }
  }, [runs.data, goods.data])

  const pathwayCols: Column<PathwayRow>[] = [
    {
      key: "pathway",
      header: "Pathway",
      render: (r) => (
        <span className="flex items-center gap-2">
          <span>{iconForOutput(r.pathway.output_category)}</span>
          <span className="text-cream-100">{r.pathway.name}</span>
        </span>
      ),
      sortValue: (r) => r.pathway.name,
    },
    {
      key: "runs",
      header: "Runs (done/all)",
      render: (r) => (
        <span className="text-mist">
          {r.runsComplete}/{r.runsTotal}
        </span>
      ),
      sortValue: (r) => r.runsComplete,
    },
    {
      key: "yield",
      header: "Yield (actual/planned)",
      render: (r) =>
        r.plannedUnits > 0 ? (
          <span className="text-cream-100">
            {r.actualUnits}/{r.plannedUnits}
          </span>
        ) : (
          <span className="text-ghost">no completed runs</span>
        ),
      sortValue: (r) => r.actualUnits,
    },
    {
      key: "efficiency",
      header: "Efficiency",
      render: (r) =>
        r.efficiencyPct == null ? (
          <span className="text-ghost">—</span>
        ) : (
          <span
            className={classNames(
              r.efficiencyPct >= 95
                ? "text-forest-300"
                : r.efficiencyPct >= 80
                ? "text-amber-300"
                : "text-clay"
            )}
          >
            {pct(r.efficiencyPct)}
          </span>
        ),
      sortValue: (r) => r.efficiencyPct ?? -1,
    },
    {
      key: "on_hand",
      header: "Units on hand",
      render: (r) => <span className="text-cream-100">{r.unitsOnHand}</span>,
      sortValue: (r) => r.unitsOnHand,
    },
    {
      key: "value",
      header: "On-hand value (retail)",
      render: (r) => <span className="text-mist">{money(r.onHandRetailCents)}</span>,
      sortValue: (r) => r.onHandRetailCents,
    },
  ]

  // Unit margin by formula, from formula cost vs target prices.
  const marginCols: Column<Formula>[] = [
    {
      key: "formula",
      header: "Formula",
      render: (f) => <span className="text-cream-100">{f.name}</span>,
      sortValue: (f) => f.name,
    },
    {
      key: "pathway",
      header: "Pathway",
      render: (f) => (
        <span className="text-mist">
          {pathways.find((p) => p.id === f.pathway_id)?.name ?? f.pathway_id}
        </span>
      ),
      sortValue: (f) => pathways.find((p) => p.id === f.pathway_id)?.name ?? "",
    },
    {
      key: "cost",
      header: "Cost/unit",
      render: (f) => <span className="text-mist">{money(f.cost_per_unit_cents)}</span>,
      sortValue: (f) => f.cost_per_unit_cents,
    },
    {
      key: "retail",
      header: "Retail margin",
      render: (f) => <MarginCell price={f.target_retail_price_cents} cost={f.cost_per_unit_cents} />,
      sortValue: (f) =>
        f.target_retail_price_cents > 0
          ? (f.target_retail_price_cents - f.cost_per_unit_cents) / f.target_retail_price_cents
          : 0,
    },
    {
      key: "wholesale",
      header: "Wholesale margin",
      render: (f) =>
        f.target_wholesale_price_cents > 0 ? (
          <MarginCell price={f.target_wholesale_price_cents} cost={f.cost_per_unit_cents} />
        ) : (
          <span className="text-ghost">retail only</span>
        ),
      sortValue: (f) =>
        f.target_wholesale_price_cents > 0
          ? (f.target_wholesale_price_cents - f.cost_per_unit_cents) /
            f.target_wholesale_price_cents
          : -1,
    },
  ]

  return (
    <div>
      <PageHeader
        title="Analytics"
        subtitle="Computed from your production runs, formulas, and finished goods — the same records the operational pages use."
      />
      <QueryState isLoading={isLoading} isError={isError}>
        <div className="space-y-6">
          {/* Headline metrics */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <MetricCard
              label="Runs completed"
              value={totals.runsComplete}
              subtitle={`${totals.runsActive} active now`}
              icon="⚗️"
            />
            <MetricCard
              label="Yield efficiency"
              value={totals.efficiencyPct == null ? "—" : pct(totals.efficiencyPct)}
              subtitle="actual vs planned, completed runs"
              icon="🎯"
            />
            <MetricCard
              label="Units on hand"
              value={totals.unitsOnHand}
              subtitle={`${money(totals.onHandRetailCents)} at retail`}
              icon="🫙"
            />
            <MetricCard
              label="BMC-sourced"
              value={dashboard ? pct(dashboard.bmc_sourced_pct) : "—"}
              subtitle="portfolio-wide, current"
              icon="🌐"
            />
          </div>

          {/* Per-pathway breakdown */}
          <section>
            <h2 className="heading text-base mb-2">By pathway</h2>
            <DataTable columns={pathwayCols} rows={rows} exportName="analytics-by-pathway" />
          </section>

          {/* Margin by formula */}
          <section>
            <h2 className="heading text-base mb-2">Unit margin by formula</h2>
            <p className="text-xs text-mist mb-2">
              From formula cost per unit vs target prices. Realized margin lands here once the
              sales ledger is wired in.
            </p>
            <DataTable
              columns={marginCols}
              rows={formulas.data ?? []}
              exportName="analytics-margins"
            />
          </section>
        </div>
      </QueryState>
    </div>
  )
}

function MarginCell({ price, cost }: { price: number; cost: number }) {
  const marginPct = price > 0 ? ((price - cost) / price) * 100 : 0
  return (
    <span>
      <span
        className={classNames(
          marginPct >= 60 ? "text-forest-300" : marginPct >= 40 ? "text-cream-100" : "text-amber-300"
        )}
      >
        {pct(marginPct)}
      </span>
      <span className="text-[11px] text-ghost ml-1.5">{money(price - cost)}/unit</span>
    </span>
  )
}
