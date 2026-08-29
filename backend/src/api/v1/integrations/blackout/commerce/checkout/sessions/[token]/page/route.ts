import { createLogger } from "../../../../../../../../../shared/logger"
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import jwt from "jsonwebtoken"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import {
  createCartWorkflow,
  createPaymentCollectionForCartWorkflow,
  createPaymentSessionsWorkflow,
} from "@medusajs/medusa/core-flows"
import { config } from "../../../../../../../../../shared/config"
import { MARKETPLACE_LISTING_MODULE } from "../../../../../../../../../modules/marketplace-listing"
import type MarketplaceListingService from "../../../../../../../../../modules/marketplace-listing/service"
import {
  BlackoutCheckoutSessionStatus,
  CreatorListingStatus,
} from "../../../../../../../../../modules/marketplace-listing/models"
import { SUBSCRIPTION_MODULE } from "../../../../../../../../../modules/subscription"
import type SubscriptionModuleService from "../../../../../../../../../modules/subscription/service"
import { SubscriptionType } from "../../../../../../../../../modules/subscription/types"
import { createSubscriptionWorkflow } from "../../../../../../../../../workflows/subscription"
import { SUBSCRIPTION_PAYMENT_PROVIDER_ID } from "../../../../../../../../../workflows/subscription/renew-helpers"
import createDigitalProductOrderWorkflow from "../../../../../../../../../workflows/create-digital-product-order"
import { ENTITLEMENT_MODULE } from "../../../../../../../../../modules/entitlement"
import type EntitlementModuleService from "../../../../../../../../../modules/entitlement/service"
import { EntitlementKind } from "../../../../../../../../../modules/entitlement/models"
import { resolveOrCreateCustomerForBlackoutUser } from "../../../../../../../../../lib/blackout-identity"
import { ensureListingProduct } from "../../../../../../../../../lib/blackout-listing-product"
import {
  extractPaymentMethodId,
  extractStripeClientSecret,
  getCustomerEmailAndMxid,
  mapListingRecurrence,
  resolveRegionIdForCurrency,
  sanitizeCheckoutMetadata,
} from "../../../../../../../../../lib/blackout-checkout"

const log = createLogger(
  "api/v1/integrations/blackout/commerce/checkout/sessions/[token]/page"
)

/**
 * Hosted FBM checkout page for a Blackout-initiated session (§5, W1b).
 *
 * The session token resolves a stateful `blackout_checkout_session` row; this
 * page materializes the real purchase around it, idempotently:
 *   render → ensure customer (create-on-miss) → ensure the listing's shadow
 *   product → ensure cart (+ payment collection + Stripe payment session,
 *   saved for off-session renewals) → the member pays →
 *   ?action=complete → subscription listings run createSubscriptionWorkflow
 *   (cart → order → subscription → tier entitlement bundle), everything else
 *   runs the standard digital-product order flow → the order.placed webhook
 *   posts `purchase.succeeded` (metadata echo included) back to Blackout.
 *
 * Re-renders and retries reuse the recorded cart; a completed session renders
 * (and postMessages) the completed state instead of purchasing twice.
 */

interface TokenPayload {
  sid: string
}

type SessionRow = {
  id: string
  blackout_user_id: string
  listing_id: string
  mxid: string | null
  customer_id: string | null
  cart_id: string | null
  order_id: string | null
  subscription_id: string | null
  status: string
  embed: boolean
  embed_origin: string | null
  return_url: string | null
  requested_metadata: unknown
}

type ListingRow = {
  id: string
  seller_id: string
  title: string
  description: string | null
  status: string
  category: string | null
  price_cents: number | null
  currency: string | null
  entitlement_kind: string | null
  feature_keys: unknown
  media_urls: unknown
  interval: string | null
  period_days: number | null
  product_id: string | null
  variant_id: string | null
  metadata: Record<string, unknown> | null
  slug: string
}

function decodeToken(token: string): TokenPayload | null {
  if (!config.JWT_SECRET) return null
  try {
    const decoded = jwt.verify(token, config.JWT_SECRET, {
      audience: "fbm-blackout-checkout",
    })
    if (typeof decoded !== "object" || !decoded) return null
    const sid = (decoded as Record<string, unknown>)["sid"]
    if (typeof sid !== "string" || !sid) return null
    return { sid }
  } catch {
    return null
  }
}

function listingService(req: MedusaRequest): MarketplaceListingService {
  return req.scope.resolve<MarketplaceListingService>(MARKETPLACE_LISTING_MODULE)
}

