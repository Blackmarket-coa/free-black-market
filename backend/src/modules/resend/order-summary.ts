/**
 * The order-summary lines of the `order-placed` email, kept out of the `.tsx`
 * so the arithmetic can be tested without rendering and the integration spec
 * can check it against a real order.
 *
 * ## Why these fields
 *
 * The first version printed `item_total` as "Subtotal" and each shipping
 * method's `total`, then a "Tax" line. In Medusa 2.14 (`@medusajs/utils`
 * totals/line-item and totals/cart) an item's `total` is
 * `subtotal - discount_subtotal + tax_total`, and `item_total` is the sum of
 * those, so tax was printed inside Subtotal and again on its own line. A real
 * order of 2 x $10 at 10% tax plus $8 shipping rendered Subtotal $22 /
 * Shipping $8 / Tax $2 / Total $30: lines that add up to $32.
 *
 * `decorateCartTotals`, which the order module uses for its totals, computes
 *
 *     total = item_subtotal + shipping_subtotal - discount_subtotal
 *             + tax_total - credit_line_total
 *
 * where every `*_subtotal` is before tax and before discounts (for
 * tax-inclusive prices the tax is taken out), the discount is its pre-tax
 * amount, and `tax_total` is the tax on the discounted amounts. So those are
 * the lines, and they add up to the total by the same formula Medusa used to
 * produce it.
 *
 * `discount_subtotal` is not one of the order module's selectable totals
 * (`shouldIncludeTotals` in `order-module-service.js` does not list it), so
 * the subscriber asks for `discount_total` and `discount_tax_total` and takes
 * the difference: `decorateCartTotals` sums each line's
 * `discount_total = discount_subtotal + discount_tax_total`.
 */

export type OrderSummaryInput = {
  item_subtotal?: number | null
  discount_subtotal?: number | null
  tax_total?: number | null
  credit_line_total?: number | null
  total?: number | null
  shipping_methods?: Array<{ id: string; name?: string | null; subtotal?: number | null }> | null
}

export type OrderSummaryLine = {
  key: string
  label: string
  /** Signed: a discount or a credit is negative. */
  amount: number
}

const amount = (value: number | null | undefined): number =>
  typeof value === "number" && Number.isFinite(value) ? value : 0

/**
 * The lines between the items and the total, in display order. Discount and
 * credit lines appear only when there is one; Subtotal, shipping and Tax
 * always do.
 */
export function orderSummaryLines(order: OrderSummaryInput): OrderSummaryLine[] {
  const lines: OrderSummaryLine[] = [
    { key: "subtotal", label: "Subtotal", amount: amount(order.item_subtotal) },
  ]
  for (const method of order.shipping_methods ?? []) {
    lines.push({
      key: `shipping:${method.id}`,
      label: method.name || "Shipping",
      amount: amount(method.subtotal),
    })
  }
  const discount = amount(order.discount_subtotal)
  if (discount > 0) {
    lines.push({ key: "discount", label: "Discount", amount: -discount })
  }
  lines.push({ key: "tax", label: "Tax", amount: amount(order.tax_total) })
  const credits = amount(order.credit_line_total)
  if (credits > 0) {
    lines.push({ key: "credits", label: "Credits applied", amount: -credits })
  }
  return lines
}

/**
 * Currency formatting that cannot throw. `Intl.NumberFormat` throws a
 * RangeError on a currency code it does not know, and a render-time throw is
 * a failed send; an unformatted amount is still a receipt.
 */
export function currencyFormatter(currencyCode: string | null | undefined): (value: number) => string {
  const code = String(currencyCode ?? "").toUpperCase()
  try {
    const formatter = new Intl.NumberFormat("en-US", {
      style: "currency",
      currencyDisplay: "narrowSymbol",
      currency: code,
    })
    return (value) => formatter.format(value)
  } catch {
    return (value) => `${value.toFixed(2)}${code ? ` ${code}` : ""}`
  }
}
