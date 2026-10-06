import { Text } from "@medusajs/ui"
import type { VendorDashboard } from "../../hooks/api/hawala"

const formatCurrency = (amount: number, currency = "USD") =>
  new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount)

/**
 * Card processing owed: card processing retained on refunded orders that
 * the vendor's earnings could not cover at the time (backend
 * hawala-ledger/card-processing.ts). Plain wording: what is owed, that it is
 * taken from the next sales before payout, and why. The why says only what
 * the ledger knows: the amount is FBM's card-processing estimate, and the
 * refunded order may not have been a card charge (SD-36), so it never claims
 * Stripe kept a fee. Nothing renders when nothing is owed.
 */
export const CardProcessingOwed = ({
  owed,
  currency,
}: {
  owed: NonNullable<VendorDashboard["card_processing_owed"]>
  currency: string
}) => {
  if (!(owed.outstanding > 0)) return null
  const orders = owed.open.map((o) => o.order_id).filter((id): id is string => Boolean(id))
  return (
    <div className="bg-ui-bg-base border border-ui-border-base rounded-lg p-4">
      <div className="flex justify-between items-center">
        <Text className="font-semibold">Card processing owed</Text>
        <Text className="font-semibold">{formatCurrency(owed.outstanding, currency)}</Text>
      </div>
      <Text className="text-sm text-ui-fg-muted mt-2">
        This is taken from your next sales, before any payout.
      </Text>
      <Text className="text-sm text-ui-fg-muted mt-1">
        {`Why: ${orders.length === 1 ? "an order of yours was" : "orders of yours were"} refunded. Card processing on an order is not returned when the order is refunded, and your earnings at the time did not cover it.`}
        {orders.length > 0 ? ` Refunded: ${orders.join(", ")}.` : ""}
      </Text>
    </div>
  )
}
