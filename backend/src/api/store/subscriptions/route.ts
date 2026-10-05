import { z } from "zod"
import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { SUBSCRIPTION_MODULE } from "../../../modules/subscription"
import SubscriptionModuleService from "../../../modules/subscription/service"
import { SubscriptionInterval, SubscriptionType } from "../../../modules/subscription/types"
import { createSubscriptionWorkflow } from "../../../workflows/subscription"
import { requireCustomerId } from "../../../shared"
import { forbidden } from "../../../shared/community-read-access"
import {
  consumerSubscriptionsEnabled,
  loadProductMetadata,
} from "../../../workflows/subscription/grace-lifecycle"
import { isUntilCanceledProduct } from "../../../modules/subscription/utils/grace"
import {
  saveAutoRenewPaymentMethod,
  subscriptionCartLines,
} from "../../../workflows/subscription/auto-renew"
import { AUTO_RENEW_DISCLOSURE_VERSION } from "../../../modules/subscription/utils/auto-renew"

/**
 * The cart's owner, or null when the cart does not exist or the lookup
 * fails. A failure denies rather than admits.
 */
async function cartCustomerId(
  req: AuthenticatedMedusaRequest,
  cartId: string
): Promise<string | null> {
  try {
    const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
    const { data } = await query.graph({
      entity: "cart",
      fields: ["id", "customer_id"],
      filters: { id: cartId },
    })
    const cart = (data as Array<{ customer_id?: string | null }>)[0]
    return cart?.customer_id ?? null
  } catch {
    return null
  }
}

/** Product metadata naming the billing interval a subscribable product is sold on. */
const SUBSCRIPTION_INTERVAL_PRODUCT_METADATA_KEY = "subscription_interval"

// ===========================================
// VALIDATION SCHEMAS
// ===========================================

const createSubscriptionSchema = z.object({
  cart_id: z.string().min(1, "Cart ID is required"),
  interval: z.enum(["weekly", "biweekly", "monthly", "quarterly", "yearly"]),
  period: z.number().min(1).max(52, "Period must be between 1-52"),
  type: z.enum(["csa_share", "meal_plan", "produce_box", "membership", "custom"]).optional(),
  delivery_day: z.string().optional(),
  delivery_instructions: z.string().max(500).optional(),
})

/**
 * FF_CONSUMER_SUBSCRIPTIONS_V1: the customer must answer the auto-renew
 * question explicitly — `true` or `false`, never absent (400) — and an
 * approval names the disclosure version the customer saw.
 */
const createWithApprovalSchema = createSubscriptionSchema
  .extend({
    auto_renew_approved: z.boolean({
      error: "auto_renew_approved is required and must be true or false",
    }),
    auto_renew_disclosure_version: z.string().min(1).max(64).optional(),
  })
  .refine((d) => !d.auto_renew_approved || !!d.auto_renew_disclosure_version, {
    error: "auto_renew_disclosure_version is required when auto_renew_approved is true",
    path: ["auto_renew_disclosure_version"],
  })

/**
 * POST /store/subscriptions with FF_CONSUMER_SUBSCRIPTIONS_V1 on: the
 * affirmative auto-renew approval (operator answer 2026-10-05, "renew upon
 * approval").
 *
 *   - approved → until cancelled, but only for a product marked
 *     `subscription_until_canceled`; the approval is stored with its time and
 *     disclosure version, and the card on the cart's payment session is kept
 *     for off-session renewals;
 *   - declined → exactly one period, never renewed, no card kept.
 *
 * Refused before anything is completed or charged: a missing answer (400), a
 * cart that is not the caller's (forbidden()), a cart with other than one line
 * of quantity 1 (400), an approval of a stale disclosure or for a product not
 * sold that way (409), and an interval other than the one the product names in
 * `metadata.subscription_interval` (409) — the interval the disclosure the
 * customer approved named, and the one period a declined purchase pays for.
 */
