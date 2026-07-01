import { Link } from "react-router-dom"

// Shared urgent-action banner. The message-type→emoji map differs per portal
// (orders/inventory vs booking/intake vs boost/split …), so it is passed in via
// `icons`; the presentation is identical across portals.
export interface UrgentActionLike {
  type: string
  message: string
  link: string
}

export function UrgentBanner({
  action,
  icons,
}: {
  action: UrgentActionLike
  icons: Record<string, string>
}) {
  return (
    <Link
      to={action.link}
      className="flex items-center gap-3 px-4 py-2.5 rounded-sm border border-amber-700/50 bg-amber-900/20 hover:bg-amber-900/30 transition-colors"
    >
      <span aria-hidden className="text-base">
        {icons[action.type]}
      </span>
      <span className="text-sm text-cream-100 flex-1">{action.message}</span>
      <span className="text-xs text-amber-300">View →</span>
    </Link>
  )
}
