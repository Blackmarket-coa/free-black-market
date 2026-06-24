import type { LeaderboardEntry } from "@/lib/data/collective-quest"

const BAND_LABEL: Record<LeaderboardEntry["band"], { label: string; icon: string }> = {
  seedling: { label: "Seedling", icon: "🌱" },
  sprout: { label: "Sprout", icon: "🌿" },
  grove: { label: "Grove", icon: "🌳" },
}

/**
 * The opt-in, relative-to-self den activity view — deliberately NOT a
 * competitive ranking (ADR-0004 / Qiao et al.). Only members who opted in
 * appear, each shown with a self-relative growth band rather than a rank
 * number. Rendered as a secondary, collapsible-feeling panel.
 */
export function DenLeaderboard({ entries }: { entries: LeaderboardEntry[] }) {
  if (entries.length === 0) {
    return (
      <p className="text-secondary text-sm">
        No one has opted into the den activity view yet. Sharing is always
        optional — the goal is the shared harvest, not a ranking.
      </p>
    )
  }

  return (
    <ul className="space-y-2">
      {entries.map((e) => {
        const band = BAND_LABEL[e.band]
        return (
          <li
            key={e.customer_id}
            className="flex items-center justify-between rounded-md border border-tertiary px-4 py-2"
          >
            <span className="text-sm">
              <span aria-hidden className="mr-2">{band.icon}</span>
              {band.label}
            </span>
            <span className="text-secondary text-xs">
              {e.contribution.toLocaleString()} contributed
            </span>
          </li>
        )
      })}
    </ul>
  )
}