async function loadSession(req: MedusaRequest, sid: string): Promise<SessionRow | null> {
  try {
    const record = await listingService(req).retrieveBlackoutCheckoutSession(sid)
    return record as unknown as SessionRow
  } catch {
    return null
  }
}

async function loadListing(req: MedusaRequest, listingId: string): Promise<ListingRow | null> {
  const [listing] = await listingService(req).listCreatorListings({ id: listingId })
  return (listing as unknown as ListingRow | undefined) ?? null
}

function featureKeysOf(listing: ListingRow): string[] {
  if (!Array.isArray(listing.feature_keys)) return []
  return listing.feature_keys.filter(
    (k): k is string => typeof k === "string" && k.length > 0
  )
}

function entitlementKindOf(listing: ListingRow): EntitlementKind | undefined {
  const raw = listing.entitlement_kind
  if (!raw) return undefined
  return (Object.values(EntitlementKind) as string[]).includes(raw)
    ? (raw as EntitlementKind)
    : undefined
}

function blackoutTierOf(listing: ListingRow): string {
  const fromMetadata = listing.metadata?.["blackout_tier"]
  if (typeof fromMetadata === "string" && fromMetadata.length > 0) return fromMetadata
  return listing.slug
}

type CartView = {
  cart_id: string
  completed: boolean
  total: string | null
  currency_code: string | null
  client_secret: string | null
  payment_session_data: unknown
}

async function queryCart(req: MedusaRequest, cartId: string) {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "cart",
    fields: [
      "id",
      "completed_at",
      "total",
      "currency_code",
      "payment_collection.id",
      "payment_collection.payment_sessions.id",
      "payment_collection.payment_sessions.data",
      "payment_collection.payment_sessions.status",
    ],
    filters: { id: cartId },
  })
  return (data?.[0] ?? null) as {
    id: string
    completed_at?: string | Date | null
    total?: number | string | null
    currency_code?: string | null
    payment_collection?: {
      id: string
      payment_sessions?: Array<{ id: string; data?: unknown; status?: string }>
    } | null
  } | null
}

/**
 * Idempotently materialize customer, shadow product, cart, payment collection
 * and payment session for the session record. Every artifact is persisted
 * back onto the record so a re-render resumes instead of duplicating.
 */
async function materialize(
  req: MedusaRequest,
  record: SessionRow,
  listing: ListingRow
): Promise<CartView> {
  const service = listingService(req)

  // 1. Customer (create-on-miss keeps Blackout-native members purchasable).
  let customerId = record.customer_id
  if (!customerId) {
    const resolved = await resolveOrCreateCustomerForBlackoutUser(req.scope, {
      blackoutUserId: record.blackout_user_id,
      mxid: record.mxid,
    })
    if (!resolved) {
      throw new Error("Could not resolve or create a customer for this session")
    }
    customerId = resolved.customerId
    await service.updateBlackoutCheckoutSessions({ id: record.id, customer_id: customerId })
    record.customer_id = customerId
  }

  // 2. Shadow product (persists product_id/variant_id on the listing).
  const { variant_id } = await ensureListingProduct(req.scope, listing)

  // 3. Cart.
  let cart = record.cart_id ? await queryCart(req, record.cart_id) : null
  if (record.cart_id && !cart) {
    // Recorded cart vanished (env reset); mint a fresh one below.
    record.cart_id = null
  }
  if (cart?.completed_at) {
    return {
      cart_id: cart.id,
      completed: true,
      total: cart.total != null ? String(cart.total) : null,
      currency_code: cart.currency_code ?? null,
      client_secret: null,
      payment_session_data: null,
    }
  }

  if (!cart) {
    const currency = (listing.currency ?? "usd").toLowerCase()
    const regionId = await resolveRegionIdForCurrency(req.scope, currency)
    if (!regionId) {
      throw new Error(`No region is configured for currency ${currency}`)
    }
    const { email, mxid: customerMxid } = await getCustomerEmailAndMxid(
      req.scope,
      customerId
    )
    const mxid = record.mxid ?? customerMxid

    const echo = sanitizeCheckoutMetadata(record.requested_metadata) ?? {}
    const cartMetadata: Record<string, unknown> = {
      ...echo,
      blackout_user_id: record.blackout_user_id,
      fbm_external_customer_id: record.blackout_user_id,
      creator_listing_id: listing.id,
      blackout_checkout_session_id: record.id,
      ...(mxid ? { mxid } : {}),
    }

    const { result } = await createCartWorkflow(req.scope).run({
      input: {
        region_id: regionId,
        customer_id: customerId,
        email: email ?? undefined,
        currency_code: currency,
        items: [
          {
            variant_id,
            quantity: 1,
            metadata: { creator_listing_id: listing.id },
          },
        ],
        metadata: cartMetadata,
      },
    })
    const createdCartId = (result as { id?: string })?.id
    if (!createdCartId) {
      throw new Error("Cart creation returned no id")
    }
    await service.updateBlackoutCheckoutSessions({ id: record.id, cart_id: createdCartId })
    record.cart_id = createdCartId
    cart = await queryCart(req, createdCartId)
    if (!cart) throw new Error("Cart not found after creation")
  }

  // 4. Payment collection + payment session (saved method for renewals).
  if (!cart.payment_collection?.id) {
    await createPaymentCollectionForCartWorkflow(req.scope).run({
      input: { cart_id: cart.id },
    })
    cart = await queryCart(req, cart.id)
    if (!cart?.payment_collection?.id) {
      throw new Error("Payment collection not found after creation")
    }
  }

  let session = cart.payment_collection.payment_sessions?.[0] ?? null
  if (!session) {
    await createPaymentSessionsWorkflow(req.scope).run({
      input: {
        payment_collection_id: cart.payment_collection.id,
        provider_id: SUBSCRIPTION_PAYMENT_PROVIDER_ID,
        customer_id: customerId,
        // Ask the provider to save the method for off-session renewals; the
        // renewal workflow later charges `subscription.payment_method_id`.
        data: { setup_future_usage: "off_session" },
        context: { setup_future_usage: "off_session" },
      },
    })
    cart = await queryCart(req, cart.id)
    session = cart?.payment_collection?.payment_sessions?.[0] ?? null
  }

  return {
    cart_id: cart!.id,
    completed: false,
    total: cart!.total != null ? String(cart!.total) : null,
    currency_code: cart!.currency_code ?? null,
    client_secret: extractStripeClientSecret(session?.data),
    payment_session_data: session?.data ?? null,
  }
}

