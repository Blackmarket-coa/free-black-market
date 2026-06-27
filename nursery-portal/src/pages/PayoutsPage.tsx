import { usePayouts } from "@/hooks/usePayouts"
import { PageHeader } from "@/components/ui/PageHeader"
import { MetricCard } from "@/components/ui/MetricCard"
import { QueryState } from "@/components/ui/QueryState"
import { TierBadge } from "@/components/payouts/TierBadge"
import { KarmaBar } from "@/components/payouts/KarmaBar"
import { PayoutRow } from "@/components/payouts/PayoutRow"
import { money, shortDate, pct } from "@/lib/format"
import { TIERS } from "@/lib/tiers"

export function PayoutsPage() {
  const { data, isLoading, isError } = usePayouts()

  return (
    <div>
      <PageHeader title="Payouts" subtitle="Earnings, splits, KARMA, and tax status" />
      <QueryState isLoading={isLoading} isError={isError}>
        {data && (
          <div className="space-y-6">
            {/* Section 1 — current period */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <MetricCard label="Units sold" value={data.current_period.units_sold} />
              <MetricCard label="Gross" value={money(data.current_period.gross_cents)} />
              <MetricCard label="Your split" value={pct(data.current_period.split_pct)} />
              <MetricCard
                label="Net (est.)"
                value={money(data.current_period.net_cents)}
                subtitle={`Next pay ${shortDate(data.current_period.next_payment_date)}`}
              />
            </div>

            {/* Section 2 — KARMA & tier */}
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
                    <div className="text-lg" aria-hidden>{t.icon}</div>
                    <div className="text-xs text-cream-100">{t.name}</div>
                    <div className="text-[11px] text-ghost">{t.split_pct}%</div>
                  </div>
                ))}
              </div>

              <div className="mt-4">
                <div className="text-xs uppercase tracking-wide text-ghost mb-2">
                  Recent KARMA
                </div>
                <ul className="space-y-1">
                  {data.karma_events.map((e) => (
                    <li key={e.id} className="flex items-center justify-between text-sm">
                      <span className="text-mist">{e.description}</span>
                      <span className="text-forest-300 shrink-0 ml-2">+{e.karma}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </section>

            {/* 1099 status */}
            <section className="panel-pad">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm text-cream-100">2026 earnings to date</div>
                  <div className="heading text-xl">{money(data.earnings_ytd_cents)}</div>
                </div>
                {data.w9_required ? (
                  <div className="text-right">
                    <div className="text-xs text-amber-300">
                      W-9 required — over $600 threshold
                    </div>
                    <button className="btn-primary text-xs mt-1">Upload W-9</button>
                  </div>
                ) : (
                  <span className="text-xs text-forest-300">On track</span>
                )}
              </div>
            </section>

            {/* Section 3 — payout history */}
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
                      <th className="px-3 py-2 font-medium">Net</th>
                      <th className="px-3 py-2 font-medium">Paid</th>
                      <th className="px-3 py-2 font-medium">Ref</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.history.map((p) => (
                      <PayoutRow key={p.id} p={p} />
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            {/* Section 4 — split breakdown */}
            <section>
              <h2 className="heading text-base mb-2">This month by product</h2>
              <div className="panel overflow-x-auto scroll-area">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-ghost border-b border-moss">
                      <th className="px-3 py-2 font-medium">Product</th>
                      <th className="px-3 py-2 font-medium">Units</th>
                      <th className="px-3 py-2 font-medium">Gross</th>
                      <th className="px-3 py-2 font-medium">Your cut</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.split_breakdown.map((s) => (
                      <tr key={s.product_name} className="border-b border-moss/50">
                        <td className="px-3 py-2 text-cream-100">{s.product_name}</td>
                        <td className="px-3 py-2 text-mist">{s.units}</td>
                        <td className="px-3 py-2 text-mist">{money(s.gross_cents)}</td>
                        <td className="px-3 py-2 text-cream-100">{money(s.your_cut_cents)}</td>
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
