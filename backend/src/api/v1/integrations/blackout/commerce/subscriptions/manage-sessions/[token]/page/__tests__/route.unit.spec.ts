/**
 * The Blackout subscription manage page: GET renders, POST acts.
 *
 * Sessions are minted through the REAL mint route (manage-fakes.ts), so every
 * token here is one the mint produced. Real code: both routes, the
 * manage-session and page helpers, the shared dispatcher
 * (lib/subscription-manage.ts), the SubscriptionModuleService prototype over
 * an in-memory store (withdrawAutoRenew / approveAutoRenew run for real),
 * grace-lifecycle's product lookup. Stubbed: manageSubscriptionWorkflow (its
 * insides have their own specs) — its input is what is asserted. The
 * container resolves only imported keys.
 */
const manageRun = jest.fn()

jest.mock("../../../../../../../../../../workflows/subscription", () => ({
  createSubscriptionWorkflow: jest.fn(),
  manageSubscriptionWorkflow: jest.fn(() => ({ run: manageRun })),
}))

import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { GET, POST } from "../route"
import { manageSubscriptionWorkflow } from "../../../../../../../../../../workflows/subscription"
import { MARKETPLACE_LISTING_MODULE } from "../../../../../../../../../../modules/marketplace-listing"
import { SUBSCRIPTION_MODULE } from "../../../../../../../../../../modules/subscription"
import { SubscriptionInterval, SubscriptionStatus } from "../../../../../../../../../../modules/subscription/types"
import {
  AUTO_RENEW_DISCLOSURE_VERSION,
  AUTO_RENEW_REAPPROVAL_DISCLOSURE_VERSION,
} from "../../../../../../../../../../modules/subscription/utils/auto-renew"
import { reapprovalDisclosure } from "../../../../../../../../../../modules/subscription/utils/auto-renew-copy"
import { csrfNonceFor } from "../../../../../../../../../../lib/blackout-manage-session"
import {
  MANAGE_EXPIRED_MESSAGE,
  MANAGE_UNAVAILABLE_MESSAGE,
  escapeHtml,
  formatManageDate,
  renewalPrice,
} from "../../../../../../../../../../lib/blackout-manage-page"
import { PHASE0_FEATURE_FLAGS } from "../../../../../../../../../../shared/feature-flags"
import {
  makeContainer,
  makeSubscriptionService,
  type FakeRow,
} from "../../../../../../../../../../modules/subscription/__tests__/fake-subscription-service"
import {
  API_KEY,
  FBM_BASE,
  makeListingService,
  makePg,
  makeRes,
  mint,
} from "../../../__tests__/manage-fakes"

const FLAG = PHASE0_FEATURE_FLAGS.CONSUMER_SUBSCRIPTIONS_V1
const DAY = 24 * 60 * 60 * 1000

beforeEach(() => {
  process.env.FBM_BLACKOUT_INTEGRATION = "1"
  process.env.FREEBLACKMARKET_API_KEY = API_KEY
  process.env.FREEBLACKMARKET_BASE_URL = FBM_BASE
  process.env[FLAG] = "true"
  manageRun.mockReset()
  manageRun.mockResolvedValue({ result: { subscription: {}, action: "cancel", success: true } })
})
afterEach(() => {
  delete process.env.FBM_BLACKOUT_INTEGRATION
  delete process.env.FREEBLACKMARKET_API_KEY
  delete process.env.FREEBLACKMARKET_BASE_URL
  delete process.env.BLACKOUT_RETURN_ORIGINS
  delete process.env[FLAG]
})

const mine = { blackout_user_id: "blk_a", creator_listing_id: "clist_1" }

