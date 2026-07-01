import { StubPage } from "@bmc/ui"
import { TIERS } from "@bmc/portal-kit"
import { TierBadge } from "@bmc/ui"

export function QuestsPage() {
  return (
    <div>
      <StubPage
        title="Quests"
        icon="🏆"
        summary="Quest progress and tier advancement. Connects to the backend progression / collective-quest modules."
        planned={[
          "Tier card with KARMA progress to next tier",
          "Cooperative (network) quest banner",
          "In-progress, ready-to-claim, and locked quests",
          "KARMA event log",
        ]}
      />
      <div className="panel-pad mt-4">
        <div className="text-xs uppercase tracking-wide text-ghost mb-3">
          Tier ladder
        </div>
        <div className="space-y-2">
          {TIERS.map((t) => (
            <div key={t.key} className="flex items-center justify-between text-sm">
              <TierBadge tier={t.key} />
              <span className="text-ghost text-xs">
                {t.karma_required} KARMA · {t.split_pct}% split · {t.unlocks}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
