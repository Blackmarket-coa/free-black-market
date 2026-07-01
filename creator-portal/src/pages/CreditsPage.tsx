import { useState } from "react"
import { PageHeader } from "@/components/ui/PageHeader"
import { MetricCard } from "@/components/ui/MetricCard"
import { QueryState } from "@/components/ui/QueryState"
import { DataTable, Column } from "@/components/ui/DataTable"
import {
  useCreditBalance,
  useCreditTransactions,
  useXpBalances,
} from "@/hooks/useCreatorData"
import { credits, dateTime, classNames } from "@bmc/portal-kit"
import type { CreditTransaction, CreditTxnType } from "@/types"

const TXN_LABEL: Record<CreditTxnType, string> = {
  tip: "Tip",
  membership: "Membership",
  boost: "Boost",
  withdrawal: "Withdrawal",
  xp_conversion: "XP → ₡",
  dead_drop: "Dead-drop",
  platform_fee: "Platform fee",
}

const XP_PER_CREDIT_BLOCK = 1000 // 1,000 XP → 50₡
const CREDITS_PER_BLOCK = 50

export function CreditsPage() {
  const { data: balance, isLoading, isError } = useCreditBalance()
  const { data: txns } = useCreditTransactions()
  const { data: xpBalances } = useXpBalances()

  const [spaceId, setSpaceId] = useState<string>("")
  const [xpAmount, setXpAmount] = useState<number>(1000)
  const [withdrawAmount, setWithdrawAmount] = useState<number>(100)

  const selectedSpace = (xpBalances ?? []).find((x) => x.space_id === spaceId) ?? xpBalances?.[0]
  const xpConvertible = selectedSpace ? Math.floor(selectedSpace.xp / XP_PER_CREDIT_BLOCK) * XP_PER_CREDIT_BLOCK : 0
  const creditsFromXp = Math.floor(xpAmount / XP_PER_CREDIT_BLOCK) * CREDITS_PER_BLOCK

  const columns: Column<CreditTransaction>[] = [
    { key: "date", header: "When", sortValue: (r) => r.created_at, render: (r) => <span className="text-mist">{dateTime(r.created_at)}</span> },
    { key: "type", header: "Type", sortValue: (r) => r.type, render: (r) => <span className="text-cream-100">{TXN_LABEL[r.type]}</span> },
    { key: "counterparty", header: "Detail", render: (r) => <span className="text-mist">{r.counterparty ?? "—"}{r.room ? ` · ${r.room}` : ""}</span> },
    {
      key: "amount",
      header: "Amount",
      sortValue: (r) => r.amount_credits,
      className: "text-right",
      render: (r) => (
        <span className={classNames("text-right block", r.amount_credits >= 0 ? "text-forest-300" : "text-clay")}>
          {r.amount_credits >= 0 ? "+" : "−"}
          {credits(Math.abs(r.amount_credits))}
        </span>
      ),
    },
  ]

  return (
    <div className="space-y-5">
      <PageHeader
        title="Coalition Credits"
        subtitle="Your ₡ balance on the hawala-ledger CCR rail — tips, memberships, boosts, and withdrawals."
      />

      <QueryState isLoading={isLoading} isError={isError}>
        {balance && (
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
            <MetricCard label="Available" value={credits(balance.available_credits)} icon="🪙" subtitle="spendable / withdrawable" />
            <MetricCard label="Pending" value={credits(balance.pending_credits)} subtitle="in Stellar escrow" />
            <MetricCard label="Lifetime earned" value={credits(balance.lifetime_earned)} />
          </div>
        )}

        <div className="grid md:grid-cols-2 gap-4">
          {/* Withdraw */}
          <section className="panel-pad space-y-3">
            <div className="heading text-sm text-cream-50">Withdraw to bank</div>
            <p className="text-xs text-mist">
              ₡ → USDC → USD via ACH. Minimum 100₡ ($1). Processing 2–3 business days.
            </p>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={100}
                value={withdrawAmount}
                onChange={(e) => setWithdrawAmount(Number(e.target.value))}
                className="w-32 bg-soil border border-moss rounded-sm px-3 py-1.5 text-sm text-cream-100 focus:outline-none focus:border-amber-600"
              />
              <span className="text-xs text-ghost">≈ ${(withdrawAmount / 100).toFixed(2)}</span>
            </div>
            <button
              className="btn-primary text-sm"
              disabled={withdrawAmount < 100 || (balance ? withdrawAmount > balance.available_credits : true)}
            >
              Withdraw {credits(withdrawAmount)}
            </button>
          </section>

          {/* XP → Credits */}
          <section className="panel-pad space-y-3">
            <div className="heading text-sm text-cream-50">Convert XP to credits</div>
            <p className="text-xs text-mist">
              1,000 XP → 50₡. XP is per-Space — choose which coalition's XP to convert.
            </p>
            <select
              value={spaceId || selectedSpace?.space_id || ""}
              onChange={(e) => setSpaceId(e.target.value)}
              className="w-full bg-soil border border-moss rounded-sm px-3 py-1.5 text-sm text-cream-100 focus:outline-none focus:border-amber-600"
            >
              {(xpBalances ?? []).map((x) => (
                <option key={x.space_id} value={x.space_id}>
                  {x.space_name} — {x.xp.toLocaleString()} XP
                </option>
              ))}
            </select>
            <div className="flex items-center gap-2">
              <input
                type="number"
                step={1000}
                min={1000}
                max={xpConvertible}
                value={xpAmount}
                onChange={(e) => setXpAmount(Number(e.target.value))}
                className="w-32 bg-soil border border-moss rounded-sm px-3 py-1.5 text-sm text-cream-100 focus:outline-none focus:border-amber-600"
              />
              <span className="text-xs text-forest-300">→ {credits(creditsFromXp)}</span>
            </div>
            <button
              className="btn-primary text-sm"
              disabled={xpAmount < 1000 || xpAmount % 1000 !== 0 || xpAmount > xpConvertible}
            >
              Convert
            </button>
          </section>
        </div>

        <section>
          <h2 className="heading text-sm mb-2">Transactions</h2>
          <DataTable columns={columns} rows={txns ?? []} exportName="creator-credit-transactions" />
        </section>
      </QueryState>
    </div>
  )
}
