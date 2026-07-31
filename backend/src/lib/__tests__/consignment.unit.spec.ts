import {
  CONSIGNMENT_BPS_DENOMINATOR,
  CONSIGNMENT_CATALOG_ID,
  CONSIGNMENT_SPLIT_FLAG,
  extractConsignmentConfig,
  isConsignmentSplitLive,
  resolveOrderConsignment,
  splitConsignmentCents,
  type ConsignmentProduct,
} from "../consignment"

const consignmentProduct = (
  id: string,
  overrides: Partial<ConsignmentProduct> = {}
): ConsignmentProduct => ({
  id,
  metadata: { consignor_seller_id: "sel_consignor", consignor_bps: 2500 },
  listing_type: { catalog_id: CONSIGNMENT_CATALOG_ID },
  ...overrides,
})

describe("isConsignmentSplitLive", () => {
  const ORIG_ENV = { ...process.env }

  afterEach(() => {
    process.env = { ...ORIG_ENV }
  })

  afterAll(() => {
    process.env = ORIG_ENV
  })

  it("is dark by default and only live on exactly '1'", () => {
    delete process.env[CONSIGNMENT_SPLIT_FLAG]
    expect(isConsignmentSplitLive()).toBe(false)

    for (const off of ["0", "", "true", "yes", "live"]) {
      process.env[CONSIGNMENT_SPLIT_FLAG] = off
      expect(isConsignmentSplitLive()).toBe(false)
    }

    process.env[CONSIGNMENT_SPLIT_FLAG] = "1"
    expect(isConsignmentSplitLive()).toBe(true)
  })
})

describe("splitConsignmentCents", () => {
  it("floors the consignor share and gives the remainder to the vendor", () => {
    // 999 * 1500 / 10000 = 149.85 -> consignor 149, vendor 850
    expect(splitConsignmentCents(999, 1500)).toEqual({
      consignor_cents: 149,
      vendor_cents: 850,
    })
  })

  it("handles the 0 and 10000 bps extremes", () => {
    expect(splitConsignmentCents(12345, 0)).toEqual({
      consignor_cents: 0,
      vendor_cents: 12345,
    })
    expect(splitConsignmentCents(12345, CONSIGNMENT_BPS_DENOMINATOR)).toEqual({
      consignor_cents: 12345,
      vendor_cents: 0,
    })
  })

  it("rounds a sub-cent consignor share down to zero", () => {
    // 1 * 9999 / 10000 = 0.9999 -> consignor 0, vendor keeps the full cent
    expect(splitConsignmentCents(1, 9999)).toEqual({
      consignor_cents: 0,
      vendor_cents: 1,
    })
  })

  it("never drifts: legs are non-negative integers summing to the input", () => {
    const amounts = [0, 1, 3, 7, 33, 999, 12345, 1000001]
    const bpsValues = [0, 1, 3, 2500, 3333, 5000, 9999, 10000]
    for (const amount of amounts) {
      for (const bps of bpsValues) {
        const { consignor_cents, vendor_cents } = splitConsignmentCents(
          amount,
          bps
        )
        expect(Number.isInteger(consignor_cents)).toBe(true)
        expect(Number.isInteger(vendor_cents)).toBe(true)
        expect(consignor_cents).toBeGreaterThanOrEqual(0)
        expect(vendor_cents).toBeGreaterThanOrEqual(0)
        expect(consignor_cents + vendor_cents).toBe(amount)
        expect(consignor_cents).toBe(
          Math.floor((amount * bps) / CONSIGNMENT_BPS_DENOMINATOR)
        )
      }
    }
  })

  it("throws on a negative or non-integer amount", () => {
    for (const amount of [-1, -100, 10.5, NaN, Infinity]) {
      expect(() => splitConsignmentCents(amount, 2500)).toThrow(
        "sellerAmountCents must be a non-negative integer"
      )
    }
  })

  it("throws on out-of-range or non-integer bps", () => {
    for (const bps of [-1, 10001, 100000, 0.5, 2500.5, NaN, Infinity]) {
      expect(() => splitConsignmentCents(1000, bps)).toThrow(
        "consignorBps must be an integer in 0..10000"
      )
    }
  })
})

