import CottageFoodModuleService from "../service"

/**
 * In-memory stand-in for the generated MedusaService CRUD.
 *
 * Built off the prototype so the real `getComplianceSnapshot`, `recordSale`,
 * `reverseSale`, and `renderLabel` logic runs unchanged while the persistence
 * methods are shadowed by instance properties. Avoids booting a container or a
 * database for what is fundamentally arithmetic over a list of rows.
 */
function matches(row: Record<string, any>, filter: Record<string, any>): boolean {
  return Object.entries(filter).every(([key, want]) => {
    const got = row[key]
    if (want && typeof want === "object" && "$gte" in want) {
      return new Date(got).getTime() >= new Date(want.$gte).getTime()
    }
    return got === want
  })
}

function makeService(seed: {
  profiles?: Record<string, any>[]
  entries?: Record<string, any>[]
  labels?: Record<string, any>[]
} = {}) {
  const profiles = [...(seed.profiles ?? [])]
  const entries = [...(seed.entries ?? [])]
  const labels = [...(seed.labels ?? [])]
  let seq = entries.length

  const svc: any = Object.create(CottageFoodModuleService.prototype)

  svc.listCottageFoodProfiles = async (filter: any = {}) =>
    profiles.filter((p) => matches(p, filter))

  svc.createCottageFoodProfiles = async (data: any) => {
    const row = { id: `prof_${profiles.length + 1}`, ...data }
    profiles.push(row)
    return row
  }

  svc.updateCottageFoodProfiles = async (data: any) => {
    const row = profiles.find((p) => p.id === data.id)
    if (!row) return null
    Object.assign(row, data)
    return row
  }

  svc.listCottageFoodSalesEntries = async (filter: any = {}, config: any = {}) => {
    let rows = entries.filter((e) => matches(e, filter))
    if (config.order?.occurred_at === "DESC") {
      rows = [...rows].sort(
        (a, b) =>
          new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime()
      )
    }
    if (config.skip) rows = rows.slice(config.skip)
    if (config.take) rows = rows.slice(0, config.take)
    return rows
  }

  svc.createCottageFoodSalesEntries = async (data: any) => {
    const row = { id: `entry_${++seq}`, ...data }
    entries.push(row)
    return row
  }

  svc.createCottageFoodLabels = async (data: any) => {
    const row = { id: `label_${labels.length + 1}`, ...data }
    labels.push(row)
    return row
  }

  svc.retrieveCottageFoodLabel = async (id: string) =>
    labels.find((l) => l.id === id)

  svc.__entries = entries
  svc.__profiles = profiles
  return svc as CottageFoodModuleService & Record<string, any>
}

const LA = "America/Los_Angeles"

/** Baseline profile: nothing declared. */
function profile(overrides: Record<string, any> = {}) {
  return {
    id: "prof_1",
    seller_id: "sel_1",
    operation_type: "SHELF_STABLE",
    cap_period_start_month: 1,
    timezone: LA,
    annual_sales_cap_cents: null,
    daily_meal_cap: null,
    weekly_meal_cap: null,
    permit_expires_at: null,
    food_handler_expires_at: null,
    ...overrides,
  }
}

function entry(overrides: Record<string, any> = {}) {
  return {
    id: `e_${Math.random().toString(36).slice(2, 8)}`,
    seller_id: "sel_1",
    source: "medusa_order",
    source_id: null,
    occurred_at: "2026-06-10T18:00:00Z",
    amount_cents: 0,
    meal_count: 0,
    counts_toward_annual: true,
    counts_toward_meals: true,
    reverses_entry_id: null,
    ...overrides,
  }
}

