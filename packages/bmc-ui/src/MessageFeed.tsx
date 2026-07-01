import type { ReactNode } from "react"
import { classNames, shortDate } from "@bmc/portal-kit"

// Shared Blackout (Matrix) message-feed shell: the scrollable list, per-message
// timestamp, and optional reply box. The per-message-type card rendering is
// portal-specific (different message unions/actions), so each portal passes a
// `renderMessage` render-prop; the reply accent + placeholder are props too.
export interface FeedMessage {
  id: string
  timestamp?: string | null
}

export function MessageFeed<T extends FeedMessage>({
  messages,
  renderMessage,
  showReply = false,
  replyPlaceholder = "Reply…",
  replyAccentClassName = "focus:border-forest-600",
}: {
  messages: T[]
  renderMessage: (msg: T) => ReactNode
  showReply?: boolean
  replyPlaceholder?: string
  replyAccentClassName?: string
}) {
  return (
    <div className="panel">
      <div className="divide-y divide-moss/50 max-h-[60vh] overflow-y-auto scroll-area">
        {messages.map((m) => (
          <div key={m.id} className="p-2">
            <div className="text-[10px] text-ghost mb-1">{shortDate(m.timestamp)}</div>
            {renderMessage(m)}
          </div>
        ))}
      </div>
      {showReply && (
        <div className="flex gap-2 p-2 border-t border-moss">
          <input
            className={classNames(
              "flex-1 bg-soil border border-moss rounded-sm px-3 py-1.5 text-sm text-cream-100 placeholder:text-ghost focus:outline-none",
              replyAccentClassName
            )}
            placeholder={replyPlaceholder}
          />
          <button className="btn-primary text-sm">Send</button>
        </div>
      )}
    </div>
  )
}
