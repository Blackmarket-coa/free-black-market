/**
 * Creator attribution on order.placed.
 *
 * The live failure this locks out: `POST /store/carts/:id/attribution` writes
 * `fbm_short_code` and `fbm_visitor_token` onto the CART, on its own stated
 * expectation that they "propagate to order.metadata at completion". On FBM's
 * main checkout path they do not — `splitAndCompleteCartWorkflow` drops cart
 * metadata (D9-5) — and this subscriber read `order.metadata` directly.
 *
 * So last-click affiliate attribution never happened there: a creator whose
 * link drove the sale earned nothing. Promo-code attribution kept working,
 * because it reads `order.promotions`, a real relation — which is why the
 * failure looked like "affiliate links convert badly" rather than a bug.
 */
import handler from "../attribute-order-on-placed"
import { CREATOR_ATTRIBUTION_MODULE } from "../../modules/creator-attribution"
import { MARKETPLACE_WEBHOOKS_MODULE } from "../../modules/marketplace-webhooks"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

jest.mock("../../lib/blackout-identity", () => ({
  resolveCustomerMxid: jest.fn(async () => null),
  resolveSellerIdByMxid: jest.fn(async () => null),
  resolveSellerBlackoutUserId: jest.fn(async () => null),
}))

const makeContainer = (opts: {
  orderMetadata?: Record<string, unknown> | null
  cartMetadata?: Record<string, unknown>
  cartId?: string | null
  graphThrows?: boolean
}) => {
  const attributionService = {
    // Returning null keeps the test on the one thing it is about: what this
    // subscriber hands the service. Everything past that point is the
    // service's own logic and has its own tests.
    attributeOrder: jest.fn(async () => null),
    holdAttribution: jest.fn(async () => null),
  }

  const graph = jest.fn(async ({ entity }: { entity: string }) => {
    if (entity === "order") {
      return {
        data: [
          {
            id: "order_1",
            subtotal: 5000,
            total: 5000,
            currency_code: "usd",
            customer_id: "cus_1",
            metadata: opts.orderMetadata ?? {},
            promotions: [],
          },
        ],
      }
    }
    if (opts.graphThrows) throw new Error("link table missing")
    if (entity === "order_set") {
      return {
        data: opts.cartId === null ? [] : [{ cart_id: opts.cartId ?? "cart_1" }],
      }
    }
    if (entity === "cart") return { data: [{ metadata: opts.cartMetadata ?? {} }] }
    throw new Error(`unexpected entity ${entity}`)
  })

  const container = {
    resolve: (key: string) => {
      if (key === CREATOR_ATTRIBUTION_MODULE) return attributionService
      if (key === MARKETPLACE_WEBHOOKS_MODULE) return null
      if (key === "query" || key === ContainerRegistrationKeys.QUERY) {
        return { graph }
      }
      throw new Error(`unresolvable: ${String(key)}`)
    },
  }

  return { container, attributionService }
}

const run = (container: unknown) =>
  handler({ event: { data: { id: "order_1" } }, container } as never)

describe("attribute-order-on-placed", () => {
  it("recovers the affiliate keys the checkout path dropped from the order", async () => {
    const { container, attributionService } = makeContainer({
      orderMetadata: {},
      cartMetadata: {
        fbm_visitor_token: "vis_abc",
        fbm_short_code: "CREATOR7",
      },
    })

    await run(container)

    expect(attributionService.attributeOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: "order_1",
        visitorToken: "vis_abc",
        shortCode: "CREATOR7",
      })
    )
  })

  it("prefers the order's own stamp over the cart's", async () => {
    const { container, attributionService } = makeContainer({
      orderMetadata: { fbm_short_code: "ONORDER" },
      cartMetadata: { fbm_short_code: "ONCART", fbm_visitor_token: "vis_abc" },
    })

    await run(container)

    // The order wins on the key it carries; the cart still supplies the key
    // the order does not have. A partial stamp must not discard the rest —
    // see the every-key short-circuit in lib/cart-metadata-recovery.ts.
    expect(attributionService.attributeOrder).toHaveBeenCalledWith(
      expect.objectContaining({ shortCode: "ONORDER", visitorToken: "vis_abc" })
    )
  })

  it("passes nulls when neither carries the keys", async () => {
    const { container, attributionService } = makeContainer({
      orderMetadata: {},
      cartMetadata: {},
    })

    await run(container)

    expect(attributionService.attributeOrder).toHaveBeenCalledWith(
      expect.objectContaining({ visitorToken: null, shortCode: null })
    )
  })

  it("still attributes when the cart cannot be reached", async () => {
    // Recovery is best-effort: promo-code attribution does not depend on it,
    // so a failed cart read must not skip the call entirely.
    const { container, attributionService } = makeContainer({
      orderMetadata: {},
      graphThrows: true,
    })

    await run(container)

    expect(attributionService.attributeOrder).toHaveBeenCalledTimes(1)
  })

  it("does not attribute an order with no subtotal", async () => {
    const { container, attributionService } = makeContainer({
      orderMetadata: {},
      cartMetadata: { fbm_short_code: "CREATOR7" },
    })
    const graphing = container.resolve("query") as {
      graph: jest.Mock
    }
    graphing.graph.mockImplementationOnce(async () => ({
      data: [{ id: "order_1", subtotal: 0, total: 0, promotions: [] }],
    }))

    await run(container)

    expect(attributionService.attributeOrder).not.toHaveBeenCalled()
  })
})