function rows(): FakeRow[] {
  const now = Date.now()
  return [
    {
      id: "sub_on",
      status: SubscriptionStatus.ACTIVE,
      interval: SubscriptionInterval.MONTHLY,
      customer_id: "cus_a",
      product_id: "prod_vault",
      last_order_date: new Date(now - 10 * DAY),
      next_order_date: new Date(now + 20 * DAY),
      expiration_date: null,
      payment_method_id: "pm_card",
      auto_renew_approved: true,
      metadata: { ...mine },
    },
    {
      id: "sub_single",
      status: SubscriptionStatus.ACTIVE,
      interval: SubscriptionInterval.MONTHLY,
      customer_id: "cus_a",
      product_id: "prod_vault",
      last_order_date: new Date(now - 10 * DAY),
      next_order_date: null,
      expiration_date: new Date(now + 20 * DAY),
      payment_method_id: "pm_card",
      auto_renew_approved: false,
      metadata: { ...mine, auto_renew_mode: "withdrawn" },
    },
    {
      // Legacy fixed horizon: bought before the flag, still renewing monthly
      // up to a 12-month expiration, never approved.
      id: "sub_legacy",
      status: SubscriptionStatus.ACTIVE,
      interval: SubscriptionInterval.MONTHLY,
      customer_id: "cus_a",
      product_id: "prod_vault",
      last_order_date: new Date(now - 10 * DAY),
      next_order_date: new Date(now + 20 * DAY),
      expiration_date: new Date(now + 300 * DAY),
      payment_method_id: "pm_card",
      auto_renew_approved: null,
      metadata: { ...mine },
    },
    {
      // Legacy fixed horizon in its FINAL period: nothing scheduled any more
      // (the next charge would pass the expiration), never approved, a card
      // saved. Still cancel only.
      id: "sub_legacy_final",
      status: SubscriptionStatus.ACTIVE,
      interval: SubscriptionInterval.MONTHLY,
      customer_id: "cus_a",
      product_id: "prod_vault",
      last_order_date: new Date(now - 20 * DAY),
      next_order_date: null,
      expiration_date: new Date(now + 10 * DAY),
      payment_method_id: "pm_card",
      auto_renew_approved: false,
      metadata: { ...mine },
    },
    {
      // Renewal off, bought through the hosted checkout at a caller-chosen
      // amount ($7.50) below the listing's $10.00: a renewal charges $7.50.
      id: "sub_custom",
      status: SubscriptionStatus.ACTIVE,
      interval: SubscriptionInterval.MONTHLY,
      customer_id: "cus_a",
      product_id: "prod_vault",
      last_order_date: new Date(now - 10 * DAY),
      next_order_date: null,
      expiration_date: new Date(now + 20 * DAY),
      payment_method_id: "pm_card",
      auto_renew_approved: false,
      metadata: { ...mine, auto_renew_mode: "single_period" },
    },
    {
      // Renewal off, but no template cart to read a renewal price from.
      id: "sub_nocart",
      status: SubscriptionStatus.ACTIVE,
      interval: SubscriptionInterval.MONTHLY,
      customer_id: "cus_a",
      product_id: "prod_vault",
      last_order_date: new Date(now - 10 * DAY),
      next_order_date: null,
      expiration_date: new Date(now + 20 * DAY),
      payment_method_id: "pm_card",
      auto_renew_approved: false,
      metadata: { ...mine, auto_renew_mode: "withdrawn" },
    },
    {
      id: "sub_done",
      status: SubscriptionStatus.CANCELED,
      interval: SubscriptionInterval.MONTHLY,
      customer_id: "cus_a",
      product_id: "prod_vault",
      last_order_date: new Date(now - 40 * DAY),
      next_order_date: null,
      expiration_date: null,
      metadata: { ...mine },
    },
    {
      // Another member's subscription, on another customer.
      id: "sub_other",
      status: SubscriptionStatus.ACTIVE,
      interval: SubscriptionInterval.MONTHLY,
      customer_id: "cus_b",
      product_id: "prod_vault",
      last_order_date: new Date(now - 10 * DAY),
      next_order_date: new Date(now + 20 * DAY),
      expiration_date: null,
      payment_method_id: "pm_b",
      auto_renew_approved: true,
      metadata: { blackout_user_id: "blk_b", creator_listing_id: "clist_1" },
    },
    {
      // A row with no customer at all: an unbound session must not match it
      // as null === null.
      id: "sub_orphan",
      status: SubscriptionStatus.ACTIVE,
      interval: SubscriptionInterval.MONTHLY,
      customer_id: null,
      product_id: "prod_vault",
      last_order_date: new Date(now - 10 * DAY),
      next_order_date: new Date(now + 20 * DAY),
      expiration_date: null,
      metadata: {},
    },
    {
      // Another customer's subscription bought on the storefront: no Blackout
      // stamp, so only the customer check can refuse it.
      id: "sub_other_storefront",
      status: SubscriptionStatus.ACTIVE,
      interval: SubscriptionInterval.MONTHLY,
      customer_id: "cus_b",
      product_id: "prod_vault",
      last_order_date: new Date(now - 10 * DAY),
      next_order_date: new Date(now + 20 * DAY),
      expiration_date: null,
      payment_method_id: "pm_b2",
      auto_renew_approved: true,
      metadata: {},
    },
    {
      // On this member's customer, but bought by a different Blackout member
      // before the customer was re-stamped.
      id: "sub_restamped",
      status: SubscriptionStatus.ACTIVE,
      interval: SubscriptionInterval.MONTHLY,
      customer_id: "cus_a",
      product_id: "prod_vault",
      last_order_date: new Date(now - 10 * DAY),
      next_order_date: new Date(now + 20 * DAY),
      expiration_date: null,
      payment_method_id: "pm_old",
      auto_renew_approved: true,
      metadata: { blackout_user_id: "blk_old", creator_listing_id: "clist_1" },
    },
    {
      // On THIS member's customer, bought on the storefront: no Blackout
      // stamp. The page manages Blackout-bought rows only, so it is neither
      // listed nor actionable here (operator scope decision 2026-10-06).
      id: "sub_mine_storefront",
      status: SubscriptionStatus.ACTIVE,
      interval: SubscriptionInterval.MONTHLY,
      customer_id: "cus_a",
      product_id: "prod_vault",
      last_order_date: new Date(now - 10 * DAY),
      next_order_date: new Date(now + 20 * DAY),
      expiration_date: null,
      payment_method_id: "pm_card",
      auto_renew_approved: true,
      metadata: {},
    },
    {
      // Stamped with THIS member's id, but on ANOTHER customer (cus_b): only
      // the customer half of the ownership predicate can refuse it. GET
      // pre-filters by customer; POST looks the row up by id alone.
      id: "sub_mine_elsewhere",
      status: SubscriptionStatus.ACTIVE,
      interval: SubscriptionInterval.MONTHLY,
      customer_id: "cus_b",
      product_id: "prod_vault",
      last_order_date: new Date(now - 10 * DAY),
      next_order_date: new Date(now + 20 * DAY),
      expiration_date: null,
      payment_method_id: "pm_b3",
      auto_renew_approved: true,
      metadata: { ...mine },
    },
  ]
}

