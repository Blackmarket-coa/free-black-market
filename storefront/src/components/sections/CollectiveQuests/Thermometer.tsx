import type { CollectiveGoal } from "@/lib/data/collective-quest"

const SCOPE_ICON: Record<CollectiveGoal["scope_type"], string> = {
  TREASURY: "💰",
  QUORUM: "🗳️",
  FOOD_FOREST: "🌳",
  CUSTOM: "🎯",
}

/**
 * A shared-progress "thermometer" — a cooperative goal rendered as a growing
 * bar. Pure presentational; `current_value` is snapshotted from the source
 * module server-side. Emphasizes the shared goal, not individual rank.
 */
export function Thermometer({ goal }: { goal: CollectiveGoal }) {
  const pct =
    goal.target_value > 0
      ? Math.min(100, Math.round((goal.current_value / goal.target_value) * 100))
      : 0
  const complete = goal.status === "COMPLETE" || pct >= 100

  return (
    <div className="rounded-lg border border-tertiary p-5 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="heading-sm">
          <span aria-hidden className="mr-2">{SCOPE_ICON[goal.scope_type]}</span>
          {goal.title}
        </h3>
        {complete && <span className="badge-accent text-xs">Reached 🎉</span>}
      </div>
      {goal.description && (
        <p className="text-secondary text-sm">{goal.description}</p>
      )}
      <div
        className="h-4 w-full overflow-hidden rounded-full bg-component"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${goal.title} progress`}
      >
        <div
          className="h-full rounded-full bg-gradient-to-r from-brand-400 to-amber-400 transition-[width] duration-700 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="text-secondary text-xs">
        {goal.current_value.toLocaleString()} / {goal.target_value.toLocaleString()}{" "}
        {goal.unit} · {pct}%
      </p>
    </div>
  )
}
