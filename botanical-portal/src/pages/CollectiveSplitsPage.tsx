import { useCollectiveSplits } from "@/hooks/useCollectiveSplits"
import { useOperatorType } from "@/hooks/useOperatorType"
import { PageHeader } from "@bmc/ui"
import { MetricCard } from "@bmc/ui"
import { QueryState } from "@bmc/ui"
import { EmptyState } from "@bmc/ui"
import { money, shortDate, monthLabel, pct } from "@bmc/portal-kit"
import type { CollectiveRole } from "@/types"

const ROLE_STYLE: Record<CollectiveRole, string> = {
  founder: "text-forest-300",
  member: "text-cream-100",
  apprentice: "text-amber-300",
}

// Collective only — guarded at the route level in App.tsx; the in-page guard
// covers direct navigation while running as a solo maker.
export function CollectiveSplitsPage() {
  const { isCollective } = useOperatorType()
  const { data, isLoading, isError } = useCollectiveSplits()

  if (!isCollective) {
    return (
      <div>
        <PageHeader title="Pool Splits" />
        <EmptyState
          icon="🤝"
          title="Collective operators only"
          message="Pool splits apply to shared production houses. Solo makers keep the full maker split — see Payouts."
        />
      </div>
    )
  }

  return (
    <div>
      <PageHeader
        title="Pool Splits"
        subtitle="Pooled revenue across shared production, split by member contribution."
      />
      <QueryState isLoading={isLoading} isError={isError}>
        {data && (
          <div className="space-y-6">
            {/* Period totals */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <MetricCard
                label="Pool gross"
                value={money(data.pool_gross_cents)}
                subtitle={monthLabel(data.period)}
              />
              <MetricCard label="Hub cut" value={money(data.hub_cut_cents)} />
              <MetricCard label="Pool net" value={money(data.pool_net_cents)} />
              <MetricCard
                label="Members"
                value={data.members.length}
                subtitle={`settles ${shortDate(data.settlement_date)}`}
              />
            </div>

            {/* Active split rule */}
            <section className="panel-pad">
              <div className="text-xs uppercase tracking-wide text-ghost mb-1">
                Active split rule
              </div>
              <p className="text-sm text-mist">{data.split_rule}</p>
            </section>

            {/* Member contribution + splits */}
            <section>
              <h2 className="heading text-base mb-2">Member splits — {monthLabel(data.period)}</h2>
              <div className="panel overflow-x-auto scroll-area">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-ghost border-b border-moss">
                      <th className="px-3 py-2 font-medium">Maker</th>
                      <th className="px-3 py-2 font-medium">Role</th>
                      <th className="px-3 py-2 font-medium">Units</th>
                      <th className="px-3 py-2 font-medium">Batches</th>
                      <th className="px-3 py-2 font-medium">Split</th>
                      <th className="px-3 py-2 font-medium">Payout (est.)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.members.map((m) => (
                      <tr key={m.maker_id} className="border-b border-moss/50 hover:bg-moss/30">
                        <td className="px-3 py-2 text-cream-100">{m.maker_name}</td>
                        <td className="px-3 py-2">
                          <span className={`text-xs capitalize ${ROLE_STYLE[m.role]}`}>
                            {m.role}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-mist">{m.contribution_units}</td>
                        <td className="px-3 py-2 text-mist">{m.contribution_batches}</td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2 min-w-[120px]">
                            <div className="flex-1 h-1.5 rounded-full bg-moss overflow-hidden">
                              <div
                                className="h-full bg-forest-500"
                                style={{ width: `${Math.min(100, m.split_pct)}%` }}
                              />
                            </div>
                            <span className="text-cream-100 text-xs shrink-0">
                              {pct(m.split_pct)}
                            </span>
                          </div>
                        </td>
                        <td className="px-3 py-2 text-cream-100">
                          {money(m.period_earned_cents)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            {/* Settlement preview */}
            <section className="panel-pad">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm text-cream-100">Settlement preview</div>
                  <div className="text-xs text-mist mt-0.5">
                    {money(data.pool_net_cents)} pool net →{" "}
                    {money(
                      data.members.reduce((s, m) => s + m.period_earned_cents, 0)
                    )}{" "}
                    distributed across {data.members.length} makers on{" "}
                    {shortDate(data.settlement_date)}.
                  </div>
                </div>
                <button className="btn-ghost text-xs" disabled>
                  Adjust rule
                </button>
              </div>
            </section>
          </div>
        )}
      </QueryState>
    </div>
  )
}