type CompletionResult = {
  order_id: string | null
  subscription_id: string | null
}

/**
 * Complete the session's cart into an order (and, for subscription-category
 * listings, a subscription + tier entitlement bundle). Idempotent: a session
 * already completed returns the recorded ids.
 */
async function completeCheckout(
  req: MedusaRequest,
  record: SessionRow,
  listing: ListingRow
): Promise<CompletionResult> {
  if (record.status === BlackoutCheckoutSessionStatus.COMPLETED) {
    return { order_id: record.order_id, subscription_id: record.subscription_id }
  }

  // Ensure the cart/payment stack exists (direct ?action=complete hits).
  const view = await materialize(req, record, listing)
  const cartId = view.cart_id
  const service = listingService(req)

  const recurrence = mapListingRecurrence(listing)
  let orderId: string | null = null
  let subscriptionId: string | null = null

  if (recurrence) {
    const { result } = await createSubscriptionWorkflow(req.scope).run({
      input: {
        cart_id: cartId,
        subscription_data: {
          interval: recurrence.interval,
          period: recurrence.period,
          type: SubscriptionType.MEMBERSHIP,
        },
      },
    })
    orderId = (result.order as { id?: string })?.id ?? null
    const subscription = result.subscription as
      | {
          id: string
          next_order_date?: Date | string | null
          metadata?: Record<string, unknown> | null
        }
      | undefined
    subscriptionId = subscription?.id ?? null

    if (subscription) {
      // Gap C: persist the saved payment method + Blackout tier identity so
      // off-session renewals and tier mapping have what they need.
      try {
        const completedCart = await queryCart(req, cartId)
        const sessionData =
          completedCart?.payment_collection?.payment_sessions?.[0]?.data ??
          view.payment_session_data
        const paymentMethodId = extractPaymentMethodId(sessionData)
        const subscriptionService = req.scope.resolve<SubscriptionModuleService>(
          SUBSCRIPTION_MODULE
        )
        await subscriptionService.updateSubscriptions({
          selector: { id: subscription.id },
          data: {
            ...(paymentMethodId ? { payment_method_id: paymentMethodId } : {}),
            seller_id: listing.seller_id,
            metadata: {
              ...(subscription.metadata ?? {}),
              blackout_tier: blackoutTierOf(listing),
              blackout_user_id: record.blackout_user_id,
              creator_listing_id: listing.id,
              blackout_checkout_session_id: record.id,
            },
          },
        })
      } catch (error) {
        log.error("Failed to persist payment method / tier on subscription:", error)
      }

      // Tier bundle grant — bypasses EntitlementGrantRule by design; the
      // listing's feature_keys ARE the tier definition.
      try {
        const featureKeys = featureKeysOf(listing)
        if (featureKeys.length > 0) {
          const { mxid: customerMxid } = record.customer_id
            ? await getCustomerEmailAndMxid(req.scope, record.customer_id)
            : { mxid: null }
          const entitlementService = req.scope.resolve<EntitlementModuleService>(
            ENTITLEMENT_MODULE
          )
          const expiresAt = subscription.next_order_date
            ? new Date(subscription.next_order_date)
            : null
          await entitlementService.grantBundleFromSubscription({
            subscription_id: subscription.id,
            customer_id: record.customer_id,
            customer_external_id: record.mxid ?? customerMxid,
            seller_id: listing.seller_id,
            feature_keys: featureKeys,
            kind: entitlementKindOf(listing) ?? EntitlementKind.ACCESS_PASS,
            expires_at: expiresAt,
          })
        }
      } catch (error) {
        log.error("Failed to grant subscription tier entitlements:", error)
      }
    }
  } else {
    const { result } = await createDigitalProductOrderWorkflow(req.scope).run({
      input: { cart_id: cartId },
    })
    orderId =
      (result as { order?: { id?: string } } | undefined)?.order?.id ?? null

    // One-off listings grant their feature_keys directly (the shadow product
    // has no EntitlementGrantRule rows).
    try {
      const featureKeys = featureKeysOf(listing)
      if (featureKeys.length > 0 && orderId) {
        const { mxid: customerMxid } = record.customer_id
          ? await getCustomerEmailAndMxid(req.scope, record.customer_id)
          : { mxid: null }
        const entitlementService = req.scope.resolve<EntitlementModuleService>(
          ENTITLEMENT_MODULE
        )
        for (const featureKey of featureKeys) {
          await entitlementService.grant({
            customer_id: record.customer_id,
            customer_external_id: record.mxid ?? customerMxid,
            seller_id: listing.seller_id,
            product_id: listing.product_id,
            variant_id: listing.variant_id,
            feature_key: featureKey,
            kind: entitlementKindOf(listing),
            source_order_id: orderId,
          })
        }
      }
    } catch (error) {
      log.error("Failed to grant one-off listing entitlements:", error)
    }
  }

  await service.updateBlackoutCheckoutSessions({
    id: record.id,
    status: BlackoutCheckoutSessionStatus.COMPLETED,
    order_id: orderId,
    subscription_id: subscriptionId,
  })
  record.status = BlackoutCheckoutSessionStatus.COMPLETED
  record.order_id = orderId
  record.subscription_id = subscriptionId

  return { order_id: orderId, subscription_id: subscriptionId }
}

