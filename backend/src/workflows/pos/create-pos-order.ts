import {
  createWorkflow,
  createStep,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { emitEventStep } from "@medusajs/medusa/core-flows"
import {
  ContainerRegistrationKeys,
  MedusaError,
  Modules,
} from "@medusajs/framework/utils"
import {
  buildPosOrderMetadata,
  shapePosItems,
  type PosOrderInput,
} from "./pos-helpers"
import { adjustPosInventoryStep } from "./adjust-pos-inventory"

/**
 * Create a real order for an in-person POS sale (roadmap Phase 3A / §1.7).
 *
 * Creates the order directly via the order module (mirroring the delivery
 * flow's `create-order` step) — no cart/payment-session ceremony, because the
 * payment already happened physically at the counter. The order metadata is
 * stamped `order_channel: "pos"` and `order.placed` is emitted explicitly so
 * every placed-order subscriber fires: channel attribution, entitlement
 * grants (digital goods sold in person), and the Blackout order events.
 *
 * Direct creation bypasses the cart flow's reservation machinery, so the
 * workflow decrements stock itself via `adjustPosInventoryStep` (best-effort:
 * the payment already happened at the counter, so inventory problems are
 * logged, never fatal).
 */
export const createPosOrderStep = createStep(
  "create-pos-order-step",
  async (input: PosOrderInput, { container }) => {
    const shaped = shapePosItems(input.items)
    if (!shaped.ok) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, shaped.message)
    }

    const query = container.resolve(ContainerRegistrationKeys.QUERY)

    // Enrich catalog items: resolve title/product_id from the variant when the
    // client sent only a variant_id. Unknown variant ids are a hard error —
    // a mistyped ring-up must not silently create an untraceable line.
    const variantIds = shaped.items
      .map((i) => i.variant_id)
      .filter((id): id is string => !!id)
    if (variantIds.length > 0) {
      const { data: variants } = await query.graph({
        entity: "variant",
        fields: ["id", "title", "product_id", "product.title"],
        filters: { id: variantIds },
      })
      const byId = new Map<string, any>(
        (variants ?? []).map((v: any) => [v.id, v])
      )
      for (const item of shaped.items) {
        if (!item.variant_id) continue
        const variant = byId.get(item.variant_id)
        if (!variant) {
          throw new MedusaError(
            MedusaError.Types.NOT_FOUND,
            `Variant ${item.variant_id} not found`
          )
        }
        item.product_id = item.product_id ?? variant.product_id ?? undefined
        if (item.title === "POS item") {
          item.title = variant.product?.title
            ? `${variant.product.title}${variant.title ? ` (${variant.title})` : ""}`
            : variant.title || item.title
        }
      }
    }

    // Default region/currency from the store's first region when not given,
    // so a bare POS client works out of the box.
    let regionId = input.region_id ?? undefined
    let currencyCode = input.currency_code ?? undefined
    if (!regionId || !currencyCode) {
      const { data: regions } = await query.graph({
        entity: "region",
        fields: ["id", "currency_code"],
        filters: {},
      })
      const region = regions?.[0]
      regionId = regionId ?? region?.id ?? undefined
      currencyCode = currencyCode ?? region?.currency_code ?? "usd"
    }

    const orderModuleService = container.resolve(Modules.ORDER)
    const order = await orderModuleService.createOrders({
      currency_code: currencyCode,
      email: input.email || undefined,
      customer_id: input.customer_id || undefined,
      region_id: regionId,
      sales_channel_id: input.sales_channel_id || undefined,
      items: shaped.items,
      metadata: buildPosOrderMetadata({
        seller_id: input.seller_id,
        payment_method: input.payment_method,
        note: input.note,
      }),
    })

    return new StepResponse({ order }, { orderId: order.id })
  },
  // Compensation: soft-delete the order if a later step fails.
  async (data, { container }) => {
    if (!data) {
      return
    }
    const orderService = container.resolve(Modules.ORDER)
    await orderService.softDeleteOrders([data.orderId])
  }
)

export const createPosOrderWorkflowId = "create-pos-order-workflow"
export const createPosOrderWorkflow = createWorkflow(
  createPosOrderWorkflowId,
  (input: PosOrderInput) => {
    const { order } = createPosOrderStep(input)

    // Decrement stock for the catalog lines (compensated on later failure).
    adjustPosInventoryStep(input)

    // Fire the placed-order pipeline: channel attribution reads the
    // metadata.order_channel stamp; entitlements + Blackout events follow.
    emitEventStep({
      eventName: "order.placed",
      data: { id: order.id },
    })

    return new WorkflowResponse({ order })
  }
)
