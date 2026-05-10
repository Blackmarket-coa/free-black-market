import type { Metadata } from "next"
import { AccountLoadingState, LoginForm, UserNavigation } from "@/components/molecules"
import { retrieveCustomerContext } from "@/lib/data/customer"
import {
  getCoalitionCreditsWallet,
  listCoalitionCreditsTransactions,
} from "@/lib/data/coalition-credits"

export const metadata: Metadata = {
  title: "Coalition Credits",
  description:
    "Your Coalition Credits balance, recent ledger entries, and pending settlements.",
}

const TRANSACTION_LIMIT = 25

export default async function CoalitionCreditsPage() {
  const { customer, isAuthenticated } = await retrieveCustomerContext()

  if (!customer) {
    if (!isAuthenticated) return <LoginForm />
    return <AccountLoadingState title="Coalition Credits" />
  }

  const [walletResult, transactionsResult] = await Promise.all([
    getCoalitionCreditsWallet(),
    listCoalitionCreditsTransactions({ limit: TRANSACTION_LIMIT }),
  ])

  const wallet = walletResult?.wallet ?? null
  const balance = walletResult?.balance ?? null
  const transactions = transactionsResult?.transactions ?? []

  const currency = balance?.currency_code || wallet?.currency_code || "USD"

  return (
    <main className="container">
      <div className="grid grid-cols-1 md:grid-cols-4 mt-6 gap-5 md:gap-8">
        <UserNavigation />
        <div className="md:col-span-3 space-y-8">
          <header>
            <h1 className="heading-md uppercase">Coalition Credits</h1>
            <p className="text-secondary mt-2">
              Coalition Credits settle every economic event in the Black Market
              Coalition. Balances here reflect your wallet on the
              <code className="ml-1">hawala-ledger</code> substrate.
            </p>
          </header>

          <section className="rounded-lg border border-tertiary p-6 space-y-3">
            <h2 className="heading-sm uppercase">Balance</h2>
            <dl className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <dt className="text-secondary text-sm">Available</dt>
                <dd className="heading-lg" data-testid="cc-available">
                  {formatAmount(balance?.available_balance ?? 0, currency)}
                </dd>
              </div>
              <div>
                <dt className="text-secondary text-sm">Pending</dt>
                <dd className="heading-md" data-testid="cc-pending">
                  {formatAmount(balance?.pending_balance ?? 0, currency)}
                </dd>
              </div>
              <div>
                <dt className="text-secondary text-sm">Currency</dt>
                <dd className="heading-md">{currency}</dd>
              </div>
            </dl>
            {!wallet && (
              <p className="text-sm text-secondary">
                You don&apos;t have a Coalition Credits wallet yet. One will be
                created automatically the first time you transact.
              </p>
            )}
          </section>

          <section className="space-y-3">
            <h2 className="heading-sm uppercase">Recent activity</h2>
            {transactions.length === 0 ? (
              <p className="text-secondary text-sm">
                No transactions yet. Purchases, payouts, and transfers will
                appear here.
              </p>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-secondary uppercase text-xs">
                  <tr>
                    <th className="text-left py-2">Date</th>
                    <th className="text-left">Type</th>
                    <th className="text-left">Description</th>
                    <th className="text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.map((tx) => (
                    <tr key={tx.id} className="border-t border-tertiary">
                      <td className="py-2">
                        {new Date(tx.created_at).toLocaleDateString()}
                      </td>
                      <td>{tx.entry_type}</td>
                      <td className="text-secondary">{tx.description ?? ""}</td>
                      <td
                        className={`text-right ${tx.direction === "credit" ? "text-green-600" : "text-red-600"}`}
                      >
                        {tx.direction === "credit" ? "+" : "-"}
                        {formatAmount(Math.abs(tx.amount), currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </div>
      </div>
    </main>
  )
}

function formatAmount(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
    }).format(value)
  } catch {
    return `${value.toFixed(2)} ${currency}`
  }
}
