import { useState } from "react"
import { useSearchParams } from "react-router-dom"
import {
  ArrowDownTray,
  ArrowUpTray,
  CurrencyDollarSolid,
  CashSolid,
  ChartBar,
  CreditCardSolid,
  Spinner,
} from "@medusajs/icons"
import {
  Badge,
  Button,
  Container,
  Heading,
  Text,
  Input,
  Label,
  toast,
} from "@medusajs/ui"
import {
  useVendorDashboard,
  usePayoutOptions,
  useRequestPayout,
  useAdvanceEligibility,
  useRequestAdvance,
} from "../../hooks/api/hawala"
import { useCreateInvoice, useInvoices, useUpdateInvoiceState } from "../../hooks/api/invoicing"

const formatCurrency = (amount: number, currency = "USD") => {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
  }).format(amount)
}

// Balance Card Component
const BalanceCard = ({
  title,
  amount,
  currency,
  icon: Icon,
  color,
}: {
  title: string
  amount: number
  currency: string
  icon: React.ComponentType<{ className?: string }>
  color: "green" | "yellow" | "blue"
}) => {
  const colorClasses = {
    green: "bg-green-50 text-green-600",
    yellow: "bg-yellow-50 text-yellow-600",
    blue: "bg-blue-50 text-blue-600",
  }

  return (
    <div className="bg-ui-bg-base border border-ui-border-base rounded-lg p-4">
      <div className="flex items-center gap-3 mb-2">
        <div className={`p-2 rounded-full ${colorClasses[color]}`}>
          <Icon className="h-5 w-5" />
        </div>
        <Text className="text-ui-fg-muted">{title}</Text>
      </div>
      <Text className="text-2xl font-bold">{formatCurrency(amount, currency)}</Text>
    </div>
  )
}

