import { Link } from "react-router-dom"
import { useBlackoutFeed, useGovernanceProposals } from "@/hooks/useBlackoutFeed"
import { usePayouts } from "@/hooks/usePayouts"
import { PageHeader } from "@bmc/ui"
import { QueryState } from "@bmc/ui"
import { MessageFeed } from "@bmc/ui"
import { canAccessGovernance, shortDate, classNames } from "@bmc/portal-kit"
import type { BlackoutMessage, GovernanceProposal } from "@/types"

// Renders one Blackout (Matrix) message by type. Action-bearing types get rich
// cards that deep-link into the relevant portal page; text is a plain bubble.
function MessageRow({ msg }: { msg: BlackoutMessage }) {
  switch (msg.type) {
    case "order":
      return (
        <div className="rounded-sm border border-forest-700 bg-forest-900/20 px-3 py-2 flex items-center gap-2">
          <span aria-hidden>🛒</span>
          <span className="text-sm text-cream-100 flex-1">{msg.text}</span>
          <Link to={msg.link || "/orders"} className="text-xs text-forest-300 shrink-0">
            Open order →
          </Link>
        </div>
      )
    case "low_stock":
      return (
        <div className="rounded-sm border border-amber-700/50 bg-amber-900/15 px-3 py-2 flex items-center gap-2">
          <span aria-hidden>⚠️</span>
          <span className="text-sm text-cream-100 flex-1">{msg.text}</span>
          <Link to={msg.link || "/raw-materials"} className="text-xs text-amber-300 shrink-0">
            Raw materials →
          </Link>
        </div>
      )
    case "compliance":
      return (
        <div className="rounded-sm border border-amber-700/50 bg-amber-900/15 px-3 py-2 flex items-center gap-2">
          <span aria-hidden>📋</span>
          <span className="text-sm text-cream-100 flex-1">{msg.text}</span>
          <Link to={msg.link || "/compliance"} className="text-xs text-amber-300 shrink-0">
            Compliance →
          </Link>
        </div>
      )
    case "request":
      return (
        <div className="rounded-sm border border-moss bg-moss/30 px-3 py-2 flex items-center gap-2">
          <span aria-hidden>🌐</span>
          <span className="text-sm text-cream-100 flex-1">{msg.text}</span>
          <Link to={msg.link || "/nursery"} className="text-xs text-forest-300 shrink-0">
            Nursery network →
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
          {msg.sender && <span className="text-xs text-forest-300 mr-2">{msg.sender}</span>}
          <span className="text-sm text-cream-100">{msg.text}</span>
        </div>
      )
  }
}

export function BlackoutPage() {
  const maker = useBlackoutFeed("maker")
  const network = useBlackoutFeed("network")
  const governance = useGovernanceProposals()
  const { data: payouts } = usePayouts()

  const govUnlocked = payouts ? canAccessGovernance(payouts.tier) : false

  return (
    <div>
      <PageHeader
        title="Blackout"
        subtitle="Your maker room, network announcements, and governance — proxied Matrix rooms."
      />
      <div className="grid lg:grid-cols-2 gap-6">
        {/* Maker room (read + reply) */}
        <section>
          <h2 className="heading text-base mb-2">Maker room</h2>
          <QueryState isLoading={maker.isLoading} isError={maker.isError}>
            {maker.data && (
              <MessageFeed
                messages={maker.data}
                showReply
                replyPlaceholder="Reply to your maker room…"
                replyAccentClassName="focus:border-forest-600"
                renderMessage={(m) => <MessageRow msg={m} />}
              />
            )}
          </QueryState>
        </section>

        {/* Network announcements (read-only) */}
        <section>
          <h2 className="heading text-base mb-2">Network announcements</h2>
          <QueryState isLoading={network.isLoading} isError={network.isError}>
            {network.data && (
              <MessageFeed
                messages={network.data}
                renderMessage={(m) => <MessageRow msg={m} />}
              />
            )}
          </QueryState>
        </section>
      </div>

      {/* Governance (Root+ tier) */}
      <section className="mt-6">
        <h2 className="heading text-base mb-2">Governance</h2>
        {!govUnlocked ? (
          <div className="panel-pad text-sm text-mist">
            🔒 Governance unlocks at <span className="text-cream-100">Root</span> tier. Keep
            earning KARMA to vote on network proposals.
          </div>
        ) : (
          <QueryState isLoading={governance.isLoading} isError={governance.isError}>
            {governance.data && (
              <div className="grid lg:grid-cols-2 gap-3">
                {governance.data.map((p) => (
                  <ProposalCard key={p.id} proposal={p} />
                ))}
              </div>
            )}
          </QueryState>
        )}
      </section>
    </div>
  )
}

function ProposalCard({ proposal }: { proposal: GovernanceProposal }) {
  const totalVotes = Object.values(proposal.tally).reduce((s, n) => s + n, 0)
  const open = proposal.status === "open"

  return (
    <div className="panel-pad">
      <div className="flex items-start justify-between gap-3">
        <div className="text-sm text-cream-50 font-medium">{proposal.title}</div>
        <span
          className={classNames(
            "text-xs shrink-0",
            open ? "text-forest-300" : "text-ghost"
          )}
        >
          {open ? `open · closes ${shortDate(proposal.deadline)}` : `closed · ${proposal.outcome}`}
        </span>
      </div>
      <p className="text-xs text-mist mt-1">{proposal.description}</p>

      <div className="mt-3 space-y-1.5">
        {proposal.options.map((opt) => {
          const votes = proposal.tally[opt] ?? 0
          const share = totalVotes > 0 ? (votes / totalVotes) * 100 : 0
          return (
            <div key={opt}>
              <div className="flex justify-between text-xs mb-0.5">
                <span className="text-cream-100">{opt}</span>
                <span className="text-ghost">{votes}</span>
              </div>
              <div className="h-1.5 rounded-full bg-moss overflow-hidden">
                <div className="h-full bg-forest-500" style={{ width: `${share}%` }} />
              </div>
            </div>
          )
        })}
      </div>

      {open && (
        <div className="mt-3 flex gap-2">
          {proposal.options.map((opt) => (
            <button key={opt} className="btn-ghost text-xs">
              Vote {opt}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