describe("getComplianceSnapshot", () => {
  const now = new Date("2026-06-12T19:00:00Z") // Fri Jun 12, noon PDT

  it("returns an empty snapshot for a seller with no profile", async () => {
    const svc = makeService()
    const snap = await svc.getComplianceSnapshot("sel_nobody", now)

    expect(snap.has_profile).toBe(false)
    expect(snap.annual.cap).toBeNull()
    expect(snap.advisories).toEqual([])
  })

  it("hides every meter and raises nothing when no limits are declared", async () => {
    const svc = makeService({
      profiles: [profile()],
      entries: [entry({ amount_cents: 500_00, meal_count: 40 })],
    })
    const snap = await svc.getComplianceSnapshot("sel_1", now)

    // Usage is still counted — it just isn't measured against anything.
    expect(snap.annual.used).toBe(500_00)
    expect(snap.annual.cap).toBeNull()
    expect(snap.annual.pct).toBeNull()
    expect(snap.annual.remaining).toBeNull()
    expect(snap.today.pct).toBeNull()
    expect(snap.advisories).toEqual([])
  })

  it("treats a declared cap of zero as 'not tracked' rather than an instant breach", async () => {
    const svc = makeService({
      profiles: [profile({ annual_sales_cap_cents: 0 })],
      entries: [entry({ amount_cents: 100_00 })],
    })
    const snap = await svc.getComplianceSnapshot("sel_1", now)

    expect(snap.annual.cap).toBeNull()
    expect(snap.annual.pct).toBeNull()
    expect(snap.advisories).toEqual([])
  })

  it("splits on-platform from self-reported sales in the annual total", async () => {
    const svc = makeService({
      profiles: [profile({ annual_sales_cap_cents: 75_000_00 })],
      entries: [
        entry({ amount_cents: 300_00, source: "medusa_order" }),
        entry({ amount_cents: 120_00, source: "manual" }),
      ],
    })
    const snap = await svc.getComplianceSnapshot("sel_1", now)

    expect(snap.annual.used).toBe(420_00)
    expect(snap.annual.on_platform_cents).toBe(300_00)
    expect(snap.annual.self_reported_cents).toBe(120_00)
  })

  it("counts a permit year that straddles the calendar boundary", async () => {
    const svc = makeService({
      profiles: [
        profile({
          annual_sales_cap_cents: 50_000_00,
          cap_period_start_month: 10, // Oct → Sep
        }),
      ],
      entries: [
        // Inside the Oct 2025 → Oct 2026 window.
        entry({ amount_cents: 100_00, occurred_at: "2025-11-15T18:00:00Z" }),
        entry({ amount_cents: 200_00, occurred_at: "2026-02-01T18:00:00Z" }),
        // Before it — belongs to the prior permit year.
        entry({ amount_cents: 900_00, occurred_at: "2025-09-15T18:00:00Z" }),
      ],
    })
    const snap = await svc.getComplianceSnapshot("sel_1", now)

    expect(snap.annual.used).toBe(300_00)
    expect(snap.annual.period_start).toBe("2025-10-01T07:00:00.000Z")
    expect(snap.annual.period_end).toBe("2026-10-01T07:00:00.000Z")
  })

  it("excludes entries the seller marked as not counting toward the annual cap", async () => {
    const svc = makeService({
      profiles: [profile({ annual_sales_cap_cents: 10_000_00 })],
      entries: [
        entry({ amount_cents: 100_00 }),
        entry({ amount_cents: 900_00, counts_toward_annual: false }),
      ],
    })
    const snap = await svc.getComplianceSnapshot("sel_1", now)
    expect(snap.annual.used).toBe(100_00)
  })

  it("buckets meals into today and this week using the seller's timezone", async () => {
    const svc = makeService({
      profiles: [
        profile({
          operation_type: "HOME_KITCHEN",
          daily_meal_cap: 30,
          weekly_meal_cap: 60,
        }),
      ],
      entries: [
        // Fri Jun 12, 9am PDT — today.
        entry({ meal_count: 5, occurred_at: "2026-06-12T16:00:00Z" }),
        // Thu Jun 11, 8pm PDT (= Jun 12 03:00 UTC) — this week, NOT today.
        // A UTC-based day boundary would wrongly count this as today.
        entry({ meal_count: 7, occurred_at: "2026-06-12T03:00:00Z" }),
        // Sat Jun 6, before the Sunday week start — neither.
        entry({ meal_count: 50, occurred_at: "2026-06-06T18:00:00Z" }),
      ],
    })
    const snap = await svc.getComplianceSnapshot("sel_1", now)

    expect(snap.tracks_meals).toBe(true)
    expect(snap.today.used).toBe(5)
    expect(snap.today.remaining).toBe(25)
    expect(snap.this_week.used).toBe(12)
    expect(snap.this_week.remaining).toBe(48)
  })

  it("does not mark shelf-stable operations as meal-tracking", async () => {
    const svc = makeService({ profiles: [profile()] })
    const snap = await svc.getComplianceSnapshot("sel_1", now)
    expect(snap.tracks_meals).toBe(false)
  })

  it("nets reversals out of the totals", async () => {
    const svc = makeService({
      profiles: [profile({ annual_sales_cap_cents: 10_000_00 })],
      entries: [
        entry({ id: "orig", amount_cents: 500_00, meal_count: 4 }),
        entry({
          amount_cents: -500_00,
          meal_count: -4,
          reverses_entry_id: "orig",
          occurred_at: "2026-06-11T18:00:00Z",
        }),
      ],
    })
    const snap = await svc.getComplianceSnapshot("sel_1", now)
    expect(snap.annual.used).toBe(0)
  })
})

