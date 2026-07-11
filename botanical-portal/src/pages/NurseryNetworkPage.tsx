import { useNurseryNetwork } from "@/hooks/useNurseryNetwork"
import { useDashboardSummary } from "@/hooks/useDashboardSummary"
import { PageHeader } from "@bmc/ui"
import { QueryState } from "@bmc/ui"
import { TierBadge } from "@bmc/ui"
import { EmptyState } from "@bmc/ui"
import { money, shortDate, classNames } from "@bmc/portal-kit"
import type { MaterialRequestStatus, NurseryMaterialForm, NurseryNode } from "@/types"

const FORM_ICON: Record<NurseryMaterialForm, string> = {
  live_plant: "🪴",
  dried: "🌾",
  fresh_harvest: "🧺",
  seed: "🌱",
}

const REQUEST_STYLE: Record<MaterialRequestStatus, string> = {
  sent: "text-mist",
  accepted: "text-cream-100",
  in_transit: "text-amber-300",
  received: "text-forest-300",
  declined: "text-clay",
}

export function NurseryNetworkPage() {
  const { data, isLoading, isError } = useNurseryNetwork()
  const { data: dashboard } = useDashboardSummary()

  return (
    <div>
      <PageHeader
        title="Nursery Network"
        subtitle="Source raw plant material from BMC grower nodes — every request raises your BMC-sourced %."
      />
      <QueryState isLoading={isLoading} isError={isError}>
        {data && (
          <div className="space-y-6">
            {/* Cooperative sourcing headline — same portfolio metric as the dashboard */}
            {dashboard && (
              <section className="panel-pad">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-xs uppercase tracking-wide text-ghost">
                      BMC-sourced ingredients
                    </div>
                    <div className="text-mist text-xs mt-0.5">
                      Portfolio-wide, across all pathways.
                    </div>
                  </div>
                  <div className="heading text-3xl text-forest-300">
                    {dashboard.bmc_sourced_pct}%
                  </div>
                </div>
                <div className="mt-3 h-2 rounded-full bg-moss overflow-hidden">
                  <div
                    className="h-full bg-forest-500"
                    style={{ width: `${Math.min(100, dashboard.bmc_sourced_pct)}%` }}
                  />
                </div>
              </section>
            )}

            {/* Open material requests */}
            <section>
              <h2 className="heading text-base mb-2">Material requests</h2>
              {data.requests.length === 0 ? (
                <EmptyState
                  icon="📨"
                  title="No requests yet"
                  message="Request material from a grower node below."
                />
              ) : (
                <div className="panel overflow-x-auto scroll-area">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-ghost border-b border-moss">
                        <th className="px-3 py-2 font-medium">Material</th>
                        <th className="px-3 py-2 font-medium">Node</th>
                        <th className="px-3 py-2 font-medium">Qty</th>
                        <th className="px-3 py-2 font-medium">Requested</th>
                        <th className="px-3 py-2 font-medium">Expected</th>
                        <th className="px-3 py-2 font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.requests.map((r) => (
                        <tr key={r.id} className="border-b border-moss/50 hover:bg-moss/30">
                          <td className="px-3 py-2 text-cream-100">{r.material}</td>
                          <td className="px-3 py-2 text-mist">{r.node_name}</td>
                          <td className="px-3 py-2 text-mist">
                            {r.qty} {r.unit}
                          </td>
                          <td className="px-3 py-2 text-mist">{shortDate(r.requested_at)}</td>
                          <td className="px-3 py-2 text-mist">{shortDate(r.expected_at)}</td>
                          <td className="px-3 py-2">
                            <span
                              className={classNames(
                                "text-xs capitalize",
                                REQUEST_STYLE[r.status]
                              )}
                            >
                              {r.status.replace("_", " ")}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {/* Node directory */}
            <section>
              <h2 className="heading text-base mb-2">Grower nodes</h2>
              <div className="grid lg:grid-cols-2 gap-3">
                {data.nodes.map((node) => (
                  <NodeCard key={node.id} node={node} />
                ))}
              </div>
            </section>
          </div>
        )}
      </QueryState>
    </div>
  )
}

function NodeCard({ node }: { node: NurseryNode }) {
  return (
    <div className="panel-pad">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm text-cream-50 font-medium truncate">{node.name}</div>
          <div className="text-[11px] text-ghost">
            {node.region} ({node.state}) · {node.fulfillment_reliability_pct}% on-time
          </div>
        </div>
        <TierBadge tier={node.tier} />
      </div>

      <div className="mt-2 flex flex-wrap gap-1.5">
        {node.specialties.map((s) => (
          <span
            key={s}
            className="text-[11px] text-mist border border-moss rounded-sm px-1.5 py-0.5"
          >
            {s}
          </span>
        ))}
      </div>

      {/* Sourceable inventory */}
      <div className="mt-3 divide-y divide-moss/50 border-t border-moss/50">
        {node.listings.map((l) => (
          <div key={l.material} className="py-2 flex items-center gap-2 text-sm">
            <span aria-hidden>{FORM_ICON[l.form]}</span>
            <div className="min-w-0 flex-1">
              <div className="text-cream-100 truncate">{l.material}</div>
              {l.botanical_name && (
                <div className="text-[11px] text-ghost italic">{l.botanical_name}</div>
              )}
            </div>
            <div className="text-right shrink-0">
              <div className="text-mist text-xs">
                {l.available_qty} {l.unit}
              </div>
              <div className="text-[11px] text-ghost">
                {money(l.price_cents_per_unit)}/{l.unit}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-3">
        {node.open_to_requests ? (
          // POST /vendor/botanical/nursery-network/requests — wired with the request flow
          <button className="btn-primary text-xs">Request materials</button>
        ) : (
          <span className="text-xs text-ghost">At capacity this season</span>
        )}
      </div>
    </div>
  )
}
