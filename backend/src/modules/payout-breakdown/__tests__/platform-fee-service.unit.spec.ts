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

  svc.listPayoutConfigs = (async () => [
    { id: "pc_1", is_default: true, platform_fee_percent: opts.defaultPercent ?? 3 },
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

  return {
    svc: svc as unknown as PayoutBreakdownService,
    rows,
    created,
    updated,
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
})
