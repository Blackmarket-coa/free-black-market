import { Text } from "@medusajs/ui"
import type { OwedKind, VendorDashboard } from "../../hooks/api/hawala"

const formatCurrency = (amount: number, currency = "USD") =>
  new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount)

type Owed = NonNullable<VendorDashboard["card_processing_owed"]>

/** An item with no `kind` comes from a build before refunds were added: card processing. */
const kindOf = (item: { kind?: OwedKind }): OwedKind => item.kind ?? "card_processing"

const sum = (items: Array<{ amount: number }>) => Math.round(items.reduce((s, i) => s + i.amount, 0) * 100) / 100

/**
 * What the vendor owes, in two plain parts (backend
 * hawala-ledger/card-processing.ts and vendor-receivable.ts):
 *
 *   - Card processing owed: retained on refunded orders that the vendor's
 *     earnings could not cover at the time. The why says only what the
 *     ledger knows: the amount is FBM's card-processing estimate, and the
 *     refunded order may not have been a card charge (SD-36), so it never
 *     claims Stripe kept a fee.
 *   - Refunds owed: an order refunded after the vendor's earnings for it were
 *     paid out (SD-40).
 *   - Chargeback fees owed: the fee Stripe charges when a cardholder disputes
 *     an order (operator answer 2026-10-07). Stripe keeps it whether the
 *     dispute is won or lost, so the text never says the vendor lost.
 *
 * Both are taken from the next sales before any payout, and anything unrepaid
 * 180 days after the refund is forgiven (backend
 * CARD_PROCESSING_WRITE_OFF_DAYS): it leaves the amount owed and is listed as
 * forgiven, so a vendor who sees the total drop knows why. Nothing renders
 * when nothing is owed or forgiven.
 */
export const CardProcessingOwed = ({ owed, currency }: { owed: Owed; currency: string }) => {
  const forgiven = owed.forgiven ?? []
  const open = owed.open
  const processingOpen = open.filter((o) => kindOf(o) === "card_processing")
  const refundOpen = open.filter((o) => kindOf(o) === "refund")
  const feeOpen = open.filter((o) => kindOf(o) === "dispute_fee")
  // `by_kind` when the API sends it; otherwise everything is card processing.
  const processingOwed = owed.by_kind ? owed.by_kind.card_processing : owed.outstanding
  const refundOwed = owed.by_kind ? owed.by_kind.refund : 0
  const feeOwed = owed.by_kind?.dispute_fee ?? 0
  const processingForgiven = sum(forgiven.filter((f) => kindOf(f) === "card_processing"))
  const refundForgiven = sum(forgiven.filter((f) => kindOf(f) === "refund"))
  const feeForgiven = sum(forgiven.filter((f) => kindOf(f) === "dispute_fee"))
  if (
    !(processingOwed > 0) &&
    !(refundOwed > 0) &&
    !(feeOwed > 0) &&
    !(processingForgiven > 0) &&
    !(refundForgiven > 0) &&
    !(feeForgiven > 0)
  )
    return null
  const ids = (items: Array<{ order_id: string | null }>) =>
    items.map((o) => o.order_id).filter((id): id is string => Boolean(id))
  const processingOrders = ids(processingOpen)
  const refundOrders = ids(refundOpen)
  const feeOrders = ids(feeOpen)
  let first = true
  const gap = () => {
    const cls = first ? "" : " mt-3"
    first = false
    return cls
  }
  return (
    <div className="bg-ui-bg-base border border-ui-border-base rounded-lg p-4">
      {processingOwed > 0 ? (
        <div className={gap()}>
          <div className="flex justify-between items-center">
            <Text className="font-semibold">Card processing owed</Text>
            <Text className="font-semibold">{formatCurrency(processingOwed, currency)}</Text>
          </div>
          <Text className="text-sm text-ui-fg-muted mt-2">
            This is taken from your next sales, before any payout. Anything still owed 180 days after the refund is forgiven.
          </Text>
          <Text className="text-sm text-ui-fg-muted mt-1">
            {`Why: ${processingOrders.length === 1 ? "an order of yours was" : "orders of yours were"} refunded. Card processing on an order is not returned when the order is refunded, and your earnings at the time did not cover it.`}
            {processingOrders.length > 0 ? ` Refunded: ${processingOrders.join(", ")}.` : ""}
          </Text>
        </div>
      ) : null}
      {refundOwed > 0 ? (
        <div className={gap()}>
          <div className="flex justify-between items-center">
            <Text className="font-semibold">Refunds owed</Text>
            <Text className="font-semibold">{formatCurrency(refundOwed, currency)}</Text>
          </div>
          <Text className="text-sm text-ui-fg-muted mt-2">
            This is taken from your next sales, before any payout. Anything still owed 180 days after the refund is forgiven.
          </Text>
          <Text className="text-sm text-ui-fg-muted mt-1">
            {`Why: ${refundOrders.length === 1 ? "an order of yours was" : "orders of yours were"} refunded after your earnings for ${refundOrders.length === 1 ? "it" : "them"} had been paid out, so the refund was paid on your behalf.`}
            {refundOrders.length > 0 ? ` Refunded: ${refundOrders.join(", ")}.` : ""}
          </Text>
        </div>
      ) : null}
      {feeOwed > 0 ? (
        <div className={gap()}>
          <div className="flex justify-between items-center">
            <Text className="font-semibold">Chargeback fees owed</Text>
            <Text className="font-semibold">{formatCurrency(feeOwed, currency)}</Text>
          </div>
          <Text className="text-sm text-ui-fg-muted mt-2">
            This is taken from your next sales, before any payout. Anything still owed 180 days after the chargeback is forgiven.
          </Text>
          <Text className="text-sm text-ui-fg-muted mt-1">
            {`Why: a cardholder disputed ${feeOrders.length === 1 ? "an order" : "orders"} of yours with their bank. Stripe charges a fee for every dispute and keeps it whether the dispute is won or lost.`}
            {feeOrders.length > 0 ? ` Disputed: ${feeOrders.join(", ")}.` : ""}
          </Text>
        </div>
      ) : null}
      {processingForgiven > 0 ? (
        <Text className={`text-sm text-ui-fg-muted${gap()}`}>
          {`Forgiven: ${formatCurrency(processingForgiven, currency)} of card processing went unrepaid for 180 days after the refund, so you no longer owe it and it will not be taken from your sales.`}
        </Text>
      ) : null}
      {refundForgiven > 0 ? (
        <Text className={`text-sm text-ui-fg-muted${gap()}`}>
          {`Forgiven: ${formatCurrency(refundForgiven, currency)} of refunds went unrepaid for 180 days after the refund, so you no longer owe it and it will not be taken from your sales.`}
        </Text>
      ) : null}
      {feeForgiven > 0 ? (
        <Text className={`text-sm text-ui-fg-muted${gap()}`}>
          {`Forgiven: ${formatCurrency(feeForgiven, currency)} of chargeback fees went unrepaid for 180 days after the chargeback, so you no longer owe it and it will not be taken from your sales.`}
        </Text>
      ) : null}
    </div>
  )
}
