/**
 * A recurring Blackout listing may renew until cancelled
 * (FF_CONSUMER_SUBSCRIPTIONS_V1). Before the flag, a `subscription`-category
 * listing was sold as a renewing membership; with it, the hosted checkout
 * offers the auto-renew checkbox and the create step makes a subscription
 * until-cancelled only for a product marked `subscription_until_canceled` —
 * which `ensureListingProduct` never wrote. The page now merges that marker
 * onto the listing's own shadow product, once.
 *
 * Real code: the page route (render + completion), the marker
 * (ensureRecurringListingMarkedUntilCanceled) over a fake product module whose
 * metadata is the one store both `retrieveProduct` and `query.graph` read,
 * grace-lifecycle's product lookup, AND createSubscriptionStep's handler
 * (decideCreateTerms over that same store) with the REAL subscription service
 * override (only its generated base `createSubscriptions` is stubbed — it only
 * persists). Stubbed: Medusa's core-flows (cart / payment collection /
 * payment session), the workflow wrapper around the create step, the customer
 * helper, and shadow-product materialization (`ensureListingProduct`).
 * The container resolves only imported keys and throws on anything else.
 */
const createRun = jest.fn()
const createSessionsRun = jest.fn()

jest.mock("@medusajs/framework/workflows-sdk", () => ({
  ...jest.requireActual("@medusajs/framework/workflows-sdk"),
  // Hand the step's own handler back so the spec can run it.
  createStep: (_name: unknown, invokeFn: unknown, compensateFn: unknown) =>
    Object.assign(jest.fn(), { invokeFn, compensateFn }),
}))
jest.mock("../../../../../../../../../../shared/config", () => ({
  config: { JWT_SECRET: "jwt-secret-".padEnd(48, "x") },
}))
jest.mock("../../../../../../../../../../workflows/subscription", () => ({
  createSubscriptionWorkflow: jest.fn(() => ({ run: createRun })),
}))
jest.mock("../../../../../../../../../../workflows/create-digital-product-order", () => ({
  __esModule: true,
  default: jest.fn(() => ({ run: jest.fn(async () => ({ result: { order: { id: "order_oneoff" } } })) })),
}))
jest.mock("../../../../../../../../../../lib/blackout-identity", () => ({
  resolveOrCreateCustomerForBlackoutUser: jest.fn(async () => ({ customerId: "cus_member" })),
}))
jest.mock("../../../../../../../../../../lib/blackout-listing-product", () => ({
  ...jest.requireActual("../../../../../../../../../../lib/blackout-listing-product"),
  ensureListingProduct: jest.fn(async () => ({
    product_id: "prod_tier",
    variant_id: "var_tier",
    created: false,
  })),
}))

type FakeSession = { id: string; status: string; data: Record<string, unknown> }
type FakeCart = {
  id: string
  completed_at: string | null
  total: number
  currency_code: string
  payment_collection: { id: string; payment_sessions: FakeSession[] } | null
}

const world = { carts: new Map<string, FakeCart>(), sessionSeq: 0 }

jest.mock("@medusajs/medusa/core-flows", () => ({
  createCartWorkflow: jest.fn(() => ({
    run: jest.fn(async () => {
      const id = `cart_${world.carts.size + 1}`
      world.carts.set(id, { id, completed_at: null, total: 5, currency_code: "usd", payment_collection: null })
      return { result: { id } }
    }),
  })),
  createPaymentCollectionForCartWorkflow: jest.fn(() => ({
    run: jest.fn(async ({ input }: { input: { cart_id: string } }) => {
      const cart = world.carts.get(input.cart_id)!
      cart.payment_collection = { id: `paycol_${cart.id}`, payment_sessions: [] }
      return { result: {} }
    }),
  })),
  createPaymentSessionsWorkflow: jest.fn(() => ({ run: createSessionsRun })),
}))

