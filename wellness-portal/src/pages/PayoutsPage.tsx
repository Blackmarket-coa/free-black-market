import { PageHeader } from "@bmc/ui"
import { MetricCard } from "@bmc/ui"
import { QueryState } from "@bmc/ui"
import { DataTable, Column } from "@bmc/ui"
import { TierBadge } from "@bmc/ui"
import { KarmaBar } from "@bmc/ui"
import { usePayouts } from "@/hooks/useWellness"
import { money, monthLabel, shortDate } from "@bmc/portal-kit"
import type { PayoutRecord } from "@/types"

export function PayoutsPage() {
  const { data, isLoading, isError } = usePayouts()

  const columns: Column<PayoutRecord>[] = [
    { key: "month", header: "Month", sortValue: (r) => r.month, render: (r) => <span className="text-cream-100">{monthLabel(r.month)}</span> },
    { key: "gross", header: "Gross", sortValue: (r) => r.gross_cents, render: (r) => <span className="text-mist">{money(r.gross_cents)}</span> },
    { key: "fee", header: "FBM fee", sortValue: (r) => r.fee_cents, render: (r) => <span className="text-mist">{money(r.fee_cents)}</span> },
    { key: "net", header: "Net", sortValue: (r) => r.net_cents, render: (r) => <span className="text-cream-100">{money(r.net_cents)}</span> },
    { key: "paid", header: "Paid", sortValue: (r) => r.paid_at ?? "", render: (r) => <span className="text-mist">{shortDate(r.paid_at)}</span> },
    { key: "ref", header: "Ref", render: (r) => <span className="text-ghost text-xs">{r.transfer_ref ?? "—"}</span> },
  ]

  return (
    <div className="space-y-5">
      <PageHeader title="Payouts" subtitle="Earnings, FBM split, and payout history." />
      <QueryState isLoading={isLoading} isError={isError}>
        {data && (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {data.current_period.by_type.slice(0, 3).map((t) => (
                <MetricCard key={t.type} label={t.type} value={money(t.net_cents)} />
              ))}
              <MetricCard
                label="Net this month"
                value={money(data.current_period.net_total_cents)}
                icon="💸"
                subtitle={`Next payout ${shortDate(data.current_period.next_payment_date)}`}
              />
            </div>

            <section className="panel-pad">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                  <div className="text-xs text-ghost uppercase tracking-wide mb-1">Tier</div>
                  <TierBadge tier={data.tier} size="lg" />
                </div>
                <div className="flex-1 min-w-[240px]">
                  <KarmaBar tier={data.tier} karma={data.karma_total} />
                </div>
              </div>
            </section>

            <section className="panel-pad text-sm">
              <div className="heading text-sm text-cream-50 mb-1">Tax status</div>
              <div className="text-mist">
                2026 earnings to date: {money(data.earnings_ytd_cents)}.{" "}
                {data.w9_required
                  ? "You've passed the $600 IRS reporting threshold — your 1099 will be available in January 2027."
                  : "Below the $600 reporting threshold."}
              </div>
            </section>

            <section>
              <h2 className="heading text-sm mb-2">Payout history</h2>
              <DataTable columns={columns} rows={data.history} exportName="wellness-payouts" />
            </section>
          </>
        )}
      </QueryState>
    </div>
  )
}
