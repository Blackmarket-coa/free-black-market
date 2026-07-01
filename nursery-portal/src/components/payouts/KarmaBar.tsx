import type { TierKey } from "@/types"
import { getTier, getNextTier } from "@bmc/portal-kit"

// Progress from the current tier threshold to the next tier threshold.
export function KarmaBar({ tier, karma }: { tier: TierKey; karma: number }) {
  const current = getTier(tier)
  const next = getNextTier(tier)

  if (!next) {
    return (
      <div className="text-xs text-forest-400">
        Top tier reached — {karma} KARMA
      </div>
    )
  }

  const span = next.karma_required - current.karma_required
  const into = Math.max(0, karma - current.karma_required)
  const progress = Math.min(1, span > 0 ? into / span : 0)
  const remaining = Math.max(0, next.karma_required - karma)

  return (
    <div>
      <div className="flex justify-between text-xs text-mist mb-1">
        <span>{karma} KARMA</span>
        <span>
          {remaining} to {next.name} ({next.split_pct}% split)
        </span>
      </div>
      <div className="h-2 rounded-full bg-moss overflow-hidden">
        <div
          className="h-full"
          style={{
            width: `${Math.round(progress * 100)}%`,
            backgroundColor: next.color,
          }}
        />
      </div>
    </div>
  )
}
