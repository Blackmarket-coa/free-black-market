/**
 * The Blackout hosted checkout asks the auto-renew question
 * (FF_CONSUMER_SUBSCRIPTIONS_V1; operator answer 2026-10-05, "renew upon
 * approval" applies here too).
 *
 * Real code: the page route (render, completion, refusals), its token check
 * (jsonwebtoken), blackout-checkout.ts's helpers, grace-lifecycle's product
 * lookup (the `subscription_until_canceled` marker), auto-renew.ts's card save
 * (saveAutoRenewPaymentMethod), the copy module, the flag reader, and the
 * subscription service prototype over a fake store. Stubbed: Medusa's
 * core-flows (cart / payment collection / payment session — the fake records
 * the session `data` the way the Stripe provider stores the PaymentIntent),
 * createSubscriptionWorkflow (its create step has its own spec; the fake
 * returns the row that step would create from the real decideCreateTerms),
 * the customer and shadow-product helpers. The container resolves only
 * imported keys and throws on anything else.
 */
const createRun = jest.fn()
const createSessionsRun = jest.fn()

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
  // The real until-cancelled marker (it reads and writes through the fake
  // product module below); only the shadow-product materialization is stubbed.
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

const world = {
  carts: new Map<string, FakeCart>(),
  sessionSeq: 0,
}

