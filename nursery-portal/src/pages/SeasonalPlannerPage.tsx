import { usePropagation } from "@/hooks/usePropagation"
import { PageHeader } from "@bmc/ui"
import { QueryState } from "@bmc/ui"
import {
  PROPAGATION_WINDOWS,
  REFERENCE_ZONE,
  isWindowOpen,
  windowsOpenIn,
  windowLabel,
  monthName,
  type PropagationWindow,
} from "@/lib/seasonal-windows"
import { shortDate, daysUntil, classNames } from "@bmc/portal-kit"

const THIS_MONTH = new Date().getMonth() + 1
const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1)

// Rough calendar month a batch started now would be saleable in.
function readyMonthLabel(w: PropagationWindow): string | null {
  if (w.weeks_to_saleable == null) return null
  const d = new Date()
  d.setDate(d.getDate() + w.weeks_to_saleable * 7)
  return `${monthName(d.getMonth() + 1)} ${d.getFullYear()}`
}

export function SeasonalPlannerPage() {
  const { data, isLoading, isError } = usePropagation()

  // "Start now" — windows open this month, best odds first. Windows that
  // close after this month get a last-call flag.
  const startNow = [...windowsOpenIn(THIS_MONTH)].sort(
    (a, b) => (b.success_rate ?? 0) - (a.success_rate ?? 0)
  )

  return (
    <div>
      <PageHeader
        title="Seasonal Planner"
        subtitle={`Year-round propagation calendar (zone ${REFERENCE_ZONE} reference) — what to start each month to keep supply flowing`}
      />
      <QueryState isLoading={isLoading} isError={isError}>
        {data && (
          <div className="space-y-6">
            {/* Section 1 — start now */}
            <section>
              <h2 className="heading text-base mb-2">
                Start now — {monthName(THIS_MONTH)}
              </h2>
              {startNow.length === 0 ? (
                <div className="panel-pad text-sm text-mist">
                  No propagation windows open this month. Use the calendar below
                  to prep for the next one.
                </div>
              ) : (
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {startNow.map((w) => {
                    const lastCall = w.end_month === THIS_MONTH
                    const ready = readyMonthLabel(w)
                    return (
                      <div key={`${w.species}-${w.method}`} className="panel-pad">
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-cream-100">{w.species}</span>
                          {lastCall ? (
                            <span className="text-[11px] text-amber-300">
                              Last call — closes {monthName(w.end_month)}
                            </span>
                          ) : (
                            <span className="text-[11px] text-forest-300">
                              Open {windowLabel(w)}
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-mist capitalize mt-0.5">{w.method}</div>
                        <div className="text-xs text-ghost mt-1">{w.notes}</div>
                        <div className="text-[11px] text-ghost mt-2">
                          {w.success_rate != null && (
                            <>~{Math.round(w.success_rate * 100)}% success</>
                          )}
                          {ready && <> · saleable ~{ready}</>}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </section>

            {/* Section 2 — 12-month calendar derived from PROPAGATION_WINDOWS */}
            <section>
              <h2 className="heading text-base mb-2">Year at a glance</h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                {MONTHS.map((m) => {
                  const open = PROPAGATION_WINDOWS.filter((w) => isWindowOpen(w, m))
                  const sows = data.stratification.filter(
                    (s) => new Date(s.end_at).getMonth() + 1 === m
                  )
                  const isNow = m === THIS_MONTH
                  return (
                    <div
                      key={m}
                      className={classNames(
                        "panel-pad",
                        isNow && "border border-forest-500"
                      )}
                    >
                      <div className="flex items-center justify-between mb-1.5">
                        <span
                          className={classNames(
                            "text-sm",
                            isNow ? "text-forest-300" : "text-cream-100"
                          )}
                        >
                          {monthName(m)}
                        </span>
                        {isNow && (
                          <span className="text-[10px] uppercase tracking-wide text-forest-300">
                            now
                          </span>
                        )}
                      </div>
                      {open.length === 0 && sows.length === 0 ? (
                        <div className="text-xs text-ghost">Quiet month</div>
                      ) : (
                        <ul className="space-y-0.5">
                          {open.map((w) => {
                            const starts = w.start_month === m
                            return (
                              <li
                                key={`${w.species}-${w.method}`}
                                className="text-xs text-mist"
                              >
                                <span className={starts ? "text-cream-100" : undefined}>
                                  {w.species}
                                </span>{" "}
                                <span className="text-ghost">
                                  {starts ? `— start ${w.method}` : "· continues"}
                                </span>
                              </li>
                            )
                          })}
                          {sows.map((s) => (
                            <li key={s.id} className="text-xs text-amber-300">
                              Sow {s.species_name} (stratification ends)
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )
                })}
              </div>
            </section>

            {/* Section 3 — upcoming stratification (from the propagation hook) */}
            <section>
              <h2 className="heading text-base mb-2">Stratification pipeline</h2>
              {data.stratification.length === 0 ? (
                <div className="panel-pad text-sm text-mist">
                  Nothing stratifying. Seed windows in the calendar above show
                  when to start cold treatment.
                </div>
              ) : (
                <div className="panel overflow-x-auto scroll-area">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-ghost border-b border-moss">
                        <th className="px-3 py-2 font-medium">Species</th>
                        <th className="px-3 py-2 font-medium">Type</th>
                        <th className="px-3 py-2 font-medium">Started</th>
                        <th className="px-3 py-2 font-medium">Sow on</th>
                        <th className="px-3 py-2 font-medium">Countdown</th>
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
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>
        )}
      </QueryState>
    </div>
  )
}
