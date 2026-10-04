import PayoutBreakdownService from "../service"

/**
 * Service-level cover for the fee chain and the settings writer, using the
 * `Object.create(Service.prototype)` + patched-CRUD pattern from
 * `modules/entitlement/__tests__/entitlement-service.unit.spec.ts`. The
 * precedence rule itself is covered purely in `fee-resolution.unit.spec.ts`;
 * what matters here is that the service reads and writes the right rows.
 */

type SettingsRow = {
  id: string
  seller_id: string
  custom_platform_fee_percent?: number | null
  fee_reduction_reason?: string | null
  fee_reduction_expires_at?: Date | null
}

const makeService = (opts: {
  defaultPercent?: number
  pluginDeveloperPercent?: number
  referralPercent?: number
  settings?: SettingsRow[]
}) => {
  // Read-only on the generated service type, so the harness holds a plain
  // record and is cast back once the CRUD stubs are in place.
  const svc = Object.create(
    PayoutBreakdownService.prototype
  ) as Record<string, unknown>

  const rows: SettingsRow[] = [...(opts.settings ?? [])]
  const created: Record<string, unknown>[] = []
  const updated: Record<string, unknown>[] = []
  const storedBreakdowns: Record<string, unknown>[] = []

  svc.listPayoutConfigs = (async () => [
    {
      id: "pc_1",
      is_default: true,
      platform_fee_percent: opts.defaultPercent ?? 3,
      plugin_developer_percent: opts.pluginDeveloperPercent ?? 0,
      referral_percent: opts.referralPercent ?? 0,
    },
  ]) as never

  svc.listSellerPayoutSettings = (async (filters: { seller_id?: string }) =>
    rows.filter((r) => !filters?.seller_id || r.seller_id === filters.seller_id)) as never

  svc.createSellerPayoutSettings = (async (data: Record<string, unknown>) => {
    const row = { id: `sps_${rows.length + 1}`, ...data } as SettingsRow
    rows.push(row)
    created.push(data)
    return row
  }) as never

  svc.updateSellerPayoutSettings = (async (data: Record<string, unknown>) => {
    updated.push(data)
    const row = rows.find((r) => r.id === data.id)
    if (row) Object.assign(row, data)
    return row
  }) as never

  // The stored-breakdown table, so storeOrderBreakdown -> getOrderBreakdown
  // can be exercised as a round trip through the real service methods.
  svc.createOrderPayoutBreakdowns = (async (data: Record<string, unknown>) => {
    const row = { id: `opb_${storedBreakdowns.length + 1}`, ...data }
    storedBreakdowns.push(row)
    return row
  }) as never
  svc.listOrderPayoutBreakdowns = (async (filters: { order_id?: string }) =>
    storedBreakdowns.filter(
      (r) => !filters?.order_id || r.order_id === filters.order_id
    )) as never

  return {
    svc: svc as unknown as PayoutBreakdownService,
    rows,
    created,
    updated,
    storedBreakdowns,
  }
}

describe("getPlatformFeeDetail", () => {
  it("returns the platform default for a seller with no settings row", async () => {
    // The default state for every seller today — createSellerPayoutSettings had
    // no call site, so no row has ever been written.
    const { svc } = makeService({ defaultPercent: 3 })
    const fee = await svc.getPlatformFeeDetail("sel_1")

    expect(fee.percent).toBe(3)
    expect(fee.source).toBe("platform_default")
  })

  it("applies the plan rate when one is supplied", async () => {
    const { svc } = makeService({ defaultPercent: 3 })
    const fee = await svc.getPlatformFeeDetail("sel_1", 6)

    expect(fee.percent).toBe(6)
    expect(fee.source).toBe("plan")
  })

  it("lets a negotiated override beat the plan", async () => {
    const { svc } = makeService({
      defaultPercent: 3,
      settings: [
        {
          id: "sps_1",
          seller_id: "sel_1",
          custom_platform_fee_percent: 1,
          fee_reduction_reason: "pilot",
        },
      ],
    })
    const fee = await svc.getPlatformFeeDetail("sel_1", 6)

    expect(fee.percent).toBe(1)
    expect(fee.source).toBe("seller_override")
  })

  it("does not leak one seller's override to another", async () => {
    const { svc } = makeService({
      defaultPercent: 3,
      settings: [
        { id: "sps_1", seller_id: "sel_1", custom_platform_fee_percent: 1 },
      ],
    })
    expect((await svc.getPlatformFeeDetail("sel_2")).percent).toBe(3)
  })
})

