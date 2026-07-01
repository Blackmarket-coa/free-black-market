import { Link } from "react-router-dom"
import { PageHeader } from "@bmc/ui"
import { MetricCard } from "@bmc/ui"
import { QueryState } from "@bmc/ui"
import { UrgentBanner } from "@/components/ui/UrgentBanner"
import { BoostCard } from "@/components/boost/BoostCard"
import { MessageFeed } from "@/components/blackout/MessageFeed"
import { useDashboard } from "@/hooks/useCreatorData"
import { credits, money, pct } from "@bmc/portal-kit"

export function DashboardPage() {
  const { data, isLoading, isError } = useDashboard()

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        subtitle="Today's pulse — credits, members, your active boost, and Space health."
      />
      <QueryState isLoading={isLoading} isError={isError}>
        {data && (
          <>
            {/* Pulse */}
            <section>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <MetricCard label="Credits today" value={credits(data.credits_earned_today)} icon="🪙" />
                <MetricCard label="New members today" value={data.new_members_today} icon="💎" />
                <MetricCard label="Unread DMs" value={data.unread_dms} icon="💬" />
                <MetricCard
                  label="MRR this week"
                  value={`+${money(data.mrr_change_this_week_cents)}`}
                  icon="📈"
                />
              </div>
            </section>

            {/* Urgent actions */}
            {data.urgent_actions.length > 0 && (
              <section className="space-y-2">
                <h2 className="heading text-sm">Needs attention</h2>
                {data.urgent_actions.map((a, i) => (
                  <UrgentBanner key={i} action={a} />
                ))}
              </section>
            )}

            <div className="grid md:grid-cols-2 gap-6">
              {/* Active boost */}
              <section>
                <h2 className="heading text-sm mb-2">Active boost</h2>
                {data.active_boost ? (
                  <BoostCard boost={data.active_boost} />
                ) : (
                  <div className="panel-pad text-sm text-mist">
                    No active boost.{" "}
                    <Link to="/boosts" className="text-amber-300">
                      Start a Hype Train →
                    </Link>
                  </div>
                )}
              </section>

              {/* Space health */}
              <section>
                <h2 className="heading text-sm mb-2">Space health</h2>
                <div className="panel-pad space-y-3">
                  {[
                    { label: "Weekly active members", v: data.space_health.weekly_active_members_pct },
                    { label: "Governance participation", v: data.space_health.governance_participation_pct },
                    { label: "30-day retention", v: data.space_health.retention_30d_pct },
                  ].map((row) => (
                    <div key={row.label}>
                      <div className="flex justify-between text-xs text-mist mb-1">
                        <span>{row.label}</span>
                        <span className="text-cream-100">{pct(row.v)}</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-moss overflow-hidden">
                        <div className="h-full bg-forest-500" style={{ width: `${row.v}%` }} />
                      </div>
                    </div>
                  ))}
                  <div className="text-xs text-ghost pt-1">
                    Avg {data.space_health.messages_per_room_avg} messages/room ·{" "}
                    Refrain queue: {data.refrain_queue.pending_review} review,{" "}
                    {data.refrain_queue.awaiting_delivery} delivery,{" "}
                    {data.refrain_queue.in_revision} revision
                  </div>
                </div>
              </section>
            </div>

            {/* Recent activity */}
            <section>
              <h2 className="heading text-sm mb-2">Recent activity</h2>
              <MessageFeed messages={data.recent_activity} />
            </section>
          </>
        )}
      </QueryState>
    </div>
  )
}
