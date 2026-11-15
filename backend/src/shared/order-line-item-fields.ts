/**
 * The line fields an ORDER read may name as `items.<field>` (SD-52).
 *
 * Medusa 2.14.2's order module rewrites every `items.<field>` on an order
 * read to `items.item.<field>` (`mapRepositoryToOrderModel` in
 * `@medusajs/order/dist/utils/transform-order.js`): `items` is the order's
 * OrderItem rows and the line itself is `items.item`, an OrderLineItem. So a
 * field resolves only if OrderLineItem has it. Quantities (`quantity`,
 * `fulfilled_quantity`, ...) live on OrderItem and computed totals (`total`,
 * `subtotal`, ...) on no table at all; `items.quantity` and `items.total`
 * both throw "Entity 'OrderLineItem' does not have property ..." for any order
 * that has a line. Select `items.*` instead: it returns the line with its
 * quantity. For line totals add a top-level total field (`total`): the order
 * module then decorates each line with `total`, `subtotal` and the rest, in
 * major units like every Medusa v2 amount.
 *
 * These are OrderLineItem's own columns plus its two relations, as Medusa
 * 2.14.2 defines them (`@medusajs/order/dist/models/line-item.js`). The
 * table also has a `totals_id` column (an early order migration) with no
 * property behind it; it is left out and fails the same way. Deeper paths
 * (`items.product.*`, `items.variant.*`, `items.tax_lines.*`,
 * `items.detail.*`) are not covered by this list.
 *
 * Read by `src/shared/__tests__/order-items-quantity-guard.unit.spec.ts`,
 * which fails on an order read naming any other `items.<field>`, and by
 * `integration-tests/http/order-items-quantity-read.spec.ts`, which reads each
 * of these on a real order and checks the list against the table's columns.
 * Cart reads are unaffected: a cart line item has its own `quantity` and
 * totals.
 */
export const ORDER_LINE_ITEM_COLUMNS = [
  "id",
  "title",
  "subtitle",
  "thumbnail",
  "variant_id",
  "product_id",
  "product_title",
  "product_description",
  "product_subtitle",
  "product_type",
  "product_type_id",
  "product_collection",
  "product_handle",
  "variant_sku",
  "variant_barcode",
  "variant_title",
  "variant_option_values",
  "requires_shipping",
  "is_giftcard",
  "is_discountable",
  "is_tax_inclusive",
  "compare_at_unit_price",
  "raw_compare_at_unit_price",
  "unit_price",
  "raw_unit_price",
  "is_custom_price",
  "metadata",
  "created_at",
  "updated_at",
  "deleted_at",
] as const

export const ORDER_LINE_ITEM_RELATIONS = ["tax_lines", "adjustments"] as const

/** Every `items.<field>` an order read can name: `*`, a column, or a relation. */
export const ORDER_READ_ITEM_FIELDS: ReadonlySet<string> = new Set<string>([
  "*",
  ...ORDER_LINE_ITEM_COLUMNS,
  ...ORDER_LINE_ITEM_RELATIONS,
])