describe("advisories", () => {
  const now = new Date("2026-06-12T19:00:00Z")

  it("stays quiet below the first threshold", async () => {
    const svc = makeService({
      profiles: [profile({ annual_sales_cap_cents: 10_000_00 })],
      entries: [entry({ amount_cents: 5_000_00 })], // 50%
    })
    const snap = await svc.getComplianceSnapshot("sel_1", now)
    expect(snap.advisories).toEqual([])
  })

  it("reports position once past 75% of a declared cap", async () => {
    const svc = makeService({
      profiles: [profile({ annual_sales_cap_cents: 10_000_00 })],
      entries: [entry({ amount_cents: 8_000_00 })],
    })
    const snap = await svc.getComplianceSnapshot("sel_1", now)
    expect(snap.advisories).toHaveLength(1)
    expect(snap.advisories[0]).toContain("80%")
  })

  it("says plainly when a declared cap has been passed — and still never blocks", async () => {
    const svc = makeService({
      profiles: [profile({ annual_sales_cap_cents: 10_000_00 })],
      entries: [entry({ amount_cents: 12_000_00 })],
    })
    const snap = await svc.getComplianceSnapshot("sel_1", now)

    expect(snap.advisories[0]).toContain("over it")
    // The contract: advisories are prose for a human. Nothing in the snapshot
    // is a machine-readable gate.
    expect(snap).not.toHaveProperty("blocked")
    expect(snap).not.toHaveProperty("allowed")
    expect(snap.advisories.every((a: string) => typeof a === "string")).toBe(true)
  })

  it("flags permit and food-handler expiry", async () => {
    const svc = makeService({
      profiles: [
        profile({
          permit_expires_at: "2026-06-26T00:00:00Z", // 13 days out
          food_handler_expires_at: "2026-05-01T00:00:00Z", // past
        }),
      ],
    })
    const snap = await svc.getComplianceSnapshot("sel_1", now)

    expect(snap.permit.status).toBe("expiring_soon")
    expect(snap.food_handler.status).toBe("expired")
    expect(snap.advisories.join(" ")).toContain("permit expires in 13 days")
    expect(snap.advisories.join(" ")).toContain("food handler")
  })

  it("leaves expiry unset when no date was recorded", async () => {
    const svc = makeService({ profiles: [profile()] })
    const snap = await svc.getComplianceSnapshot("sel_1", now)
    expect(snap.permit.status).toBe("unset")
    expect(snap.advisories).toEqual([])
  })
})

describe("recordSale", () => {
  it("is idempotent on (source, source_id) so subscriber retries can't double-count", async () => {
    const svc = makeService({ profiles: [profile()] })

    await svc.recordSale({
      seller_id: "sel_1",
      source: "medusa_order",
      source_id: "order_1",
      amount_cents: 250_00,
    })
    await svc.recordSale({
      seller_id: "sel_1",
      source: "medusa_order",
      source_id: "order_1",
      amount_cents: 250_00,
    })

    expect(svc.__entries).toHaveLength(1)
  })

  it("appends every manual entry — two identical cash sales are two real sales", async () => {
    const svc = makeService({ profiles: [profile()] })

    await svc.recordSale({ seller_id: "sel_1", source: "manual", amount_cents: 20_00 })
    await svc.recordSale({ seller_id: "sel_1", source: "manual", amount_cents: 20_00 })

    expect(svc.__entries).toHaveLength(2)
  })

  it("attaches the seller's profile id when one exists", async () => {
    const svc = makeService({ profiles: [profile()] })
    const created: any = await svc.recordSale({
      seller_id: "sel_1",
      source: "manual",
      amount_cents: 1,
    })
    expect(created.profile_id).toBe("prof_1")
  })
})

