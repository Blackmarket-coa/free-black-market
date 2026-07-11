import { usePayouts } from "@/hooks/usePayouts"
import { PageHeader } from "@bmc/ui"
import { MetricCard } from "@bmc/ui"
import { QueryState } from "@bmc/ui"
import { TierBadge } from "@bmc/ui"
import { KarmaBar } from "@bmc/ui"
import { money, shortDate, monthLabel, pct, TIERS } from "@bmc/portal-kit"

export function PayoutsPage() {
  const { data, isLoading, isError } = usePayouts()

  return (
    <div>
      <PageHeader title="Payouts" subtitle="Earnings, cooperative split, and KARMA tier" />
      <QueryState isLoading={isLoading} isError={isError}>
        {data && (
          <div className="space-y-6">
            {/* Current period */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <MetricCard label="Units sold" value={data.current_period.units_sold} />
              <MetricCard label="Gross" value={money(data.current_period.gross_cents)} />
              <MetricCard
                label="Your split"
                value={pct(data.current_period.split_pct)}
                subtitle={`hub cut ${money(data.current_period.hub_cut_cents)}`}
              />
              <MetricCard
                label="Net (est.)"
                value={money(data.current_period.net_cents)}
                subtitle={`Next pay ${shortDate(data.current_period.next_payment_date)}`}
              />
            </div>

            {/* KARMA & tier ladder */}
            <section className="panel-pad">
              <div className="flex items-center justify-between mb-3">
                <h2 className="heading text-base">Tier & KARMA</h2>
                <TierBadge tier={data.tier} size="lg" />
              </div>
              <KarmaBar tier={data.tier} karma={data.karma_total} />

              <div className="grid sm:grid-cols-5 gap-2 mt-4">
                {TIERS.map((t) => (
                  <div
                    key={t.key}
                    className="rounded-sm border p-2 text-center"
                    style={{
                      borderColor: t.key === data.tier ? t.color : "#242b14",
                      backgroundColor: t.key === data.tier ? `${t.color}18` : "transparent",
                    }}
                  >
                    <div className="text-lg" aria-hidden>
                      {t.icon}
                    </div>
                    <div className="text-xs text-cream-100">{t.name}</div>
                    <div className="text-[11px] text-ghost">{t.split_pct}%</div>
                  </div>
                ))}
              </div>

              <div className="mt-4">
                <div className="text-xs uppercase tracking-wide text-ghost mb-2">Recent KARMA</div>
                <ul className="space-y-1">
                  {data.karma_events.map((e) => (
                    <li key={e.id} className="flex items-center justify-between text-sm">
                      <span className="text-mist">
                        {e.description}
                        <span className="text-[11px] text-ghost ml-2">{shortDate(e.date)}</span>
                      </span>
                      <span className="text-forest-300 shrink-0 ml-2">+{e.karma}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </section>

            {/* Hub cut breakdown — current period by pathway */}
            <section>
              <h2 className="heading text-base mb-2">This period by pathway</h2>
              <div className="panel overflow-x-auto scroll-area">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-ghost border-b border-moss">
                      <th className="px-3 py-2 font-medium">Pathway</th>
                      <th className="px-3 py-2 font-medium">Units</th>
                      <th className="px-3 py-2 font-medium">Gross</th>
                      <th className="px-3 py-2 font-medium">Hub cut</th>
                      <th className="px-3 py-2 font-medium">Your cut</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.pathway_breakdown.map((s) => (
                      <tr key={s.pathway_id} className="border-b border-moss/50">
                        <td className="px-3 py-2 text-cream-100">{s.pathway_name}</td>
                        <td className="px-3 py-2 text-mist">{s.units}</td>
                        <td className="px-3 py-2 text-mist">{money(s.gross_cents)}</td>
                        <td className="px-3 py-2 text-mist">
                          {money(s.gross_cents - s.your_cut_cents)}
                        </td>
                        <td className="px-3 py-2 text-cream-100">{money(s.your_cut_cents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            {/* Payout history */}
            <section>
              <h2 className="heading text-base mb-2">Payout history</h2>
              <div className="panel overflow-x-auto scroll-area">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-ghost border-b border-moss">
                      <th className="px-3 py-2 font-medium">Month</th>
                      <th className="px-3 py-2 font-medium">Units</th>
                      <th className="px-3 py-2 font-medium">Gross</th>
                      <th className="px-3 py-2 font-medium">Split</th>
                      <th className="px-3 py-2 font-medium">Hub cut</th>
                      <th className="px-3 py-2 font-medium">Net</th>
                      <th className="px-3 py-2 font-medium">Paid</th>
                      <th className="px-3 py-2 font-medium">Ref</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.history.map((p) => (
                      <tr key={p.id} className="border-b border-moss/50 hover:bg-moss/30">
                        <td className="px-3 py-2 text-cream-100">{monthLabel(p.month)}</td>
                        <td className="px-3 py-2 text-mist">{p.units_sold}</td>
                        <td className="px-3 py-2 text-mist">{money(p.gross_cents)}</td>
                        <td className="px-3 py-2 text-mist">{pct(p.split_pct)}</td>
                        <td className="px-3 py-2 text-mist">{money(p.hub_cut_cents)}</td>
                        <td className="px-3 py-2 text-cream-100">{money(p.net_cents)}</td>
                        <td className="px-3 py-2">
                          {p.paid_at ? (
                            <span className="text-forest-300">{shortDate(p.paid_at)}</span>
                          ) : (
                            <span className="text-amber-300">pending</span>
                          )}
                        </td>
                        <td className="px-3 py-2 font-mono text-[11px] text-ghost">
                          {p.transfer_ref ?? "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        )}
      </QueryState>
    </div>
  )
}
