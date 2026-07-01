import { PageHeader } from "@/components/ui/PageHeader"
import { QueryState } from "@/components/ui/QueryState"
import { TierBadge } from "@/components/payouts/TierBadge"
import { KarmaBar } from "@/components/payouts/KarmaBar"
import { usePayouts } from "@/hooks/useWellness"
import { TIERS } from "@bmc/portal-kit"

// Wellness quest definitions surface through the shared progression/KARMA engine
// (same tier ladder as the nursery portal). These mirror the seeds on the
// backend; progress is illustrative here.
const WELLNESS_QUESTS = [
  { id: "first-session", title: "Complete your first client session", current: 1, required: 1, karma: 20 },
  { id: "sold-out-class", title: "Fill a class to 100% capacity", current: 0, required: 1, karma: 25 },
  { id: "digital-launch", title: "Publish and sell your first digital product", current: 1, required: 1, karma: 15 },
  { id: "membership-milestone", title: "Reach 10 active members", current: 9, required: 10, karma: 50 },
  { id: "embed-first-sale", title: "Make your first sale through the connect.js embed", current: 1, required: 1, karma: 25 },
  { id: "zero-noshow-month", title: "Complete a full month with zero no-shows", current: 0, required: 1, karma: 20 },
  { id: "mrr-500", title: "Reach $500 monthly recurring revenue", current: 965, required: 500, karma: 40 },
  { id: "mrr-1000", title: "Reach $1,000 monthly recurring revenue", current: 965, required: 1000, karma: 75 },
  { id: "community-anchor", title: "Post in the community room 10 times", current: 6, required: 10, karma: 20 },
  { id: "five-star-streak", title: "Receive 5-star reviews 5 sessions in a row", current: 3, required: 5, karma: 75 },
]

export function QuestsPage() {
  const { data, isLoading, isError } = usePayouts()

  return (
    <div className="space-y-5">
      <PageHeader
        title="Quests"
        subtitle="Earn KARMA and climb the practitioner tier ladder."
      />
      <QueryState isLoading={isLoading} isError={isError}>
        {data && (
          <>
            <section className="panel-pad space-y-3">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <TierBadge tier={data.tier} size="lg" />
                <div className="flex-1 min-w-[240px]">
                  <KarmaBar tier={data.tier} karma={data.karma_total} />
                </div>
              </div>
              <div className="flex flex-wrap gap-2 pt-1">
                {TIERS.map((t) => (
                  <span
                    key={t.key}
                    className="text-[11px] rounded-full px-2 py-0.5"
                    style={{ backgroundColor: `${t.color}22`, color: t.color }}
                  >
                    {t.icon} {t.name}
                  </span>
                ))}
              </div>
            </section>

            <section className="grid md:grid-cols-2 gap-3">
              {WELLNESS_QUESTS.map((q) => {
                const done = q.current >= q.required
                const pct = Math.min(100, Math.round((q.current / q.required) * 100))
                return (
                  <div key={q.id} className="panel-pad space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="text-sm text-cream-50">{q.title}</div>
                      <span className="text-[11px] text-amber-300 shrink-0">+{q.karma} KARMA</span>
                    </div>
                    <div className="h-2 rounded-full bg-moss overflow-hidden">
                      <div
                        className="h-full"
                        style={{ width: `${pct}%`, backgroundColor: done ? "#7EC850" : "#E8C547" }}
                      />
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-mist">
                        {q.current}/{q.required}
                      </span>
                      {done ? (
                        <button className="btn-primary text-xs py-0.5">Claim</button>
                      ) : (
                        <span className="text-ghost">In progress</span>
                      )}
                    </div>
                  </div>
                )
              })}
            </section>
          </>
        )}
      </QueryState>
    </div>
  )
}
