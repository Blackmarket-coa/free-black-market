import type { TierKey } from "@bmc/portal-kit"
import { getTier } from "@bmc/portal-kit"

export function TierBadge({
  tier,
  size = "sm",
}: {
  tier: TierKey
  size?: "sm" | "lg"
}) {
  const t = getTier(tier)
  const lg = size === "lg"
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5"
      style={{
        backgroundColor: `${t.color}22`,
        border: `1px solid ${t.color}66`,
        fontSize: lg ? "0.95rem" : "0.7rem",
      }}
    >
      <span aria-hidden>{t.icon}</span>
      <span style={{ color: t.color }} className="font-medium">
        {t.name}
      </span>
    </span>
  )
}
