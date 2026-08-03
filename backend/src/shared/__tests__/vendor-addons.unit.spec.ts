import {
  getAddonOwnership,
  grantAddon,
  revokeAddon,
} from "../vendor-addons"
import { ENTITLEMENT_MODULE } from "../../modules/entitlement"
import { EntitlementStatus } from "../../modules/entitlement/models/entitlement"
import {
  clearPlanFeatureCache,
  getCachedPlanFeatures,
  setCachedPlanFeatures,
} from "../plan-entitlement-cache"

/**
 * In-memory entitlement stub shaped like the two calls the add-on service
 * makes: `grant` appends a row, `listEntitlements` filters by seller+status,
 * `updateEntitlements` patches by id — enough to exercise the extension and
 * revocation logic without a container.
 */
type Row = {
  id: string
  seller_id: string
  feature_key: string
  status: string
  expires_at: Date | null
  metadata: Record<string, unknown> | null
}

const makeContainer = () => {
  const rows: Row[] = []

  const entitlements = {
    grant: jest.fn(async (input: Record<string, unknown>) => {
      const row: Row = {
        id: `ent_${rows.length + 1}`,
        seller_id: input.seller_id as string,
        feature_key: input.feature_key as string,
        status: EntitlementStatus.ACTIVE,
        expires_at: (input.expires_at as Date) ?? null,
        metadata: (input.metadata as Record<string, unknown>) ?? null,
      }
      rows.push(row)
      return row
    }),
    listEntitlements: jest.fn(
      async (where: { seller_id?: string; status?: string }) =>
        rows.filter(
          (r) =>
            (!where.seller_id || r.seller_id === where.seller_id) &&
            (!where.status || r.status === where.status)
        )
    ),
    updateEntitlements: jest.fn(
      async (updates: Array<{ id: string } & Record<string, unknown>>) => {
        for (const u of updates) {
          const row = rows.find((r) => r.id === u.id)
          if (row) Object.assign(row, u)
        }
        return updates
      }
    ),
  }

  const container = {
    resolve: (key: string) => {
      if (key === ENTITLEMENT_MODULE) return entitlements
      throw new Error(`unexpected resolve: ${key}`)
    },
  }

  return { container: container as never, entitlements, rows }
}

afterEach(() => clearPlanFeatureCache())

describe("grantAddon", () => {
  it("grants one access-pass row per feature key, all sharing the expiry", async () => {
    const { container, rows } = makeContainer()
    const now = new Date("2026-08-01T00:00:00.000Z")

    const owned = await grantAddon(container, {
      sellerId: "sel_1",
      code: "grower_pack",
      now,
    })

    expect(owned.active).toBe(true)
    expect(owned.expires_at).toEqual(new Date("2026-08-31T00:00:00.000Z"))
    expect(rows.map((r) => r.feature_key).sort()).toEqual([
      "vendor.nursery",
      "vendor.production_ledger",
    ])
    for (const row of rows) {
      expect(row.expires_at).toEqual(owned.expires_at)
      expect(row.metadata?.addon).toBe("grower_pack")
    }
  })

  it("extends an open window instead of restarting it", async () => {
    const { container } = makeContainer()
    const first = await grantAddon(container, {
      sellerId: "sel_1",
      code: "quest_pack",
      now: new Date("2026-08-01T00:00:00.000Z"),
    })
    // A week later, buy again: the new window ends 30 days after the FIRST
    // window's end, not 30 days after the second purchase.
    const second = await grantAddon(container, {
      sellerId: "sel_1",
      code: "quest_pack",
      now: new Date("2026-08-08T00:00:00.000Z"),
    })
    expect(second.expires_at).toEqual(
      new Date(first.expires_at!.getTime() + 30 * 86_400_000)
    )
  })

  it("does not let one pack's window extend another's", async () => {
    const { container } = makeContainer()
    await grantAddon(container, {
      sellerId: "sel_1",
      code: "quest_pack",
      now: new Date("2026-08-01T00:00:00.000Z"),
    })
    const other = await grantAddon(container, {
      sellerId: "sel_1",
      code: "grower_pack",
      now: new Date("2026-08-01T00:00:00.000Z"),
    })
    // grower_pack starts fresh; quest_pack's open window is not its base.
    expect(other.expires_at).toEqual(new Date("2026-08-31T00:00:00.000Z"))
  })

  it("throws on an unknown code rather than fulfilling nothing", async () => {
    const { container } = makeContainer()
    await expect(
      grantAddon(container, { sellerId: "sel_1", code: "mystery_pack" })
    ).rejects.toThrow(/unknown add-on/i)
  })

  it("invalidates the seller's plan snapshot so the gate opens immediately", async () => {
    const { container } = makeContainer()
    setCachedPlanFeatures("sel_1", {
      plan_code: "free",
      feature_keys: new Set(),
    })
    await grantAddon(container, { sellerId: "sel_1", code: "quest_pack" })
    // A vendor who just paid must not wait out the 30s TTL.
    expect(getCachedPlanFeatures("sel_1")).toBeNull()
  })
})

describe("revokeAddon", () => {
  it("revokes only the rows the pack granted", async () => {
    const { container, rows, entitlements } = makeContainer()
    await grantAddon(container, { sellerId: "sel_1", code: "grower_pack" })
    // A key held from another source must survive the pack's revocation.
    await entitlements.grant({
      seller_id: "sel_1",
      feature_key: "vendor.nursery",
      metadata: { comp: "support" },
    })

    const revoked = await revokeAddon(container, "sel_1", "grower_pack", "refund")

    expect(revoked).toBe(2)
    const active = rows.filter((r) => r.status === EntitlementStatus.ACTIVE)
    expect(active).toHaveLength(1)
    expect(active[0].metadata?.comp).toBe("support")
  })

  it("is a no-op when nothing is active", async () => {
    const { container } = makeContainer()
    expect(await revokeAddon(container, "sel_1", "quest_pack")).toBe(0)
  })
})

describe("getAddonOwnership", () => {
  it("reports every purchasable pack, active or not", async () => {
    const { container } = makeContainer()
    await grantAddon(container, {
      sellerId: "sel_1",
      code: "quest_pack",
      now: new Date("2026-08-01T00:00:00.000Z"),
    })

    const owned = await getAddonOwnership(
      container,
      "sel_1",
      new Date("2026-08-15T00:00:00.000Z")
    )
    const byCode = new Map(owned.map((o) => [o.code, o]))

    expect(byCode.get("quest_pack")?.active).toBe(true)
    expect(byCode.get("grower_pack")?.active).toBe(false)
    expect(byCode.get("grower_pack")?.expires_at).toBeNull()
  })

  it("reports a lapsed window as inactive", async () => {
    const { container } = makeContainer()
    await grantAddon(container, {
      sellerId: "sel_1",
      code: "quest_pack",
      now: new Date("2026-08-01T00:00:00.000Z"),
    })
    const owned = await getAddonOwnership(
      container,
      "sel_1",
      new Date("2026-09-15T00:00:00.000Z")
    )
    expect(owned.find((o) => o.code === "quest_pack")?.active).toBe(false)
  })

  it("degrades to nothing-owned when the lookup fails", async () => {
    const broken = {
      resolve: () => {
        throw new Error("entitlement module unavailable")
      },
    }
    const owned = await getAddonOwnership(broken as never, "sel_1")
    expect(owned.length).toBeGreaterThan(0)
    expect(owned.every((o) => !o.active)).toBe(true)
  })
})
