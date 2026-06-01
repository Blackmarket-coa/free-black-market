import { cn } from "@/lib/utils"
import type { RoleTrack, Stance } from "@/lib/data/progression"

const ROLE_META: Record<Stance, { label: string; emoji: string; bar: string }> = {
  producer: { label: "Producer", emoji: "🌱", bar: "bg-green-600" },
  consumer: { label: "Consumer", emoji: "🛒", bar: "bg-amber-500" },
  investor: { label: "Investor", emoji: "💰", bar: "bg-amber-700" },
  coalition: { label: "Coalition", emoji: "🤝", bar: "bg-green-800" },
  creator: { label: "Creator", emoji: "🎨", bar: "bg-green-500" },
}

/**
 * A single role track on the character sheet: emoji + label, level, and an
 * XP-into-level progress bar. Presentation-only.
 */
export function RoleTrackBar({ track }: { track: RoleTrack }) {
  const meta = ROLE_META[track.role]
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2 font-medium">
          <span aria-hidden>{meta.emoji}</span>
          {meta.label}
        </span>
        <span className="text-sm text-secondary">
          Level {track.level}
        </span>
      </div>
      <div className="h-2.5 w-full rounded-full bg-green-100 overflow-hidden">
        <div
          className={cn("h-full rounded-full transition-all", meta.bar)}
          style={{ width: `${track.pct}%` }}
          role="progressbar"
          aria-valuenow={track.pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`${meta.label} progress to next level`}
        />
      </div>
      <p className="text-xs text-secondary">
        {track.xpIntoLevel} / {track.xpForNextLevel} XP to next level
        <span className="ml-2 opacity-70">({track.xp} total)</span>
      </p>
    </div>
  )
}
