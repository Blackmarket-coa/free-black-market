import { Link } from "react-router-dom"
import { useDashboardSummary } from "@/hooks/useDashboardSummary"
import { useActivePathways } from "@/hooks/useActivePathways"
import { PageHeader } from "@bmc/ui"
import { MetricCard } from "@bmc/ui"
import { UrgentBanner } from "@bmc/ui"
import { QueryState } from "@bmc/ui"
import { RunStatusBadge } from "@/components/production/RunStatusBadge"
import { CureTimer } from "@/components/production/CureTimer"
import { money, classNames } from "@bmc/portal-kit"
import type { ProductionPathway } from "@/types"

// Per-portal urgent-action icon map passed to the shared UrgentBanner.
const URGENT_ICONS: Record<string, string> = {
  orders: "🛒",
  inventory: "🪴",
  seasonal: "📅",
  quest: "🏆",
  compliance: "⚠️",
}

const SEVERITY_DOT: Record<string, string> = {
  high: "bg-clay",
  med: "bg-amber-400",
  low: "bg-forest-500",
}

export function DashboardPage() {
  const { data, isLoading, isError } = useDashboardSummary()
  const { data: pathways = [] } = useActivePathways()

  // Pathway-conditional sections — derived entirely from the active pathways.
  const showCureTimer = pathways.some((p) => (p.default_cure_time_days ?? 0) > 0)
  const showPhAlert = pathways.some((p) => p.requires_ph_testing)
  const showGermAlert = pathways.some((p) => p.output_category === "seed_packet")

  const pathwayById = (id: string): ProductionPathway | undefined =>
    pathways.find((p) => p.id === id)

  return (
    <div>
      <PageHeader title="Dashboard" subtitle="Your workshop today" />
      <QueryState isLoading={isLoading} isError={isError}>
        {data && (
          <div className="space-y-6">
            {/* Urgent / compliance flags */}
            {data.urgent_actions.length > 0 && (
              <div className="space-y-2">
                {data.urgent_actions.map((a, i) => (
                  <UrgentBanner key={i} action={a} icons={URGENT_ICONS} />
                ))}
              </div>
            )}

            {/* Today's numbers */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <MetricCard label="Active runs" value={data.todays_metrics.active_runs} icon="⚗️" />
              <MetricCard
                label="Units on hand"
                value={data.todays_metrics.finished_units_on_hand}
                icon="🫙"
              />
              <MetricCard
                label="Active formulas"
                value={data.todays_metrics.active_formulas}
                icon="📖"
              />
              <MetricCard
                label="This month"
                value={money(data.todays_metrics.month_earnings_cents)}
                icon="💸"
              />
            </div>

            {/* Cooperative headline metric — always portfolio-wide */}
            <section className="panel-pad">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs uppercase tracking-wide text-ghost">
                    BMC-sourced ingredients
                  </div>
                  <div className="text-mist text-xs mt-0.5">
                    Across all {pathways.length} pathways — the cooperative supply metric.
                  </div>
                </div>
                <div className="heading text-3xl text-forest-300">{data.bmc_sourced_pct}%</div>
              </div>
              <div className="mt-3 h-2 rounded-full bg-moss overflow-hidden">
                <div
                  className="h-full bg-forest-500"
                  style={{ width: `${Math.min(100, data.bmc_sourced_pct)}%` }}
                />
              </div>
            </section>

            <div className="grid lg:grid-cols-2 gap-6">
              {/* Production queue — pathway status labels + cure timers */}
              <section>
                <div className="flex items-center justify-between mb-2">
                  <h2 className="heading text-base">Production queue</h2>
                  <Link to="/production" className="text-xs text-forest-300">
                    View all →
                  </Link>
                </div>
                <div className="space-y-3">
                  {data.production_queue.map((run) => {
                    const pathway = pathwayById(run.pathway_id)
                    return (
                      <div key={run.id} className="panel-pad">
                        <div className="flex items-center justify-between">
                          <div className="min-w-0">
                            <div className="text-sm text-cream-100 truncate">
                              {run.formula_name}
                            </div>
                            <div className="text-[11px] text-ghost font-mono">
                              {run.batch_number}
                            </div>
                          </div>
                          <RunStatusBadge pathway={pathway} status={run.status} />
                        </div>
                        {showCureTimer && (
                          <CureTimer run={run} pathway={pathway} className="mt-2" />
                        )}
                      </div>
                    )
                  })}
                </div>
              </section>

              {/* Inventory alerts — pathway-aware */}
              <section>
                <div className="flex items-center justify-between mb-2">
                  <h2 className="heading text-base">Inventory alerts</h2>
                  <Link to="/raw-materials" className="text-xs text-forest-300">
                    View all →
                  </Link>
                </div>
                <div className="panel divide-y divide-moss/50">
                  {data.inventory_alerts.map((a) => (
                    <div key={a.id} className="flex items-center gap-3 px-3 py-2.5">
                      <span
                        className={classNames(
                          "w-1.5 h-1.5 rounded-full shrink-0",
                          SEVERITY_DOT[a.severity]
                        )}
                      />
                      <div className="min-w-0">
                        <div className="text-sm text-cream-100">{a.label}</div>
                        <div className="text-xs text-mist truncate">{a.detail}</div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Conditional compliance hints — only when a relevant pathway is active */}
                <div className="mt-3 space-y-1.5 text-xs text-ghost">
                  {showPhAlert && (
                    <div>🧪 pH testing tracked for acidified/fermented pathways.</div>
                  )}
                  {showGermAlert && (
                    <div>🌱 Germination retests tracked for the seed pathway.</div>
                  )}
                </div>
              </section>
            </div>

            {/* Quest progress */}
            <section>
              <div className="flex items-center justify-between mb-2">
                <h2 className="heading text-base">Quests</h2>
                <Link to="/quests" className="text-xs text-forest-300">
                  View all →
                </Link>
              </div>
              <div className="grid sm:grid-cols-3 gap-2">
                {data.quest_highlights.map((q, i) => {
                  const progress = Math.min(1, q.current / q.required)
                  return (
                    <div key={i} className="panel-pad">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-cream-100 truncate">{q.quest_title}</span>
                        <span className="text-xs text-amber-300 shrink-0 ml-2">
                          +{q.karma_reward}
                        </span>
                      </div>
                      <div className="mt-2 h-1.5 rounded-full bg-moss overflow-hidden">
                        <div
                          className="h-full bg-forest-500"
                          style={{ width: `${Math.round(progress * 100)}%` }}
                        />
                      </div>
                      <div className="text-xs text-ghost mt-1">
                        {q.current}/{q.required}
                      </div>
                    </div>
                  )
                })}
              </div>
            </section>
          </div>
        )}
      </QueryState>
    </div>
  )
}