describe("getPlatformFeeDetail transaction kind", () => {
  // Through the real service and the real resolver — NOT the hand stubs in
  // api/admin/sellers/__tests__/payout-settings-route.unit.spec.ts or
  // hawala-ledger/__tests__/consignment-split.unit.spec.ts, which re-implement
  // the chain and would stay green whatever the service did with `kind`.
  const contested = {
    defaultPercent: 3,
    settings: [
      {
        id: "sps_1",
        seller_id: "sel_1",
        custom_platform_fee_percent: 1,
        fee_reduction_reason: "pilot",
      },
    ],
  }

  it("charges 0 on a donation for a seller holding an override AND a plan", async () => {
    const { svc } = makeService(contested)
    const fee = await svc.getPlatformFeeDetail("sel_1", 6, "donation")

    expect(fee.percent).toBe(0)
    expect(fee.source).toBe("transaction_kind")
    expect(fee.override_reason).toBeNull()
  })

  it("charges 0 on a donation pledge the same way", async () => {
    const { svc } = makeService(contested)
    const fee = await svc.getPlatformFeeDetail("sel_1", 6, "donation_pledge")

    expect(fee.percent).toBe(0)
    expect(fee.source).toBe("transaction_kind")
  })

  it("resolves a sale exactly as the two-argument call does", async () => {
    const { svc } = makeService(contested)
    const explicit = await svc.getPlatformFeeDetail("sel_1", 6, "sale")
    const historical = await svc.getPlatformFeeDetail("sel_1", 6)

    expect(explicit).toEqual(historical)
    expect(explicit.percent).toBe(1)
    expect(explicit.source).toBe("seller_override")
  })

  it("forwards the kind through getEffectivePlatformFee too", async () => {
    const { svc } = makeService(contested)
    expect(await svc.getEffectivePlatformFee("sel_1", 6, "donation")).toBe(0)
    expect(await svc.getEffectivePlatformFee("sel_1", 6, "sale")).toBe(1)
  })

  it("keeps a seller's negotiated 0 distinct from a donation's 0", async () => {
    const { svc } = makeService({ defaultPercent: 3 })
    await svc.upsertSellerSettings("sel_1", { custom_platform_fee_percent: 0 })

    const concession = await svc.getPlatformFeeDetail("sel_1", 6)
    const donation = await svc.getPlatformFeeDetail("sel_1", 6, "donation")
    expect(concession.percent).toBe(0)
    expect(donation.percent).toBe(0)
    expect(concession.source).toBe("seller_override")
    expect(donation.source).toBe("transaction_kind")
  })
})

describe("getEffectivePlatformFee", () => {
  it("keeps its historical single-argument behaviour", async () => {
    // Callers that have not been updated must keep resolving exactly as before:
    // override, else platform default. No plan tier, no surprise change.
    const { svc } = makeService({
      defaultPercent: 3,
      settings: [
        { id: "sps_1", seller_id: "sel_1", custom_platform_fee_percent: 2 },
      ],
    })

    expect(await svc.getEffectivePlatformFee("sel_1")).toBe(2)
    expect(await svc.getEffectivePlatformFee("sel_2")).toBe(3)
  })
})