async function postWithApproval(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse,
  customerId: string
) {
  const data = createWithApprovalSchema.parse(req.body)

  if ((await cartCustomerId(req, data.cart_id)) !== customerId) {
    forbidden(res)
    return
  }

  if (
    data.auto_renew_approved &&
    data.auto_renew_disclosure_version !== AUTO_RENEW_DISCLOSURE_VERSION
  ) {
    res.status(409).json({
      message:
        `The auto-renewal terms have changed (current version ${AUTO_RENEW_DISCLOSURE_VERSION}). ` +
        `Review the current terms and approve again.`,
      type: "auto_renew_disclosure_outdated",
    })
    return
  }

  const lines = await subscriptionCartLines(req.scope, data.cart_id)
  if (
    !lines ||
    lines.item_count !== 1 ||
    lines.product_ids.length !== 1 ||
    lines.quantities[0] !== 1
  ) {
    res.status(400).json({
      message: "A subscription is checked out on its own: the cart must hold exactly one item.",
      type: "subscription_cart_single_item",
    })
    return
  }

  const productMetadata = await loadProductMetadata(req.scope, lines.product_ids[0])
  if (data.auto_renew_approved && !isUntilCanceledProduct(productMetadata)) {
    res.status(409).json({
      message: "Automatic renewal is not offered for this product.",
      type: "auto_renew_not_offered",
    })
    return
  }

  // The interval is the product's, not the client's: an approval renews on
  // the interval the disclosure named, and a declined purchase pays for one
  // period of it. An approved purchase needs the product to name one.
  const productInterval = productMetadata?.[SUBSCRIPTION_INTERVAL_PRODUCT_METADATA_KEY]
  if (
    (data.auto_renew_approved || productInterval !== undefined) &&
    productInterval !== data.interval
  ) {
    res.status(409).json({
      message: "The subscription interval does not match the interval this product is sold on.",
      type: "subscription_interval_mismatch",
    })
    return
  }

  const { result } = await createSubscriptionWorkflow(req.scope).run({
    input: {
      cart_id: data.cart_id,
      subscription_data: {
        interval: data.interval as SubscriptionInterval,
        period: data.period,
        type: data.type as SubscriptionType | undefined,
        delivery_day: data.delivery_day,
        delivery_instructions: data.delivery_instructions,
        auto_renew: {
          approved: data.auto_renew_approved,
          disclosure_version: data.auto_renew_approved
            ? (data.auto_renew_disclosure_version ?? null)
            : null,
          approved_at: new Date().toISOString(),
        },
      },
    },
  })

  const subscription = result.subscription as
    | { id: string; auto_renew_approved?: boolean | null; expiration_date?: unknown }
    | undefined
  if (subscription) {
    await saveAutoRenewPaymentMethod(req.scope, { subscription, cart_id: data.cart_id })
  }

  res.status(201).json({
    subscription: result.subscription,
    order: result.order,
  })
}

// ===========================================
// GET /store/subscriptions
// List customer's subscriptions
// ===========================================

export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  try {
    const customerId = requireCustomerId(req, res)
    if (!customerId) return

    const subscriptionService = req.scope.resolve<SubscriptionModuleService>(SUBSCRIPTION_MODULE)
    
    const { status, type } = req.query as { status?: string; type?: string }
    
    const filters: Record<string, any> = { customer_id: customerId }
    if (status) filters.status = status
    if (type) filters.type = type

    const subscriptions = await subscriptionService.listSubscriptions(filters, {
      order: { created_at: "DESC" },
    })

    res.json({
      subscriptions,
      count: subscriptions.length,
    })
  } catch (error) {
    throw error
  }
}

// ===========================================
// POST /store/subscriptions
// Create a new subscription from cart
// ===========================================

export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  try {
    const customerId = requireCustomerId(req, res)
    if (!customerId) return

    if (consumerSubscriptionsEnabled()) {
      await postWithApproval(req, res, customerId)
      return
    }

    const data = createSubscriptionSchema.parse(req.body)

    // A1: the cart must be the caller's own. Previously any cart id was
    // completed, and the subscription (and the order, and the charge) then
    // belonged to whoever owned that cart. Missing cart and someone else's
    // cart get the same 403 — one code, so cart ids cannot be probed.
    if ((await cartCustomerId(req, data.cart_id)) !== customerId) {
      forbidden(res)
      return
    }

    const { result } = await createSubscriptionWorkflow(req.scope).run({
      input: {
        cart_id: data.cart_id,
        subscription_data: {
          interval: data.interval as SubscriptionInterval,
          period: data.period,
          type: data.type as SubscriptionType | undefined,
          delivery_day: data.delivery_day,
          delivery_instructions: data.delivery_instructions,
        }
      }
    })

    res.status(201).json({
      subscription: result.subscription,
      order: result.order,
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ message: "Validation failed", errors: error.issues })
      return
    }
    throw error
  }
}
