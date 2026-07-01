import { Link } from "react-router-dom"
import type { BlackoutMessage } from "@/types"
import { OrderAlertMessage } from "./OrderAlertMessage"
import { LabelMessage } from "./LabelMessage"
import { MessageFeed as MessageFeedShell } from "@bmc/ui"

// Renders a Blackout (Matrix) message according to its type. Action-bearing
// types (order/label/photo/low_stock/cert) get rich cards; text is a bubble.
function MessageRow({ msg }: { msg: BlackoutMessage }) {
  switch (msg.type) {
    case "order":
      return <OrderAlertMessage msg={msg} />
    case "label":
      return <LabelMessage msg={msg} />
    case "low_stock":
      return (
        <div className="rounded-sm border border-amber-700/50 bg-amber-900/15 px-3 py-2 flex items-center gap-2">
          <span aria-hidden>⚠️</span>
          <span className="text-sm text-cream-100 flex-1">{msg.text}</span>
          <Link to={msg.link || "/inventory"} className="text-xs text-amber-300">
            Go to Inventory →
          </Link>
        </div>
      )
    case "photo":
      return (
        <div className="rounded-sm border border-moss bg-moss/30 px-3 py-2 flex items-center gap-2">
          <span aria-hidden>📸</span>
          <span className="text-sm text-cream-100 flex-1">{msg.text}</span>
          <Link to="/propagation" className="btn-ghost text-xs">
            Upload photo
          </Link>
        </div>
      )
    case "cert":
      return (
        <div className="rounded-sm border border-amber-700/50 bg-amber-900/15 px-3 py-2 flex items-center gap-2">
          <span aria-hidden>📋</span>
          <span className="text-sm text-cream-100 flex-1">{msg.text}</span>
          <Link to="/orders" className="btn-ghost text-xs">
            Upload cert
          </Link>
        </div>
      )
    case "payout":
      return (
        <div className="rounded-sm border border-forest-700 bg-forest-900/20 px-3 py-2 flex items-center gap-2">
          <span aria-hidden>💸</span>
          <span className="text-sm text-cream-100 flex-1">{msg.text}</span>
        </div>
      )
    default:
      return (
        <div className="px-3 py-2">
          {msg.sender && (
            <span className="text-xs text-forest-300 mr-2">{msg.sender}</span>
          )}
          <span className="text-sm text-cream-100">{msg.text}</span>
        </div>
      )
  }
}

export function MessageFeed({
  messages,
  showReply = false,
}: {
  messages: BlackoutMessage[]
  showReply?: boolean
}) {
  return (
    <MessageFeedShell
      messages={messages}
      showReply={showReply}
      replyPlaceholder="Reply to your node room…"
      replyAccentClassName="focus:border-forest-600"
      renderMessage={(m) => <MessageRow msg={m} />}
    />
  )
}
