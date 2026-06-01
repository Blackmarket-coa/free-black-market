import CreatorAttributionService from "../service"

/**
 * Capturing fake for the pg connection. Records every raw SQL string + bindings
 * so the test can assert an atomic `col = col + 1` UPDATE was issued (rather
 * than a read-modify-write that writes a literal value).
 */
function makeFakePg() {
  const calls: Array<{ sql: string; bindings: unknown[] }> = []
  return {
    calls,
    raw: jest.fn(async (sql: string, bindings: unknown[] = []) => {
      calls.push({ sql, bindings })
      return { rows: [] }
    }),
  }
}

/**
 * Build a service instance with the MedusaService-generated CRUD methods
 * stubbed out, plus a fake container that resolves the capturing pg connection.
 */
function makeService(pg: ReturnType<typeof makeFakePg> | null) {
  // Bypass the MedusaService constructor by creating a bare object whose
  // prototype is the service prototype, then attaching the bits the methods
  // under test touch.
  const svc: any = Object.create(CreatorAttributionService.prototype)

  // The container resolves the pg connection (the service uses
  // ContainerRegistrationKeys.PG_CONNECTION; we return the fake for any key so
  // the test doesn't couple to the exact registration string).
  svc.container_ = pg
    ? { resolve: () => pg }
    : { resolve: () => undefined }

  // Stubs for the MedusaService-generated data methods used by recordClick /
  // attributeOrder so we can drive the increment paths in isolation.
  svc.listAffiliateLinks = jest.fn(async () => [
    {
      id: "link_1",
      short_code: "fbm_abc",
      creator_seller_id: "seller_1",
      click_count: 5,
      attributed_order_count: 2,
      status: "active",
    },
  ])
  svc.createAttributionClickEvents = jest.fn(async () => ({ id: "evt_1" }))
  svc.updateAffiliateLinks = jest.fn(async () => ({}))

  return svc
}

describe("creator-attribution atomic counters", () => {
  it("recordClick issues an atomic click_count = click_count + 1 UPDATE via pg", async () => {
    const pg = makeFakePg()
    const svc = makeService(pg)

    await svc.recordClick({
      shortCode: "fbm_abc",
      visitorToken: "vtok",
      isBotSuspected: false,
    })

    expect(pg.raw).toHaveBeenCalledTimes(1)
    const { sql, bindings } = pg.calls[0]
    // Atomic increment, not a literal write.
    expect(sql.replace(/\s+/g, " ")).toContain(
      "SET click_count = click_count + 1"
    )
    expect(sql).toContain("WHERE id = ?")
    expect(sql).toContain("deleted_at IS NULL")
    expect(bindings).toEqual(["link_1"])
    // Must NOT fall back to read-modify-write when pg is available.
    expect(svc.updateAffiliateLinks).not.toHaveBeenCalled()
  })

  it("recordClick skips the increment when the click is bot-suspected", async () => {
    const pg = makeFakePg()
    const svc = makeService(pg)

    await svc.recordClick({
      shortCode: "fbm_abc",
      visitorToken: "vtok",
      isBotSuspected: true,
    })

    expect(pg.raw).not.toHaveBeenCalled()
    expect(svc.updateAffiliateLinks).not.toHaveBeenCalled()
  })

  it("atomicIncrementAffiliateLink targets attributed_order_count atomically", async () => {
    const pg = makeFakePg()
    const svc = makeService(pg)

    await svc.atomicIncrementAffiliateLink("attributed_order_count", "link_1")

    expect(pg.raw).toHaveBeenCalledTimes(1)
    const { sql, bindings } = pg.calls[0]
    expect(sql.replace(/\s+/g, " ")).toContain(
      "SET attributed_order_count = attributed_order_count + 1"
    )
    expect(bindings).toEqual(["link_1"])
  })

  it("falls back to read-modify-write when no pg connection is reachable", async () => {
    const svc = makeService(null)

    await svc.atomicIncrementAffiliateLink("click_count", "link_1")

    // Fallback path performs a read then a literal write.
    expect(svc.updateAffiliateLinks).toHaveBeenCalledWith({
      id: "link_1",
      click_count: 6,
    })
  })
})
