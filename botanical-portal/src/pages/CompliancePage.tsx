import { useCompliance } from "@/hooks/useCompliance"
import { useActivePathways } from "@/hooks/useActivePathways"
import { PageHeader } from "@/components/ui/PageHeader"
import { QueryState } from "@/components/ui/QueryState"
import { COMPLIANCE_FRAMEWORKS, hasClaimRules, iconForOutput } from "@/lib/pathways"
import { money, shortDate, pct, classNames } from "@bmc/portal-kit"
import type { ComplianceOverview } from "@/types"

const ROW_STATUS: Record<ComplianceOverview["pathway_rows"][number]["status"], { icon: string; tone: string }> = {
  ok: { icon: "✅", tone: "text-forest-300" },
  attention: { icon: "⚠️", tone: "text-amber-300" },
  none_required: { icon: "—", tone: "text-ghost" },
}

export function CompliancePage() {
  const { data, isLoading, isError } = useCompliance()
  const { data: pathways = [] } = useActivePathways()

  // Section visibility derives entirely from the active pathways.
  const showCottageFood = pathways.some((p) => p.counts_toward_cottage_food_limit)
  const showPhLog = pathways.some((p) => p.requires_ph_testing)
  const showGermLog = pathways.some((p) => p.output_category === "seed_packet")
  const showClaimNote = pathways.some((p) => hasClaimRules(p.compliance_framework_id))

  return (
    <div>
      <PageHeader
        title="Compliance Center"
        subtitle="Only the sections relevant to your active pathways are shown."
      />
      <QueryState isLoading={isLoading} isError={isError}>
        {data && (
          <div className="space-y-6">
            {/* Per-pathway compliance dashboard */}
            <section>
              <h2 className="heading text-base mb-2">Pathway compliance</h2>
              <div className="panel divide-y divide-moss/50">
                {data.pathway_rows.map((row) => {
                  const s = ROW_STATUS[row.status]
                  return (
                    <div
                      key={row.pathway_id}
                      className="flex items-center justify-between gap-3 px-3 py-2.5"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span>{iconForOutput(row.output_category)}</span>
                        <div className="min-w-0">
                          <div className="text-sm text-cream-100 truncate">
                            {row.pathway_name}
                          </div>
                          <div className="text-[11px] text-ghost">
                            {COMPLIANCE_FRAMEWORKS[row.framework_id].name}
                          </div>
                        </div>
                      </div>
                      <div className={classNames("text-xs text-right shrink-0", s.tone)}>
                        <span className="mr-1">{s.icon}</span>
                        {row.note}
                      </div>
                    </div>
                  )
                })}
              </div>
            </section>

            {showClaimNote && (
              <section className="panel-pad">
                <h2 className="heading text-sm mb-1">Claim checker</h2>
                <p className="text-sm text-mist">
                  Real-time label-claim checking runs in the{" "}
                  <a href="#/formulas" className="text-forest-300">
                    Formula Library
                  </a>{" "}
                  for pathways with claim rules (supplement, cosmetic, food). Craft and seed
                  pathways have no claim restrictions.
                </p>
              </section>
            )}

            {/* Cottage food tracker — aggregated across cottage-eligible pathways */}
            {showCottageFood && data.cottage_food.enabled && (
              <CottageFood cottage={data.cottage_food} />
            )}

            {/* pH log — acidified/fermented pathways only */}
            {showPhLog && (
              <section>
                <h2 className="heading text-base mb-2">pH test log</h2>
                <div className="panel overflow-x-auto scroll-area">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-ghost border-b border-moss">
                        <th className="px-3 py-2 font-medium">Batch</th>
                        <th className="px-3 py-2 font-medium">Formula</th>
                        <th className="px-3 py-2 font-medium">Date</th>
                        <th className="px-3 py-2 font-medium">pH</th>
                        <th className="px-3 py-2 font-medium">Method</th>
                        <th className="px-3 py-2 font-medium">Result</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.ph_logs.map((l) => (
                        <tr key={l.id} className="border-b border-moss/50">
                          <td className="px-3 py-2 font-mono text-[11px] text-mist">
                            {l.batch_number}
                          </td>
                          <td className="px-3 py-2 text-cream-100">{l.formula_name}</td>
                          <td className="px-3 py-2 text-mist">{shortDate(l.test_date)}</td>
                          <td className="px-3 py-2 text-cream-100">{l.ph_reading}</td>
                          <td className="px-3 py-2 text-mist">{l.method}</td>
                          <td className="px-3 py-2">
                            <span className={l.pass ? "text-forest-300" : "text-clay"}>
                              {l.pass ? "Pass" : "Fail"}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            {/* Germination log — seed pathway only */}
            {showGermLog && (
              <section>
                <h2 className="heading text-base mb-2">Germination log</h2>
                <div className="panel overflow-x-auto scroll-area">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-ghost border-b border-moss">
                        <th className="px-3 py-2 font-medium">Lot</th>
                        <th className="px-3 py-2 font-medium">Species</th>
                        <th className="px-3 py-2 font-medium">Tested</th>
                        <th className="px-3 py-2 font-medium">Rate</th>
                        <th className="px-3 py-2 font-medium">Method</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.germination_logs.map((l) => (
                        <tr key={l.id} className="border-b border-moss/50">
                          <td className="px-3 py-2 font-mono text-[11px] text-mist">
                            {l.lot_number}
                          </td>
                          <td className="px-3 py-2 text-cream-100">
                            {l.species_name}
                            {l.alert && (
                              <span className="ml-2 text-[11px] text-clay">retest</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-mist">{shortDate(l.test_date)}</td>
                          <td className="px-3 py-2">
                            <span className={l.germination_rate_pct < 70 ? "text-clay" : "text-forest-300"}>
                              {pct(l.germination_rate_pct)}
                            </span>
                            <span className="text-[11px] text-ghost ml-1">
                              ({l.seeds_germinated}/{l.seeds_tested})
                            </span>
                          </td>
                          <td className="px-3 py-2 text-mist">{l.method.replace(/_/g, " ")}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            <p className="text-[11px] text-ghost">
              BMC provides general guidance only, not legal advice.
            </p>
          </div>
        )}
      </QueryState>
    </div>
  )
}

function CottageFood({ cottage }: { cottage: ComplianceOverview["cottage_food"] }) {
  const ratio = cottage.cap_cents > 0 ? cottage.ytd_revenue_cents / cottage.cap_cents : 0
  const tone = ratio >= 0.95 ? "bg-clay" : ratio >= 0.8 ? "bg-amber-400" : "bg-forest-500"
  return (
    <section className="panel-pad">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="heading text-sm">Cottage food revenue ({cottage.state})</h2>
          <p className="text-xs text-mist mt-0.5">
            Aggregated YTD across all cottage-food-eligible pathways.
          </p>
        </div>
        <div className="text-right">
          <div className="text-cream-50 heading text-lg">{money(cottage.ytd_revenue_cents)}</div>
          <div className="text-[11px] text-ghost">cap {money(cottage.cap_cents)}</div>
        </div>
      </div>
      <div className="mt-3 h-2 rounded-full bg-moss overflow-hidden">
        <div className={classNames("h-full", tone)} style={{ width: `${Math.min(100, ratio * 100)}%` }} />
      </div>
      <div className="text-[11px] text-mist mt-1">{pct(ratio * 100)} of state cap</div>
    </section>
  )
}
