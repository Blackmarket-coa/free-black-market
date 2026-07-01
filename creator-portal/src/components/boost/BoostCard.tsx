import type { Boost, BoostType } from "@/types"
import { credits, shortDate, classNames, daysUntil } from "@bmc/portal-kit"

const TYPE_META: Record<BoostType, { icon: string; label: string }> = {
  hype_train: { icon: "🚂", label: "Hype Train" },
  fundraiser_rally: { icon: "🎯", label: "Fundraiser Rally" },
  proposal_boost: { icon: "🗳️", label: "Proposal Boost" },
  bounty_boost: { icon: "💼", label: "Bounty Boost" },
}

// Live momentum bar for a Governance Boost. Mirrors the BoostBar that renders
// inside the Blackout room — the same goal/current/milestone contract.
export function BoostCard({ boost }: { boost: Boost }) {
  const meta = TYPE_META[boost.type]
  const progress = Math.min(1, boost.goal_credits > 0 ? boost.current_credits / boost.goal_credits : 0)
  const remainingDays = daysUntil(boost.ends_at)
  const active = boost.status === "active"

  return (
    <div className="panel-pad space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <span aria-hidden className="text-lg">
              {meta.icon}
            </span>
            <span className="text-cream-50 font-medium">{boost.title}</span>
          </div>
          <div className="text-xs text-ghost mt-0.5">{meta.label}</div>
        </div>
        <span
          className={classNames(
            "text-[10px] rounded-full px-2 py-0.5 shrink-0 capitalize",
            boost.status === "active" && "bg-forest-900/40 text-forest-300",
            boost.status === "succeeded" && "bg-amber-900/40 text-amber-300",
            boost.status === "expired" && "bg-moss text-ghost"
          )}
        >
          {boost.status}
        </span>
      </div>

      {/* Momentum bar */}
      <div>
        <div className="flex justify-between text-xs text-mist mb-1">
          <span className="text-cream-100">{credits(boost.current_credits)}</span>
          <span>goal {credits(boost.goal_credits)}</span>
        </div>
        <div className="h-2.5 rounded-full bg-moss overflow-hidden">
          <div
            className="h-full bg-forest-500 transition-all"
            style={{ width: `${Math.round(progress * 100)}%` }}
          />
        </div>
        <div className="flex justify-between text-[11px] text-ghost mt-1">
          <span>{boost.contributor_count} contributors</span>
          <span>
            {active && remainingDays !== null
              ? remainingDays <= 0
                ? "ending today"
                : `${remainingDays}d left`
              : `ended ${shortDate(boost.ends_at)}`}
          </span>
        </div>
      </div>

      {boost.linked_product_name && (
        <div className="text-xs text-mist">
          🎁 Funds: <span className="text-cream-100">{boost.linked_product_name}</span>
        </div>
      )}

      {/* Milestones */}
      <ul className="space-y-1">
        {boost.milestones.map((m, i) => (
          <li key={i} className="flex items-center gap-2 text-xs">
            <span aria-hidden>{m.unlocked ? "✅" : "⬜"}</span>
            <span className={m.unlocked ? "text-cream-100" : "text-mist"}>
              {credits(m.credits)} — {m.reward}
            </span>
          </li>
        ))}
      </ul>

      {boost.matrix_state_event_id && (
        <div className="text-[10px] text-ghost truncate">
          Matrix state event: <span className="text-mist">{boost.matrix_state_event_id}</span>
        </div>
      )}
    </div>
  )
}
