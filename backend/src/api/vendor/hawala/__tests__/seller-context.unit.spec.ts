import { resolveVendorSellerId } from "../seller-context"

/**
 * The vendor middleware rewrites `auth_context.actor_id` from `sel_*` to
 * `mem_*`, but earnings accrue under `sel_*`. Reading the actor id directly
 * made every money route on this surface look under the wrong id — payouts
 * threw "Vendor account not found", and earnings silently created a second,
 * permanently-empty account showing the vendor $0.
 */

const makeReq = (opts: {
  sellerId?: string
  actorId?: string
  memberRow?: { seller_id: string } | null
}) => {
  const raw = jest.fn(async () => ({
    rows: opts.memberRow ? [opts.memberRow] : [],
  }))
  return {
    req: {
      // The guard attaches `_seller_id` only once it has resolved the actor.
      _seller_id: opts.sellerId,
      _sellerContextResolved: opts.sellerId ? true : undefined,
      auth_context: opts.actorId ? { actor_id: opts.actorId } : undefined,
      scope: { resolve: () => ({ raw }) },
    } as any,
    raw,
  }
}

describe("resolveVendorSellerId", () => {
  it("prefers the seller id the context guard attached", async () => {
    const { req, raw } = makeReq({ sellerId: "sel_1", actorId: "mem_9" })

    await expect(resolveVendorSellerId(req)).resolves.toBe("sel_1")
    expect(raw).not.toHaveBeenCalled()
  })

  it("resolves a mem_ actor through the member table to its owning seller", async () => {
    const { req } = makeReq({ actorId: "mem_9", memberRow: { seller_id: "sel_1" } })

    await expect(resolveVendorSellerId(req)).resolves.toBe("sel_1")
  })

  it("never returns the mem_ id when a seller owns it — the $0-account bug", async () => {
    const { req } = makeReq({ actorId: "mem_9", memberRow: { seller_id: "sel_1" } })

    await expect(resolveVendorSellerId(req)).resolves.not.toBe("mem_9")
  })

  it("does not take a sel_ actor id as the store unless the guard resolved it", async () => {
    // A seller id acts only as the live member of that store at the login's
    // address (shared/seller-actor.ts). It used to pass through untouched,
    // which let any login holding it act for the store.
    const { req, raw } = makeReq({ actorId: "sel_1" })

    await expect(resolveVendorSellerId(req)).resolves.toBeUndefined()
    expect(raw).not.toHaveBeenCalled()
  })

  it("returns undefined when the request carries no actor at all", async () => {
    const { req } = makeReq({})

    await expect(resolveVendorSellerId(req)).resolves.toBeUndefined()
  })
})
