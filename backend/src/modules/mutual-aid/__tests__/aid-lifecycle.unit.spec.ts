import MutualAidModuleService from "../service"
import { AidRequestStatus } from "../models/mutual-aid-request"
import { AidOfferStatus } from "../models/mutual-aid-offer"

/**
 * The two halves of the ask-board lifecycle that had no writer at all
 * (`docs/CDFI_COOP_ROADMAP.md` §3.8).
 *
 * `WITHDRAWN` and `EXPIRED` are declared on both enums and, before this, were
 * written by nothing: there was no withdraw endpoint or service method, and no
 * job read `needed_by` / `available_until` back. So a request stayed OPEN
 * forever, and `matchRequest` — which guarded status but never the date — would
 * let a helper commit to a need whose date had passed months ago.
 *
 * These call the prototype methods against fake list/update pairs, the way the
 * rest of this module's suite does, because the real ones go through Medusa's
 * generated data layer.
 */
const proto = MutualAidModuleService.prototype as any

const req = (over: Record<string, unknown> = {}) => ({
  id: "mar_1",
  requester_id: "cus_asker",
  status: AidRequestStatus.OPEN,
  matched_offer_id: null,
  matched_helper_id: null,
  needed_by: null,
  ...over,
})

const offer = (over: Record<string, unknown> = {}) => ({
  id: "mao_1",
  offerer_id: "cus_giver",
  status: AidOfferStatus.AVAILABLE,
  available_until: null,
  ...over,
})

/** A context whose list/update pair mutates the row, so a re-read sees it. */
const makeCtx = (rows: { request?: any; offer?: any } = {}) => ({
  listMutualAidRequests: jest.fn(async () =>
    rows.request ? [rows.request] : []
  ),
  listMutualAidOffers: jest.fn(async () => (rows.offer ? [rows.offer] : [])),
  updateMutualAidRequests: jest.fn(async (input: any) => {
    if (rows.request) Object.assign(rows.request, input)
    return rows.request
  }),
  updateMutualAidOffers: jest.fn(async (input: any) => {
    if (rows.offer) Object.assign(rows.offer, input)
    return rows.offer
  }),
})

describe("withdrawRequest", () => {
  it("takes an open request off the board", async () => {
    const request = req()
    const ctx: any = makeCtx({ request })

    const updated = await proto.withdrawRequest.call(ctx, "mar_1", "cus_asker")

    expect(updated.status).toBe(AidRequestStatus.WITHDRAWN)
    expect(ctx.updateMutualAidRequests).toHaveBeenCalledWith(
      expect.objectContaining({ id: "mar_1", status: AidRequestStatus.WITHDRAWN })
    )
  })

  it("refuses anyone but the requester", async () => {
    // A helper who no longer wants the commitment does not get to close
    // somebody else's ask.
    const ctx: any = makeCtx({ request: req() })

    await expect(
      proto.withdrawRequest.call(ctx, "mar_1", "cus_helper")
    ).rejects.toThrow(/only the requester/i)

    expect(ctx.updateMutualAidRequests).not.toHaveBeenCalled()
  })

  it("404s an unknown request", async () => {
    const ctx: any = makeCtx({})

    await expect(
      proto.withdrawRequest.call(ctx, "mar_missing", "cus_asker")
    ).rejects.toThrow(/not found/i)
  })

  it("releases the committed offer when a matched request is withdrawn", async () => {
    // Otherwise the offer sits COMMITTED against a request nobody will ever
    // confirm — quietly removing a willing helper from the board.
    const request = req({
      status: AidRequestStatus.MATCHED,
      matched_offer_id: "mao_1",
      matched_helper_id: "cus_giver",
    })
    const committed = offer({ status: AidOfferStatus.COMMITTED })
    const ctx: any = makeCtx({ request, offer: committed })

    await proto.withdrawRequest.call(ctx, "mar_1", "cus_asker")

    expect(ctx.updateMutualAidOffers).toHaveBeenCalledWith({
      id: "mao_1",
      status: AidOfferStatus.AVAILABLE,
    })
    expect(request.matched_offer_id).toBeNull()
    expect(request.matched_helper_id).toBeNull()
  })

  it("does not touch an offer when an unmatched request is withdrawn", async () => {
    const ctx: any = makeCtx({ request: req() })

    await proto.withdrawRequest.call(ctx, "mar_1", "cus_asker")

    expect(ctx.updateMutualAidOffers).not.toHaveBeenCalled()
  })

  it.each([AidRequestStatus.FULFILLED, AidRequestStatus.WITHDRAWN, AidRequestStatus.EXPIRED])(
    "refuses to withdraw a %s request",
    async (status) => {
      const ctx: any = makeCtx({ request: req({ status }) })

      await expect(
        proto.withdrawRequest.call(ctx, "mar_1", "cus_asker")
      ).rejects.toThrow(/cannot withdraw/i)

      expect(ctx.updateMutualAidRequests).not.toHaveBeenCalled()
    }
  )
})

