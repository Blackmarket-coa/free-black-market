import {
  getPromotionState,
  grantPromotion,
  revokePromotion,
  sweepExpiredPromotions,
  syncFeaturedFlag,
} from "../promoted-listing-service"
import { PROMOTED_LISTING_FEATURE_KEY } from "../promoted-listing"
import { ENTITLEMENT_MODULE } from "../../modules/entitlement"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

const NOW = new Date("2026-08-03T00:00:00Z")
const day = 86_400_000

type Meta = { id: string; seller_id: string; featured: boolean }
type Ent = {
  seller_id: string
  feature_key: string
  status: string
  expires_at: Date | null
  created_at: Date
}

const makeContainer = (opts: {
  metadata?: Meta[]
  entitlements?: Ent[]
} = {}) => {
  const metadata = opts.metadata ?? []
  const entitlements = opts.entitlements ?? []
  const updates: Record<string, unknown>[] = []

  const grant = jest.fn(async (input: Record<string, unknown>) => {
    const idx = entitlements.findIndex(
      (e) =>
        e.seller_id === input.seller_id && e.feature_key === input.feature_key
    )
    const row: Ent = {
      seller_id: input.seller_id as string,
      feature_key: input.feature_key as string,
      status: "active",
      expires_at: (input.expires_at as Date | null) ?? null,
      created_at: NOW,
    }
    if (idx >= 0) entitlements[idx] = row
    else entitlements.push(row)
    return row
  })

  const revokeSellerFeatureKeys = jest.fn(
    async (sellerId: string, keys: string[]) => {
      let n = 0
      for (const e of entitlements) {
        if (e.seller_id === sellerId && keys.includes(e.feature_key)) {
          e.status = "revoked"
          n++
        }
      }
      return n
    }
  )

  const container = {
    resolve: (key: string) => {
      if (key === ENTITLEMENT_MODULE) {
        return {
          listEntitlements: async (filters: Record<string, unknown>) =>
            entitlements.filter(
              (e) =>
                e.seller_id === filters.seller_id &&
                e.feature_key === filters.feature_key &&
                e.status === filters.status
            ),
          grant,
          revokeSellerFeatureKeys,
        }
      }
      if (key === ContainerRegistrationKeys.QUERY) {
        return {
          graph: async (spec: {
            filters?: { seller_id?: string; featured?: boolean }
          }) => {
            if (spec.filters?.seller_id) {
              return {
                data: metadata.filter(
                  (m) => m.seller_id === spec.filters!.seller_id
                ),
              }
            }
            if (spec.filters?.featured !== undefined) {
              return {
                data: metadata.filter(
                  (m) => m.featured === spec.filters!.featured
                ),
              }
            }
            return { data: metadata }
          },
        }
      }
      if (key === "sellerExtension") {
        return {
          updateSellerMetadata: async (data: Record<string, unknown>[]) => {
            for (const d of [data].flat()) {
              updates.push(d as Record<string, unknown>)
              const row = metadata.find((m) => m.id === d.id)
              if (row) row.featured = d.featured as boolean
            }
            return data
          },
        }
      }
      return undefined
    },
  }

  return { container, metadata, entitlements, updates, grant, revokeSellerFeatureKeys }
}

describe("grantPromotion", () => {
  it("grants a dated promotion and features the seller", async () => {
    const { container, metadata, grant } = makeContainer({
      metadata: [{ id: "sm_1", seller_id: "sel_1", featured: false }],
    })

    const state = await grantPromotion(container as never, {
      sellerId: "sel_1",
      tierCode: "week",
      now: NOW,
    })

    expect(state.active).toBe(true)
    expect(state.expires_at?.getTime()).toBe(NOW.getTime() + 7 * day)
    expect(metadata[0].featured).toBe(true)
    expect(grant).toHaveBeenCalledWith(
      expect.objectContaining({
        seller_id: "sel_1",
        feature_key: PROMOTED_LISTING_FEATURE_KEY,
      })
    )
  })

  it("extends a running promotion rather than restarting it", async () => {
    const remaining = new Date(NOW.getTime() + 3 * day)
    const { container } = makeContainer({
      metadata: [{ id: "sm_1", seller_id: "sel_1", featured: true }],
      entitlements: [
        {
          seller_id: "sel_1",
          feature_key: PROMOTED_LISTING_FEATURE_KEY,
          status: "active",
          expires_at: remaining,
          created_at: NOW,
        },
      ],
    })

    const state = await grantPromotion(container as never, {
      sellerId: "sel_1",
      tierCode: "week",
      now: NOW,
    })

    // Renewing early must not forfeit the time already paid for.
    expect(state.expires_at?.getTime()).toBe(remaining.getTime() + 7 * day)
  })

  it("grants an open-ended promotion when no tier is given", async () => {
    const { container } = makeContainer({
      metadata: [{ id: "sm_1", seller_id: "sel_1", featured: false }],
    })

    const state = await grantPromotion(container as never, {
      sellerId: "sel_1",
      now: NOW,
    })

    expect(state.expires_at).toBeNull()
    expect(state.active).toBe(true)
  })

  it("refuses an unknown tier", async () => {
    const { container, grant } = makeContainer({
      metadata: [{ id: "sm_1", seller_id: "sel_1", featured: false }],
    })

    await expect(
      grantPromotion(container as never, {
        sellerId: "sel_1",
        tierCode: "forever",
        now: NOW,
      })
    ).rejects.toThrow(/Unknown promotion tier/)
    expect(grant).not.toHaveBeenCalled()
  })
})

