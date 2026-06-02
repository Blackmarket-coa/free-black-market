import { z } from "zod"

export const salesChannelSchema = z.enum([
  "storefront",
  "pos",
  "social",
  "marketplace_feed",
])

export const inventoryLedgerEventSchema = z.object({
  event_id: z.string().min(1),
  occurred_at: z.string().datetime(),
  product_id: z.string(),
  variant_id: z.string(),
  delta: z.number().int(),
  reason: z.string(),
  transition: z.enum(["create", "update", "reconcile"]).default("update"),
  channel: salesChannelSchema,
  idempotency_key: z.string().optional(),
}).strict()

export const orderSyncEventSchema = z.object({
  event_id: z.string().min(1),
  order_id: z.string(),
  occurred_at: z.string().datetime(),
  status: z.string(),
  channel: salesChannelSchema,
  idempotency_key: z.string().optional(),
}).strict()

export const weightPriceRuleSchema = z.object({
  rule_id: z.string(),
  product_id: z.string(),
  unit: z.enum(["kg", "lb", "g", "oz"]),
  price_per_unit: z.number().int().min(0),
  currency_code: z.string().length(3),
}).strict()

export const pickPackBatchSchema = z.object({
  batch_id: z.string(),
  status: z.enum(["queued", "picking", "packing", "ready", "completed", "failed"]),
  assigned_to: z.string(),
  order_ids: z.array(z.string()).min(1),
}).strict()

export const invoiceSchema = z.object({
  invoice_id: z.string(),
  order_id: z.string(),
  status: z.enum(["draft", "issued", "sent", "paid", "void"]),
  total: z.number().int().min(0),
  currency_code: z.string().length(3),
  issued_at: z.string().datetime(),
}).strict()

export type InventoryLedgerEvent = z.infer<typeof inventoryLedgerEventSchema>
export type OrderSyncEvent = z.infer<typeof orderSyncEventSchema>
export type WeightPriceRule = z.infer<typeof weightPriceRuleSchema>
export type PickPackBatch = z.infer<typeof pickPackBatchSchema>
export type InvoiceContract = z.infer<typeof invoiceSchema>

const contractSchemas = {
  inventory_ledger_event: inventoryLedgerEventSchema,
  order_sync_event: orderSyncEventSchema,
  weight_price_rule: weightPriceRuleSchema,
  pick_pack_batch: pickPackBatchSchema,
  invoice: invoiceSchema,
} as const

export type Phase0ContractKey = keyof typeof contractSchemas

export function validatePhase0Contract<T extends Phase0ContractKey>(
  key: T,
  payload: unknown
): z.infer<(typeof contractSchemas)[T]> {
  return contractSchemas[key].parse(payload) as z.infer<(typeof contractSchemas)[T]>
}
