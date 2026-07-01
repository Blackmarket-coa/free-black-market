import { useState } from "react"
import { useProductionRuns } from "@/hooks/useProductionRuns"
import { useActivePathways } from "@/hooks/useActivePathways"
import { PageHeader } from "@bmc/ui"
import { QueryState } from "@bmc/ui"
import { Tabs } from "@bmc/ui"
import { EmptyState } from "@bmc/ui"
import { RunStatusBadge } from "@/components/production/RunStatusBadge"
import { CureTimer } from "@/components/production/CureTimer"
import { iconForOutput } from "@/lib/pathways"
import { money, shortDate } from "@bmc/portal-kit"
import type { ProductionPathway } from "@/types"

export function ProductionPage() {
  const { data: runs = [], isLoading, isError } = useProductionRuns()
  const { data: pathways = [] } = useActivePathways()
  const [tab, setTab] = useState("active")

  const pathwayById = (id: string): ProductionPathway | undefined =>
    pathways.find((p) => p.id === id)

  const active = runs.filter((r) => !["complete", "failed"].includes(r.status))
  const done = runs.filter((r) => ["complete", "failed"].includes(r.status))
  const shown = tab === "active" ? active : done

  return (
    <div>
      <PageHeader
        title="Production"
        subtitle="Batch runs across every pathway. Status labels and cure timers adapt to each pathway."
        action={
          <button className="btn-primary text-sm" disabled>
            + Schedule run
          </button>
        }
      />
      <QueryState isLoading={isLoading} isError={isError}>
        <Tabs
          tabs={[
            { key: "active", label: "Active", count: active.length },
            { key: "complete", label: "Completed", count: done.length },
          ]}
          active={tab}
          onChange={setTab}
        />

        {shown.length === 0 ? (
          <EmptyState icon="⚗️" title="No runs here" message="Scheduled runs will appear here." />
        ) : (
          <div className="space-y-3">
            {shown.map((run) => {
              const pathway = pathwayById(run.pathway_id)
              const yieldText =
                run.actual_yield_units != null
                  ? `${run.actual_yield_units} / ${run.planned_yield_units}`
                  : `${run.planned_yield_units} planned`
              return (
                <div key={run.id} className="panel-pad">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-lg">
                        {pathway ? iconForOutput(pathway.output_category) : "⚗️"}
                      </span>
                      <div className="min-w-0">
                        <div className="text-sm text-cream-50 font-medium truncate">
                          {run.formula_name}
                        </div>
                        <div className="text-[11px] text-ghost font-mono">{run.batch_number}</div>
                      </div>
                    </div>
                    <RunStatusBadge pathway={pathway} status={run.status} />
                  </div>

                  <CureTimer run={run} pathway={pathway} className="mt-3" />

                  <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                    <Stat label="Started" value={shortDate(run.actual_start_date)} />
                    <Stat
                      label={`Yield (${run.yield_unit_type})`}
                      value={yieldText}
                    />
                    <Stat label="Cost" value={money(run.total_cost_cents)} />
                    {/* pH entry only for pathways that require it */}
                    {pathway?.requires_ph_testing && (
                      <Stat
                        label={`pH (≤ ${pathway.ph_threshold ?? 4.6})`}
                        value={
                          run.ph_reading != null ? (
                            <span
                              className={
                                run.ph_reading < (pathway.ph_threshold ?? 4.6)
                                  ? "text-forest-300"
                                  : "text-clay"
                              }
                            >
                              {run.ph_reading}
                            </span>
                          ) : (
                            <span className="text-amber-300">log needed</span>
                          )
                        }
                      />
                    )}
                  </div>

                  {run.notes && <p className="text-xs text-mist mt-2">{run.notes}</p>}
                </div>
              )
            })}
          </div>
        )}
      </QueryState>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-ghost">{label}</div>
      <div className="text-cream-100 mt-0.5">{value}</div>
    </div>
  )
}
