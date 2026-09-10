/**
 * Donation accrual on order.placed.
 *
 * The live failure this locks out: the storefront writes donation
 * preferences onto the CART, FBM's main checkout path drops cart metadata,
 * and this subscriber read `order.metadata` directly — so `beneficiaryId`
 * was always "" and the early-return fired. A buyer who chose to donate had
 * their donation silently never accrued; nothing errored, the beneficiary's
 * balance simply never moved. D9-5 in docs/AUDIT_DEBT.md.
 */
import handler from "../donation-order-accrued"
import { DONATION_MODULE } from "../../modules/donation"
import { TENANCY_MODULE } from "../../modules/tenancy"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

const BENEFICIARY = { id: "ben_1", metadata: { accrued_balance: 100 } }

const makeContainer = (opts: {
  orderMetadata?: Record<string, unknown> | null
  cartMetadata?: Record<string, unknown>
  cartId?: string | null
}) => {
  const donationService = {
    retrieveDonationBeneficiary: jest.fn(async () => ({ ...BENEFICIARY })),
    updateDonationBeneficiaries: jest.fn(async () => ({})),
  }
  const tenancyService = {
    resolveContext: jest.fn(async () => ({ tier: "tier2_partner" })),
    featureGatesForTier: jest.fn(() => ({ donation_routing: true })),
  }
  const orderService = {
    retrieveOrder: jest.fn(async () => ({
      id: "order_1",
      currency_code: "usd",
      metadata: opts.orderMetadata ?? {},
    })),
  }
  const graph = jest.fn(async ({ entity }: { entity: string }) => {
    if (entity === "order_set") {
      return { data: opts.cartId === null ? [] : [{ cart_id: opts.cartId ?? "cart_1" }] }
    }
    if (entity === "cart") return { data: [{ metadata: opts.cartMetadata ?? {} }] }
    throw new Error(`unexpected entity ${entity}`)
  })

  const container = {
    resolve: (key: string) => {
      if (key === DONATION_MODULE) return donationService
      if (key === TENANCY_MODULE) return tenancyService
      if (key === "order") return orderService
      if (key === ContainerRegistrationKeys.QUERY) return { graph }
      throw new Error(`unresolvable: ${String(key)}`)
    },
  }

  return { container, donationService, tenancyService }
}

const run = (container: unknown) =>
  handler({ event: { data: { id: "order_1" } }, container } as never)

describe("donation-order-accrued", () => {
  it("accrues a donation the checkout path dropped from the order", async () => {
    const { container, donationService } = makeContainer({
      orderMetadata: {},
      cartMetadata: {
        donation_total: 500,
        donation_beneficiary_id: "ben_1",
        storefront_id: "sf_1",
      },
    })

    await run(container)

    expect(donationService.updateDonationBeneficiaries).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "ben_1",
        metadata: expect.objectContaining({ accrued_balance: 600 }),
      })
    )
  })

  it("still accrues when the order did carry the metadata", async () => {
    // The completion routes that wrap Medusa's own workflow propagate fine
    // and must keep working.
    const { container, donationService } = makeContainer({
      orderMetadata: {
        donation_total: 250,
        donation_beneficiary_id: "ben_1",
        storefront_id: "sf_1",
      },
    })

    await run(container)

    expect(donationService.updateDonationBeneficiaries).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ accrued_balance: 350 }),
      })
    )
  })

  it("does nothing when there is no donation on either the order or the cart", async () => {
    const { container, donationService } = makeContainer({
      orderMetadata: {},
      cartMetadata: {},
    })

    await run(container)

    expect(donationService.updateDonationBeneficiaries).not.toHaveBeenCalled()
  })

  it("does nothing for a zero donation", async () => {
    const { container, donationService } = makeContainer({
      orderMetadata: {},
      cartMetadata: { donation_total: 0, donation_beneficiary_id: "ben_1" },
    })

    await run(container)

    expect(donationService.updateDonationBeneficiaries).not.toHaveBeenCalled()
  })

  it("respects the tier gate on donation routing", async () => {
    const { container, donationService, tenancyService } = makeContainer({
      orderMetadata: {},
      cartMetadata: {
        donation_total: 500,
        donation_beneficiary_id: "ben_1",
        storefront_id: "sf_1",
      },
    })
    tenancyService.featureGatesForTier.mockReturnValue({ donation_routing: false })

    await run(container)

    expect(donationService.updateDonationBeneficiaries).not.toHaveBeenCalled()
  })
})
