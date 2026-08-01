import { useState } from "react"
import { PageHeader } from "@bmc/ui"
import { MetricCard } from "@bmc/ui"
import { QueryState } from "@bmc/ui"
import { DataTable, Column } from "@bmc/ui"
import {
  useConvertXp,
  useCreditBalance,
  useCreditTransactions,
  useWithdrawCredits,
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

/** Surface the backend's error message (axios response) or a fallback. */
function errorMessage(err: unknown): string {
  if (err && typeof err === "object") {
    const resp = (err as { response?: { data?: { message?: unknown } } }).response
    if (resp?.data && typeof resp.data.message === "string") return resp.data.message
    const msg = (err as { message?: unknown }).message
    if (typeof msg === "string") return msg
  }
  return "Something went wrong. Please try again."
}

export function CreditsPage() {
  const { data: balance, isLoading, isError } = useCreditBalance()
  const { data: txns } = useCreditTransactions()
  const { data: xpBalances } = useXpBalances()
  const convertXp = useConvertXp()
  const withdraw = useWithdrawCredits()

  const [spaceId, setSpaceId] = useState<string>("")
  const [xpAmount, setXpAmount] = useState<number>(1000)
  const [withdrawAmount, setWithdrawAmount] = useState<number>(100)

  const selectedSpace = (xpBalances ?? []).find((x) => x.space_id === spaceId) ?? xpBalances?.[0]
  const spendableXp = selectedSpace?.xp ?? 0
  const xpConvertible = Math.floor(spendableXp / XP_PER_CREDIT_BLOCK) * XP_PER_CREDIT_BLOCK
  const creditsFromXp = Math.floor(xpAmount / XP_PER_CREDIT_BLOCK) * CREDITS_PER_BLOCK
  // Posture A: Coalition Credits never convert to cash. A withdrawal is a
  // closed-loop redemption REQUEST that burns ₡ and is settled manually.
  const canConvert =
    spendableXp >= XP_PER_CREDIT_BLOCK &&
    xpAmount >= XP_PER_CREDIT_BLOCK &&
    xpAmount % XP_PER_CREDIT_BLOCK === 0 &&
    xpAmount <= xpConvertible
  const canWithdraw =
    withdrawAmount > 0 && !!balance && withdrawAmount <= balance.available_credits

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
          {/* Withdraw — closed-loop redemption request (Posture A: no cash-out) */}
          <section className="panel-pad space-y-3">
            <div className="heading text-sm text-cream-50">Withdraw credits</div>
            <p className="text-xs text-mist">
              Coalition Credits are closed-loop — they don't cash out. A withdrawal
              retires ₡ from your balance and queues a redemption request for manual
              settlement by the coalition.
            </p>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={1}
                value={withdrawAmount}
                onChange={(e) => setWithdrawAmount(Number(e.target.value))}
                className="w-32 bg-soil border border-moss rounded-sm px-3 py-1.5 text-sm text-cream-100 focus:outline-none focus:border-amber-600"
              />
              <span className="text-xs text-ghost">
                of {credits(balance?.available_credits ?? 0)} available
              </span>
            </div>
            <button
              className="btn-primary text-sm"
              disabled={!canWithdraw || withdraw.isPending}
              onClick={() => withdraw.mutate({ credits: withdrawAmount })}
            >
              {withdraw.isPending ? "Requesting…" : `Withdraw ${credits(withdrawAmount)}`}
            </button>
            {withdraw.isSuccess && (
              <p className="text-xs text-forest-300">
                Queued for manual settlement · request {withdraw.data.request_id}
              </p>
            )}
            {withdraw.isError && (
              <p className="text-xs text-clay">{errorMessage(withdraw.error)}</p>
            )}
          </section>

          {/* XP → Credits */}
          <section className="panel-pad space-y-3">
            <div className="heading text-sm text-cream-50">Convert XP to credits</div>
            <p className="text-xs text-mist">
              1,000 XP → 50₡, converted in whole blocks. You have{" "}
              {spendableXp.toLocaleString()} XP.
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
              disabled={!canConvert || convertXp.isPending}
              onClick={() => convertXp.mutate({ xp: xpAmount })}
            >
              {convertXp.isPending ? "Converting…" : "Convert"}
            </button>
            {convertXp.isSuccess && (
              <p className="text-xs text-forest-300">
                Converted {convertXp.data.converted_xp.toLocaleString()} XP →{" "}
                {credits(convertXp.data.credits)}
              </p>
            )}
            {convertXp.isError && (
              <p className="text-xs text-clay">{errorMessage(convertXp.error)}</p>
            )}
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