import jwt from "jsonwebtoken"
import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { GET } from "../route"
import { MARKETPLACE_LISTING_MODULE } from "../../../../../../../../../../modules/marketplace-listing"
import { CreatorListingStatus } from "../../../../../../../../../../modules/marketplace-listing/models"
import { SUBSCRIPTION_MODULE } from "../../../../../../../../../../modules/subscription"
import SubscriptionModuleService from "../../../../../../../../../../modules/subscription/service"
import { ENTITLEMENT_MODULE } from "../../../../../../../../../../modules/entitlement"
import { SubscriptionStatus } from "../../../../../../../../../../modules/subscription/types"
import { AUTO_RENEW_DISCLOSURE_VERSION } from "../../../../../../../../../../modules/subscription/utils/auto-renew"
import { UNTIL_CANCELED_PRODUCT_METADATA_KEY } from "../../../../../../../../../../modules/subscription/utils/grace"
import { PHASE0_FEATURE_FLAGS } from "../../../../../../../../../../shared/feature-flags"
import { ensureRecurringListingMarkedUntilCanceled } from "../../../../../../../../../../lib/blackout-listing-product"
import { createSubscriptionStep } from "../../../../../../../../../../workflows/subscription/steps/create-subscription"
import {
  makeContainer,
  makeSubscriptionService,
} from "../../../../../../../../../../modules/subscription/__tests__/fake-subscription-service"

const FLAG = PHASE0_FEATURE_FLAGS.CONSUMER_SUBSCRIPTIONS_V1
const SECRET = "jwt-secret-".padEnd(48, "x")
const CHECKBOX = '<input id="auto-renew-approval" type="checkbox">'
const CHECKBOX_TICKED = '<input id="auto-renew-approval" type="checkbox" checked>'
const OWN_PAGE = { "sec-fetch-site": "same-origin" }

createSessionsRun.mockImplementation(
  async ({ input }: { input: { payment_collection_id: string; data?: Record<string, unknown> } }) => {
    const cart = [...world.carts.values()].find((c) => c.payment_collection?.id === input.payment_collection_id)!
    world.sessionSeq += 1
    cart.payment_collection!.payment_sessions = [
      {
        id: `ps_${world.sessionSeq}`,
        status: "pending",
        data: {
          id: `pi_${world.sessionSeq}`,
          client_secret: `pi_${world.sessionSeq}_secret`,
          setup_future_usage: input.data?.setup_future_usage ?? null,
          metadata: { ...((input.data?.metadata as Record<string, unknown>) ?? {}) },
          payment_method: "pm_card",
        },
      },
    ]
    return { result: {} }
  }
)

type Listing = Record<string, unknown> & { id: string }

const listingOf = (overrides: Partial<Listing> = {}): Listing => ({
  id: "clist_tier",
  seller_id: "sel_1",
  title: "Vault seat",
  description: null,
  status: CreatorListingStatus.PUBLISHED,
  category: "subscription",
  price_cents: 500,
  currency: "usd",
  entitlement_kind: null,
  feature_keys: ["vault"],
  media_urls: [],
  interval: "monthly",
  period_days: null,
  product_id: null,
  variant_id: null,
  metadata: null,
  slug: "vault-seat",
  ...overrides,
})

/** What ensureListingProduct writes on a shadow product, plus an unrelated key. */
const SHADOW = { creator_listing_id: "clist_tier", blackout_shadow_product: true, admin_note: "keep me" }