jest.mock("@medusajs/medusa/core-flows", () => ({
  createCartWorkflow: jest.fn(() => ({
    run: jest.fn(async ({ input }: { input: { items: Array<{ unit_price?: number }> } }) => {
      const id = `cart_${world.carts.size + 1}`
      world.carts.set(id, {
        id,
        completed_at: null,
        total: input.items[0]?.unit_price ?? 5,
        currency_code: "usd",
        payment_collection: null,
      })
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

import fs from "fs"
import path from "path"
import jwt from "jsonwebtoken"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { GET, POST } from "../route"
import { MARKETPLACE_LISTING_MODULE } from "../../../../../../../../../../modules/marketplace-listing"
import { CreatorListingStatus } from "../../../../../../../../../../modules/marketplace-listing/models"
import { SUBSCRIPTION_MODULE } from "../../../../../../../../../../modules/subscription"
import { ENTITLEMENT_MODULE } from "../../../../../../../../../../modules/entitlement"
import {
  SubscriptionInterval,
  SubscriptionStatus,
} from "../../../../../../../../../../modules/subscription/types"
import {
  AUTO_RENEW_DISCLOSURE_VERSION,
  decideCreateTerms,
} from "../../../../../../../../../../modules/subscription/utils/auto-renew"
import {
  AUTO_RENEW_CHECKBOX_LABEL,
  autoRenewDisclosure,
  oneTimeTerms,
} from "../../../../../../../../../../modules/subscription/utils/auto-renew-copy"
import { PHASE0_FEATURE_FLAGS } from "../../../../../../../../../../shared/feature-flags"
import {
  makeContainer,
  makeSubscriptionService,
} from "../../../../../../../../../../modules/subscription/__tests__/fake-subscription-service"

const FLAG = PHASE0_FEATURE_FLAGS.CONSUMER_SUBSCRIPTIONS_V1
const SECRET = "jwt-secret-".padEnd(48, "x")
const PRICE = "$5.00"
const COPY = { price: PRICE, interval: SubscriptionInterval.MONTHLY }

/** The Stripe provider stores the PaymentIntent, which echoes setup_future_usage. */
createSessionsRun.mockImplementation(
  async ({ input }: { input: { payment_collection_id: string; data?: Record<string, unknown> } }) => {
    const cart = [...world.carts.values()].find(
      (c) => c.payment_collection?.id === input.payment_collection_id
    )!
    world.sessionSeq += 1
    // createPaymentSessionsWorkflow deletes the collection's existing session.
    cart.payment_collection!.payment_sessions = [
      {
        id: `ps_${world.sessionSeq}`,
        status: "pending",
        data: {
          id: `pi_${world.sessionSeq}`,
          client_secret: `pi_${world.sessionSeq}_secret`,
          setup_future_usage: input.data?.setup_future_usage ?? null,
          // The provider merges data.metadata into the intent's metadata.
          metadata: { ...((input.data?.metadata as Record<string, unknown>) ?? {}), session_id: "payses" },
          payment_method: "pm_card",
        },
      },
    ]
    return { result: {} }
  }
)

type Listing = Record<string, unknown> & { id: string }

const tierListing = (overrides: Partial<Listing> = {}): Listing => ({
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

function makeWorld(opts: {
  listing?: Listing
  productMetadata?: Record<string, unknown> | null
  session?: Record<string, unknown>
}) {
  world.carts.clear()
  world.sessionSeq = 0
  const listing = opts.listing ?? tierListing()
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
    ...opts.session,
  }
  const listingService = {
    retrieveBlackoutCheckoutSession: jest.fn(async () => ({ ...session })),
    listCreatorListings: jest.fn(async () => [{ ...listing }]),
    updateBlackoutCheckoutSessions: jest.fn(async (data: Record<string, unknown>) => {
      Object.assign(session, data)
      return session
    }),
  }
  const svc = makeSubscriptionService([])
  const entitlements = { grantBundleFromSubscription: jest.fn(async () => ({})), grant: jest.fn() }
  const productMetadata =
    opts.productMetadata === undefined
      ? { subscription_until_canceled: true, subscription_interval: "monthly" }
      : opts.productMetadata
  const query = {
    graph: jest.fn(async ({ entity, filters }: { entity: string; filters: { id?: string } }) => {
      if (entity === "product") {
        return { data: productMetadata ? [{ id: filters.id, metadata: productMetadata }] : [] }
      }
      if (entity === "region") return { data: [{ id: "reg_us", currency_code: "usd" }] }
      if (entity === "cart") {
        const cart = world.carts.get(String(filters.id))
        return { data: cart ? [JSON.parse(JSON.stringify(cart))] : [] }
      }
      throw new Error(`unexpected entity ${entity}`)
    }),
  }
  const customers = {
    retrieveCustomer: jest.fn(async () => ({ email: "m@example.test", metadata: {} })),
  }
  // The product module the until-cancelled marker reads first. None of these
  // fixtures is a shadow product lacking the key, so nothing is ever written
  // here (until-canceled-marker.unit.spec.ts covers the write).
  const products = {
    retrieveProduct: jest.fn(async (id: string) => {
      if (!productMetadata) throw new Error(`Product with id: ${id} was not found`)
      return { id, metadata: productMetadata }
    }),
    updateProducts: jest.fn(async () => {
      throw new Error("no product write expected in this spec")
    }),
  }
  const scope = makeContainer({
    [MARKETPLACE_LISTING_MODULE]: listingService,
    [SUBSCRIPTION_MODULE]: svc,
    [ENTITLEMENT_MODULE]: entitlements,
    [ContainerRegistrationKeys.QUERY]: query,
    [Modules.CUSTOMER]: customers,
    [Modules.PRODUCT]: products,
  })
  return { listing, session, listingService, svc, entitlements, scope, products }
}

type W = ReturnType<typeof makeWorld>

/**
 * The create workflow: completes the cart (authorizing the payment session)
 * and returns the row the real create step builds from decideCreateTerms.
 */
function wireCreate(w: W) {
  createRun.mockImplementation(
    async ({ input }: { input: { cart_id: string; subscription_data: Record<string, unknown> } }) => {
      const cart = world.carts.get(input.cart_id)!
      cart.completed_at = "2026-10-06T00:00:00.000Z"
      cart.payment_collection!.payment_sessions[0].status = "authorized"
      const approval = input.subscription_data.auto_renew as
        | { approved: boolean; disclosure_version: string | null; approved_at: string }
        | undefined
      const terms = approval
        ? decideCreateTerms({ approved: approval.approved, product_allows_until_canceled: true })
        : null
      const sub: Record<string, unknown> & { id: string; status: string } = {
        id: "sub_1",
        status: SubscriptionStatus.ACTIVE,
        interval: input.subscription_data.interval,
        metadata: { initial_cart_id: input.cart_id },
        ...(terms?.mode === "until_canceled"
          ? {
              auto_renew_approved: true,
              auto_renew_approved_at: new Date(approval!.approved_at),
              auto_renew_disclosure_version: approval!.disclosure_version,
              expiration_date: null,
              next_order_date: new Date("2026-11-06T00:00:00.000Z"),
            }
          : terms?.mode === "single_period"
            ? {
                auto_renew_approved: false,
                expiration_date: new Date("2026-11-06T00:00:00.000Z"),
                next_order_date: null,
                metadata: { initial_cart_id: input.cart_id, auto_renew_mode: "single_period" },
              }
            : {
                expiration_date: new Date("2027-10-06T00:00:00.000Z"),
                next_order_date: new Date("2026-11-06T00:00:00.000Z"),
              }),
      }
      w.svc.store.set(sub.id, { ...sub })
      return { result: { subscription: sub, order: { id: "order_1" } } }
    }
  )
}

const token = () => jwt.sign({ sid: "bcs_1" }, SECRET, { audience: "fbm-blackout-checkout" })

function makeRes() {
  const res = {
    statusCode: 200,
    body: "" as unknown,
    headers: {} as Record<string, string>,
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
    setHeader: jest.fn((k: string, v: string) => {
      res.headers[k] = v
    }),
    removeHeader: jest.fn(),
  }
  return res
}

async function get(w: W, query: Record<string, string> = {}, headers?: Record<string, string>) {
  const res = makeRes()
  await GET({ params: { token: token() }, query, scope: w.scope, headers } as never, res as never)
  return { status: res.statusCode, html: String(res.body) }
}

/** What the browser sends on the page's own toggle navigation. */
const OWN_PAGE = { "sec-fetch-site": "same-origin" }
/** What it sends when the integrator's frame (or any other site) loads the URL. */
const CROSS_SITE = { "sec-fetch-site": "cross-site" }

/** The member ticks (or unticks) the box: the page's toggle reloads it. */
const toggle = (w: W, approved: boolean, extra: Record<string, string> = {}) =>
  get(w, { auto_renew_approved: approved ? "true" : "false", ...extra }, OWN_PAGE)

async function post(w: W, body: Record<string, unknown>) {
  const res = makeRes()
  await POST({ params: { token: token() }, query: {}, body, scope: w.scope } as never, res as never)
  return { status: res.statusCode, body: res.body as Record<string, unknown> }
}

const lastSessionInput = () =>
  createSessionsRun.mock.calls[createSessionsRun.mock.calls.length - 1]?.[0]?.input as
    | Record<string, unknown>
    | undefined

const html = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")

beforeEach(() => {
  createRun.mockReset()
  createSessionsRun.mockClear()
})
afterEach(() => {
  delete process.env[FLAG]
  delete process.env.STRIPE_PUBLISHABLE_KEY
})

describe("hosted checkout page: the auto-renew question", () => {
  // The Stripe Payment Element page (the live path): its script navigates to
  // the completion URL once the payment is confirmed.
  beforeEach(() => {
    process.env.STRIPE_PUBLISHABLE_KEY = "pk_test_page"
  })

  it("flag on, recurring listing: the storefront's checkbox, unticked, with the disclosure and the one-period terms", async () => {
    process.env[FLAG] = "true"
    const w = makeWorld({})
    const { status, html: page } = await get(w)
    expect(status).toBe(200)
    expect(page).toContain('<input id="auto-renew-approval" type="checkbox">')
    expect(page).toContain(html(AUTO_RENEW_CHECKBOX_LABEL))
    expect(page).toContain(html(autoRenewDisclosure(COPY)))
    expect(page).toContain(html(oneTimeTerms(COPY)))
    // Unticked: the session does NOT ask Stripe to keep the card.
    expect(lastSessionInput()).not.toHaveProperty("data")
    expect(lastSessionInput()).not.toHaveProperty("context")
    // The answer the page shows is the one it carries to the completion.
    expect(page).toContain(JSON.stringify("?action=complete&auto_renew_approved=false"))
  })

  it("ticked: the box renders checked, the session keeps the card, and the version travels with the approval", async () => {
    process.env[FLAG] = "true"
    const w = makeWorld({})
    await get(w)
    expect(createSessionsRun).toHaveBeenCalledTimes(1)
    const { html: page } = await toggle(w, true)
    expect(page).toContain('<input id="auto-renew-approval" type="checkbox" checked>')
    expect(page).not.toContain('id="one-time-terms"')
    // The unpaid session started without setup is replaced by one that keeps the card.
    expect(createSessionsRun).toHaveBeenCalledTimes(2)
    expect(lastSessionInput()).toMatchObject({
      data: {
        setup_future_usage: "off_session",
        metadata: { fbm_auto_renew_disclosure_version: AUTO_RENEW_DISCLOSURE_VERSION },
      },
      context: { setup_future_usage: "off_session" },
    })
    expect(page).toContain(
      JSON.stringify(
        `?action=complete&auto_renew_approved=true&auto_renew_disclosure_version=${AUTO_RENEW_DISCLOSURE_VERSION}`
      )
    )
    // Re-rendering with the same answer reuses the session.
    await toggle(w, true)
    expect(createSessionsRun).toHaveBeenCalledTimes(2)
  })

  it("a URL built elsewhere cannot deliver the box ticked: a cross-site or header-less first render is unticked and keeps no card", async () => {
    process.env[FLAG] = "true"
    for (const headers of [CROSS_SITE, { "sec-fetch-site": "same-site" }, { "sec-fetch-site": "none" }, undefined]) {
      createSessionsRun.mockClear()
      const w = makeWorld({ session: { embed: true, embed_origin: "https://theblackout.app" } })
      const { html: page } = await get(w, { auto_renew_approved: "true", embed: "1" }, headers)
      expect(page).toContain('<input id="auto-renew-approval" type="checkbox">')
      expect(page).not.toContain(" checked>")
      expect(page).toContain(html(oneTimeTerms(COPY)))
      expect(page).toContain(JSON.stringify("?action=complete&embed=1&auto_renew_approved=false"))
      expect(createSessionsRun).toHaveBeenCalledTimes(1)
      expect(lastSessionInput()).not.toHaveProperty("data")
      expect(lastSessionInput()).not.toHaveProperty("context")
    }
  })

  it("an integrator-built approved URL loaded after the member ticked does not keep the ticked session: it reverts to unticked", async () => {
    process.env[FLAG] = "true"
    const w = makeWorld({})
    await toggle(w, true)
    expect(lastSessionInput()).toHaveProperty("data")
    const { html: page } = await get(w, { auto_renew_approved: "true" }, CROSS_SITE)
    expect(page).toContain('<input id="auto-renew-approval" type="checkbox">')
    expect(lastSessionInput()).not.toHaveProperty("data")
  })

  it("the toggle fixes the answer once payment starts", async () => {
    process.env[FLAG] = "true"
    const w = makeWorld({})
    const { html: page } = await get(w)
    expect(page).toContain('document.addEventListener("submit", function () {\n        box.disabled = true;')
    expect(page).toContain('var pay = document.getElementById("submit");')
  })

  it("a session that may already be paid is never replaced: the answer is locked to it", async () => {
    process.env[FLAG] = "true"
    const w = makeWorld({})
    await get(w)
    const cart = [...world.carts.values()][0]
    cart.payment_collection!.payment_sessions[0].status = "authorized"
    const { html: page } = await toggle(w, true)
    expect(createSessionsRun).toHaveBeenCalledTimes(1)
    expect(page).toContain('<input id="auto-renew-approval" type="checkbox" disabled>')
    expect(page).toContain(JSON.stringify("?action=complete&auto_renew_approved=false"))
  })

  it("without Stripe, the fallback form carries the answer as fields (a GET form drops its action's query)", async () => {
    delete process.env.STRIPE_PUBLISHABLE_KEY
    process.env[FLAG] = "true"
    const w = makeWorld({})
    const { html: page } = await toggle(w, true)
    expect(page).toContain('<input type="hidden" name="action" value="complete">')
    expect(page).toContain('<input type="hidden" name="auto_renew_approved" value="true">')
    expect(page).toContain(
      `<input type="hidden" name="auto_renew_disclosure_version" value="${AUTO_RENEW_DISCLOSURE_VERSION}">`
    )
  })

  it("flag on, one-off listing: no question, the page is the legacy one", async () => {
    process.env[FLAG] = "true"
    const w = makeWorld({ listing: tierListing({ category: "digital", interval: null }) })
    const { html: page } = await get(w)
    expect(page).not.toContain("auto-renew")
    expect(page).not.toContain("auto_renew")
    expect(lastSessionInput()).toMatchObject({ data: { setup_future_usage: "off_session" } })
  })

  it("flag off, recurring listing: no question", async () => {
    const w = makeWorld({})
    const { html: page } = await get(w)
    expect(page).not.toContain("auto-renew")
    expect(page).not.toContain("auto_renew")
  })

  it("flag on, a product not sold until cancelled: no checkbox, only the one-period terms", async () => {
    process.env[FLAG] = "true"
    const w = makeWorld({ productMetadata: { subscription_interval: "monthly" } })
    const { html: page } = await toggle(w, true)
    expect(page).not.toContain('id="auto-renew-approval"')
    expect(page).not.toContain(html(AUTO_RENEW_CHECKBOX_LABEL))
    expect(page).toContain(html(oneTimeTerms(COPY)))
    expect(lastSessionInput()).not.toHaveProperty("data")
  })

  it("embed mode carries embed=1 on the toggle and the completion", async () => {
    process.env[FLAG] = "true"
    const w = makeWorld({ session: { embed: true, embed_origin: "https://theblackout.app" } })
    const { html: page } = await get(w)
    expect(page).toContain(JSON.stringify("?auto_renew_approved=true&embed=1"))
    expect(page).toContain(JSON.stringify("?action=complete&embed=1&auto_renew_approved=false"))
  })
})

describe("?action=complete: an explicit answer, honoured exactly", () => {
  it("refuses a missing or malformed answer before anything is completed", async () => {
    process.env[FLAG] = "true"
    const w = makeWorld({})
    wireCreate(w)
    await get(w)
    const malformed: Array<Record<string, string>> = [{}, { auto_renew_approved: "" }, { auto_renew_approved: "on" }]
    for (const query of malformed) {
      const res = await get(w, { action: "complete", ...query })
      expect(res.status).toBe(400)
      expect(res.html).toContain("auto_renew_answer_required")
    }
    const viaPost = await post(w, {})
    expect(viaPost.status).toBe(400)
    expect(viaPost.body.code).toBe("auto_renew_answer_required")
    expect(createRun).not.toHaveBeenCalled()
    expect(w.session.status).toBe("pending")
  })

  it("approved: until-cancelled terms, approval time and disclosure version recorded, card saved", async () => {
    process.env[FLAG] = "true"
    const w = makeWorld({})
    wireCreate(w)
    await toggle(w, true)
    const before = Date.now()
    const res = await get(w, {
      action: "complete",
      auto_renew_approved: "true",
      auto_renew_disclosure_version: AUTO_RENEW_DISCLOSURE_VERSION,
    })
    expect(res.status).toBe(200)
    expect(res.html).toContain("checkout.completed")
    const approval = createRun.mock.calls[0][0].input.subscription_data.auto_renew
    expect(approval).toMatchObject({ approved: true, disclosure_version: AUTO_RENEW_DISCLOSURE_VERSION })
    expect(new Date(approval.approved_at).getTime()).toBeGreaterThanOrEqual(before - 1000)
    const row = w.svc.store.get("sub_1")!
    expect(row.auto_renew_approved).toBe(true)
    expect(row.auto_renew_disclosure_version).toBe(AUTO_RENEW_DISCLOSURE_VERSION)
    expect(row.payment_method_id).toBe("pm_card")
    expect(row.seller_id).toBe("sel_1")
    expect(w.session.status).toBe("completed")
  })

  it("an approval of a stale disclosure, or for a product not sold that way, is refused", async () => {
    process.env[FLAG] = "true"
    const stale = makeWorld({})
    wireCreate(stale)
    await toggle(stale, true)
    const res = await get(stale, {
      action: "complete",
      auto_renew_approved: "true",
      auto_renew_disclosure_version: "2026-01-01",
    })
    expect(res.status).toBe(409)
    expect(res.html).toContain("auto_renew_disclosure_outdated")

    const unmarked = makeWorld({ productMetadata: null })
    wireCreate(unmarked)
    const viaPost = await post(unmarked, {
      auto_renew_approved: true,
      auto_renew_disclosure_version: AUTO_RENEW_DISCLOSURE_VERSION,
    })
    expect(viaPost.status).toBe(409)
    expect(viaPost.body.code).toBe("auto_renew_not_offered")
    expect(createRun).not.toHaveBeenCalled()
  })

  it("not approved: exactly one period, never renews, no card kept anywhere", async () => {
    process.env[FLAG] = "true"
    const w = makeWorld({})
    wireCreate(w)
    await get(w)
    const res = await get(w, { action: "complete", auto_renew_approved: "false" })
    expect(res.status).toBe(200)
    expect(createRun.mock.calls[0][0].input.subscription_data.auto_renew).toMatchObject({
      approved: false,
      disclosure_version: null,
    })
    const row = w.svc.store.get("sub_1")!
    expect(row.next_order_date).toBeNull()
    expect(row.metadata).toMatchObject({ auto_renew_mode: "single_period", blackout_tier: "vault-seat" })
    expect(row).not.toHaveProperty("payment_method_id")
    // Stripe was never asked to keep the card.
    for (const call of createSessionsRun.mock.calls) {
      expect(call[0].input).not.toHaveProperty("data")
    }
    // Access ends with the one period paid for, not never.
    expect(w.entitlements.grantBundleFromSubscription).toHaveBeenCalledWith(
      expect.objectContaining({ expires_at: new Date("2026-11-06T00:00:00.000Z") })
    )
  })

  it("an answer that does not match the session the member paid against is refused", async () => {
    process.env[FLAG] = "true"
    const w = makeWorld({})
    wireCreate(w)
    await get(w) // unticked: the session does not keep the card
    const res = await get(w, {
      action: "complete",
      auto_renew_approved: "true",
      auto_renew_disclosure_version: AUTO_RENEW_DISCLOSURE_VERSION,
    })
    expect(res.status).toBe(409)
    expect(res.html).toContain("auto_renew_answer_mismatch")
    expect(createRun).not.toHaveBeenCalled()
    expect(createSessionsRun).toHaveBeenCalledTimes(1)
  })

  it("a completed session is never re-completed with a different answer; the same answer is an idempotent retry", async () => {
    process.env[FLAG] = "true"
    const w = makeWorld({ session: { embed: true, embed_origin: "https://theblackout.app" } })
    wireCreate(w)
    await get(w)
    expect((await get(w, { action: "complete", auto_renew_approved: "false", embed: "1" })).status).toBe(200)
    expect(createRun).toHaveBeenCalledTimes(1)

    const retry = await get(w, { action: "complete", auto_renew_approved: "false", embed: "1" })
    expect(retry.status).toBe(200)
    expect(retry.html).toContain('"order_id":"order_1"')

    const flipped = await post(w, {
      auto_renew_approved: true,
      auto_renew_disclosure_version: AUTO_RENEW_DISCLOSURE_VERSION,
    })
    expect(flipped.status).toBe(409)
    expect(flipped.body.code).toBe("auto_renew_answer_conflict")

    const embedRefusal = await get(w, { action: "complete", embed: "1" })
    expect(embedRefusal.status).toBe(400)
    expect(embedRefusal.html).toContain('type: "checkout.error"')
    expect(embedRefusal.html).toContain('"https://theblackout.app"')
    expect(createRun).toHaveBeenCalledTimes(1)
    // The re-render of a completed session still shows the completed state.
    expect((await get(w)).html).toContain("checkout.completed")
  })

  it("an approval carried by a URL with no verified tick behind it is refused: nothing marked the session", async () => {
    process.env[FLAG] = "true"
    const w = makeWorld({})
    wireCreate(w)
    // The integrator opens the approved URL and completes with an approval, on
    // a session nobody ticked, and on a fresh one the completion starts itself.
    await get(w, { auto_renew_approved: "true" }, CROSS_SITE)
    const approvedQuery = {
      action: "complete",
      auto_renew_approved: "true",
      auto_renew_disclosure_version: AUTO_RENEW_DISCLOSURE_VERSION,
    }
    expect((await get(w, approvedQuery)).html).toContain("auto_renew_answer_mismatch")
    const fresh = makeWorld({})
    wireCreate(fresh)
    const viaPost = await post(fresh, { auto_renew_approved: true, auto_renew_disclosure_version: AUTO_RENEW_DISCLOSURE_VERSION })
    expect(viaPost.status).toBe(409)
    expect(viaPost.body.code).toBe("auto_renew_answer_mismatch")
    expect(lastSessionInput()).not.toHaveProperty("data")
    expect(createRun).not.toHaveBeenCalled()
  })

  it("retry after the cart completed but the record did not: an approved retry finishes the record instead of 409", async () => {
    process.env[FLAG] = "true"
    const w = makeWorld({})
    wireCreate(w)
    await toggle(w, true)
    const approvedQuery = {
      action: "complete",
      auto_renew_approved: "true",
      auto_renew_disclosure_version: AUTO_RENEW_DISCLOSURE_VERSION,
    }
    // First attempt: the workflow completes the cart, then the record write fails.
    w.listingService.updateBlackoutCheckoutSessions.mockImplementationOnce(async () => {
      throw new Error("db blip")
    })
    expect((await get(w, approvedQuery)).status).toBe(500)
    expect([...world.carts.values()][0].completed_at).not.toBeNull()
    expect(w.session.status).toBe("pending")

    const retry = await get(w, approvedQuery)
    expect(retry.status).toBe(200)
    expect(retry.html).toContain("checkout.completed")
    expect(w.session.status).toBe("completed")
    expect(w.session.subscription_id).toBe("sub_1")
    expect(createRun).toHaveBeenCalledTimes(2)
    expect(createRun.mock.calls[1][0].input.subscription_data.auto_renew).toMatchObject({ approved: true })
    expect(w.svc.store.get("sub_1")!.payment_method_id).toBe("pm_card")
    // A declined retry of that approved cart is still refused.
    const flipped = makeWorld({})
    wireCreate(flipped)
    await toggle(flipped, true)
    // That cart completed with the approval; the record is still pending.
    const cart = [...world.carts.values()][0]
    cart.completed_at = "2026-10-06T00:00:00.000Z"
    const declined = await get(flipped, { action: "complete", auto_renew_approved: "false" })
    expect(declined.status).toBe(409)
    expect(declined.html).toContain("auto_renew_answer_mismatch")
  })

  it("a payment set up before the question (flag flip) is never read as an approval, and is refused for an operator", async () => {
    process.env[FLAG] = "true"
    const w = makeWorld({})
    wireCreate(w)
    // The pre-flag page started the session keeping the card, with no mark,
    // and the member paid it.
    await get(w)
    const ps = [...world.carts.values()][0].payment_collection!.payment_sessions[0]
    ps.data = { ...ps.data, setup_future_usage: "off_session", metadata: {} }
    ps.status = "authorized"
    const { html: page } = await get(w)
    expect(page).toContain('<input id="auto-renew-approval" type="checkbox" disabled>')
    expect(page).toContain('<input type="hidden" name="auto_renew_approved" value="false">')
    expect(createSessionsRun).toHaveBeenCalledTimes(1)
    const completions: Array<Record<string, string>> = [
      { action: "complete", auto_renew_approved: "false" },
      { action: "complete", auto_renew_approved: "true", auto_renew_disclosure_version: AUTO_RENEW_DISCLOSURE_VERSION },
    ]
    for (const query of completions) {
      const res = await get(w, query)
      expect(res.status).toBe(409)
      expect(res.html).toContain("auto_renew_not_asked")
    }
    expect(createRun).not.toHaveBeenCalled()
    expect(w.session.status).toBe("pending")
  })
})

describe("flag off: completion and stored rows are what they always were", () => {
  it("no answer needed, the session keeps the card, the card is written, no approval passed", async () => {
    const w = makeWorld({})
    wireCreate(w)
    await get(w)
    expect(lastSessionInput()).toEqual({
      payment_collection_id: "paycol_cart_1",
      provider_id: expect.any(String),
      customer_id: "cus_member",
      data: { setup_future_usage: "off_session" },
      context: { setup_future_usage: "off_session" },
    })
    const res = await get(w, { action: "complete" })
    expect(res.status).toBe(200)
    expect(createRun.mock.calls[0][0].input.subscription_data).toEqual({
      interval: SubscriptionInterval.MONTHLY,
      period: 12,
      type: "membership",
    })
    const row = w.svc.store.get("sub_1")!
    expect(row.payment_method_id).toBe("pm_card")
    expect(w.entitlements.grantBundleFromSubscription).toHaveBeenCalledWith(
      expect.objectContaining({ expires_at: new Date("2026-11-06T00:00:00.000Z") })
    )
  })
})

/**
 * Byte identity, pinned: the pages a flag-off recurring checkout and a flag-on
 * one-off checkout render, compared with goldens captured from the route as it
 * was before the auto-renew question existed (main d51aa0b9). A change to the
 * shared template (renderPayPage) that moves a byte on these paths fails here.
 * Each scenario renders twice, ?auto_renew_approved=true from the page itself
 * the second time, which must change nothing either.
 */
describe("golden pages: flag off, and one-off listings with the flag on, are byte-identical to before", () => {
  const golden = (name: string) =>
    fs.readFileSync(path.join(__dirname, "__golden__", `${name}.html`), "utf8")
  const oneOff = () => tierListing({ category: "digital", interval: null })
  const scenarios: Array<[string, { flag: boolean; stripe: boolean }, () => W]> = [
    ["flag-off-recurring-stripe", { flag: false, stripe: true }, () => makeWorld({})],
    [
      "flag-off-recurring-form-embed",
      { flag: false, stripe: false },
      () => makeWorld({ session: { embed: true, embed_origin: "https://theblackout.app" } }),
    ],
    ["flag-on-oneoff-stripe", { flag: true, stripe: true }, () => makeWorld({ listing: oneOff() })],
    ["flag-on-oneoff-form", { flag: true, stripe: false }, () => makeWorld({ listing: oneOff() })],
  ]

  it.each(scenarios)("%s", async (name, env, mk) => {
    if (env.flag) process.env[FLAG] = "true"
    if (env.stripe) process.env.STRIPE_PUBLISHABLE_KEY = "pk_test_page"
    const expected = golden(name)
    const w = mk()
    expect((await get(w)).html).toBe(expected)
    expect((await toggle(w, true)).html).toBe(expected)
  })
})
