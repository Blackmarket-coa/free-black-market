import { Link } from "react-router-dom"
import type { BlackoutMessage } from "@/types"
import { OrderAlertMessage } from "./OrderAlertMessage"
import { LabelMessage } from "./LabelMessage"
import { shortDate } from "@/lib/format"

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
    <div className="panel">
      <div className="divide-y divide-moss/50 max-h-[60vh] overflow-y-auto scroll-area">
        {messages.map((m) => (
          <div key={m.id} className="p-2">
            <div className="text-[10px] text-ghost mb-1">{shortDate(m.timestamp)}</div>
            <MessageRow msg={m} />
          </div>
        ))}
      </div>
      {showReply && (
        <div className="flex gap-2 p-2 border-t border-moss">
          <input
            className="flex-1 bg-soil border border-moss rounded-sm px-3 py-1.5 text-sm text-cream-100 placeholder:text-ghost focus:outline-none focus:border-forest-600"
            placeholder="Reply to your node room…"
          />
          <button className="btn-primary text-sm">Send</button>
        </div>
      )}
    </div>
  )
}