describe("revokePromotion", () => {
  it("ends placement immediately, not at the expiry", async () => {
    const { container, metadata } = makeContainer({
      metadata: [{ id: "sm_1", seller_id: "sel_1", featured: true }],
      entitlements: [
        {
          seller_id: "sel_1",
          feature_key: PROMOTED_LISTING_FEATURE_KEY,
          status: "active",
          expires_at: new Date(NOW.getTime() + 30 * day),
          created_at: NOW,
        },
      ],
    })

    expect(await revokePromotion(container as never, "sel_1")).toBe(true)
    expect(metadata[0].featured).toBe(false)
  })
})

describe("syncFeaturedFlag", () => {
  it("clears the flag once the promotion lapses", async () => {
    const { container, metadata } = makeContainer({
      metadata: [{ id: "sm_1", seller_id: "sel_1", featured: true }],
      entitlements: [
        {
          seller_id: "sel_1",
          feature_key: PROMOTED_LISTING_FEATURE_KEY,
          status: "active",
          expires_at: new Date(NOW.getTime() - day),
          created_at: NOW,
        },
      ],
    })

    expect(await syncFeaturedFlag(container as never, "sel_1", NOW)).toBe("clear")
    expect(metadata[0].featured).toBe(false)
  })

  it("writes nothing when the flag already agrees", async () => {
    const { container, updates } = makeContainer({
      metadata: [{ id: "sm_1", seller_id: "sel_1", featured: true }],
      entitlements: [
        {
          seller_id: "sel_1",
          feature_key: PROMOTED_LISTING_FEATURE_KEY,
          status: "active",
          expires_at: new Date(NOW.getTime() + day),
          created_at: NOW,
        },
      ],
    })

    expect(await syncFeaturedFlag(container as never, "sel_1", NOW)).toBe("none")
    expect(updates).toHaveLength(0)
  })

  it("reports a hand-set flag without clearing it", async () => {
    // The migration-safety property: a vendor featured before promotions
    // existed keeps their placement until an operator adopts them.
    const { container, metadata, updates } = makeContainer({
      metadata: [{ id: "sm_1", seller_id: "sel_1", featured: true }],
    })

    expect(await syncFeaturedFlag(container as never, "sel_1", NOW)).toBe(
      "unbacked"
    )
    expect(metadata[0].featured).toBe(true)
    expect(updates).toHaveLength(0)
  })

  it("does nothing for a seller with no metadata row", async () => {
    const { container } = makeContainer({})
    expect(await syncFeaturedFlag(container as never, "sel_missing", NOW)).toBe(
      "none"
    )
  })
})

describe("getPromotionState", () => {
  it("reports no promotion for a seller who never had one", async () => {
    const { container } = makeContainer({})
    expect(await getPromotionState(container as never, "sel_1", NOW)).toEqual({
      active: false,
      expires_at: null,
      granted_at: null,
    })
  })

  it("ignores a revoked promotion", async () => {
    const { container } = makeContainer({
      entitlements: [
        {
          seller_id: "sel_1",
          feature_key: PROMOTED_LISTING_FEATURE_KEY,
          status: "revoked",
          expires_at: new Date(NOW.getTime() + day),
          created_at: NOW,
        },
      ],
    })

    expect((await getPromotionState(container as never, "sel_1", NOW)).active).toBe(
      false
    )
  })
})

describe("sweepExpiredPromotions", () => {
  it("clears the lapsed and leaves the rest alone", async () => {
    const { container, metadata } = makeContainer({
      metadata: [
        { id: "sm_1", seller_id: "sel_lapsed", featured: true },
        { id: "sm_2", seller_id: "sel_live", featured: true },
        { id: "sm_3", seller_id: "sel_handset", featured: true },
        { id: "sm_4", seller_id: "sel_plain", featured: false },
      ],
      entitlements: [
        {
          seller_id: "sel_lapsed",
          feature_key: PROMOTED_LISTING_FEATURE_KEY,
          status: "active",
          expires_at: new Date(NOW.getTime() - day),
          created_at: NOW,
        },
        {
          seller_id: "sel_live",
          feature_key: PROMOTED_LISTING_FEATURE_KEY,
          status: "active",
          expires_at: new Date(NOW.getTime() + day),
          created_at: NOW,
        },
      ],
    })

    const result = await sweepExpiredPromotions(container as never, NOW)

    expect(result.checked).toBe(3) // only the featured rows
    expect(result.cleared).toBe(1)
    expect(result.unbacked).toEqual(["sel_handset"])
    expect(metadata.find((m) => m.seller_id === "sel_lapsed")?.featured).toBe(false)
    expect(metadata.find((m) => m.seller_id === "sel_live")?.featured).toBe(true)
    // The whole point: a job must not silently demote vendors it has no record
    // for.
    expect(metadata.find((m) => m.seller_id === "sel_handset")?.featured).toBe(
      true
    )
  })

  it("keeps going when one seller fails", async () => {
    const { container } = makeContainer({
      metadata: [
        { id: "sm_1", seller_id: "sel_a", featured: true },
        { id: "sm_2", seller_id: "sel_b", featured: true },
      ],
    })
    const inner = container.resolve
    let calls = 0
    container.resolve = ((key: string) => {
      if (key === ContainerRegistrationKeys.QUERY) {
        const q = inner(key) as { graph: (s: unknown) => Promise<unknown> }
        return {
          graph: async (spec: { filters?: { seller_id?: string } }) => {
            if (spec.filters?.seller_id && ++calls === 1) {
              throw new Error("read failed")
            }
            return q.graph(spec)
          },
        }
      }
      return inner(key)
    }) as typeof container.resolve

    const result = await sweepExpiredPromotions(container as never, NOW)
    expect(result.failed).toBe(1)
    expect(result.checked).toBe(2)
  })
})
