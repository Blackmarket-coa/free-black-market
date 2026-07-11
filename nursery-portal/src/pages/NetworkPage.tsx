import { useNetwork } from "@/hooks/useNetwork"
import { useRole } from "@/hooks/useRole"
import { PageHeader } from "@bmc/ui"
import { MetricCard } from "@bmc/ui"
import { QueryState } from "@bmc/ui"
import { DataTable, type Column } from "@bmc/ui"
import { EmptyState } from "@bmc/ui"
import { TierBadge } from "@bmc/ui"
import type { NodeHealth, NodeTransferStatus, NodeApplicationStage } from "@/types"
import { money, shortDate, classNames } from "@bmc/portal-kit"

const HEALTH: Record<NodeHealth["health"], { dot: string; label: string }> = {
  green: { dot: "bg-forest-500", label: "Healthy" },
  yellow: { dot: "bg-amber-400", label: "Falling behind" },
  red: { dot: "bg-clay", label: "Needs attention" },
}

const TRANSFER_STATUS: Record<NodeTransferStatus, { label: string; className: string }> = {
  requested: { label: "Requested", className: "text-amber-300" },
  in_transit: { label: "In transit", className: "text-forest-300" },
  received: { label: "Received", className: "text-ghost" },
}

const APPLICATION_STAGE: Record<NodeApplicationStage, string> = {
  applied: "Applied",
  interview: "Interview",
  trial_batch: "Trial batch",
  approved: "Approved",
}

// Hub only — also guarded at the route level in App.tsx.
export function NetworkPage() {
  const { isHub } = useRole()
  const { data, isLoading, isError } = useNetwork()

  if (!isHub) {
    return (
      <EmptyState
        icon="🌐"
        title="Hub access only"
        message="The network overview is the Hub operator's surface."
      />
    )
  }

  const nodeCols: Column<NodeHealth>[] = [
    { key: "name", header: "Node", render: (n) => <span className="text-cream-50 font-medium">{n.name}</span>, sortValue: (n) => n.name },
    { key: "state", header: "State", render: (n) => <span className="text-mist">{n.state}</span>, sortValue: (n) => n.state },
    { key: "tier", header: "Tier", render: (n) => <TierBadge tier={n.tier} /> },
    { key: "units", header: "Units this month", render: (n) => n.units_this_month, sortValue: (n) => n.units_this_month },
    {
      key: "pending",
      header: "Pending fulfillments",
      render: (n) =>
        n.pending_fulfillments > 3 ? (
          <span className="text-amber-300">{n.pending_fulfillments}</span>
        ) : (
          <span className="text-mist">{n.pending_fulfillments}</span>
        ),
      sortValue: (n) => n.pending_fulfillments,
    },
    {
      key: "health",
      header: "Health",
      render: (n) => (
        <span className="flex items-center gap-2">
          <span className={classNames("w-2.5 h-2.5 rounded-full shrink-0", HEALTH[n.health].dot)} />
          <span className="text-mist">{HEALTH[n.health].label}</span>
        </span>
      ),
      sortValue: (n) => n.health,
    },
    { key: "actions", header: "", render: () => <button className="btn-ghost text-xs">Message</button> },
  ]

  return (
    <div>
      <PageHeader
        title="Network"
        subtitle="Node health, inter-node transfers, and onboarding"
      />
      <QueryState isLoading={isLoading} isError={isError}>
        {data && (
          <div className="space-y-6">
            {/* Row 1 — network totals */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <MetricCard label="Units this month" value={data.totals.units_this_month} icon="🪴" />
              <MetricCard label="Network gross" value={money(data.totals.gross_cents)} icon="💵" />
              <MetricCard
                label="Grower pool"
                value={money(data.totals.grower_pool_cents)}
                subtitle="Paid out to nodes by tier split"
                icon="🌱"
              />
              <MetricCard
                label="Hub net"
                value={money(data.totals.hub_net_cents)}
                subtitle="After grower splits"
                icon="🏦"
              />
            </div>

            {/* Section 1 — node health table */}
            <section>
              <h2 className="heading text-base mb-2">Nodes</h2>
              <DataTable
                columns={nodeCols}
                rows={data.nodes}
                exportName="network-nodes"
                empty="No nodes onboarded yet."
              />
            </section>

            <div className="grid lg:grid-cols-2 gap-6">
              {/* Section 2 — inter-node transfers (HRS rail) */}
              <section>
                <h2 className="heading text-base mb-2">Inter-node transfers</h2>
                {data.transfers.length === 0 ? (
                  <div className="panel-pad text-sm text-mist">
                    No stock moving between nodes right now.
                  </div>
                ) : (
                  <div className="panel divide-y divide-moss/50">
                    {data.transfers.map((t) => (
                      <div
                        key={t.id}
                        className="flex items-center justify-between gap-3 px-3 py-2.5"
                      >
                        <div className="min-w-0">
                          <div className="text-sm text-cream-100">
                            {t.from_node} → {t.to_node}
                          </div>
                          <div className="text-xs text-mist">
                            {t.qty}× {t.species_name}
                            <span className="text-ghost ml-2">
                              {shortDate(t.updated_at)}
                            </span>
                          </div>
                        </div>
                        <span
                          className={classNames(
                            "text-xs shrink-0",
                            TRANSFER_STATUS[t.status].className
                          )}
                        >
                          {TRANSFER_STATUS[t.status].label}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {/* Section 3 — onboarding queue */}
              <section>
                <h2 className="heading text-base mb-2">Onboarding queue</h2>
                {data.onboarding.length === 0 ? (
                  <div className="panel-pad text-sm text-mist">
                    No applications waiting.
                  </div>
                ) : (
                  <div className="panel divide-y divide-moss/50">
                    {data.onboarding.map((a) => (
                      <div
                        key={a.id}
                        className="flex items-center justify-between gap-3 px-3 py-2.5"
                      >
                        <div className="min-w-0">
                          <div className="text-sm text-cream-100">{a.applicant_name}</div>
                          <div className="text-xs text-mist">
                            {a.state} · applied {shortDate(a.applied_at)}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-xs text-amber-300">
                            {APPLICATION_STAGE[a.stage]}
                          </span>
                          <button className="btn-ghost text-xs">Review</button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>
          </div>
        )}
      </QueryState>
    </div>
  )
}