// ---------------------------------------------------------------------------
// HTTP handlers
// ---------------------------------------------------------------------------

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const token = String(req.params.token || "")
  const payload = decodeToken(token)
  if (!payload) {
    res.status(401).type("text/html").send(renderError("Invalid or expired checkout session"))
    return
  }

  const record = await loadSession(req, payload.sid)
  if (!record) {
    res.status(404).type("text/html").send(renderError("Checkout session not found"))
    return
  }
  const listing = await loadListing(req, record.listing_id)
  if (!listing || listing.status !== CreatorListingStatus.PUBLISHED) {
    res.status(409).type("text/html").send(renderError("Listing is no longer available"))
    return
  }

  const embed = req.query.embed === "1" || record.embed
  const embedOrigin = record.embed_origin ?? undefined
  applySecurityHeaders(res, { embed, embedOrigin })

  const action = String(req.query.action || "")

  if (action === "complete") {
    try {
      const completion = await completeCheckout(req, record, listing)
      res.status(200).type("text/html").send(
        renderResult({
          embed,
          embedOrigin,
          event: "checkout.completed",
          payload: {
            order_id: completion.order_id,
            subscription_id: completion.subscription_id,
            cart_id: record.cart_id,
            session_id: record.id,
          },
          returnTarget: record.return_url ?? undefined,
        })
      )
    } catch (err) {
      const message = err instanceof Error ? err.message : "Checkout failed"
      log.error("Blackout checkout completion failed:", err)
      res.status(500).type("text/html").send(
        renderResult({
          embed,
          embedOrigin,
          event: "checkout.error",
          payload: { message, session_id: record.id },
        })
      )
    }
    return
  }

  if (action === "cancel") {
    res.status(200).type("text/html").send(
      renderResult({
        embed,
        embedOrigin,
        event: "checkout.cancelled",
        payload: { session_id: record.id, cart_id: record.cart_id },
        returnTarget: record.return_url ?? undefined,
      })
    )
    return
  }

  if (record.status === BlackoutCheckoutSessionStatus.COMPLETED) {
    res.status(200).type("text/html").send(
      renderResult({
        embed,
        embedOrigin,
        event: "checkout.completed",
        payload: {
          order_id: record.order_id,
          subscription_id: record.subscription_id,
          cart_id: record.cart_id,
          session_id: record.id,
        },
        returnTarget: record.return_url ?? undefined,
      })
    )
    return
  }

  try {
    const view = await materialize(req, record, listing)
    if (view.completed) {
      res.status(200).type("text/html").send(
        renderResult({
          embed,
          embedOrigin,
          event: "checkout.completed",
          payload: {
            order_id: record.order_id,
            cart_id: view.cart_id,
            session_id: record.id,
          },
          returnTarget: record.return_url ?? undefined,
        })
      )
      return
    }
    res.status(200).type("text/html").send(
      renderPayPage({
        embed,
        embedOrigin,
        listingTitle: listing.title,
        total: view.total,
        currency: view.currency_code,
        clientSecret: view.client_secret,
        publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || null,
        sessionId: record.id,
        cartId: view.cart_id,
      })
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : "Checkout unavailable"
    log.error("Blackout checkout materialization failed:", err)
    res.status(500).type("text/html").send(
      renderResult({
        embed,
        embedOrigin,
        event: "checkout.error",
        payload: { message, session_id: record.id },
      })
    )
  }
}

