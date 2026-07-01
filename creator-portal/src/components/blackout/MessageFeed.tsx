import { Link } from "react-router-dom"
import type { BlackoutMessage } from "@/types"
import { MessageFeed as MessageFeedShell } from "@bmc/ui"

// Renders a Blackout (Matrix) message. Action-bearing types get an accent card;
// plain text is a bubble.
function MessageRow({ msg }: { msg: BlackoutMessage }) {
  switch (msg.type) {
    case "tip":
      return (
        <div className="rounded-sm border border-amber-700/50 bg-amber-900/15 px-3 py-2 flex items-center gap-2">
          <span aria-hidden>💸</span>
          <span className="text-sm text-cream-100 flex-1">{msg.text}</span>
          {msg.link && (
            <Link to={msg.link} className="text-xs text-amber-300">
              Open →
            </Link>
          )}
        </div>
      )
    case "membership":
      return (
        <div className="rounded-sm border border-amber-700/50 bg-amber-900/15 px-3 py-2 flex items-center gap-2">
          <span aria-hidden>💎</span>
          <span className="text-sm text-cream-100 flex-1">{msg.text}</span>
        </div>
      )
    case "boost":
      return (
        <div className="rounded-sm border border-forest-700/50 bg-forest-900/20 px-3 py-2 flex items-center gap-2">
          <span aria-hidden>🚀</span>
          <span className="text-sm text-cream-100 flex-1">{msg.text}</span>
        </div>
      )
    case "system":
      return (
        <div className="rounded-sm border border-moss bg-moss/30 px-3 py-2 flex items-center gap-2">
          <span aria-hidden>🤖</span>
          <span className="text-sm text-cream-100 flex-1">{msg.text}</span>
        </div>
      )
    default:
      return (
        <div className="px-3 py-2">
          {msg.sender && (
            <span className="text-xs text-amber-300 mr-2">{msg.sender}</span>
          )}
          <span className="text-sm text-cream-100">{msg.text}</span>
        </div>
      )
  }
}

export function MessageFeed({
  messages,
  showReply = false,
  replyPlaceholder = "Reply…",
}: {
  messages: BlackoutMessage[]
  showReply?: boolean
  replyPlaceholder?: string
}) {
  return (
    <MessageFeedShell
      messages={messages}
      showReply={showReply}
      replyPlaceholder={replyPlaceholder}
      replyAccentClassName="focus:border-amber-600"
      renderMessage={(m) => <MessageRow msg={m} />}
    />
  )
}
