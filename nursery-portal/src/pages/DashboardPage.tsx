import { Link } from "react-router-dom"
import { useDashboard } from "@/hooks/useDashboard"
import { usePayouts } from "@/hooks/usePayouts"
import { useRole } from "@/hooks/useRole"
import { PageHeader } from "@/components/ui/PageHeader"
import { MetricCard } from "@/components/ui/MetricCard"
import { UrgentBanner } from "@/components/ui/UrgentBanner"
import { QueryState } from "@/components/ui/QueryState"
import { BatchCard } from "@/components/inventory/BatchCard"
import { MessageFeed } from "@/components/blackout/MessageFeed"
import { money, shortDate, classNames } from "@bmc/portal-kit"

const HEALTH_COLOR: Record<string, string> = {
  green: "bg-forest-500",
  yellow: "bg-amber-400",
  red: "bg-clay",
}

export function DashboardPage() {
  const { isHub } = useRole()
  const { data, isLoading, isError } = useDashboard()
  const { data: payouts } = usePayouts()

  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle={isHub ? "Network at a glance" : "Your node today"}
      />
      <QueryState isLoading={isLoading} isError={isError}>
        {data && (
          <div className="space-y-6">
            {/* Row 1 — urgent actions */}
            {data.urgent_actions.length > 0 && (
              <div className="space-y-2">
                {data.urgent_actions.map((a, i) => (
                  <UrgentBanner key={i} action={a} />
                ))}
              </div>
            )}

            {/* Row 2 — today's numbers */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <MetricCard
                label="Orders pending"
                value={data.todays_metrics.orders_pending}
                icon="🛒"
              />
              <MetricCard
                label="Units in propagation"
                value={data.todays_metrics.units_in_propagation}
                icon="🌱"
              />
              <MetricCard
                label="Active listings"
                value={data.todays_metrics.active_listings}
                icon="🏷️"
              />
              <MetricCard
                label="This month"
                value={money(data.todays_metrics.month_earnings_cents)}
                subtitle={payouts ? `${payouts.current_period.split_pct}% split` : undefined}
                icon="💸"
              />
            </div>

            {/* Hub-only — network health */}
            {isHub && data.network_health && (
              <section>
                <h2 className="heading text-base mb-2">Network health</h2>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {data.network_health.map((n) => (
                    <div key={n.node_id} className="panel-pad">
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-cream-50">{n.name}</span>
                        <span
                          className={classNames(
                            "w-2.5 h-2.5 rounded-full",
                            HEALTH_COLOR[n.health]
                          )}
                        />
                      </div>
                      <div className="text-xs text-mist mt-1">
                        {n.units_this_month} units · {n.pending_fulfillments} pending
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            <div className="grid lg:grid-cols-2 gap-6">
              {/* Row 3 — propagation status */}
              <section>
                <div className="flex items-center justify-between mb-2">
                  <h2 className="heading text-base">Propagation</h2>
                  <Link to="/propagation" className="text-xs text-forest-300">
                    View all →
                  </Link>
                </div>
                <div className="space-y-3">
                  {data.propagation_batches.slice(0, 3).map((b) => (
                    <BatchCard key={b.id} batch={b} />
                  ))}
                </div>
              </section>

              {/* Row 4 — recent orders */}
              <section>
                <div className="flex items-center justify-between mb-2">
                  <h2 className="heading text-base">Recent orders</h2>
                  <Link to="/orders" className="text-xs text-forest-300">
                    View all →
                  </Link>
                </div>
                <div className="panel divide-y divide-moss/50">
                  {data.recent_orders.map((o) => (
                    <div key={o.id} className="flex items-center justify-between px-3 py-2">
                      <div className="min-w-0">
                        <div className="text-sm text-cream-100">
                          #{o.id.replace("ord_", "")} · {o.destination_state}
                        </div>
                        <div className="text-xs text-mist truncate">
                          {o.lines.map((l) => `${l.qty}× ${l.species_name}`).join(", ")}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-xs text-cream-100">{money(o.total_cents)}</div>
                        <div className="text-[11px] text-ghost">
                          ship {shortDate(o.ship_by)}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            </div>

            {/* Row 5 — seasonal alerts */}
            <section>
              <h2 className="heading text-base mb-2">This week</h2>
              <div className="panel divide-y divide-moss/50">
                {data.seasonal_alerts.map((a, i) => (
                  <div key={i} className="flex items-center gap-3 px-3 py-2">
                    <span
                      className={classNames(
                        "w-1.5 h-1.5 rounded-full shrink-0",
                        a.urgency === "high"
                          ? "bg-clay"
                          : a.urgency === "med"
                          ? "bg-amber-400"
                          : "bg-forest-500"
                      )}
                    />
                    <span className="text-sm text-cream-100">{a.action}</span>
                  </div>
                ))}
              </div>
            </section>

            <div className="grid lg:grid-cols-2 gap-6">
              {/* Row 6 — blackout feed */}
              <section>
                <div className="flex items-center justify-between mb-2">
                  <h2 className="heading text-base">Blackout</h2>
                  <Link to="/blackout" className="text-xs text-forest-300">
                    Open →
                  </Link>
                </div>
                <MessageFeed messages={data.blackout_preview} />
              </section>

              {/* Row 7 — quest progress */}
              <section>
                <div className="flex items-center justify-between mb-2">
                  <h2 className="heading text-base">Quests</h2>
                  <Link to="/quests" className="text-xs text-forest-300">
                    View all →
                  </Link>
                </div>
                <div className="space-y-2">
                  {data.quest_highlights.map((q, i) => {
                    const progress = Math.min(1, q.current / q.required)
                    return (
                      <div key={i} className="panel-pad">
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-cream-100">{q.quest_title}</span>
                          <span className="text-xs text-amber-300">+{q.karma_reward} KARMA</span>
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
          </div>
        )}
      </QueryState>
    </div>
  )
}