describe("reverseSale", () => {
  it("appends a compensating entry instead of mutating history", async () => {
    const svc = makeService({ profiles: [profile()] })
    const original: any = await svc.recordSale({
      seller_id: "sel_1",
      source: "medusa_order",
      source_id: "order_9",
      amount_cents: 400_00,
      meal_count: 3,
    })

    const reversal: any = await svc.reverseSale("medusa_order", "order_9")

    expect(svc.__entries).toHaveLength(2)
    expect(reversal.amount_cents).toBe(-400_00)
    expect(reversal.meal_count).toBe(-3)
    expect(reversal.reverses_entry_id).toBe(original.id)
    // Original untouched — the sale did happen, and the ledger says so.
    expect(original.amount_cents).toBe(400_00)
    // Reversal carries no source_id, so it can't collide with the entry it
    // reverses on the unique index.
    expect(reversal.source_id).toBeNull()
  })

  it("does not double-reverse", async () => {
    const svc = makeService({ profiles: [profile()] })
    await svc.recordSale({
      seller_id: "sel_1",
      source: "medusa_order",
      source_id: "order_9",
      amount_cents: 400_00,
    })

    await svc.reverseSale("medusa_order", "order_9")
    await svc.reverseSale("medusa_order", "order_9")

    expect(svc.__entries).toHaveLength(2)
  })

  it("returns null when there is nothing to reverse", async () => {
    const svc = makeService({ profiles: [profile()] })
    expect(await svc.reverseSale("medusa_order", "nope")).toBeNull()
  })
})

describe("renderLabel", () => {
  it("composes the label in the order a printed label reads", async () => {
    const svc = makeService({
      labels: [
        {
          id: "label_1",
          product_name: "Sourdough Loaf",
          net_weight_text: "24 oz",
          ingredients: [{ name: "Flour" }, { name: "Water" }, { name: "Salt" }],
          allergens: ["wheat", "sesame"],
          allergen_cross_contact_note: "Made in a kitchen that also handles nuts.",
          business_name_snapshot: "Ruth's Kitchen",
          address_snapshot: "12 Elm St, Austin TX",
          permit_number_snapshot: "CF-4482",
          disclosure_text_snapshot:
            "Made in a home kitchen that is not inspected by the Department of State Health Services.",
        },
      ],
    })

    const rendered = await svc.renderLabel("label_1")

    expect(rendered.text.split("\n")).toEqual([
      "Sourdough Loaf",
      "INGREDIENTS: Flour, Water, Salt.",
      "CONTAINS: Wheat, Sesame.",
      "Made in a kitchen that also handles nuts.",
      "NET WT 24 oz",
      "Ruth's Kitchen",
      "12 Elm St, Austin TX",
      "Permit #CF-4482",
      "Made in a home kitchen that is not inspected by the Department of State Health Services.",
    ])
    expect(rendered.missing).toEqual([])
  })

  it("omits sections the seller hasn't filled in rather than inventing them", async () => {
    const svc = makeService({
      labels: [{ id: "label_1", product_name: "Plum Jam" }],
    })
    const rendered = await svc.renderLabel("label_1")

    expect(rendered.text).toBe("Plum Jam")
    // No fabricated disclosure sentence, no placeholder permit number.
    expect(rendered.text).not.toMatch(/permit/i)
    expect(rendered.missing).toEqual([
      "ingredients",
      "net weight",
      "business name",
      "home-kitchen disclosure",
    ])
  })

  it("ignores allergen keys outside the Big 9", async () => {
    const svc = makeService({
      labels: [
        {
          id: "label_1",
          product_name: "Trail Mix",
          allergens: ["peanuts", "unicorn"],
        },
      ],
    })
    const rendered = await svc.renderLabel("label_1")
    expect(rendered.allergens).toEqual(["Peanuts"])
  })
})
