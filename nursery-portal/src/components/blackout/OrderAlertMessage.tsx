import { Link } from "react-router-dom"
import type { BlackoutMessage } from "@/types"

export function OrderAlertMessage({ msg }: { msg: BlackoutMessage }) {
  return (
    <div className="rounded-sm border border-forest-700 bg-forest-900/20 px-3 py-2">
      <div className="flex items-center gap-2">
        <span aria-hidden>🛒</span>
        <span className="text-sm text-cream-100 flex-1">{msg.text}</span>
        <Link to="/orders" className="text-xs text-forest-300 hover:text-forest-200">
          Go to Orders →
        </Link>
      </div>
    </div>
  )
}
