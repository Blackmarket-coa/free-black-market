import { useState } from "react"
import { PageHeader } from "@bmc/ui"
import { Tabs } from "@/components/ui/Tabs"
import { MessageFeed } from "@/components/blackout/MessageFeed"
import { GovernanceProposalCard } from "@/components/blackout/GovernanceProposal"
import {
  useCommunityFeed,
  useMemberDM,
  useMemberThreads,
  useProposals,
} from "@/hooks/useCreatorData"
import { shortDate, classNames } from "@bmc/portal-kit"

export function BlackoutPage() {
  const [tab, setTab] = useState("dms")
  const { data: threads } = useMemberThreads()
  const { data: community } = useCommunityFeed()
  const { data: proposals } = useProposals()
  const [activeRoom, setActiveRoom] = useState<string | null>(null)
  const { data: dm } = useMemberDM(activeRoom ?? undefined)

  const totalUnread = (threads ?? []).reduce((s, t) => s + t.unread, 0)
  const openProposals = (proposals ?? []).filter((p) => p.status === "open").length

  return (
    <div className="space-y-4">
      <PageHeader
        title="Blackout Space"
        subtitle="Member DMs, your community room, and Space governance — all end-to-end encrypted."
      />
      <Tabs
        tabs={[
          { key: "dms", label: "Member DMs", count: totalUnread },
          { key: "community", label: "Community" },
          { key: "governance", label: "Governance", count: openProposals },
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
                  <span className="text-sm text-cream-50">{t.member_name}</span>
                  {t.unread > 0 && (
                    <span className="text-[10px] bg-amber-600 text-white rounded-full px-1.5">{t.unread}</span>
                  )}
                </div>
                <div className="text-xs text-mist truncate">{t.last_message}</div>
                {t.tier_name && (
                  <div className="text-[10px] text-amber-300 mt-0.5">
                    {t.tier_name} · {shortDate(t.timestamp)}
                  </div>
                )}
              </button>
            ))}
          </div>
          <div>
            {activeRoom ? (
              <MessageFeed messages={dm ?? []} showReply replyPlaceholder="Reply to member…" />
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

      {tab === "governance" && (
        <div className="grid md:grid-cols-2 gap-4">
          {(proposals ?? []).map((p) => (
            <GovernanceProposalCard key={p.id} proposal={p} />
          ))}
        </div>
      )}
    </div>
  )
}
