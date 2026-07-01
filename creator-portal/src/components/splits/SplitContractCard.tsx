import { useState } from "react"
import type { SplitContract } from "@/types"
import { shortDate, classNames } from "@bmc/portal-kit"

const BLACKOUT_URL = import.meta.env.VITE_BLACKOUT_URL || "https://theblackout.app"

// Immutable on-Blackout proof, shown once activation writes the Matrix state
// event. The event id is the canonical contract proof — it cannot be modified,
// only archived.
function MatrixEventProof({ contract }: { contract: SplitContract }) {
  const [copied, setCopied] = useState(false)
  const eventId = contract.matrix_event_id!

  function copy() {
    navigator.clipboard?.writeText(eventId)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const viewUrl = contract.space_id
    ? `${BLACKOUT_URL}/#/room/${contract.space_id}/${eventId}`
    : `${BLACKOUT_URL}`

  return (
    <div className="rounded-sm border border-forest-700/50 bg-forest-900/20 p-3 space-y-1.5">
      <div className="text-xs font-medium text-forest-300">✅ RECORDED ON BLACKOUT</div>
      <div className="flex items-center gap-2">
        <code className="text-xs text-cream-100 truncate flex-1">{eventId}</code>
        <button onClick={copy} className="btn-ghost text-xs py-0.5">
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>
      <p className="text-[11px] text-mist">
        This contract is permanently stored on your Blackout Space. It cannot be
        modified — only archived.
      </p>
      <a
        href={viewUrl}
        target="_blank"
        rel="noreferrer"
        className="inline-block text-xs text-amber-300 hover:text-amber-200"
      >
        View on Blackout →
      </a>
    </div>
  )
}

export function SplitContractCard({
  contract,
  onActivate,
  activating,
}: {
  contract: SplitContract
  onActivate?: (id: string) => void
  activating?: boolean
}) {
  const total = contract.parties.reduce((s, p) => s + p.pct, 0)
  const balanced = total === 100

  return (
    <div className="panel-pad space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-cream-50 font-medium">{contract.name}</div>
          <div className="text-xs text-ghost mt-0.5">
            Created {shortDate(contract.created_at)}
          </div>
        </div>
        <span
          className={classNames(
            "text-[10px] rounded-full px-2 py-0.5 shrink-0 capitalize",
            contract.status === "active" && "bg-forest-900/40 text-forest-300",
            contract.status === "draft" && "bg-amber-900/40 text-amber-300",
            contract.status === "archived" && "bg-moss text-ghost"
          )}
        >
          {contract.status}
        </span>
      </div>

      {/* Parties + split */}
      <div className="space-y-1.5">
        {contract.parties.map((p, i) => (
          <div key={i} className="flex items-center gap-2 text-sm">
            <span className="flex-1 text-cream-100">
              {p.name}
              {p.is_creator && <span className="text-[10px] text-amber-300 ml-1">you</span>}
            </span>
            <div className="w-28 h-1.5 rounded-full bg-moss overflow-hidden">
              <div className="h-full bg-amber-500" style={{ width: `${p.pct}%` }} />
            </div>
            <span className="w-10 text-right text-mist">{p.pct}%</span>
          </div>
        ))}
        <div
          className={classNames(
            "text-[11px] text-right",
            balanced ? "text-ghost" : "text-clay"
          )}
        >
          Total: {total}% {balanced ? "" : "(must equal 100%)"}
        </div>
      </div>

      {contract.status === "active" && contract.matrix_event_id ? (
        <MatrixEventProof contract={contract} />
      ) : contract.status === "draft" ? (
        <button
          className="btn-primary text-sm w-full"
          disabled={!balanced || activating}
          onClick={() => onActivate?.(contract.id)}
        >
          {activating ? "Activating…" : "Activate & record on Blackout"}
        </button>
      ) : null}
    </div>
  )
}