describe("extractConsignmentConfig", () => {
  it("extracts a valid config", () => {
    expect(extractConsignmentConfig(consignmentProduct("prod_1"))).toEqual({
      consignor_seller_id: "sel_consignor",
      consignor_bps: 2500,
    })
  })

  it("accepts a numeric-string bps and trims the seller id", () => {
    expect(
      extractConsignmentConfig({
        id: "prod_1",
        metadata: { consignor_seller_id: "  sel_c  ", consignor_bps: "2500" },
      })
    ).toEqual({ consignor_seller_id: "sel_c", consignor_bps: 2500 })
    expect(
      extractConsignmentConfig({
        id: "prod_1",
        metadata: { consignor_seller_id: "sel_c", consignor_bps: " 0300 " },
      })
    ).toEqual({ consignor_seller_id: "sel_c", consignor_bps: 300 })
  })

  it("accepts the 0 and 10000 bps boundaries", () => {
    for (const bps of [0, 10000, "0", "10000"]) {
      expect(
        extractConsignmentConfig({
          metadata: { consignor_seller_id: "sel_c", consignor_bps: bps },
        })
      ).toEqual({ consignor_seller_id: "sel_c", consignor_bps: Number(bps) })
    }
  })

  it("returns null when the product or metadata is absent", () => {
    expect(extractConsignmentConfig(null)).toBeNull()
    expect(extractConsignmentConfig(undefined)).toBeNull()
    expect(extractConsignmentConfig({ id: "prod_1" })).toBeNull()
    expect(extractConsignmentConfig({ id: "prod_1", metadata: null })).toBeNull()
    expect(extractConsignmentConfig({ id: "prod_1", metadata: {} })).toBeNull()
    expect(
      extractConsignmentConfig({ id: "prod_1", metadata: [] as any })
    ).toBeNull()
  })

  it("returns null for invalid consignor_seller_id shapes", () => {
    for (const sellerId of ["", "   ", 123, true, null, {}, ["sel_c"]]) {
      expect(
        extractConsignmentConfig({
          metadata: { consignor_seller_id: sellerId, consignor_bps: 2500 },
        })
      ).toBeNull()
    }
  })

  it("returns null for invalid consignor_bps shapes", () => {
    const invalid = [
      undefined,
      null,
      "",
      "  ",
      "abc",
      "20.5",
      "1e3",
      "-1",
      "10001",
      "123456",
      -1,
      10001,
      20.5,
      NaN,
      Infinity,
      true,
      {},
      [2500],
    ]
    for (const bps of invalid) {
      expect(
        extractConsignmentConfig({
          metadata: { consignor_seller_id: "sel_c", consignor_bps: bps },
        })
      ).toBeNull()
    }
  })
})

