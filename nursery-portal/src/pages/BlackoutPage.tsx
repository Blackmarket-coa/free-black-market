import { useBlackoutFeed, useGovernanceProposals } from "@/hooks/useBlackoutFeed"
import { usePayouts } from "@/hooks/usePayouts"
import { PageHeader } from "@/components/ui/PageHeader"
import { QueryState } from "@/components/ui/QueryState"
import { MessageFeed } from "@/components/blackout/MessageFeed"
import { GovernanceProposalCard } from "@/components/blackout/GovernanceProposal"
import { canAccessGovernance } from "@/lib/tiers"

export function BlackoutPage() {
  const node = useBlackoutFeed("node")
  const network = useBlackoutFeed("network")
  const governance = useGovernanceProposals()
  const { data: payouts } = usePayouts()

  const govUnlocked = payouts ? canAccessGovernance(payouts.tier) : false

  return (
    <div>
      <PageHeader
        title="Blackout"
        subtitle="Your node room, network announcements, and governance"
      />
      <div className="grid lg:grid-cols-2 gap-6">
        {/* Section 1 — node room (read + reply) */}
        <section>
          <h2 className="heading text-base mb-2">Node room</h2>
          <QueryState isLoading={node.isLoading} isError={node.isError}>
            {node.data && <MessageFeed messages={node.data} showReply />}
          </QueryState>
        </section>

        {/* Section 2 — network announcements (read-only) */}
        <section>
          <h2 className="heading text-base mb-2">Network announcements</h2>
          <QueryState isLoading={network.isLoading} isError={network.isError}>
            {network.data && <MessageFeed messages={network.data} />}
          </QueryState>
        </section>
      </div>

      {/* Section 3 — governance (Root+ tier) */}
      <section className="mt-6">
        <h2 className="heading text-base mb-2">Governance</h2>
        {!govUnlocked ? (
          <div className="panel-pad text-sm text-mist">
            🔒 Governance unlocks at <span className="text-cream-100">Root</span> tier.
            Keep earning KARMA to vote on network proposals.
          </div>
        ) : (
          <QueryState isLoading={governance.isLoading} isError={governance.isError}>
            {governance.data && (
              <div className="grid lg:grid-cols-2 gap-3">
                {governance.data.map((p) => (
                  <GovernanceProposalCard key={p.id} proposal={p} />
                ))}
              </div>
            )}
          </QueryState>
        )}
      </section>
    </div>
  )
}