describe("upsertSellerSettings", () => {
  it("creates the row that never had a writer", async () => {
    const { svc, created } = makeService({ defaultPercent: 3 })
    await svc.upsertSellerSettings("sel_1", {
      custom_platform_fee_percent: 1.5,
      fee_reduction_reason: "negotiated",
    })

    expect(created).toHaveLength(1)
    expect(created[0]).toMatchObject({
      seller_id: "sel_1",
      custom_platform_fee_percent: 1.5,
    })
    expect((await svc.getPlatformFeeDetail("sel_1")).percent).toBe(1.5)
  })

  it("updates in place rather than creating a second row", async () => {
    // seller_id is unique; a second insert would fail on the constraint.
    const { svc, created, updated } = makeService({
      defaultPercent: 3,
      settings: [
        { id: "sps_1", seller_id: "sel_1", custom_platform_fee_percent: 2 },
      ],
    })
    await svc.upsertSellerSettings("sel_1", { custom_platform_fee_percent: 1 })

    expect(created).toHaveLength(0)
    expect(updated).toHaveLength(1)
    expect((await svc.getPlatformFeeDetail("sel_1")).percent).toBe(1)
  })

  it("touches only the fields it was given", async () => {
    // Setting an expiry must not silently clear the reason it was granted for.
    const { svc, updated } = makeService({
      defaultPercent: 3,
      settings: [
        {
          id: "sps_1",
          seller_id: "sel_1",
          custom_platform_fee_percent: 2,
          fee_reduction_reason: "pilot",
        },
      ],
    })
    await svc.upsertSellerSettings("sel_1", {
      fee_reduction_expires_at: new Date("2027-01-01"),
    })

    expect(updated[0]).not.toHaveProperty("fee_reduction_reason")
    const fee = await svc.getPlatformFeeDetail("sel_1")
    expect(fee.override_reason).toBe("pilot")
  })
})

describe("clearSellerFeeOverride", () => {
  it("returns the seller to their plan's rate", async () => {
    const { svc } = makeService({
      defaultPercent: 3,
      settings: [
        {
          id: "sps_1",
          seller_id: "sel_1",
          custom_platform_fee_percent: 1,
          fee_reduction_reason: "pilot",
          fee_reduction_expires_at: new Date("2027-01-01"),
        },
      ],
    })
    await svc.clearSellerFeeOverride("sel_1")

    const fee = await svc.getPlatformFeeDetail("sel_1", 6)
    expect(fee.percent).toBe(6)
    expect(fee.source).toBe("plan")
    expect(fee.override_expired).toBe(false)
  })

  it("is distinct from setting the rate to zero", async () => {
    const { svc } = makeService({ defaultPercent: 3 })
    await svc.upsertSellerSettings("sel_1", { custom_platform_fee_percent: 0 })

    const zeroed = await svc.getPlatformFeeDetail("sel_1", 6)
    expect(zeroed.percent).toBe(0)
    expect(zeroed.source).toBe("seller_override")

    await svc.clearSellerFeeOverride("sel_1")
    expect((await svc.getPlatformFeeDetail("sel_1", 6)).percent).toBe(6)
  })
})