const LISTING = { id: "clist_1", title: "Vault seat", price_cents: 1000, currency: "usd" }
const VAULT = { prod_vault: { subscription_until_canceled: true, subscription_interval: "monthly" } }

/** Each row's template cart (subscription → cart link), as query.graph returns it. */
const cartAt = (unit_price: number) => ({
  currency_code: "usd",
  items: [{ variant_id: "variant_vault", quantity: 1, unit_price }],
})
const CARTS: Record<string, ReturnType<typeof cartAt>> = {
  sub_on: cartAt(10),
  sub_single: cartAt(10),
  sub_legacy: cartAt(10),
  sub_legacy_final: cartAt(10),
  sub_custom: cartAt(7.5),
}

async function setup(opts: {
  customers?: Array<{ id: string; metadata: Record<string, unknown> }>
  mintBody?: Record<string, unknown>
} = {}) {
  const service = makeListingService([LISTING])
  const pg = makePg(
    opts.customers ?? [
      { id: "cus_a", metadata: { blackout_user_id: "blk_a" } },
      { id: "cus_b", metadata: { blackout_user_id: "blk_b" } },
    ]
  )
  const minted = await mint({ service, pg, body: { blackout_user_id: "blk_a", ...(opts.mintBody ?? {}) } })
  expect(minted.res.statusCode).toBe(201)
  const svc = makeSubscriptionService(rows())
  const query = {
    graph: jest.fn(async ({ entity, filters }: { entity: string; filters: { id: string | string[] } }) => {
      if (entity === "subscription") {
        const ids = ([] as string[]).concat(filters.id).filter((id) => svc.store.has(id))
        return {
          data: ids.map((id) => ({ id, quantity: svc.store.get(id)?.quantity ?? 1, cart: CARTS[id] ?? null })),
        }
      }
      if (entity !== "product") throw new Error(`unexpected entity ${entity}`)
      const metadata = VAULT[filters.id as keyof typeof VAULT]
      return { data: metadata ? [{ id: filters.id, metadata }] : [] }
    }),
  }
  const scope = makeContainer({
    [MARKETPLACE_LISTING_MODULE]: service,
    [SUBSCRIPTION_MODULE]: svc,
    [ContainerRegistrationKeys.QUERY]: query,
  })
  return { service, pg, svc, scope, query, token: minted.token as string }
}

async function get(scope: unknown, token: string) {
  const res = makeRes()
  await GET({ params: { token }, headers: {}, query: {}, scope } as never, res as never)
  return res
}

