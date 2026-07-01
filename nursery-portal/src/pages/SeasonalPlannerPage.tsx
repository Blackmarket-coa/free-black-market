import { StubPage } from "@bmc/ui"
import { PROPAGATION_WINDOWS, windowLabel } from "@/lib/seasonal-windows"

export function SeasonalPlannerPage() {
  return (
    <div>
      <StubPage
        title="Seasonal Planner"
        icon="📅"
        summary="Year-round propagation calendar — what to start each month to keep supply flowing."
        planned={[
          "12-month overview grid (propagate / harvest / cycles / compliance)",
          "Month detail with week-by-week task list",
          "Hub-requested tasks vs your own plan",
          "Mark tasks done → emits KARMA when tied to a quest",
        ]}
      />
      <div className="panel-pad mt-4">
        <div className="text-xs uppercase tracking-wide text-ghost mb-2">
          Built-in propagation windows (zone 7b reference)
        </div>
        <ul className="grid sm:grid-cols-2 gap-1.5 text-sm">
          {PROPAGATION_WINDOWS.map((w) => (
            <li key={`${w.species}-${w.method}`} className="text-mist">
              <span className="text-cream-100">{w.species}</span> — {w.method}{" "}
              <span className="text-ghost">({windowLabel(w)})</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