function makeWorld(opts: { listing?: Listing; productMetadata?: Record<string, unknown> | null } = {}) {
  world.carts.clear()
  world.sessionSeq = 0
  const listing = opts.listing ?? listingOf()
  const session: Record<string, unknown> = {
    id: "bcs_1",
    blackout_user_id: "bo_user_1",
    listing_id: listing.id,
    mxid: "@m:theblackout.app",
    amount_cents: null,
    customer_id: null,
    cart_id: null,
    order_id: null,
    subscription_id: null,
    status: "pending",
    embed: false,
    embed_origin: null,
    return_url: null,
    requested_metadata: null,
  }
  const listingService = {
    retrieveBlackoutCheckoutSession: jest.fn(async () => ({ ...session })),
    listCreatorListings: jest.fn(async () => [{ ...listing }]),
    updateBlackoutCheckoutSessions: jest.fn(async (data: Record<string, unknown>) => Object.assign(session, data)),
  }
  // One product row: what the product module returns and what query.graph
  // (the page's offer check AND the create step) reads.
  const product = {
    id: "prod_tier",
    metadata: opts.productMetadata === undefined ? { ...SHADOW } : opts.productMetadata,
  }
  const products = {
    retrieveProduct: jest.fn(async (id: string) => {
      if (id !== product.id) throw new Error(`Product with id: ${id} was not found`)
      return { id, metadata: product.metadata === null ? null : { ...product.metadata } }
    }),
    // Medusa 2.14's product repository merges sent metadata onto the stored one.
    updateProducts: jest.fn(async (id: string, data: { metadata?: Record<string, unknown> }) => {
      if (id !== product.id) throw new Error(`Product with id: ${id} was not found`)
      product.metadata = { ...(product.metadata ?? {}), ...(data.metadata ?? {}) }
      return { id, metadata: { ...product.metadata } }
    }),
  }
  const svc = makeSubscriptionService([])
  const entitlements = { grantBundleFromSubscription: jest.fn(async () => ({})) }
  const query = {
    graph: jest.fn(async ({ entity, filters }: { entity: string; filters: { id?: string } }) => {
      if (entity === "product") {
        return { data: filters.id === product.id ? [{ id: product.id, metadata: product.metadata }] : [] }
      }
      if (entity === "region") return { data: [{ id: "reg_us", currency_code: "usd" }] }
      if (entity === "cart") {
        const cart = world.carts.get(String(filters.id))
        return { data: cart ? [JSON.parse(JSON.stringify(cart))] : [] }
      }
      throw new Error(`unexpected entity ${entity}`)
    }),
  }
  const scope = makeContainer({
    [MARKETPLACE_LISTING_MODULE]: listingService,
    [SUBSCRIPTION_MODULE]: svc,
    [ENTITLEMENT_MODULE]: entitlements,
    [ContainerRegistrationKeys.QUERY]: query,
    [Modules.CUSTOMER]: { retrieveCustomer: jest.fn(async () => ({ email: "m@example.test", metadata: {} })) },
    [Modules.PRODUCT]: products,
  })
  return { listing, session, svc, scope, product, products, query }
}

type W = ReturnType<typeof makeWorld>

type StepHandler = (
  input: unknown,
  ctx: { container: MedusaContainer }
) => Promise<{ output: { subscription: Record<string, unknown> & { id: string } } }>

/**
 * createSubscriptionWorkflow as the page sees it: completes the cart, then
 * the REAL create step — with the product id the workflow reads off the
 * order's line (the shadow product) — decides the terms.
 */
function wireRealCreateStep(w: W) {
  createRun.mockImplementation(
    async ({ input }: { input: { cart_id: string; subscription_data: Record<string, unknown> } }) => {
      const cart = world.carts.get(input.cart_id)!
      cart.completed_at = "2026-10-06T00:00:00.000Z"
      cart.payment_collection!.payment_sessions[0].status = "authorized"
      const { output } = await (createSubscriptionStep as unknown as { invokeFn: StepHandler }).invokeFn(
        {
          cart_id: input.cart_id,
          order_id: "order_1",
          customer_id: "cus_member",
          seller_id: "sel_1",
          product_id: w.product.id,
          variant_id: "var_tier",
          quantity: 1,
          subscription_data: input.subscription_data,
        },
        { container: w.scope as unknown as MedusaContainer }
      )
      w.svc.store.set(output.subscription.id, { ...output.subscription, status: SubscriptionStatus.ACTIVE })
      return { result: { subscription: output.subscription, order: { id: "order_1" } } }
    }
  )
}

const token = () => jwt.sign({ sid: "bcs_1" }, SECRET, { audience: "fbm-blackout-checkout" })

async function get(w: W, query: Record<string, string> = {}, headers?: Record<string, string>) {
  const res = {
    statusCode: 200,
    body: "" as unknown,
    status: jest.fn((code: number) => {
      res.statusCode = code
      return res
    }),
    type: jest.fn(() => res),
    send: jest.fn((body: unknown) => {
      res.body = body
      return res
    }),
    json: jest.fn((body: unknown) => {
      res.body = body
      return res
    }),
    setHeader: jest.fn(),
    removeHeader: jest.fn(),
  }
  await GET({ params: { token: token() }, query, scope: w.scope, headers } as never, res as never)
  return { status: res.statusCode, html: String(res.body) }
}

const parent = Object.getPrototypeOf(SubscriptionModuleService.prototype) as {
  createSubscriptions: (d: unknown) => Promise<unknown>
}
let parentSpy: jest.SpyInstance
let logSpies: jest.SpyInstance[] = []
beforeEach(() => {
  createRun.mockReset()
  createSessionsRun.mockClear()
  process.env.STRIPE_PUBLISHABLE_KEY = "pk_test_page"
  parentSpy = jest
    .spyOn(parent, "createSubscriptions")
    .mockImplementation(async (d) => ({ id: "sub_1", ...(d as object) }))
  logSpies = [
    jest.spyOn(console, "log").mockImplementation(() => undefined),
    jest.spyOn(console, "warn").mockImplementation(() => undefined),
    jest.spyOn(console, "error").mockImplementation(() => undefined),
  ]
})
afterEach(() => {
  parentSpy.mockRestore()
  logSpies.forEach((s) => s.mockRestore())
  delete process.env[FLAG]
  delete process.env.STRIPE_PUBLISHABLE_KEY
})