// Payout Section Component
const PayoutSection = () => {
  const { payoutOptions, isPending, isError } = usePayoutOptions()
  const requestPayout = useRequestPayout()
  const [selectedTier, setSelectedTier] = useState<string>("STANDARD")
  const [customAmount, setCustomAmount] = useState<string>("")

  if (isPending) return <div className="flex justify-center p-4"><Spinner className="animate-spin" /></div>
  if (isError || !payoutOptions) return <Text className="text-ui-fg-muted">Unable to load payout options</Text>

  const selectedOption = payoutOptions.options.find((o) => o.tier === selectedTier)
  const amount = customAmount ? parseFloat(customAmount) : payoutOptions.available_balance
  const fee = amount * (selectedOption?.fee_rate || 0)
  const net = amount - fee

  const handlePayout = async () => {
    try {
      await requestPayout.mutateAsync({
        amount,
        payout_tier: selectedTier as "INSTANT" | "SAME_DAY" | "NEXT_DAY" | "WEEKLY",
      })
      toast.success("Payout requested successfully!")
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to request payout"
      toast.error(message)
    }
  }

  return (
    <div className="space-y-6">
      <div className="bg-ui-bg-subtle rounded-lg p-4">
        <Text className="text-ui-fg-muted mb-2">Available Balance</Text>
        <Heading level="h2" className="text-3xl font-bold">
          {formatCurrency(payoutOptions.available_balance, payoutOptions.currency)}
        </Heading>
      </div>

      <div className="space-y-4">
        <Label>Select Payout Speed</Label>
        <div className="grid grid-cols-2 gap-3">
          {payoutOptions.options.map((option) => (
            <button
              key={option.tier}
              onClick={() => setSelectedTier(option.tier)}
              disabled={!option.available}
              className={`p-4 rounded-lg border-2 text-left transition-all ${
                selectedTier === option.tier
                  ? "border-ui-fg-interactive bg-ui-bg-interactive-hover"
                  : "border-ui-border-base hover:border-ui-border-strong"
              } ${!option.available ? "opacity-50 cursor-not-allowed" : ""}`}
            >
              <div className="font-semibold">{option.name}</div>
              <div className="text-sm text-ui-fg-muted">{option.speed}</div>
              <Badge className="mt-2" color={option.fee_rate === 0 ? "green" : "grey"}>
                {option.fee_rate === 0 ? "FREE" : option.fee_rate_display}
              </Badge>
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <Label>Amount (optional - leave blank for full balance)</Label>
        <Input
          type="number"
          placeholder={payoutOptions.available_balance.toString()}
          value={customAmount}
          onChange={(e) => setCustomAmount(e.target.value)}
          max={payoutOptions.available_balance}
        />
      </div>

      <div className="bg-ui-bg-subtle rounded-lg p-4 space-y-2">
        <div className="flex justify-between">
          <Text>Amount</Text>
          <Text>{formatCurrency(amount)}</Text>
        </div>
        <div className="flex justify-between text-ui-fg-muted">
          <Text>Fee ({selectedOption?.fee_rate_display})</Text>
          <Text>-{formatCurrency(fee)}</Text>
        </div>
        <div className="border-t border-ui-border-base pt-2 flex justify-between font-semibold">
          <Text>You'll receive</Text>
          <Text>{formatCurrency(net)}</Text>
        </div>
      </div>

      <Button
        className="w-full"
        onClick={handlePayout}
        disabled={amount <= 0 || requestPayout.isPending}
      >
        {requestPayout.isPending ? (
          <Spinner className="animate-spin mr-2" />
        ) : (
          <ArrowUpTray className="mr-2" />
        )}
        Cash Out {formatCurrency(net)}
      </Button>
    </div>
  )
}

// Advance Section Component
const AdvanceSection = () => {
  const { eligibility, advances, isPending, isError } = useAdvanceEligibility()
  const requestAdvance = useRequestAdvance()
  const [amount, setAmount] = useState<string>("")
  const [selectedRate, setSelectedRate] = useState<number>(1.08)

  if (isPending) return <div className="flex justify-center p-4"><Spinner className="animate-spin" /></div>
  if (isError) return <Text className="text-ui-fg-muted">Unable to load advance information</Text>

  const activeAdvance = advances?.find((a) => a.status === "ACTIVE")

  if (activeAdvance) {
    const totalOwed = activeAdvance.principal * activeAdvance.fee_rate
    const progressPercent = ((activeAdvance.repaid / totalOwed) * 100).toFixed(1)

    return (
      <div className="space-y-6">
        <div className="bg-ui-bg-subtle rounded-lg p-4">
          <div className="flex justify-between items-center mb-4">
            <Text className="font-semibold">Active Advance</Text>
            <Badge color="green">In Progress</Badge>
          </div>

          <div className="space-y-3">
            <div className="flex justify-between">
              <Text className="text-ui-fg-muted">Principal</Text>
              <Text>{formatCurrency(activeAdvance.principal)}</Text>
            </div>
            <div className="flex justify-between">
              <Text className="text-ui-fg-muted">Total Owed</Text>
              <Text>{formatCurrency(totalOwed)}</Text>
            </div>
            <div className="flex justify-between">
              <Text className="text-ui-fg-muted">Repaid</Text>
              <Text className="text-green-600">{formatCurrency(activeAdvance.repaid)}</Text>
            </div>
            <div className="flex justify-between font-semibold">
              <Text>Remaining</Text>
              <Text>{formatCurrency(activeAdvance.outstanding)}</Text>
            </div>
          </div>

          <div className="mt-4">
            <div className="flex justify-between text-sm mb-1">
              <Text>Progress</Text>
              <Text>{progressPercent}%</Text>
            </div>
            <div className="w-full bg-ui-bg-base rounded-full h-2">
              <div
                className="bg-green-500 h-2 rounded-full transition-all"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>

          <Text className="text-sm text-ui-fg-muted mt-4">
            20% of each sale is automatically applied to your advance.
          </Text>
        </div>
      </div>
    )
  }

  if (!eligibility?.eligible) {
    return (
      <div className="text-center py-8">
        <CurrencyDollarSolid className="h-12 w-12 mx-auto text-ui-fg-muted mb-4" />
        <Heading level="h3" className="mb-2">
          Not Yet Eligible for Advances
        </Heading>
        <Text className="text-ui-fg-muted">
          {eligibility?.reason || "Build more sales history to unlock cash advances."}
        </Text>
        {eligibility?.metrics && (
          <div className="mt-4 text-sm text-ui-fg-muted">
            <Text>Last 30 days: {formatCurrency(eligibility.metrics.last_30_days_revenue)}</Text>
            <Text>Transactions: {eligibility.metrics.transaction_count}</Text>
          </div>
        )}
      </div>
    )
  }

  const requestedAmount = parseFloat(amount) || 0
  const totalRepayment = requestedAmount * selectedRate

  const handleRequestAdvance = async () => {
    try {
      await requestAdvance.mutateAsync({
        amount: requestedAmount,
        fee_rate: selectedRate,
        term_days: eligibility.suggested_term_days,
      })
      toast.success("Advance approved! Funds added to your balance.")
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to request advance"
      toast.error(message)
    }
  }

  return (
    <div className="space-y-6">
      <div className="bg-green-50 border border-green-200 rounded-lg p-4">
        <div className="flex items-center gap-2 mb-2">
          <Badge color="green">Eligible</Badge>
          <Text className="font-semibold">You qualify for a cash advance!</Text>
        </div>
        <Text className="text-sm text-ui-fg-muted">
          Based on your {formatCurrency(eligibility.metrics?.last_30_days_revenue || 0)} in sales
          over the last 30 days.
        </Text>
      </div>

      <div className="space-y-4">
        <div>
          <Label>How much do you need?</Label>
          <Input
            type="number"
            placeholder="Enter amount"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            max={eligibility.max_advance}
          />
          <Text className="text-sm text-ui-fg-muted mt-1">
            Maximum: {formatCurrency(eligibility.max_advance)}
          </Text>
        </div>

        <div>
          <Label>Select fee option</Label>
          <div className="grid grid-cols-2 gap-3 mt-2">
            {eligibility.fee_options?.map((option) => (
              <button
                key={option.rate}
                onClick={() => setSelectedRate(option.rate)}
                className={`p-3 rounded-lg border-2 text-left ${
                  selectedRate === option.rate
                    ? "border-ui-fg-interactive bg-ui-bg-interactive-hover"
                    : "border-ui-border-base"
                }`}
              >
                <div className="font-semibold">
                  {((option.rate - 1) * 100).toFixed(0)}% fee
                </div>
                <div className="text-sm text-ui-fg-muted">{option.apr_equivalent} APR equiv.</div>
              </button>
            ))}
          </div>
        </div>
      </div>

      {requestedAmount > 0 && (
        <div className="bg-ui-bg-subtle rounded-lg p-4 space-y-2">
          <div className="flex justify-between">
            <Text>You receive</Text>
            <Text className="font-semibold">{formatCurrency(requestedAmount)}</Text>
          </div>
          <div className="flex justify-between text-ui-fg-muted">
            <Text>Total fee</Text>
            <Text>{formatCurrency(totalRepayment - requestedAmount)}</Text>
          </div>
          <div className="border-t border-ui-border-base pt-2 flex justify-between font-semibold">
            <Text>You repay</Text>
            <Text>{formatCurrency(totalRepayment)}</Text>
          </div>
          <Text className="text-sm text-ui-fg-muted">
            Repaid automatically from 20% of each sale
          </Text>
        </div>
      )}

      <Button
        className="w-full"
        onClick={handleRequestAdvance}
        disabled={requestedAmount <= 0 || requestedAmount > eligibility.max_advance || requestAdvance.isPending}
      >
        {requestAdvance.isPending ? (
          <Spinner className="animate-spin mr-2" />
        ) : (
          <CurrencyDollarSolid className="mr-2" />
        )}
        Get {formatCurrency(requestedAmount)} Now
      </Button>

      <Text className="text-xs text-ui-fg-muted text-center">
        No credit check required. Approval is instant based on your sales history.
      </Text>
    </div>
  )
}

// Recent Transactions Component
const RecentTransactions = ({ transactions }: { transactions: Array<{
  id: string
  direction: "CREDIT" | "DEBIT"
  description?: string
  entry_type: string
  created_at: string
  amount: number
}> }) => {
  if (!transactions?.length) {
    return (
      <div className="text-center py-8 text-ui-fg-muted">
        <Text>No recent transactions</Text>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {transactions.map((tx) => (
        <div
          key={tx.id}
          className="flex items-center justify-between p-3 bg-ui-bg-base rounded-lg border border-ui-border-base"
        >
          <div className="flex items-center gap-3">
            <div
              className={`p-2 rounded-full ${
                tx.direction === "CREDIT" ? "bg-green-100" : "bg-red-100"
              }`}
            >
              {tx.direction === "CREDIT" ? (
                <ArrowDownTray className="h-4 w-4 text-green-600" />
              ) : (
                <ArrowUpTray className="h-4 w-4 text-red-600" />
              )}
            </div>
            <div>
              <Text className="font-medium">{tx.description || tx.entry_type}</Text>
              <Text className="text-sm text-ui-fg-muted">
                {new Date(tx.created_at).toLocaleDateString()}
              </Text>
            </div>
          </div>
          <Text
            className={`font-semibold ${
              tx.direction === "CREDIT" ? "text-green-600" : "text-red-600"
            }`}
          >
            {tx.direction === "CREDIT" ? "+" : "-"}
            {formatCurrency(tx.amount)}
          </Text>
        </div>
      ))}
    </div>
  )
}


const InvoicingSection = () => {
  const { data } = useInvoices()
  const createInvoice = useCreateInvoice()
  const updateInvoice = useUpdateInvoiceState()
  const [orderId, setOrderId] = useState("")
  const [total, setTotal] = useState("0")

  const onCreate = async () => {
    try {
      await createInvoice.mutateAsync({
        order_id: orderId,
        total: Number(total),
        currency_code: "USD",
        status: "draft",
      })
      toast.success("Invoice created")
      setOrderId("")
      setTotal("0")
    } catch (e: any) {
      toast.error(e?.message || "Failed to create invoice")
    }
  }

  return (
    <div className="space-y-4">
      <Heading level="h3">Invoicing</Heading>
      <Text className="text-ui-fg-subtle">Lifecycle states: draft → sent → paid / void.</Text>
      <div className="grid grid-cols-3 gap-3">
        <Input placeholder="Order ID" value={orderId} onChange={(e) => setOrderId(e.target.value)} />
        <Input type="number" placeholder="Total" value={total} onChange={(e) => setTotal(e.target.value)} />
        <Button onClick={onCreate} isLoading={createInvoice.isPending}>Create Draft Invoice</Button>
      </div>
      <div className="space-y-2">
        {(data?.invoices || []).map((invoice) => (
          <div key={invoice.id} className="border rounded p-3 flex items-center justify-between">
            <div>
              <Text className="font-medium">{invoice.order_id}</Text>
              <Text size="small">{formatCurrency(invoice.total, invoice.currency_code)} · {invoice.status}</Text>
            </div>
            <div className="flex gap-2">
              {invoice.status === "draft" && <Button size="small" variant="secondary" onClick={() => updateInvoice.mutate({ id: invoice.id, status: "sent" })}>Send</Button>}
              {invoice.status === "sent" && <Button size="small" variant="secondary" onClick={() => updateInvoice.mutate({ id: invoice.id, status: "paid" })}>Mark Paid</Button>}
              {invoice.status !== "void" && <Button size="small" variant="transparent" onClick={() => updateInvoice.mutate({ id: invoice.id, status: "void" })}>Void</Button>}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// Main Finances Page
export const FinancesPage = () => {
  const [searchParams] = useSearchParams()
  const currentView = searchParams.get("view")
  const { dashboard, isPending, isError, error } = useVendorDashboard()

  if (isPending) {
    return (
      <Container className="p-8">
        <div className="flex items-center justify-center h-64">
          <Spinner className="animate-spin h-8 w-8" />
        </div>
      </Container>
    )
  }

  if (isError || !dashboard) {
    return (
      <Container className="p-8">
        <div className="text-center py-8">
          <ChartBar className="h-12 w-12 mx-auto text-ui-fg-muted mb-4" />
          <Heading level="h3" className="mb-2">
            Financial Dashboard Unavailable
          </Heading>
          <Text className="text-ui-fg-muted">
            {error ? String(error) : "Set up your vendor account to access financial features."}
          </Text>
        </div>
      </Container>
    )
  }

  if (currentView === "invoicing") {
    return (
      <Container className="p-8">
        <InvoicingSection />
      </Container>
    )
  }

  return (
    <Container className="p-8">
      <div className="mb-8">
        <Heading level="h1" className="text-2xl font-bold mb-2">
          Financial Dashboard
        </Heading>
        <Text className="text-ui-fg-muted">
          Manage your earnings, payouts, and cash advances
        </Text>
      </div>

      {/* Balance Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <BalanceCard
          title="Available Balance"
          amount={dashboard.available_balance}
          currency={dashboard.currency}
          icon={CashSolid}
          color="green"
        />
        <BalanceCard
          title="Pending"
          amount={dashboard.pending_balance}
          currency={dashboard.currency}
          icon={CreditCardSolid}
          color="yellow"
        />
        <BalanceCard
          title="Today's Revenue"
          amount={dashboard.today.revenue}
          currency={dashboard.currency}
          icon={ChartBar}
          color="blue"
        />
      </div>

      {/* Revenue Stats */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        <div className="bg-ui-bg-base border border-ui-border-base rounded-lg p-4">
          <Text className="text-ui-fg-muted text-sm">This Week</Text>
          <Text className="text-xl font-bold">{formatCurrency(dashboard.week.revenue)}</Text>
          <Text className="text-sm text-ui-fg-muted">
            {dashboard.week.transaction_count} orders
          </Text>
        </div>
        <div className="bg-ui-bg-base border border-ui-border-base rounded-lg p-4">
          <Text className="text-ui-fg-muted text-sm">This Month</Text>
          <Text className="text-xl font-bold">{formatCurrency(dashboard.month.revenue)}</Text>
          <Text className="text-sm text-ui-fg-muted">
            {dashboard.month.transaction_count} orders
          </Text>
        </div>
        <div className="bg-ui-bg-base border border-ui-border-base rounded-lg p-4">
          <Text className="text-ui-fg-muted text-sm">Projected Month</Text>
          <Text className="text-xl font-bold">
            {formatCurrency(dashboard.projections.projected_month)}
          </Text>
          <Text className="text-sm text-ui-fg-muted">
            ~{formatCurrency(dashboard.projections.avg_daily_revenue)}/day avg
          </Text>
        </div>
      </div>

      {/* Payout Section */}
      <div className="mb-8">
        <Heading level="h3" className="mb-4">💸 Cash Out</Heading>
        <div className="bg-ui-bg-base border border-ui-border-base rounded-lg p-6">
          <PayoutSection />
        </div>
      </div>

      {/* Advance Section */}
      <div className="mb-8">
        <Heading level="h3" className="mb-4">Get Advance</Heading>
        <div className="bg-ui-bg-base border border-ui-border-base rounded-lg p-6">
          <AdvanceSection />
        </div>
      </div>

      {/* Recent Transactions */}
      <div className="mb-8">
        <Heading level="h3" className="mb-4">📜 Recent Transactions</Heading>
        <div className="bg-ui-bg-base border border-ui-border-base rounded-lg p-6">
          <RecentTransactions transactions={dashboard.recent_transactions} />
        </div>
      </div>

      {/* Investment Pools */}
      {dashboard.investment_pools && dashboard.investment_pools.length > 0 && (
        <div className="mt-8">
          <Heading level="h3" className="mb-4">
            🌱 Your Investment Pools
          </Heading>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {dashboard.investment_pools.map((pool) => (
              <div
                key={pool.id}
                className="bg-ui-bg-base border border-ui-border-base rounded-lg p-4"
              >
                <div className="flex justify-between items-start mb-2">
                  <Text className="font-semibold">{pool.name}</Text>
                  <Badge color={pool.status === "ACTIVE" ? "green" : "grey"}>
                    {pool.status}
                  </Badge>
                </div>
                <div className="mb-2">
                  <div className="flex justify-between text-sm mb-1">
                    <Text className="text-ui-fg-muted">
                      {formatCurrency(pool.raised)} / {formatCurrency(pool.target)}
                    </Text>
                    <Text>{((pool.raised / pool.target) * 100).toFixed(0)}%</Text>
                  </div>
                  <div className="w-full bg-ui-bg-subtle rounded-full h-2">
                    <div
                      className="bg-green-500 h-2 rounded-full"
                      style={{ width: `${(pool.raised / pool.target) * 100}%` }}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </Container>
  )
}

export default FinancesPage