const OWN_PAGE = { "sec-fetch-site": "same-origin", "content-type": "application/json" }

async function post(
  scope: unknown,
  token: string,
  body: Record<string, unknown>,
  headers: Record<string, string> = OWN_PAGE
) {
  const res = makeRes()
  await POST({ params: { token }, headers, query: {}, body, scope } as never, res as never)
  return res
}

/** The <li> of one subscription, from the rendered page. */
function rowHtml(html: string, id: string): string {
  const start = html.indexOf(`<li class="sub" data-subscription="${id}">`)
  if (start < 0) return ""
  return html.slice(start, html.indexOf("</li>", start))
}

// ---------------------------------------------------------------------------
describe("GET manage page", () => {
  it("lists only this member's own rows — never another customer's or another member's purchase", async () => {
    const { scope, token } = await setup()
    const res = await get(scope, token)
    expect(res.statusCode).toBe(200)
    const html = String(res.body)
    for (const id of ["sub_on", "sub_single", "sub_legacy", "sub_legacy_final", "sub_custom", "sub_nocart", "sub_done"]) {
      expect(rowHtml(html, id)).not.toBe("")
    }
    expect(html).not.toContain("sub_other")
    expect(html).not.toContain("sub_other_storefront")
    expect(html).not.toContain("sub_restamped")
    expect(html).not.toContain("sub_mine_storefront")
    expect(html).not.toContain("sub_mine_elsewhere")
  })

  it("is never framed, cached or referred", async () => {
    const { scope, token } = await setup()
    const res = await get(scope, token)
    expect(res.headers["content-security-policy"]).toContain("frame-ancestors 'none'")
    expect(res.headers["content-security-policy"]).toContain("form-action 'none'")
    expect(res.headers["x-frame-options"]).toBe("DENY")
    expect(res.headers["cache-control"]).toBe("no-store")
    expect(res.headers["referrer-policy"]).toBe("no-referrer")
    // The one script runs under the CSP nonce, and the page carries the
    // session's CSRF nonce for its POSTs.
    const scriptNonce = /script-src 'nonce-([^']+)'/.exec(res.headers["content-security-policy"])?.[1]
    expect(String(res.body)).toContain(`<script nonce="${scriptNonce}">`)
    expect(String(res.body)).toContain(JSON.stringify(csrfNonceFor(token)))
  })

  it("renewing row: next charge, renewal on, 'Turn off automatic renewal' and cancel", async () => {
    const { scope, token, svc } = await setup()
    const li = rowHtml(String((await get(scope, token)).body), "sub_on")
    const next = formatManageDate(svc.store.get("sub_on")?.next_order_date as Date)
    expect(li).toContain(`Next charge: ${next}`)
    expect(li).toContain("Automatic renewal: on")
    expect(li).toContain('data-action="disable_auto_renew"')
    expect(li).toContain('data-action="cancel"')
    expect(li).not.toContain('data-action="approve_auto_renew"')
  })

  it("legacy fixed-horizon row: says it still renews until its end date, and offers cancel only", async () => {
    const { scope, token, svc } = await setup()
    const li = rowHtml(String((await get(scope, token)).body), "sub_legacy")
    const row = svc.store.get("sub_legacy") as FakeRow
    expect(li).toContain(`Next charge: ${formatManageDate(row.next_order_date as Date)}`)
    expect(li).toContain(`Renews every month until ${formatManageDate(row.expiration_date as Date)}.`)
    expect(li).not.toContain("No further charges")
    expect(li).not.toContain("Automatic renewal: off")
    expect(li).not.toContain('data-action="disable_auto_renew"')
    expect(li).not.toContain('data-action="approve_auto_renew"')
    expect(li).toContain('data-action="cancel"')
  })

  it("renewal off with a saved card: the storefront's re-approval disclosure, unticked, button disabled", async () => {
    const { scope, token, svc } = await setup()
    const li = rowHtml(String((await get(scope, token)).body), "sub_single")
    const row = svc.store.get("sub_single") as FakeRow
    const disclosure = reapprovalDisclosure({
      price: "$10.00",
      interval: SubscriptionInterval.MONTHLY,
      paidThrough: formatManageDate(row.expiration_date as Date) as string,
    })
    expect(li).toContain(escapeHtml(disclosure))
    expect(li).toContain("Renew automatically until I cancel")
    expect(li).toMatch(/<input type="checkbox" data-approve-box="sub_single">/)
    expect(li).not.toMatch(/checked/)
    expect(li).toMatch(/data-action="approve_auto_renew" data-sub="sub_single" disabled>/)
    expect(li).toContain(`No further charges. This subscription ends ${formatManageDate(row.expiration_date as Date)}.`)
  })

  it("legacy fixed-horizon row in its final period (nothing scheduled): cancel only, no re-approval", async () => {
    const { scope, token, svc } = await setup()
    const li = rowHtml(String((await get(scope, token)).body), "sub_legacy_final")
    const row = svc.store.get("sub_legacy_final") as FakeRow
    expect(li).toContain(`No further charges. This subscription ends ${formatManageDate(row.expiration_date as Date)}.`)
    expect(li).not.toContain('data-action="approve_auto_renew"')
    expect(li).not.toContain("data-reapprove-disclosure")
    expect(li).not.toContain('data-action="disable_auto_renew"')
    expect(li).toContain('data-action="cancel"')
  })

  it("the re-approval disclosure names what a renewal charges (the template cart's price), not the listing's", async () => {
    const { scope, token, svc } = await setup()
    const li = rowHtml(String((await get(scope, token)).body), "sub_custom")
    const row = svc.store.get("sub_custom") as FakeRow
    const disclosure = reapprovalDisclosure({
      price: "$7.50",
      interval: SubscriptionInterval.MONTHLY,
      paidThrough: formatManageDate(row.expiration_date as Date) as string,
    })
    expect(li).toContain(escapeHtml(disclosure))
    expect(li).not.toContain("$10.00")
  })

  it("no template cart to read the renewal price from: no re-approval offered", async () => {
    const { scope, token } = await setup()
    const li = rowHtml(String((await get(scope, token)).body), "sub_nocart")
    expect(li).not.toContain('data-action="approve_auto_renew"')
    expect(li).not.toContain("data-reapprove-disclosure")
    expect(li).toContain('data-action="cancel"')
  })

  it("the renewal price lookup failing hides re-approval rather than guessing", async () => {
    const { scope, token, query } = await setup()
    query.graph.mockImplementationOnce(async () => {
      throw new Error("db down")
    })
    const li = rowHtml(String((await get(scope, token)).body), "sub_single")
    expect(li).not.toContain('data-action="approve_auto_renew"')
    expect(li).toContain('data-action="cancel"')
  })

  it("an ended row offers nothing", async () => {
    const { scope, token } = await setup()
    const li = rowHtml(String((await get(scope, token)).body), "sub_done")
    expect(li).toContain("Cancelled")
    expect(li).not.toContain("data-action")
  })

  it("no FBM customer for the member: 'No subscriptions'", async () => {
    const { scope, token } = await setup({ customers: [] })
    const res = await get(scope, token)
    expect(res.statusCode).toBe(200)
    expect(String(res.body)).toContain("No subscriptions")
    expect(String(res.body)).not.toContain("data-subscription")
  })

  it("'Back to Blackout' only for an accepted return_url", async () => {
    process.env.BLACKOUT_RETURN_ORIGINS = "https://app.theblackout.app"
    const ok = await setup({ mintBody: { return_url: "https://app.theblackout.app/settings" } })
    expect(String((await get(ok.scope, ok.token)).body)).toContain(
      '<a href="https://app.theblackout.app/settings" rel="noopener noreferrer">Back to Blackout</a>'
    )
    const ignored = await setup({ mintBody: { return_url: "https://evil.example/settings" } })
    expect(String((await get(ignored.scope, ignored.token)).body)).not.toContain("Back to Blackout")
  })

  it.each([
    ["expired", (s: Awaited<ReturnType<typeof setup>>) => (s.service.sessions[0].expires_at = new Date(Date.now() - 1000))],
    ["revoked", (s: Awaited<ReturnType<typeof setup>>) => (s.service.sessions[0].revoked_at = new Date())],
  ])("an %s link is the 401 'expired' page", async (_label, spoil) => {
    const s = await setup()
    spoil(s)
    const res = await get(s.scope, s.token)
    expect(res.statusCode).toBe(401)
    expect(String(res.body)).toContain(MANAGE_EXPIRED_MESSAGE)
    expect(String(res.body)).not.toContain("data-subscription")
  })

  it("a replaced link (the member minted again) is the 401 page; the new one works", async () => {
    const s = await setup()
    const again = await mint({
      service: s.service,
      pg: makePg([{ id: "cus_a", metadata: { blackout_user_id: "blk_a" } }]),
      body: { blackout_user_id: "blk_a" },
    })
    expect((await get(s.scope, s.token)).statusCode).toBe(401)
    expect((await get(s.scope, again.token as string)).statusCode).toBe(200)
  })

  it("an unknown or malformed token is the 401 page", async () => {
    const { scope } = await setup()
    for (const token of ["nope", "x".repeat(43), "", "y".repeat(500)]) {
      expect((await get(scope, token)).statusCode).toBe(401)
    }
  })

  it.each([
    ["FBM_BLACKOUT_INTEGRATION", () => delete process.env.FBM_BLACKOUT_INTEGRATION],
    ["FF_CONSUMER_SUBSCRIPTIONS_V1", () => delete process.env[FLAG]],
  ])("%s off: an existing link renders 'unavailable' and reads nothing", async (_label, flip) => {
    const { scope, token, svc } = await setup()
    flip()
    const res = await get(scope, token)
    expect(res.statusCode).toBe(404)
    expect(String(res.body)).toContain(MANAGE_UNAVAILABLE_MESSAGE)
    expect(svc.listSubscriptions).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
describe("POST manage page — actions reach the real service / workflow", () => {
  const csrfOf = (token: string) => csrfNonceFor(token)

  it("disable_auto_renew runs withdrawAutoRenew: access kept to the paid period end, nothing scheduled", async () => {
    const { scope, token, svc } = await setup()
    const res = await post(scope, token, { action: "disable_auto_renew", subscription_id: "sub_on", csrf: csrfOf(token) })
    expect(res.statusCode).toBe(200)
    const stored = svc.store.get("sub_on") as FakeRow
    expect(stored.auto_renew_approved).toBe(false)
    expect(stored.next_order_date).toBeNull()
    expect(new Date(stored.expiration_date as Date).getTime()).toBeGreaterThan(Date.now())
    expect(manageRun).not.toHaveBeenCalled()
  })

  it("approve_auto_renew with the re-approval version runs approveAutoRenew", async () => {
    const { scope, token, svc } = await setup()
    const res = await post(scope, token, {
      action: "approve_auto_renew",
      subscription_id: "sub_single",
      csrf: csrfOf(token),
      auto_renew_approved: true,
      auto_renew_disclosure_version: AUTO_RENEW_REAPPROVAL_DISCLOSURE_VERSION,
    })
    expect(res.statusCode).toBe(200)
    const stored = svc.store.get("sub_single") as FakeRow
    expect(stored.auto_renew_approved).toBe(true)
    expect(stored.auto_renew_disclosure_version).toBe(AUTO_RENEW_REAPPROVAL_DISCLOSURE_VERSION)
    expect(stored.expiration_date).toBeNull()
  })

  it("approve with the purchase version is the service's 409; without an explicit true, the store route's 400", async () => {
    const { scope, token, svc } = await setup()
    const stale = await post(scope, token, {
      action: "approve_auto_renew",
      subscription_id: "sub_single",
      csrf: csrfOf(token),
      auto_renew_approved: true,
      auto_renew_disclosure_version: AUTO_RENEW_DISCLOSURE_VERSION,
    })
    expect(stale.statusCode).toBe(409)
    expect(stale.body).toMatchObject({ type: "auto_renew_disclosure_outdated" })
    const unanswered = await post(scope, token, {
      action: "approve_auto_renew",
      subscription_id: "sub_single",
      csrf: csrfOf(token),
      auto_renew_disclosure_version: AUTO_RENEW_REAPPROVAL_DISCLOSURE_VERSION,
    })
    expect(unanswered.statusCode).toBe(400)
    expect(svc.updateSubscriptions).not.toHaveBeenCalled()
  })

  it.each([
    ["a legacy fixed-horizon row in its final period", "sub_legacy_final"],
    ["a row whose renewal price is unknown (no disclosure was shown)", "sub_nocart"],
  ])("approve_auto_renew on %s is 409 auto_renew_not_available and writes nothing", async (_label, id) => {
    const { scope, token, svc } = await setup()
    const res = await post(scope, token, {
      action: "approve_auto_renew",
      subscription_id: id,
      csrf: csrfOf(token),
      auto_renew_approved: true,
      auto_renew_disclosure_version: AUTO_RENEW_REAPPROVAL_DISCLOSURE_VERSION,
    })
    expect(res.statusCode).toBe(409)
    expect(res.body).toMatchObject({ type: "auto_renew_not_available" })
    expect(svc.updateSubscriptions).not.toHaveBeenCalled()
    expect((svc.store.get(id) as FakeRow).auto_renew_approved).toBe(false)
  })

  it("disable on a legacy fixed-horizon row is the service's 409 auto_renew_not_on", async () => {
    const { scope, token, svc } = await setup()
    const res = await post(scope, token, { action: "disable_auto_renew", subscription_id: "sub_legacy", csrf: csrfOf(token) })
    expect(res.statusCode).toBe(409)
    expect(res.body).toMatchObject({ type: "auto_renew_not_on" })
    expect(svc.updateSubscriptions).not.toHaveBeenCalled()
  })

  it("cancel runs manageSubscriptionWorkflow with the request scope, as the store route does", async () => {
    const { scope, token } = await setup()
    const res = await post(scope, token, { action: "cancel", subscription_id: "sub_legacy", csrf: csrfOf(token) })
    expect(res.statusCode).toBe(200)
    expect(manageSubscriptionWorkflow).toHaveBeenCalledWith(scope)
    expect(manageRun).toHaveBeenCalledWith({
      input: { subscription_id: "sub_legacy", action: "cancel", reason: undefined },
    })
  })

  it("cancel of an already-ended row is 409 and runs nothing", async () => {
    const { scope, token } = await setup()
    const res = await post(scope, token, { action: "cancel", subscription_id: "sub_done", csrf: csrfOf(token) })
    expect(res.statusCode).toBe(409)
    expect(res.body).toMatchObject({ type: "subscription_transition_not_allowed" })
    expect(manageRun).not.toHaveBeenCalled()
  })

  it("pause/resume are not offered here (400)", async () => {
    const { scope, token, svc } = await setup()
    for (const action of ["pause", "resume"]) {
      const res = await post(scope, token, { action, subscription_id: "sub_on", csrf: csrfOf(token) })
      expect(res.statusCode).toBe(400)
    }
    expect(svc.updateSubscriptions).not.toHaveBeenCalled()
    expect(manageRun).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
describe("POST manage page — ownership", () => {
  it.each([
    ["another member's subscription", "sub_other"],
    ["another customer's unstamped (storefront) subscription", "sub_other_storefront"],
    ["a row on this customer bought by another Blackout member", "sub_restamped"],
    ["an unstamped (storefront) row on this member's own customer", "sub_mine_storefront"],
    ["a row stamped with this member's id on another customer", "sub_mine_elsewhere"],
    ["an id that does not exist", "sub_missing"],
  ])("%s is the one forbidden() 403 and writes nothing", async (_label, id) => {
    const { scope, token, svc } = await setup()
    for (const action of ["disable_auto_renew", "cancel"]) {
      const res = await post(scope, token, { action, subscription_id: id, csrf: csrfNonceFor(token) })
      expect(res.statusCode).toBe(403)
      expect(res.body).toEqual({ message: "You do not have access to this record.", type: "not_allowed" })
    }
    expect(svc.updateSubscriptions).not.toHaveBeenCalled()
    expect(manageRun).not.toHaveBeenCalled()
  })

  it("a session bound to no customer owns nothing — not even a row with no customer", async () => {
    const { scope, token, svc } = await setup({ customers: [] })
    for (const id of ["sub_on", "sub_orphan"]) {
      const res = await post(scope, token, { action: "cancel", subscription_id: id, csrf: csrfNonceFor(token) })
      expect(res.statusCode).toBe(403)
    }
    expect(svc.updateSubscriptions).not.toHaveBeenCalled()
    expect(manageRun).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
describe("POST manage page — CSRF", () => {
  const json = { "content-type": "application/json" }

  it.each([
    ["Sec-Fetch-Site cross-site", { ...json, "sec-fetch-site": "cross-site" }],
    ["Sec-Fetch-Site same-site", { ...json, "sec-fetch-site": "same-site" }],
    ["Sec-Fetch-Site none", { ...json, "sec-fetch-site": "none" }],
    ["cross-site even with FBM's Origin", { ...json, "sec-fetch-site": "cross-site", origin: FBM_BASE }],
    ["no Fetch Metadata and no Origin", { ...json }],
    ["no Fetch Metadata, a foreign Origin", { ...json, origin: "https://app.theblackout.app" }],
    ["no Fetch Metadata, only a same-host Referer", { ...json, referer: `${FBM_BASE}/x` }],
    ["a form post", { "sec-fetch-site": "same-origin", "content-type": "application/x-www-form-urlencoded" }],
    ["text/plain", { "sec-fetch-site": "same-origin", "content-type": "text/plain" }],
    ["no content type", { "sec-fetch-site": "same-origin" }],
  ])("%s → 403 csrf_rejected, nothing read or written", async (_label, headers) => {
    const { scope, token, svc } = await setup()
    const res = await post(
      scope,
      token,
      { action: "cancel", subscription_id: "sub_on", csrf: csrfNonceFor(token) },
      headers as Record<string, string>
    )
    expect(res.statusCode).toBe(403)
    expect(res.body).toMatchObject({ code: "csrf_rejected" })
    expect(svc.listSubscriptions).not.toHaveBeenCalled()
    expect(manageRun).not.toHaveBeenCalled()
  })

  it("a wrong, missing or other session's nonce → 403 csrf_rejected", async () => {
    const { scope, token, service, svc } = await setup()
    const other = await mint({
      service,
      pg: makePg([{ id: "cus_b", metadata: { blackout_user_id: "blk_b" } }]),
      body: { blackout_user_id: "blk_b" },
    })
    for (const csrf of [undefined, "", "wrong", token, csrfNonceFor(other.token as string)]) {
      const res = await post(scope, token, { action: "cancel", subscription_id: "sub_on", csrf })
      expect(res.statusCode).toBe(403)
      expect(res.body).toMatchObject({ code: "csrf_rejected" })
    }
    expect(svc.listSubscriptions).not.toHaveBeenCalled()
    expect(manageRun).not.toHaveBeenCalled()
  })

  it("no Fetch Metadata but an Origin equal to FBM's own origin is accepted", async () => {
    const { scope, token } = await setup()
    const res = await post(
      scope,
      token,
      { action: "cancel", subscription_id: "sub_on", csrf: csrfNonceFor(token) },
      { "content-type": "application/json; charset=utf-8", origin: FBM_BASE }
    )
    expect(res.statusCode).toBe(200)
    expect(manageRun).toHaveBeenCalledTimes(1)
  })

  it("an expired session cannot act (401), even from the page", async () => {
    const s = await setup()
    s.service.sessions[0].expires_at = new Date(Date.now() - 1)
    const res = await post(s.scope, s.token, { action: "cancel", subscription_id: "sub_on", csrf: csrfNonceFor(s.token) })
    expect(res.statusCode).toBe(401)
    expect(manageRun).not.toHaveBeenCalled()
  })

  it.each([
    ["FBM_BLACKOUT_INTEGRATION", () => delete process.env.FBM_BLACKOUT_INTEGRATION],
    ["FF_CONSUMER_SUBSCRIPTIONS_V1", () => delete process.env[FLAG]],
  ])("%s off: 404 feature_disabled, nothing done", async (_label, flip) => {
    const { scope, token, svc } = await setup()
    flip()
    const res = await post(scope, token, { action: "cancel", subscription_id: "sub_on", csrf: csrfNonceFor(token) })
    expect(res.statusCode).toBe(404)
    expect(res.body).toMatchObject({ code: "feature_disabled" })
    expect(svc.listSubscriptions).not.toHaveBeenCalled()
    expect(manageRun).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
describe("renewalPrice — what a renewal of the row charges", () => {
  const cart = (items: Array<Record<string, unknown>>, currency_code: string | null = "usd") => ({
    currency_code,
    items,
  })

  it("sums the template cart's unit prices at the subscription's quantity, as buildRenewalCartInput does", () => {
    expect(renewalPrice({ id: "s", quantity: 1, cart: cart([{ variant_id: "v", quantity: 1, unit_price: 7.5 }]) })).toBe("$7.50")
    expect(renewalPrice({ id: "s", quantity: 2, cart: cart([{ variant_id: "v", quantity: 1, unit_price: 7.5 }]) })).toBe("$15.00")
  })

  it("unknown → null: no cart, no currency, no lines, a line without a unit price, a zero total", () => {
    expect(renewalPrice({ id: "s", cart: null })).toBeNull()
    expect(renewalPrice({ id: "s", cart: cart([{ variant_id: "v", unit_price: 5 }], null) })).toBeNull()
    expect(renewalPrice({ id: "s", cart: cart([]) })).toBeNull()
    expect(renewalPrice({ id: "s", cart: cart([{ variant_id: "v", quantity: 1 }]) })).toBeNull()
    expect(renewalPrice({ id: "s", cart: cart([{ variant_id: "v", quantity: 1, unit_price: 0 }]) })).toBeNull()
  })
})