describe("flag on, recurring listing: the shadow product is marked once, merged", () => {
  it("an unmarked shadow product gets the marker merged (other keys kept), the checkbox renders, and a second render writes nothing", async () => {
    process.env[FLAG] = "true"
    const w = makeWorld()
    const { status, html } = await get(w)
    expect(status).toBe(200)

    expect(w.products.updateProducts).toHaveBeenCalledTimes(1)
    expect(w.products.updateProducts).toHaveBeenCalledWith("prod_tier", {
      metadata: { ...SHADOW, [UNTIL_CANCELED_PRODUCT_METADATA_KEY]: true },
    })
    expect(w.product.metadata).toEqual({ ...SHADOW, [UNTIL_CANCELED_PRODUCT_METADATA_KEY]: true })
    // Read first, then written: the merge was built from what was stored.
    expect(w.products.retrieveProduct.mock.invocationCallOrder[0]).toBeLessThan(
      w.products.updateProducts.mock.invocationCallOrder[0]
    )
    expect(html).toContain(CHECKBOX)

    // Second render (the member's own tick): the key is there, nothing is written.
    const ticked = await get(w, { auto_renew_approved: "true" }, OWN_PAGE)
    expect(ticked.html).toContain(CHECKBOX_TICKED)
    expect(w.products.retrieveProduct).toHaveBeenCalledTimes(2)
    expect(w.products.updateProducts).toHaveBeenCalledTimes(1)
  })

  it("the member's approval yields until-cancelled through the REAL create-step decision on the same product", async () => {
    process.env[FLAG] = "true"
    const w = makeWorld()
    wireRealCreateStep(w)
    await get(w, { auto_renew_approved: "true" }, OWN_PAGE)
    const res = await get(w, {
      action: "complete",
      auto_renew_approved: "true",
      auto_renew_disclosure_version: AUTO_RENEW_DISCLOSURE_VERSION,
    })
    expect(res.status).toBe(200)
    expect(res.html).toContain("checkout.completed")

    // The create step looked the shadow product up and found the marker.
    expect(w.query.graph).toHaveBeenCalledWith(
      expect.objectContaining({ entity: "product", filters: { id: "prod_tier" } })
    )
    const written = parentSpy.mock.calls[0][0] as Record<string, unknown>
    expect(written.expiration_date).toBeNull()
    expect(written.next_order_date).toBeInstanceOf(Date)
    expect(written.auto_renew_approved).toBe(true)
    expect(written.auto_renew_disclosure_version).toBe(AUTO_RENEW_DISCLOSURE_VERSION)
    expect(w.svc.store.get("sub_1")?.payment_method_id).toBe("pm_card")
    expect(w.products.updateProducts).toHaveBeenCalledTimes(1)
  })

  it("the box is still the member's to tick: declined (or never ticked), the purchase is one period", async () => {
    process.env[FLAG] = "true"
    const w = makeWorld()
    wireRealCreateStep(w)
    await get(w)
    expect(w.product.metadata).toMatchObject({ [UNTIL_CANCELED_PRODUCT_METADATA_KEY]: true })
    const res = await get(w, { action: "complete", auto_renew_approved: "false" })
    expect(res.status).toBe(200)
    const written = parentSpy.mock.calls[0][0] as Record<string, unknown>
    expect(written.next_order_date).toBeNull()
    expect(written.period).toBe(1)
    expect(written.auto_renew_approved).toBe(false)
    expect(w.svc.store.get("sub_1")).not.toHaveProperty("payment_method_id")
  })

  it("two first renders racing write the same merged object: one marker, nothing dropped", async () => {
    process.env[FLAG] = "true"
    const w = makeWorld()
    const listing = listingOf()
    const outcomes = await Promise.all([
      ensureRecurringListingMarkedUntilCanceled(w.scope as unknown as MedusaContainer, listing, "prod_tier"),
      ensureRecurringListingMarkedUntilCanceled(w.scope as unknown as MedusaContainer, listing, "prod_tier"),
    ])
    expect(outcomes.every((o) => o === "marked" || o === "already_set")).toBe(true)
    for (const call of w.products.updateProducts.mock.calls) {
      expect(call[1]).toEqual({ metadata: { ...SHADOW, [UNTIL_CANCELED_PRODUCT_METADATA_KEY]: true } })
    }
    expect(w.product.metadata).toEqual({ ...SHADOW, [UNTIL_CANCELED_PRODUCT_METADATA_KEY]: true })
    expect(
      await ensureRecurringListingMarkedUntilCanceled(w.scope as unknown as MedusaContainer, listing, "prod_tier")
    ).toBe("already_set")
  })
})

