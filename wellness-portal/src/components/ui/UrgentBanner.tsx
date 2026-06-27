import { Link } from "react-router-dom"
import type { UrgentAction } from "@/types"

// TODO: extract to packages/bmc-ui
const ICONS: Record<UrgentAction["type"], string> = {
  booking: "📅",
  intake: "📋",
  membership: "💎",
  delivery: "📦",
  message: "💬",
  quest: "🎯",
}

export function UrgentBanner({ action }: { action: UrgentAction }) {
  return (
    <Link
      to={action.link}
      className="flex items-center gap-3 px-4 py-2.5 rounded-sm border border-amber-700/50 bg-amber-900/20 hover:bg-amber-900/30 transition-colors"
    >
      <span aria-hidden className="text-base">
        {ICONS[action.type]}
      </span>
      <span className="text-sm text-cream-100 flex-1">{action.message}</span>
      <span className="text-xs text-amber-300">View →</span>
    </Link>
  )
}