describe("calculateBreakdown", () => {
  it("charges the plan rate the caller supplied", async () => {
    const { svc } = makeService({ defaultPercent: 3 })
    const result = await svc.calculateBreakdown({
      subtotal: 10_000,
      sellerId: "sel_1",
      planFeePercentBySeller: { sel_1: 6 },
    })

    expect(result.totals.platformFees).toBe(600)
    expect(result.sellerBreakdown[0].net).toBe(9_400)
  })

  it("falls back to the platform default when no plan rate is supplied", async () => {
    const { svc } = makeService({ defaultPercent: 3 })
    const result = await svc.calculateBreakdown({
      subtotal: 10_000,
      sellerId: "sel_1",
    })

    expect(result.totals.platformFees).toBe(300)
  })

  it("carves the plugin developer share out of the platform fee", async () => {
    const { svc } = makeService({ defaultPercent: 3, pluginDeveloperPercent: 1 })
    const result = await svc.calculateBreakdown({
      subtotal: 10_000,
      sellerId: "sel_1",
      pluginsBySeller: {
        sel_1: [{ slug: "analytics", author_seller_id: "sel_dev" }],
      },
    })

    // The seller's net is byte-for-byte what it would be with no plugins
    // installed — the share comes out of the platform's 300, not theirs.
    expect(result.sellerBreakdown[0].net).toBe(9_700)
    expect(result.totals.platformFees).toBe(300)
    expect(result.totals.pluginDeveloperShare).toBe(100)
    expect(result.pluginShareAllocations).toEqual([
      {
        slug: "analytics",
        author_seller_id: "sel_dev",
        amount_cents: 100,
        sellerId: "sel_1",
      },
    ])
  })

  it("computes no share when none is configured", async () => {
    const { svc } = makeService({ defaultPercent: 3 })
    const result = await svc.calculateBreakdown({
      subtotal: 10_000,
      sellerId: "sel_1",
      pluginsBySeller: {
        sel_1: [{ slug: "analytics", author_seller_id: "sel_dev" }],
      },
    })

    expect(result.totals.pluginDeveloperShare).toBe(0)
    expect(result.pluginShareAllocations).toEqual([])
  })

  it("attributes each allocation to the seller whose order funded it", async () => {
    const { svc } = makeService({ defaultPercent: 3, pluginDeveloperPercent: 1 })
    const result = await svc.calculateBreakdown({
      subtotal: 20_000,
      sellerBreakdown: [
        { sellerId: "sel_1", subtotal: 10_000 },
        { sellerId: "sel_2", subtotal: 10_000 },
      ],
      pluginsBySeller: {
        sel_1: [{ slug: "a", author_seller_id: "sel_dev_a" }],
        sel_2: [{ slug: "b", author_seller_id: "sel_dev_b" }],
      },
    })

    expect(result.pluginShareAllocations.map((a) => a.sellerId)).toEqual([
      "sel_1",
      "sel_2",
    ])
    expect(result.totals.pluginDeveloperShare).toBe(200)
  })

  it("applies each seller's own rate on a multi-seller order", async () => {
    const { svc } = makeService({ defaultPercent: 3 })
    const result = await svc.calculateBreakdown({
      subtotal: 20_000,
      sellerBreakdown: [
        { sellerId: "sel_1", subtotal: 10_000 },
        { sellerId: "sel_2", subtotal: 10_000 },
      ],
      planFeePercentBySeller: { sel_1: 6, sel_2: 2 },
    })

    expect(result.sellerBreakdown[0].fees).toBe(600)
    expect(result.sellerBreakdown[1].fees).toBe(200)
    expect(result.totals.platformFees).toBe(800)
  })

  it("carves the referral share out of the platform fee, not the seller's net", async () => {
    const { svc } = makeService({ defaultPercent: 3, referralPercent: 1 })
    const result = await svc.calculateBreakdown({
      subtotal: 10_000,
      sellerId: "sel_referred",
      referralBySeller: { sel_referred: { referrer_seller_id: "sel_referrer" } },
    })

    // Seller net unchanged; the 100-cent share comes out of the platform's 300.
    expect(result.sellerBreakdown[0].net).toBe(9_700)
    expect(result.totals.platformFees).toBe(300)
    expect(result.totals.referralShare).toBe(100)
    expect(result.referralShareAllocations).toEqual([
      {
        referrer_seller_id: "sel_referrer",
        referred_seller_id: "sel_referred",
        amount_cents: 100,
        sellerId: "sel_referred",
      },
    ])
  })

  it("computes no referral share when none is configured", async () => {
    const { svc } = makeService({ defaultPercent: 3 })
    const result = await svc.calculateBreakdown({
      subtotal: 10_000,
      sellerId: "sel_referred",
      referralBySeller: { sel_referred: { referrer_seller_id: "sel_referrer" } },
    })
    expect(result.totals.referralShare).toBe(0)
    expect(result.referralShareAllocations).toEqual([])
  })

  it("funds plugin and referral shares from the ONE platform fee without overspending it", async () => {
    // Both carve from the same 300-cent fee. Plugin (1%) takes 100 first;
    // referral (1%) takes 100 from the 200 that remain; platform keeps 100.
    // The seller's net is untouched by either.
    const { svc } = makeService({
      defaultPercent: 3,
      pluginDeveloperPercent: 1,
      referralPercent: 1,
    })
    const result = await svc.calculateBreakdown({
      subtotal: 10_000,
      sellerId: "sel_referred",
      pluginsBySeller: {
        sel_referred: [{ slug: "analytics", author_seller_id: "sel_dev" }],
      },
      referralBySeller: { sel_referred: { referrer_seller_id: "sel_referrer" } },
    })

    expect(result.sellerBreakdown[0].net).toBe(9_700)
    expect(result.totals.platformFees).toBe(300)
    expect(result.totals.pluginDeveloperShare).toBe(100)
    expect(result.totals.referralShare).toBe(100)
    // Plugin + referral never exceed the fee: 100 + 100 ≤ 300.
    expect(
      result.totals.pluginDeveloperShare + result.totals.referralShare
    ).toBeLessThanOrEqual(result.totals.platformFees)
  })

  it("caps the referral share at what the plugin share left, never the whole fee", async () => {
    // Plugin takes 2% = 200 of the 300 fee; referral wants 2% = 200 but only
    // 100 remains, so it is capped to 100 rather than promising uncollected money.
    const { svc } = makeService({
      defaultPercent: 3,
      pluginDeveloperPercent: 2,
      referralPercent: 2,
    })
    const result = await svc.calculateBreakdown({
      subtotal: 10_000,
      sellerId: "sel_referred",
      pluginsBySeller: {
        sel_referred: [{ slug: "analytics", author_seller_id: "sel_dev" }],
      },
      referralBySeller: { sel_referred: { referrer_seller_id: "sel_referrer" } },
    })

    expect(result.totals.pluginDeveloperShare).toBe(200)
    expect(result.totals.referralShare).toBe(100)
    expect(
      result.totals.pluginDeveloperShare + result.totals.referralShare
    ).toBe(result.totals.platformFees)
  })

  it("never pays a referral share to the selling seller (self-referral)", async () => {
    const { svc } = makeService({ defaultPercent: 3, referralPercent: 1 })
    const result = await svc.calculateBreakdown({
      subtotal: 10_000,
      sellerId: "sel_referred",
      referralBySeller: { sel_referred: { referrer_seller_id: "sel_referred" } },
    })
    expect(result.totals.referralShare).toBe(0)
    expect(result.referralShareAllocations).toEqual([])
  })

  it("never lets a tip enter the fee base", async () => {
    // Tips are kept out of the platform fee by construction: the fee is taken
    // on `seller.subtotal`, and the tip is not part of it. This pins that as
    // the ONE mechanism for tips — the resolver's `kind: "tip"` has no caller,
    // and a second mechanism here is how a tip ends up both excluded and
    // classified.
    const { svc } = makeService({ defaultPercent: 3 })
    const withTip = await svc.calculateBreakdown({
      subtotal: 10_000,
      tip: 2_000,
      sellerId: "sel_1",
    })
    const without = await svc.calculateBreakdown({
      subtotal: 10_000,
      sellerId: "sel_1",
    })

    // Same fee with and without the tip: 3% of 10 000, not of 12 000.
    expect(withTip.totals.platformFees).toBe(300)
    expect(withTip.totals.platformFees).toBe(without.totals.platformFees)
    expect(withTip.sellerBreakdown[0].fees).toBe(without.sellerBreakdown[0].fees)
    // The tip reaches the producer whole.
    expect(withTip.totals.tip).toBe(2_000)
    expect(withTip.totals.toProducers).toBe(without.totals.toProducers + 2_000)
    expect(withTip.totals.customerPaid).toBe(12_000)
  })

  describe("donation", () => {
    // No live caller passes `donation` yet (that is a later slice); these pin
    // the shape it will get: fee on the goods only, producers never credited
    // with it, the org named as recipient.
    const order = {
      subtotal: 10_000,
      donation: 1_500,
      donationRecipientName: "Ground Up Liberation Project",
      sellerId: "sel_1",
      sellerBreakdown: [
        { sellerId: "sel_1", subtotal: 10_000, sellerName: "Maria's Farm" },
      ],
    }

    it("computes the platform fee on the subtotal only", async () => {
      const { svc } = makeService({ defaultPercent: 3 })
      const result = await svc.calculateBreakdown(order)

      // 3% of 10 000, not of 11 500.
      expect(result.totals.platformFees).toBe(300)
      expect(result.sellerBreakdown[0].fees).toBe(300)
      expect(result.sellerBreakdown[0].gross).toBe(10_000)
    })

    it("never credits the donation to producers", async () => {
      const { svc } = makeService({ defaultPercent: 3 })
      const withDonation = await svc.calculateBreakdown(order)
      const without = await svc.calculateBreakdown({
        ...order,
        donation: undefined,
        donationRecipientName: undefined,
      })

      expect(withDonation.totals.toProducers).toBe(9_700)
      expect(withDonation.totals.toProducers).toBe(without.totals.toProducers)
      expect(withDonation.sellerBreakdown[0].net).toBe(9_700)
      // The customer did pay it, so it is in what they paid.
      expect(withDonation.totals.customerPaid).toBe(11_500)
      expect(withDonation.totals.donation).toBe(1_500)
    })

    it("names the organisation, not the producer, as the DONATION recipient", async () => {
      const { svc } = makeService({ defaultPercent: 3 })
      const result = await svc.calculateBreakdown(order)

      const line = result.items.find((i) => i.type === "DONATION")
      expect(line).toBeDefined()
      expect(line?.amount).toBe(1_500)
      expect(line?.recipient).toBe("Ground Up Liberation Project")
      expect(line?.recipient).not.toBe("Maria's Farm")
      expect(line?.label).toBe("Donation")
      expect(line?.description).toContain("not the producer")
      expect(line?.description).toContain("0% platform fee")
      // The PRODUCER_PRICE line is the goods net, untouched by the donation.
      const producer = result.items.find((i) => i.type === "PRODUCER_PRICE")
      expect(producer?.amount).toBe(9_700)
      expect(producer?.recipient).toBe("Maria's Farm")
    })

    it("emits no DONATION line and a 0 total when there is no donation", async () => {
      const { svc } = makeService({ defaultPercent: 3 })
      const result = await svc.calculateBreakdown({
        subtotal: 10_000,
        sellerId: "sel_1",
      })
      expect(result.items.some((i) => i.type === "DONATION")).toBe(false)
      expect(result.totals.donation).toBe(0)
    })

    it("ignores a negative donation rather than crediting it anywhere", async () => {
      const { svc } = makeService({ defaultPercent: 3 })
      const result = await svc.calculateBreakdown({
        subtotal: 10_000,
        sellerId: "sel_1",
        donation: -500,
      })
      expect(result.totals.donation).toBe(0)
      expect(result.totals.customerPaid).toBe(10_000)
      expect(result.items.some((i) => i.type === "DONATION")).toBe(false)
    })

    it("stores total_donation and reads it back, separate from producers", async () => {
      const { svc, storedBreakdowns } = makeService({ defaultPercent: 3 })
      const breakdown = await svc.calculateBreakdown({ ...order, orderId: "order_1" })
      await svc.storeOrderBreakdown("order_1", "cus_1", breakdown)

      expect(storedBreakdowns).toHaveLength(1)
      expect(storedBreakdowns[0]).toMatchObject({
        order_id: "order_1",
        total_donation: 1_500,
        total_to_producers: 9_700,
        total_platform_fees: 300,
        customer_paid: 11_500,
      })

      const read = await svc.getOrderBreakdown("order_1")
      expect(read).not.toBeNull()
      expect(read?.totals.donation).toBe(1_500)
      expect(read?.totals.toProducers).toBe(9_700)
      expect(read?.items.find((i) => i.type === "DONATION")?.recipient).toBe(
        "Ground Up Liberation Project"
      )
    })
  })
})
