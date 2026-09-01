import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { z } from "zod"

import {
  CCR_RESERVATION_METADATA_KEY,
  isCcrCheckoutLive,
  quoteCreditApplication,
  resolveCentsPerCredit,
} from "../../../../../lib/ccr-checkout"
import {
  getOrCreateCustomerCcrWallet,
  releaseCartCredits,
  reserveCartCredits,
} from "../../../../../lib/ccr-cart-ledger"
import { HAWALA_LEDGER_MODULE } from "../../../../../modules/hawala-ledger"
import type HawalaLedgerModuleService from "../../../../../modules/hawala-ledger/service"

/**
 * Apply or release Coalition Credits on a cart.
 *
 * Auth posture matches the sibling `../wholesale` and `../tier` routes: no
 * middleware, the cart id is the capability. Dark unless
 * `FBM_CCR_CHECKOUT_LIVE=1`, and a 404 before any service is resolved — the
 * same shape as `vendor/creator/credits/withdraw`.
 *
 * Applying does NOT reduce the charge on its own. Credits are tender and the
 * payment-collection half is not built, so `completeCartWorkflow` refuses a
 * cart holding a reservation (`workflows/hooks/validate-ccr-reservation.ts`).
 * That is deliberate: the lifecycle is reachable and testable, and the
 * transition that could take money twice is bolted shut.
 */

const BodySchema = z.object({ credits: z.number().int().nonnegative() }).strict()

type CartRow = {
  id: string
  customer_id?: string | null
  subtotal?: number | string | null
  metadata?: Record<string, unknown> | null
}

async function loadCart(req: MedusaRequest, cartId: string): Promise<CartRow | null> {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "cart",
    fields: ["id", "customer_id", "subtotal", "metadata"],
    filters: { id: cartId },
  })
  return (Array.isArray(data) ? data[0] : null) as CartRow | null
}

function reservedOn(cart: CartRow): number {
  const raw = (cart.metadata ?? {})[CCR_RESERVATION_METADATA_KEY]
  const n = Number(raw ?? 0)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0
}

async function setReserved(
  req: MedusaRequest,
  cart: CartRow,
  credits: number
): Promise<void> {
  const carts = req.scope.resolve("cart") as {
    updateCarts: (id: string, data: Record<string, unknown>) => Promise<unknown>
  }
  await carts.updateCarts(cart.id, {
    metadata: { ...(cart.metadata ?? {}), [CCR_RESERVATION_METADATA_KEY]: credits },
  })
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  if (!isCcrCheckoutLive()) {
    return res.status(404).json({ message: "Not found", type: "not_found" })
  }

  const parsed = BodySchema.safeParse(req.body ?? {})
  if (!parsed.success) {
    return res.status(400).json({
      message: "credits must be a non-negative integer",
      type: "invalid_request",
      errors: parsed.error.flatten(),
    })
  }

  const rate = resolveCentsPerCredit()
  if (rate === null) {
    // No configured worth for a credit. Fail safe rather than guess one — the
    // same posture an unmapped Canopy plan takes rather than inventing a price.
    return res.status(503).json({
      message: "Coalition Credits cannot be applied: no credit rate is configured",
      type: "credits_unavailable",
    })
  }

  const cartId = String(req.params.id)
  const cart = await loadCart(req, cartId)
  if (!cart) {
    return res.status(404).json({ message: "Cart not found", type: "not_found" })
  }
  if (!cart.customer_id) {
    return res.status(400).json({
      message: "Claim the cart before applying credits",
      type: "cart_unclaimed",
    })
  }

  const hawala = req.scope.resolve<HawalaLedgerModuleService>(HAWALA_LEDGER_MODULE)
  const wallet = await getOrCreateCustomerCcrWallet(hawala, cart.customer_id)

  // Release any prior reservation first, so changing the amount is one
  // reservation rather than an accumulating stack.
  const already = reservedOn(cart)
  if (already > 0) {
    await releaseCartCredits(hawala, {
      cartId,
      customerId: cart.customer_id,
      credits: already,
    })
  }

  const balance = Number(wallet.available_balance ?? 0) + already
  const quote = quoteCreditApplication({
    subtotalCents: Math.floor(Number(cart.subtotal ?? 0)),
    walletCredits: Number.isFinite(balance) ? balance : 0,
    requestedCredits: parsed.data.credits,
    centsPerCredit: rate,
  })

  if (quote.creditsApplied > 0) {
    await reserveCartCredits(hawala, {
      cartId,
      customerId: cart.customer_id,
      credits: quote.creditsApplied,
    })
  }
  await setReserved(req, cart, quote.creditsApplied)

  return res.json({ applied: quote.creditsApplied > 0, quote })
}

export async function DELETE(req: MedusaRequest, res: MedusaResponse) {
  if (!isCcrCheckoutLive()) {
    return res.status(404).json({ message: "Not found", type: "not_found" })
  }

  const cartId = String(req.params.id)
  const cart = await loadCart(req, cartId)
  if (!cart) {
    return res.status(404).json({ message: "Cart not found", type: "not_found" })
  }

  const already = reservedOn(cart)
  if (already > 0 && cart.customer_id) {
    const hawala = req.scope.resolve<HawalaLedgerModuleService>(HAWALA_LEDGER_MODULE)
    await releaseCartCredits(hawala, {
      cartId,
      customerId: cart.customer_id,
      credits: already,
    })
  }
  await setReserved(req, cart, 0)

  return res.json({ released: already })
}
