import seedVendorPlans from "../../../scripts/seed-vendor-plans"
import { VENDOR_PLAN_CATALOG } from "../catalog"
import { VENDOR_PLAN_MODULE } from ".."

/**
 * Covers the seed script's upsert-by-code behaviour directly.
 *
 * `medusa exec` cannot boot in this environment (the Mercur payout module
 * requires a Stripe key), so the script is exercised against a fake container
 * instead. The logic under test — upsert by natural key, never duplicate — is
 * the part that could actually be wrong.
 */
function makeContainer() {
  const rows: any[] = []
  const logs: string[] = []

  const plans = {
    listVendorPlans: async (f: Record<string, any> = {}) =>
      rows.filter((r) =>
        Object.entries(f).every(([k, v]) => v === undefined || r[k] === v)
      ),
    createVendorPlans: async (payload: any) => {
      const row = { id: `vp_${rows.length + 1}`, ...payload }
      rows.push(row)
      return row
    },
    updateVendorPlans: async (payload: any) => {
      const row = rows.find((r) => r.id === payload.id)
      if (row) Object.assign(row, payload)
      return row
    },
  }

  const container = {
    resolve: (key: string) => {
      if (key === VENDOR_PLAN_MODULE) return plans
      // ContainerRegistrationKeys.LOGGER resolves to "logger".
      return { info: (m: string) => logs.push(m), error: (m: string) => logs.push(m) }
    },
  }

  return { container, rows, logs }
}

describe("seed-vendor-plans", () => {
  it("seeds every plan in the catalog", async () => {
    const { container, rows } = makeContainer()
    await seedVendorPlans({ container } as never)

    expect(rows).toHaveLength(VENDOR_PLAN_CATALOG.length)
    expect(rows.map((r) => r.code).sort()).toEqual(
      VENDOR_PLAN_CATALOG.map((p) => p.code).sort()
    )
  })

  it("carries the catalog's feature keys onto the row", async () => {
    const { container, rows } = makeContainer()
    await seedVendorPlans({ container } as never)

    const pro = rows.find((r) => r.code === "pro")
    expect(pro.feature_keys).toEqual(
      VENDOR_PLAN_CATALOG.find((p) => p.code === "pro")!.feature_keys
    )
  })

  it("is idempotent — a re-run updates rather than duplicates", async () => {
    const { container, rows } = makeContainer()
    await seedVendorPlans({ container } as never)
    await seedVendorPlans({ container } as never)
    await seedVendorPlans({ container } as never)

    expect(rows).toHaveLength(VENDOR_PLAN_CATALOG.length)
  })

  it("overwrites a drifted row back to the catalog", async () => {
    // Code is the source of truth; the table is a denormalized copy.
    const { container, rows } = makeContainer()
    await seedVendorPlans({ container } as never)

    const pro = rows.find((r) => r.code === "pro")
    pro.price_amount = 1
    pro.feature_keys = []

    await seedVendorPlans({ container } as never)

    const catalogPro = VENDOR_PLAN_CATALOG.find((p) => p.code === "pro")!
    expect(pro.price_amount).toBe(catalogPro.price_amount)
    expect(pro.feature_keys).toEqual(catalogPro.feature_keys)
  })
})
