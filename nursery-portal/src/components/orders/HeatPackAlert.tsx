// Heat-pack reminder for live-plant orders shipping in cold months (Nov–Feb).
export function isHeatPackSeason(date = new Date()): boolean {
  const m = date.getMonth() + 1 // 1..12
  return m === 11 || m === 12 || m === 1 || m === 2
}

export function HeatPackAlert() {
  if (!isHeatPackSeason()) return null
  return (
    <span className="inline-flex items-center gap-1 rounded-xs border border-clay/50 bg-clay/10 px-1.5 py-0.5 text-xs text-clay">
      🔥 Add a heat pack (winter shipping)
    </span>
  )
}