describe("withdrawOffer", () => {
  it("takes an available offer off the board", async () => {
    const available = offer()
    const ctx: any = makeCtx({ offer: available })

    const updated = await proto.withdrawOffer.call(ctx, "mao_1", "cus_giver")

    expect(updated.status).toBe(AidOfferStatus.WITHDRAWN)
  })

  it("refuses anyone but the offerer", async () => {
    const ctx: any = makeCtx({ offer: offer() })

    await expect(
      proto.withdrawOffer.call(ctx, "mao_1", "cus_someone")
    ).rejects.toThrow(/only the offerer/i)

    expect(ctx.updateMutualAidOffers).not.toHaveBeenCalled()
  })

  it("404s an unknown offer", async () => {
    const ctx: any = makeCtx({})

    await expect(
      proto.withdrawOffer.call(ctx, "mao_missing", "cus_giver")
    ).rejects.toThrow(/not found/i)
  })

  it("refuses to withdraw a committed offer", async () => {
    // The deliberate asymmetry with requests: a COMMITTED offer is a promise
    // already made to a named person who is waiting on it. It is released by
    // that person withdrawing their request, which leaves a trace, not by the
    // helper silently deleting the help.
    const ctx: any = makeCtx({ offer: offer({ status: AidOfferStatus.COMMITTED }) })

    await expect(
      proto.withdrawOffer.call(ctx, "mao_1", "cus_giver")
    ).rejects.toThrow(/cannot withdraw/i)

    expect(ctx.updateMutualAidOffers).not.toHaveBeenCalled()
  })

  it.each([AidOfferStatus.SPENT, AidOfferStatus.WITHDRAWN, AidOfferStatus.EXPIRED])(
    "refuses to withdraw a %s offer",
    async (status) => {
      const ctx: any = makeCtx({ offer: offer({ status }) })

      await expect(
        proto.withdrawOffer.call(ctx, "mao_1", "cus_giver")
      ).rejects.toThrow(/cannot withdraw/i)
    }
  )
})

describe("expireStaleAid", () => {
  const NOW = new Date("2026-09-08T00:00:00.000Z")

  const sweepCtx = (requests: any[], offers: any[]) => ({
    listMutualAidRequests: jest.fn(async () => requests),
    listMutualAidOffers: jest.fn(async () => offers),
    updateMutualAidRequests: jest.fn(),
    updateMutualAidOffers: jest.fn(),
  })

  it("flips overdue requests and offers to EXPIRED", async () => {
    const ctx: any = sweepCtx(
      [{ id: "mar_1" }, { id: "mar_2" }],
      [{ id: "mao_1" }]
    )

    const result = await proto.expireStaleAid.call(ctx, NOW)

    expect(result).toEqual({ requests_expired: 2, offers_expired: 1 })
    expect(ctx.updateMutualAidRequests).toHaveBeenCalledWith({
      id: "mar_1",
      status: AidRequestStatus.EXPIRED,
    })
    expect(ctx.updateMutualAidOffers).toHaveBeenCalledWith({
      id: "mao_1",
      status: AidOfferStatus.EXPIRED,
    })
  })

  it("asks only for pre-terminal rows whose date has passed", async () => {
    // The filter is the whole rule. A FULFILLED request that ran past its date
    // was still fulfilled, and `$lt` never matches NULL — which is what keeps
    // "no stated deadline" off the sweep rather than an extra guard.
    const ctx: any = sweepCtx([], [])

    await proto.expireStaleAid.call(ctx, NOW)

    expect(ctx.listMutualAidRequests).toHaveBeenCalledWith({
      status: AidRequestStatus.OPEN,
      needed_by: { $lt: NOW },
    })
    expect(ctx.listMutualAidOffers).toHaveBeenCalledWith({
      status: AidOfferStatus.AVAILABLE,
      available_until: { $lt: NOW },
    })
  })

  it("reports zero without writing when nothing is stale", async () => {
    const ctx: any = sweepCtx([], [])

    expect(await proto.expireStaleAid.call(ctx, NOW)).toEqual({
      requests_expired: 0,
      offers_expired: 0,
    })
    expect(ctx.updateMutualAidRequests).not.toHaveBeenCalled()
    expect(ctx.updateMutualAidOffers).not.toHaveBeenCalled()
  })

  it("takes `now` as an argument rather than reading the clock", async () => {
    // So the sweep is testable and a caller can replay it at a chosen instant.
    const other = new Date("2020-01-01T00:00:00.000Z")
    const ctx: any = sweepCtx([], [])

    await proto.expireStaleAid.call(ctx, other)

    expect(ctx.listMutualAidRequests).toHaveBeenCalledWith(
      expect.objectContaining({ needed_by: { $lt: other } })
    )
  })
})
