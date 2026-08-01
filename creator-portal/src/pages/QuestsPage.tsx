import { PageHeader } from "@bmc/ui"
import { QueryState } from "@bmc/ui"
import { TierBadge } from "@bmc/ui"
import { KarmaBar } from "@bmc/ui"
import { usePayouts, useQuests } from "@/hooks/useCreatorData"
import { classNames } from "@bmc/portal-kit"

export function QuestsPage() {
  const { data: payouts, isLoading, isError } = usePayouts()
  const { data: quests = [] } = useQuests()

  return (
    <div className="space-y-5">
      <PageHeader
        title="Quests"
        subtitle="Earn KARMA by growing your coalition — climb the tier ladder for a better revenue split."
      />

      <QueryState isLoading={isLoading} isError={isError}>
        {payouts && (
          <section className="panel-pad">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div>
                <div className="text-xs text-ghost uppercase tracking-wide mb-1">Current tier</div>
                <TierBadge tier={payouts.tier} size="lg" />
              </div>
              <div className="flex-1 min-w-[240px]">
                <KarmaBar tier={payouts.tier} karma={payouts.karma_total} />
              </div>
            </div>
          </section>
        )}

        <section className="space-y-2">
          <h2 className="heading text-sm">Active quests</h2>
          {quests.map((q) => {
            const progress = Math.min(1, q.required > 0 ? q.current / q.required : 0)
            const done = q.current >= q.required
            return (
              <div key={q.quest_title} className="panel-pad">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-cream-50">{q.quest_title}</span>
                  <span className={classNames("text-xs", done ? "text-forest-300" : "text-amber-300")}>
                    +{q.karma_reward} KARMA
                  </span>
                </div>
                <div className="mt-2 h-1.5 rounded-full bg-moss overflow-hidden">
                  <div
                    className={classNames("h-full", done ? "bg-forest-500" : "bg-amber-500")}
                    style={{ width: `${Math.round(progress * 100)}%` }}
                  />
                </div>
                <div className="text-xs text-mist mt-1">
                  {Math.min(q.current, q.required)} / {q.required}
                  {done && " · ready to claim"}
                </div>
              </div>
            )
          })}
        </section>
      </QueryState>
    </div>
  )
}
