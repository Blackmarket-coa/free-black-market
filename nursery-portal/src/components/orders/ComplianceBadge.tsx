// States that require a phytosanitary certificate for live-plant shipments.
// Gating the label request on these is the compliance check.
export const PHYTO_STATES = ["CA", "AZ", "HI"]

export function requiresPhyto(state: string): boolean {
  return PHYTO_STATES.includes(state.toUpperCase())
}

export function ComplianceBadge({ state }: { state: string }) {
  if (!requiresPhyto(state)) return null
  return (
    <span className="inline-flex items-center gap-1 rounded-xs border border-amber-700 bg-amber-900/20 px-1.5 py-0.5 text-xs text-amber-300">
      ⚠️ {state.toUpperCase()} — phyto cert required
    </span>
  )
}
