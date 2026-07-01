import { useState } from "react"
import { PageHeader } from "@bmc/ui"
import { Tabs } from "@/components/ui/Tabs"
import { MessageFeed } from "@/components/blackout/MessageFeed"
import {
  useAutomations,
  useClientDM,
  useClientThreads,
  useCommunityFeed,
} from "@/hooks/useWellness"
import { shortDate, classNames } from "@bmc/portal-kit"

export function BlackoutPage() {
  const [tab, setTab] = useState("dms")
  const { data: threads } = useClientThreads()
  const { data: community } = useCommunityFeed()
  const { data: automations } = useAutomations()
  const [activeRoom, setActiveRoom] = useState<string | null>(null)
  const { data: dm } = useClientDM(activeRoom ?? undefined)

  const totalUnread = (threads ?? []).reduce((s, t) => s + t.unread, 0)

  return (
    <div className="space-y-4">
      <PageHeader
        title="Blackout"
        subtitle="End-to-end encrypted client messaging, your community room, and automations."
      />
      <Tabs
        tabs={[
          { key: "dms", label: "Client DMs", count: totalUnread },
          { key: "community", label: "Community" },
          { key: "automations", label: "Automations" },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === "dms" && (
        <div className="grid md:grid-cols-[280px_1fr] gap-4">
          <div className="panel divide-y divide-moss/50 max-h-[60vh] overflow-y-auto scroll-area">
            {(threads ?? []).map((t) => (
              <button
                key={t.room_id}
                onClick={() => setActiveRoom(t.room_id)}
                className={classNames(
                  "w-full text-left p-3 hover:bg-moss/30 transition-colors",
                  activeRoom === t.room_id && "bg-moss/40"
                )}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm text-cream-50">{t.client_name}</span>
                  {t.unread > 0 && (
                    <span className="text-[10px] bg-amber-600 text-white rounded-full px-1.5">{t.unread}</span>
                  )}
                </div>
                <div className="text-xs text-mist truncate">{t.last_message}</div>
                {t.upcoming_session_at && (
                  <div className="text-[10px] text-amber-300 mt-0.5">
                    Session {shortDate(t.upcoming_session_at)}
                  </div>
                )}
              </button>
            ))}
          </div>
          <div>
            {activeRoom ? (
              <MessageFeed messages={dm ?? []} showReply replyPlaceholder="Reply to client…" />
            ) : (
              <div className="panel-pad text-sm text-mist">Select a conversation.</div>
            )}
          </div>
        </div>
      )}

      {tab === "community" && (
        <div className="space-y-3">
          <div className="flex justify-end">
            <button className="btn-primary text-sm">Create announcement</button>
          </div>
          <MessageFeed messages={community ?? []} showReply replyPlaceholder="Post to community…" />
        </div>
      )}

      {tab === "automations" && (
        <div className="space-y-2">
          {(automations ?? []).map((a) => (
            <div key={a.id} className="panel-pad">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1">
                  <div className="text-sm text-cream-50">{a.name}</div>
                  <div className="text-xs text-mist mt-1">{a.body}</div>
                </div>
                <span
                  className={classNames(
                    "text-[10px] rounded-full px-2 py-0.5 shrink-0",
                    a.enabled ? "bg-forest-900/40 text-forest-300" : "bg-moss text-ghost"
                  )}
                >
                  {a.enabled ? "On" : "Off"}
                </span>
              </div>
              <div className="flex gap-2 mt-2">
                <button className="btn-ghost text-xs">Edit</button>
                <button className="btn-ghost text-xs">{a.enabled ? "Disable" : "Enable"}</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