describe("resolveOrderConsignment", () => {
  const resolve = (
    itemProductIds: Array<string | null | undefined>,
    products: ConsignmentProduct[],
    vendorSellerId = "vendor_1"
  ) =>
    resolveOrderConsignment({
      item_product_ids: itemProductIds,
      products,
      vendor_seller_id: vendorSellerId,
    })

  it("resolves when every item sells the same consignment deal", () => {
    expect(
      resolve(["prod_1", "prod_2"], [
        consignmentProduct("prod_1"),
        consignmentProduct("prod_2"),
      ])
    ).toEqual({
      config: { consignor_seller_id: "sel_consignor", consignor_bps: 2500 },
      reason: null,
    })
  })

  it("dedupes repeated items of the same product", () => {
    expect(
      resolve(["prod_1", "prod_1"], [consignmentProduct("prod_1")]).config
    ).toEqual({ consignor_seller_id: "sel_consignor", consignor_bps: 2500 })
  })

  it("skips with no_products when the order has no items", () => {
    expect(resolve([], [])).toEqual({ config: null, reason: "no_products" })
  })

  it("skips when any item has no product id", () => {
    expect(resolve(["prod_1", null], [consignmentProduct("prod_1")])).toEqual({
      config: null,
      reason: "items_without_product",
    })
  })

  it("skips when a referenced product was not fetched", () => {
    expect(
      resolve(["prod_1", "prod_gone"], [consignmentProduct("prod_1")])
    ).toEqual({ config: null, reason: "missing_products" })
  })

  it("skips a plain order quietly (no consignment signal at all)", () => {
    expect(
      resolve(["prod_1"], [
        consignmentProduct("prod_1", {
          metadata: null,
          listing_type: { catalog_id: "physical_product" },
        }),
      ])
    ).toEqual({ config: null, reason: "no_consignment_products" })
  })

  it("flags consignor metadata on a non-consignment listing as a misconfig", () => {
    expect(
      resolve(["prod_1"], [
        consignmentProduct("prod_1", {
          listing_type: { catalog_id: "physical_product" },
        }),
      ])
    ).toEqual({
      config: null,
      reason: "metadata_without_consignment_listing",
    })
    expect(
      resolve(["prod_1"], [consignmentProduct("prod_1", { listing_type: null })])
    ).toEqual({
      config: null,
      reason: "metadata_without_consignment_listing",
    })
  })

  it("skips mixed orders (consignment + non-consignment items)", () => {
    expect(
      resolve(["prod_1", "prod_2"], [
        consignmentProduct("prod_1"),
        consignmentProduct("prod_2", {
          metadata: null,
          listing_type: { catalog_id: "physical_product" },
        }),
      ])
    ).toEqual({ config: null, reason: "not_all_consignment" })
  })

  it("skips when a consignment-listed product has invalid or missing config", () => {
    expect(
      resolve(["prod_1"], [consignmentProduct("prod_1", { metadata: {} })])
    ).toEqual({ config: null, reason: "invalid_config" })
    expect(
      resolve(["prod_1", "prod_2"], [
        consignmentProduct("prod_1"),
        consignmentProduct("prod_2", {
          metadata: { consignor_seller_id: "sel_consignor", consignor_bps: 99999 },
        }),
      ])
    ).toEqual({ config: null, reason: "invalid_config" })
  })

  it("skips when items carry conflicting consignment configs", () => {
    expect(
      resolve(["prod_1", "prod_2"], [
        consignmentProduct("prod_1"),
        consignmentProduct("prod_2", {
          metadata: { consignor_seller_id: "sel_other", consignor_bps: 2500 },
        }),
      ])
    ).toEqual({ config: null, reason: "conflicting_configs" })
    expect(
      resolve(["prod_1", "prod_2"], [
        consignmentProduct("prod_1"),
        consignmentProduct("prod_2", {
          metadata: { consignor_seller_id: "sel_consignor", consignor_bps: 5000 },
        }),
      ])
    ).toEqual({ config: null, reason: "conflicting_configs" })
  })

  it("treats numeric-string and numeric bps as the same config", () => {
    expect(
      resolve(["prod_1", "prod_2"], [
        consignmentProduct("prod_1"),
        consignmentProduct("prod_2", {
          metadata: { consignor_seller_id: "sel_consignor", consignor_bps: "2500" },
        }),
      ]).config
    ).toEqual({ consignor_seller_id: "sel_consignor", consignor_bps: 2500 })
  })

  it("skips self-consignment (consignor is the selling vendor)", () => {
    expect(
      resolve(["prod_1"], [consignmentProduct("prod_1")], "sel_consignor")
    ).toEqual({ config: null, reason: "self_consignment" })
  })
})
