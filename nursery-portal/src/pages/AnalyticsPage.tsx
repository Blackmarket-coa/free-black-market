import { useAnalytics } from "@/hooks/useAnalytics"
import { PageHeader } from "@bmc/ui"
import { MetricCard } from "@bmc/ui"
import { QueryState } from "@bmc/ui"
import { DataTable, type Column } from "@bmc/ui"
import type { SpeciesPerformance } from "@/types"
import { money, monthLabel, pct } from "@bmc/portal-kit"

// Short "May" label for chart axes.
function shortMonth(ym: string): string {
  return monthLabel(ym).split(" ")[0]
}

export function AnalyticsPage() {
  const { data, isLoading, isError } = useAnalytics()

  const speciesCols: Column<SpeciesPerformance>[] = [
    { key: "species", header: "Species", render: (r) => <span className="text-cream-100">{r.species_name}</span>, sortValue: (r) => r.species_name },
    { key: "units", header: "Units", render: (r) => r.units, sortValue: (r) => r.units },
    { key: "revenue", header: "Revenue", render: (r) => money(r.revenue_cents), sortValue: (r) => r.revenue_cents },
    { key: "avg", header: "Avg price", render: (r) => <span className="text-mist">{money(r.avg_price_cents)}</span>, sortValue: (r) => r.avg_price_cents },
    {
      key: "doa",
      header: "DOA",
      render: (r) =>
        r.doa_count === 0 ? (
          <span className="text-forest-300">0</span>
        ) : (
          <span className="text-amber-300">{r.doa_count}</span>
        ),
      sortValue: (r) => r.doa_count,
    },
  ]

  return (
    <div>
      <PageHeader
        title="Analytics"
        subtitle="Revenue, propagation success, and where your plants are going"
      />
      <QueryState isLoading={isLoading} isError={isError}>
        {data && (
          <div className="space-y-6">
            {/* Row 1 — headline numbers (YTD from the monthly series) */}
            {(() => {
              const grossYtd = data.revenue_by_month.reduce((s, m) => s + m.gross_cents, 0)
              const netYtd = data.revenue_by_month.reduce((s, m) => s + m.net_cents, 0)
              const unitsYtd = data.revenue_by_month.reduce((s, m) => s + m.units, 0)
              const started = data.method_success.reduce((s, m) => s + m.qty_started, 0)
              const succeeded = data.method_success.reduce((s, m) => s + m.qty_successful, 0)
              const successRate = started > 0 ? (succeeded / started) * 100 : 0
              return (
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                  <MetricCard label="Gross revenue (YTD)" value={money(grossYtd)} icon="💵" />
                  <MetricCard
                    label="Net to you (YTD)"
                    value={money(netYtd)}
                    subtitle={`${money(grossYtd - netYtd)} platform fees`}
                    icon="💸"
                  />
                  <MetricCard label="Units sold (YTD)" value={unitsYtd} icon="🪴" />
                  <MetricCard
                    label="Batch success rate"
                    value={pct(successRate)}
                    subtitle={`${succeeded}/${started} plants across ${data.method_success.reduce((s, m) => s + m.batches, 0)} batches`}
                    icon="🌱"
                  />
                </div>
              )
            })()}

            {/* Row 2 — revenue by month (stacked: net + fees = gross) */}
            <section className="panel-pad">
              <div className="flex items-center justify-between mb-3">
                <h2 className="heading text-base">Revenue by month</h2>
                <div className="flex items-center gap-3 text-[11px] text-ghost">
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-sm bg-forest-500" /> Net to you
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-sm bg-moss" /> Fees
                  </span>
                </div>
              </div>
              {(() => {
                const max = Math.max(...data.revenue_by_month.map((m) => m.gross_cents), 1)
                return (
                  <div className="flex items-end gap-2 h-36">
                    {data.revenue_by_month.map((m) => {
                      const grossPct = (m.gross_cents / max) * 100
                      const netShare = m.gross_cents > 0 ? (m.net_cents / m.gross_cents) * 100 : 0
                      return (
                        <div
                          key={m.month}
                          className="flex-1 flex flex-col justify-end h-full"
                          title={`${monthLabel(m.month)} — ${money(m.gross_cents)} gross, ${money(m.net_cents)} net, ${m.units} units`}
                        >
                          <div
                            className="w-full rounded-t-sm overflow-hidden flex flex-col"
                            style={{ height: `${grossPct}%` }}
                          >
                            <div className="bg-moss w-full" style={{ height: `${100 - netShare}%` }} />
                            <div className="bg-forest-500 w-full flex-1" />
                          </div>
                          <div className="text-[11px] text-ghost text-center mt-1">
                            {shortMonth(m.month)}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )
              })()}
            </section>

            <div className="grid lg:grid-cols-2 gap-6">
              {/* Row 3a — propagation success by method */}
              <section className="panel-pad">
                <h2 className="heading text-base mb-3">Propagation success by method</h2>
                <div className="space-y-3">
                  {data.method_success.map((m) => {
                    const rate = m.qty_started > 0 ? m.qty_successful / m.qty_started : 0
                    return (
                      <div key={m.method}>
                        <div className="flex items-center justify-between text-sm mb-1">
                          <span className="capitalize text-cream-100">{m.method}</span>
                          <span className="text-mist">
                            {pct(rate * 100)}{" "}
                            <span className="text-ghost text-xs">
                              ({m.qty_successful}/{m.qty_started}, {m.batches} batches)
                            </span>
                          </span>
                        </div>
                        <div className="h-2 rounded-full bg-moss overflow-hidden">
                          <div
                            className="h-full bg-forest-500"
                            style={{ width: `${Math.round(rate * 100)}%` }}
                          />
                        </div>
                      </div>
                    )
                  })}
                </div>
              </section>

              {/* Row 3b — sales by destination state */}
              <section className="panel-pad">
                <h2 className="heading text-base mb-3">Sales by destination state</h2>
                <div className="space-y-2">
                  {(() => {
                    const max = Math.max(...data.sales_by_state.map((s) => s.units), 1)
                    return data.sales_by_state.map((s) => (
                      <div key={s.state} className="flex items-center gap-2 text-sm">
                        <span className="w-8 text-mist shrink-0">{s.state}</span>
                        <div className="flex-1 h-2.5 rounded-full bg-soil overflow-hidden">
                          <div
                            className="h-full bg-forest-500 rounded-full"
                            style={{ width: `${Math.round((s.units / max) * 100)}%` }}
                          />
                        </div>
                        <span className="w-8 text-right text-ghost text-xs shrink-0">
                          {s.units}
                        </span>
                      </div>
                    ))
                  })()}
                </div>
              </section>
            </div>

            {/* Row 4 — DOA rate trend */}
            <section className="panel-pad">
              <h2 className="heading text-base mb-3">DOA rate trend</h2>
              <div className="flex items-end gap-2 h-16">
                {(() => {
                  const max = Math.max(...data.doa_rate_trend.map((d) => d.rate), 0.001)
                  return data.doa_rate_trend.map((d) => (
                    <div
                      key={d.month}
                      className="flex-1 flex flex-col justify-end h-full"
                      title={`${monthLabel(d.month)} — ${(d.rate * 100).toFixed(1)}% DOA`}
                    >
                      <div
                        className="w-full rounded-t-sm bg-clay/70"
                        style={{ height: `${Math.max(4, (d.rate / max) * 100)}%` }}
                      />
                      <div className="text-[11px] text-ghost text-center mt-1">
                        {shortMonth(d.month)}
                      </div>
                    </div>
                  ))
                })()}
              </div>
              <div className="text-xs text-mist mt-2">
                Latest:{" "}
                <span className="text-forest-300">
                  {(data.doa_rate_trend[data.doa_rate_trend.length - 1].rate * 100).toFixed(1)}%
                </span>{" "}
                of shipped plants claimed dead on arrival.
              </div>
            </section>

            {/* Row 5 — top species table */}
            <section>
              <h2 className="heading text-base mb-2">Species performance</h2>
              <DataTable
                columns={speciesCols}
                rows={data.top_species}
                exportName="species-performance"
                empty="No sales recorded yet."
              />
            </section>
          </div>
        )}
      </QueryState>
    </div>
  )
}
