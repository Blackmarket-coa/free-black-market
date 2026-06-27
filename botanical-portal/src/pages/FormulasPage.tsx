import { useMemo, useState } from "react"
import { useFormulas } from "@/hooks/useFormulas"
import { useActivePathways } from "@/hooks/useActivePathways"
import { PageHeader } from "@/components/ui/PageHeader"
import { QueryState } from "@/components/ui/QueryState"
import { EmptyState } from "@/components/ui/EmptyState"
import { ClaimChecker } from "@/components/formulas/ClaimChecker"
import { iconForOutput, resolveCompliance } from "@/lib/pathways"
import { money, classNames } from "@/lib/format"
import type { ProductionPathway } from "@/types"

const STATUS_STYLE: Record<string, string> = {
  approved: "text-forest-300",
  draft: "text-amber-300",
  deprecated: "text-ghost",
}

export function FormulasPage() {
  const { data: pathways = [] } = useActivePathways()
  const [pathwayId, setPathwayId] = useState<string>("all")
  const { data: formulas = [], isLoading, isError } = useFormulas(
    pathwayId === "all" ? undefined : pathwayId
  )

  const pathwayById = (id: string): ProductionPathway | undefined =>
    pathways.find((p) => p.id === id)

  // The claim checker runs against a chosen pathway's rules.
  const checkerPathway = useMemo(
    () => (pathwayId === "all" ? pathways[0] : pathwayById(pathwayId)),
    [pathwayId, pathways]
  )

  return (
    <div>
      <PageHeader
        title="Formula Library"
        subtitle="Pathway-tagged recipes. The compliance context and claim rules follow the pathway."
        action={
          <button className="btn-primary text-sm" disabled>
            + New formula
          </button>
        }
      />

      {/* Pathway-first filter */}
      <div className="flex flex-wrap gap-1.5 mb-4">
        <FilterChip active={pathwayId === "all"} onClick={() => setPathwayId("all")}>
          All pathways
        </FilterChip>
        {pathways.map((p) => (
          <FilterChip
            key={p.id}
            active={pathwayId === p.id}
            onClick={() => setPathwayId(p.id)}
          >
            {iconForOutput(p.output_category)} {p.name}
          </FilterChip>
        ))}
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <QueryState isLoading={isLoading} isError={isError}>
            {formulas.length === 0 ? (
              <EmptyState
                icon="📖"
                title="No formulas"
                message="Create a formula to start tracking recipes, costing, and labels."
              />
            ) : (
              <div className="space-y-3">
                {formulas.map((f) => {
                  const pathway = pathwayById(f.pathway_id)
                  const compliance = pathway ? resolveCompliance(pathway) : null
                  const bmcCount = f.ingredients.filter((i) => i.bmc_sourced).length
                  return (
                    <div key={f.id} className="panel-pad">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-lg">
                              {pathway ? iconForOutput(pathway.output_category) : "📖"}
                            </span>
                            <span className="text-sm font-medium text-cream-50 truncate">
                              {f.name}
                            </span>
                            <span className="text-[11px] text-ghost">v{f.version}</span>
                          </div>
                          {pathway && (
                            <div className="text-[11px] text-ghost mt-1">{pathway.name}</div>
                          )}
                        </div>
                        <span className={classNames("text-xs", STATUS_STYLE[f.status])}>
                          {f.status}
                          {!f.label_reviewed && f.status !== "draft" && (
                            <span className="text-amber-300"> · label review</span>
                          )}
                        </span>
                      </div>

                      {compliance && (
                        <p className="text-[11px] text-mist mt-2">{compliance.context_note}</p>
                      )}

                      <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                        <Stat label="Yield" value={`${f.yield_units} ${f.yield_unit_type}`} />
                        <Stat label="Unit cost" value={money(f.cost_per_unit_cents)} />
                        <Stat label="Retail" value={money(f.target_retail_price_cents)} />
                        <Stat
                          label="Ingredients"
                          value={`${f.ingredients.length} · ${bmcCount} BMC`}
                        />
                      </div>

                      {f.label_claims.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {f.label_claims.map((c) => (
                            <span
                              key={c}
                              className="text-[10px] rounded-sm bg-moss text-mist px-1.5 py-0.5"
                            >
                              {c}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </QueryState>
        </div>

        {/* Live claim checker — generalized over the chosen pathway */}
        <div className="lg:col-span-1">
          <ClaimChecker pathway={checkerPathway} />
        </div>
      </div>
    </div>
  )
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={classNames(
        "rounded-sm border px-2.5 py-1 text-xs transition-colors",
        active
          ? "border-forest-500 bg-forest-900/30 text-cream-50"
          : "border-moss text-mist hover:text-cream-100"
      )}
    >
      {children}
    </button>
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
