import { useState } from "react"
import { checkClaims, hasClaimRules, resolveCompliance } from "@/lib/pathways"
import type { ProductionPathway } from "@/types"

// Generalized, real-time label-claim checker. Compiles the active pathway's
// framework patterns + custom patterns and flags matches as the maker types.
// Pathways whose framework has no claim rules (craft, seed, self-regulated) show
// a "no restrictions" note instead.
export function ClaimChecker({ pathway }: { pathway?: ProductionPathway }) {
  const [text, setText] = useState("")

  if (!pathway) {
    return (
      <div className="panel-pad">
        <h3 className="heading text-sm mb-2">Claim checker</h3>
        <p className="text-sm text-mist">Select a pathway to check label claims.</p>
      </div>
    )
  }

  const ruled = hasClaimRules(pathway.compliance_framework_id)
  const compliance = resolveCompliance(pathway)
  const flags = ruled ? checkClaims(text, pathway) : []

  return (
    <div className="panel-pad sticky top-2">
      <h3 className="heading text-sm">Claim checker</h3>
      <p className="text-[11px] text-ghost mt-1">{compliance.context_note}</p>

      {!ruled ? (
        <div className="mt-3 text-sm text-mist">
          {compliance.framework.name} has no claim restrictions — nothing to check here.
        </div>
      ) : (
        <>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={5}
            placeholder="Paste your label copy or marketing text…"
            className="mt-3 w-full bg-soil border border-moss rounded-sm px-2 py-1.5 text-sm text-cream-100"
          />

          <div className="mt-3">
            {text.trim() === "" ? (
              <p className="text-xs text-ghost">
                Flags appear here as you type. Try “cures insomnia” on a supplement pathway.
              </p>
            ) : flags.length === 0 ? (
              <p className="text-sm text-forest-300">✓ No forbidden claims detected.</p>
            ) : (
              <div className="space-y-2">
                <div className="text-xs uppercase tracking-wide text-clay">
                  {flags.length} flag{flags.length > 1 ? "s" : ""}
                </div>
                {flags.map((f, i) => (
                  <div
                    key={i}
                    className="rounded-sm border border-clay/50 bg-clay/10 px-2.5 py-2"
                  >
                    <div className="text-sm text-cream-100">
                      <span className="text-clay font-medium">“{f.flagged_phrase}”</span>
                    </div>
                    <div className="text-xs text-mist mt-1">{f.reason}</div>
                    <div className="text-xs text-forest-300 mt-1">→ {f.suggestion}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {compliance.disclaimer_required && (
            <p className="text-[11px] text-amber-300 mt-3">
              This framework requires a disclaimer on the label.
            </p>
          )}
        </>
      )}
    </div>
  )
}
