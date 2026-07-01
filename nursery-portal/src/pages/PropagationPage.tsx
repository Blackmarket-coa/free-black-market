import { usePropagation } from "@/hooks/usePropagation"
import { PageHeader } from "@bmc/ui"
import { QueryState } from "@bmc/ui"
import { BatchCard } from "@/components/inventory/BatchCard"
import {
  PROPAGATION_WINDOWS,
  windowsOpenIn,
  windowLabel,
} from "@/lib/seasonal-windows"
import { shortDate, daysUntil } from "@bmc/portal-kit"

const THIS_MONTH = new Date().getMonth() + 1

export function PropagationPage() {
  const { data, isLoading, isError } = usePropagation()
  const openNow = windowsOpenIn(THIS_MONTH)

  return (
    <div>
      <PageHeader
        title="Propagation"
        subtitle="Active batches, stratification, and the species reference"
      />
      <QueryState isLoading={isLoading} isError={isError}>
        {data && (
          <div className="space-y-6">
            {/* Section 1 — active batches */}
            <section>
              <h2 className="heading text-base mb-2">Active batches</h2>
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {data.batches.map((b) => (
                  <BatchCard key={b.id} batch={b} onPhoto={() => {}} />
                ))}
              </div>
            </section>

            {/* Section 2 — windows open this month (compact calendar surrogate) */}
            <section>
              <h2 className="heading text-base mb-2">Windows open now</h2>
              {openNow.length === 0 ? (
                <div className="panel-pad text-sm text-mist">
                  No propagation windows open this month.
                </div>
              ) : (
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {openNow.map((w) => (
                    <div key={`${w.species}-${w.method}`} className="panel-pad">
                      <div className="text-sm text-cream-100">{w.species}</div>
                      <div className="text-xs text-mist capitalize mt-0.5">
                        {w.method} · {windowLabel(w)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Section 3 — stratification tracker */}
            <section>
              <h2 className="heading text-base mb-2">Seed stratification</h2>
              <div className="panel overflow-x-auto scroll-area">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-ghost border-b border-moss">
                      <th className="px-3 py-2 font-medium">Species</th>
                      <th className="px-3 py-2 font-medium">Type</th>
                      <th className="px-3 py-2 font-medium">Start</th>
                      <th className="px-3 py-2 font-medium">Sow on</th>
                      <th className="px-3 py-2 font-medium">Countdown</th>
                      <th className="px-3 py-2 font-medium">Location</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.stratification.map((s) => {
                      const days = daysUntil(s.end_at)
                      return (
                        <tr key={s.id} className="border-b border-moss/50">
                          <td className="px-3 py-2 text-cream-100">{s.species_name}</td>
                          <td className="px-3 py-2 text-mist">{s.type}</td>
                          <td className="px-3 py-2 text-mist">{shortDate(s.start_at)}</td>
                          <td className="px-3 py-2 text-mist">{shortDate(s.end_at)}</td>
                          <td className="px-3 py-2">
                            {days === null ? (
                              "—"
                            ) : days <= 0 ? (
                              <span className="text-forest-400">Ready to sow</span>
                            ) : (
                              <span className="text-mist">{days}d</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-ghost">{s.location ?? "—"}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </section>

            {/* Section 4 — species reference */}
            <section>
              <h2 className="heading text-base mb-2">Species reference (zone 7b)</h2>
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {PROPAGATION_WINDOWS.map((w) => (
                  <div key={`${w.species}-${w.method}`} className="panel-pad">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-cream-100">{w.species}</span>
                      <span className="text-xs text-forest-300">{windowLabel(w)}</span>
                    </div>
                    <div className="text-xs text-mist capitalize mt-0.5">{w.method}</div>
                    <div className="text-xs text-ghost mt-1">{w.notes}</div>
                    {w.success_rate != null && (
                      <div className="text-[11px] text-ghost mt-1">
                        ~{Math.round(w.success_rate * 100)}% success ·{" "}
                        {w.weeks_to_saleable}wk to saleable
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </section>
          </div>
        )}
      </QueryState>
    </div>
  )
}