describe("never marked", () => {
  it("flag on, a one-off listing: the product module is never touched", async () => {
    process.env[FLAG] = "true"
    const w = makeWorld({ listing: listingOf({ category: "digital", interval: null }) })
    const { status, html } = await get(w)
    expect(status).toBe(200)
    expect(html).not.toContain("auto-renew")
    expect(w.products.retrieveProduct).not.toHaveBeenCalled()
    expect(w.products.updateProducts).not.toHaveBeenCalled()
    expect(w.product.metadata).toEqual(SHADOW)
    expect(
      await ensureRecurringListingMarkedUntilCanceled(
        w.scope as unknown as MedusaContainer,
        listingOf({ category: "digital", interval: null }),
        "prod_tier"
      )
    ).toBe("not_recurring")
    expect(w.products.updateProducts).not.toHaveBeenCalled()
  })

  it("flag off, recurring listing: no product read or write at all, render or completion", async () => {
    const w = makeWorld()
    wireRealCreateStep(w)
    expect((await get(w)).status).toBe(200)
    expect((await get(w, { action: "complete" })).status).toBe(200)
    expect(w.products.retrieveProduct).not.toHaveBeenCalled()
    expect(w.products.updateProducts).not.toHaveBeenCalled()
    expect(w.product.metadata).toEqual(SHADOW)
    const resolve = (w.scope as unknown as { resolve: jest.Mock }).resolve
    resolve.mockClear()
    expect(
      await ensureRecurringListingMarkedUntilCanceled(w.scope as unknown as MedusaContainer, listingOf(), "prod_tier")
    ).toBe("flag_off")
    expect(resolve).not.toHaveBeenCalled()
  })

  it("an explicit operator opt-out (false) is kept: no write, no checkbox", async () => {
    process.env[FLAG] = "true"
    const w = makeWorld({ productMetadata: { ...SHADOW, [UNTIL_CANCELED_PRODUCT_METADATA_KEY]: false } })
    const { html } = await get(w)
    expect(w.products.updateProducts).not.toHaveBeenCalled()
    expect(w.product.metadata).toMatchObject({ [UNTIL_CANCELED_PRODUCT_METADATA_KEY]: false })
    expect(html).not.toContain('id="auto-renew-approval"')
  })

  it("a product that is not this listing's shadow product is never changed", async () => {
    process.env[FLAG] = "true"
    for (const metadata of [
      { sku_note: "ordinary catalogue product" },
      { ...SHADOW, creator_listing_id: "clist_other" },
      { ...SHADOW, blackout_shadow_product: "true" },
      null,
    ]) {
      const w = makeWorld({ productMetadata: metadata })
      const { status, html } = await get(w)
      expect(status).toBe(200)
      expect(w.products.updateProducts).not.toHaveBeenCalled()
      expect(w.product.metadata).toEqual(metadata)
      expect(html).not.toContain('id="auto-renew-approval"')
    }
  })

  it("a failed write is logged and fails closed: no checkbox, one-period terms only", async () => {
    process.env[FLAG] = "true"
    const w = makeWorld()
    w.products.updateProducts.mockRejectedValueOnce(new Error("product db down"))
    const { status, html } = await get(w)
    expect(status).toBe(200)
    expect(html).not.toContain('id="auto-renew-approval"')
    expect(html).toContain('id="one-time-terms"')
    expect(w.product.metadata).toEqual(SHADOW)
    expect(logSpies[1].mock.calls.some((c) => String(c[0]).includes("product db down"))).toBe(true)
    // The next render retries and succeeds.
    expect((await get(w)).html).toContain(CHECKBOX)
  })
})
