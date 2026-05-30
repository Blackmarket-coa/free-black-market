import { Container, Heading, Text, Badge } from "@medusajs/ui"
import { useEconomicStanding } from "../../../hooks/api/economic-standing"

/**
 * Format a minor-unit-free integer amount as a currency string. The economic
 * standing route already rounds to whole units.
 */
const formatAmount = (amount: number, currency: string) => {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency || "USD",
      maximumFractionDigits: 0,
    }).format(amount)
  } catch {
    return `${amount} ${currency || "USD"}`
  }
}

/**
 * Read-only vendor economic-standing card: Coalition Credits balance, pending
 * payout, and current-period sales. Backed by Blackout entitlement/hawala data
 * via `/vendor/economic-standing`. Renders nothing until data loads, and shows
 * zeros gracefully for vendors not yet provisioned with a Matrix identity.
 */
export const EconomicStandingCard = () => {
  const { standing, isLoading, isError } = useEconomicStanding()

  if (isLoading || isError || !standing) {
    return null
  }

  const { coalition_credits, payouts, vendor_sales, creator_rewards } = standing

  return (
    <Container className="p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <Heading level="h2" className="text-lg">
            Economic Standing
          </Heading>
          <Text className="text-ui-fg-subtle" size="small">
            Coalition Credits, payouts, and sales for {vendor_sales.period}
          </Text>
        </div>
        {creator_rewards.eligible && (
          <Badge color="green" size="small">
            Creator rewards eligible
          </Badge>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Metric
          label="Available credits"
          value={formatAmount(coalition_credits.available, coalition_credits.currency)}
        />
        <Metric
          label="Pending credits"
          value={formatAmount(coalition_credits.pending, coalition_credits.currency)}
        />
        <Metric
          label="Pending payout"
          value={formatAmount(payouts.pending_amount, payouts.currency)}
        />
        <Metric
          label="Sales (gross)"
          value={formatAmount(vendor_sales.gross_volume, vendor_sales.currency)}
        />
      </div>
    </Container>
  )
}

const Metric = ({ label, value }: { label: string; value: string }) => (
  <div className="flex flex-col gap-1 rounded-lg border p-4">
    <Text className="text-ui-fg-subtle" size="xsmall">
      {label}
    </Text>
    <Text className="text-ui-fg-base" size="large" weight="plus">
      {value}
    </Text>
  </div>
)
