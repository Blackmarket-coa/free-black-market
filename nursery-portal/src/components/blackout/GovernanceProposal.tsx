import type { GovernanceProposal } from "@/types"
import { shortDate, classNames } from "@/lib/format"

export function GovernanceProposalCard({ proposal }: { proposal: GovernanceProposal }) {
  const total = Object.values(proposal.tally).reduce((a, b) => a + b, 0) || 1
  const closed = proposal.status === "closed"

  return (
    <div className="panel-pad">
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-medium text-cream-50">{proposal.title}</h3>
        <span
          className={classNames(
            "text-xs rounded-xs border px-1.5 py-0.5",
            closed
              ? "border-moss text-ghost"
              : "border-forest-600 text-forest-300"
          )}
        >
          {closed ? proposal.outcome || "Closed" : `Open · ${shortDate(proposal.deadline)}`}
        </span>
      </div>
      <p className="text-sm text-mist mt-1">{proposal.description}</p>

      <div className="mt-3 space-y-2">
        {proposal.options.map((opt) => {
          const votes = proposal.tally[opt] ?? 0
          const share = Math.round((votes / total) * 100)
          return (
            <div key={opt}>
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="text-cream-100">{opt}</span>
                <span className="text-ghost">
                  {votes} ({share}%)
                </span>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex-1 h-1.5 rounded-full bg-moss overflow-hidden">
                  <div className="h-full bg-forest-500" style={{ width: `${share}%` }} />
                </div>
                {!closed && (
                  <button className="btn-ghost text-xs py-0.5">Vote</button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