/**
 * Programmatic completion for non-iframe consumers and tests: completes the
 * session's cart and returns JSON instead of HTML.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const token = String(req.params.token || "")
  const payload = decodeToken(token)
  if (!payload) {
    return res.status(401).json({ code: "unauthorized", message: "Invalid or expired session" })
  }
  const record = await loadSession(req, payload.sid)
  if (!record) {
    return res.status(404).json({ code: "not_found", message: "Checkout session not found" })
  }
  const listing = await loadListing(req, record.listing_id)
  if (!listing || listing.status !== CreatorListingStatus.PUBLISHED) {
    return res
      .status(409)
      .json({ code: "listing_not_purchasable", message: "Listing is no longer available" })
  }

  try {
    const completion = await completeCheckout(req, record, listing)
    return res.json({
      id: record.id,
      status: "completed",
      order_id: completion.order_id,
      subscription_id: completion.subscription_id,
      cart_id: record.cart_id,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Checkout failed"
    log.error("Blackout checkout completion failed:", err)
    return res.status(500).json({ code: "checkout_failed", message })
  }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function applySecurityHeaders(
  res: MedusaResponse,
  args: { embed: boolean; embedOrigin?: string }
) {
  const frameAncestors =
    args.embed && args.embedOrigin ? args.embedOrigin : "'self'"
  if (args.embed && args.embedOrigin) {
    res.removeHeader("X-Frame-Options")
  }
  res.setHeader(
    "Content-Security-Policy",
    `default-src 'self'; script-src 'self' 'unsafe-inline' https://js.stripe.com; ` +
      `style-src 'unsafe-inline'; frame-src https://js.stripe.com; ` +
      `connect-src 'self' https://api.stripe.com; frame-ancestors ${frameAncestors}`
  )
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

function renderError(message: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Checkout error</title></head><body><h1>Checkout error</h1><p>${escapeHtml(
    message
  )}</p></body></html>`
}

const PAGE_STYLE = `
    body { font-family: system-ui, sans-serif; padding: 16px; max-width: 480px; margin: 0 auto; }
    .row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #eee; }
    button { padding: 12px 20px; border-radius: 6px; border: 0; cursor: pointer; font-size: 16px; width: 100%; }
    .pay { background: #111; color: #fff; margin-top: 16px; }
    .cancel { background: #f4f4f4; color: #111; margin-top: 8px; }
    #payment-element { margin-top: 16px; }
    .error { color: #b00020; margin-top: 12px; min-height: 1em; }
`

function renderPayPage(args: {
  embed: boolean
  embedOrigin?: string
  listingTitle: string
  total: string | null
  currency: string | null
  clientSecret: string | null
  publishableKey: string | null
  sessionId: string
  cartId: string
}): string {
  const completeUrl = `?action=complete${args.embed ? "&embed=1" : ""}`
  const cancelUrl = `?action=cancel${args.embed ? "&embed=1" : ""}`
  const total = args.total ?? "—"
  const currency = args.currency ? args.currency.toUpperCase() : ""
  const useStripe = !!(args.clientSecret && args.publishableKey)
  const safeOrigin = JSON.stringify(args.embedOrigin ?? "")
  const readyPayload = JSON.stringify({
    session_id: args.sessionId,
    cart_id: args.cartId,
  })

  const stripeBlock = useStripe
    ? `
  <form id="payment-form">
    <div id="payment-element"></div>
    <button class="pay" id="submit" type="submit">Pay ${escapeHtml(total)} ${escapeHtml(
        currency
      )}</button>
    <div class="error" id="error-message"></div>
  </form>
  <script src="https://js.stripe.com/v3/"></script>
  <script>
    (function () {
      var stripe = Stripe(${JSON.stringify(args.publishableKey)});
      var elements = stripe.elements({ clientSecret: ${JSON.stringify(
        args.clientSecret
      )} });
      var paymentElement = elements.create("payment");
      paymentElement.mount("#payment-element");
      var form = document.getElementById("payment-form");
      var button = document.getElementById("submit");
      form.addEventListener("submit", function (e) {
        e.preventDefault();
        button.disabled = true;
        stripe
          .confirmPayment({ elements: elements, redirect: "if_required" })
          .then(function (result) {
            if (result.error) {
              document.getElementById("error-message").textContent =
                result.error.message || "Payment failed";
              button.disabled = false;
              return;
            }
            window.location.href = ${JSON.stringify(completeUrl)};
          });
      });
    })();
  </script>`
    : `
  <form method="GET" action="${escapeHtml(completeUrl)}">
    <button class="pay" type="submit">Confirm and pay ${escapeHtml(total)} ${escapeHtml(
        currency
      )}</button>
  </form>`

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>Free Black Market — Checkout</title>
  <style>${PAGE_STYLE}</style>
</head>
<body>
  <h1>Checkout</h1>
  <div class="row"><span>Item</span><span>${escapeHtml(args.listingTitle)}</span></div>
  <div class="row"><span>Total</span><span>${escapeHtml(total)} ${escapeHtml(
    currency
  )}</span></div>
  ${stripeBlock}
  <form method="GET" action="${escapeHtml(cancelUrl)}">
    <button class="cancel" type="submit">Cancel</button>
  </form>
  <script>
    (function () {
      var embed = ${args.embed ? "true" : "false"};
      var origin = ${safeOrigin};
      if (embed && origin && window.parent && window.parent !== window) {
        window.parent.postMessage(
          { source: "fbm-checkout", type: "checkout.ready", payload: ${readyPayload} },
          origin
        );
      }
    })();
  </script>
</body>
</html>`
}

function renderResult(args: {
  embed: boolean
  embedOrigin?: string
  event: "checkout.completed" | "checkout.cancelled" | "checkout.error"
  payload: Record<string, unknown>
  returnTarget?: string
}): string {
  const safeOrigin = JSON.stringify(args.embedOrigin ?? "")
  const safeEvent = JSON.stringify(args.event)
  const safePayload = JSON.stringify(args.payload)
  const safeReturnTarget = JSON.stringify(args.returnTarget ?? null)
  const heading =
    args.event === "checkout.completed"
      ? "Order placed"
      : args.event === "checkout.cancelled"
        ? "Checkout cancelled"
        : "Checkout error"
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(heading)}</title>
  <style>
    body { font-family: system-ui, sans-serif; padding: 24px; max-width: 480px; margin: 0 auto; text-align: center; }
  </style>
</head>
<body>
  <h1>${escapeHtml(heading)}</h1>
  <script>
    (function () {
      var embed = ${args.embed ? "true" : "false"};
      var origin = ${safeOrigin};
      var returnTarget = ${safeReturnTarget};
      if (embed && origin && window.parent && window.parent !== window) {
        window.parent.postMessage(
          { source: "fbm-checkout", type: ${safeEvent}, payload: ${safePayload} },
          origin
        );
      } else if (returnTarget) {
        try { window.location.href = returnTarget; } catch (e) {}
      }
    })();
  </script>
</body>
</html>`
}
