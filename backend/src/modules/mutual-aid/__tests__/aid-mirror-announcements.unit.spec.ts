import MutualAidModuleService from "../service"
import { AidRequestStatus } from "../models/mutual-aid-request"
import {
  BLACKOUT_AID_EVENTS,
  isBlackoutEventType,
} from "../../marketplace-webhooks/models/blackout-events"

/**
 * Every point at which a request's public state changes has to announce it, or
 * Blackout's mirror goes stale — and a stale mirror shows a need that is no
 * longer there, which sends someone to help with something already handled.
 *
 * Four transitions produce a change: create, match/confirm, withdraw, expire.
 * The three route ones are asserted in the route suites; this file covers the
 * sweep, which is the one that runs unattended.
 */
const proto = MutualAidModuleService.prototype as any

describe("the sweep announces each expired ask", () => {
  const NOW = new Date("2026-09-08T00:00:00.000Z")

  const ctx = (requests: any[]) => ({
    listMutualAidRequests: jest.fn(async () => requests),
    listMutualAidOffers: jest.fn(async () => []),
    updateMutualAidRequests: jest.fn(),
    updateMutualAidOffers: jest.fn(),
  })

  it("calls back once per expired request, after the status is written", async () => {
    const order: string[] = []
    const service: any = ctx([{ id: "mar_1" }, { id: "mar_2" }])
    service.updateMutualAidRequests = jest.fn(async (input: any) => {
      order.push(`update:${input.id}`)
    })

    await proto.expireStaleAid.call(service, NOW, async (id: string) => {
      order.push(`announce:${id}`)
    })

    expect(order).toEqual([
      "update:mar_1",
      "announce:mar_1",
      "update:mar_2",
      "announce:mar_2",
    ])
  })

  it("does not announce offers — the mirror carries requests only", async () => {
    const service: any = ctx([])
    service.listMutualAidOffers = jest.fn(async () => [{ id: "mao_1" }])
    const announced: string[] = []

    await proto.expireStaleAid.call(service, NOW, async (id: string) => {
      announced.push(id)
    })

    expect(service.updateMutualAidOffers).toHaveBeenCalled()
    expect(announced).toEqual([])
  })

  it("finishes the sweep when an announcement throws", async () => {
    // The status transition is the job's real work; a mirror that missed one
    // is not a reason to leave the rest of the board stale.
    const service: any = ctx([{ id: "mar_1" }, { id: "mar_2" }])

    const result = await proto.expireStaleAid.call(service, NOW, async () => {
      throw new Error("event bus down")
    })

    expect(result).toEqual({ requests_expired: 2, offers_expired: 0 })
    expect(service.updateMutualAidRequests).toHaveBeenCalledTimes(2)
  })

  it("still works with no callback at all", async () => {
    const service: any = ctx([{ id: "mar_1" }])

    expect(await proto.expireStaleAid.call(service, NOW)).toEqual({
      requests_expired: 1,
      offers_expired: 0,
    })
  })
})

describe("the aid family is registered on the Blackout channel", () => {
  it("names exactly the three types Blackout accepts", () => {
    expect([...BLACKOUT_AID_EVENTS]).toEqual([
      "aid.request.opened",
      "aid.request.fulfilled",
      "aid.request.closed",
    ])
  })

  it("passes the emitter's own type guard", () => {
    // `emitBlackout` throws on an unregistered type, so an event family that
    // is not in this list is a runtime error at the first real emit rather
    // than a missing mirror.
    for (const type of BLACKOUT_AID_EVENTS) {
      expect(isBlackoutEventType(type)).toBe(true)
    }
  })

  it("covers every status the request model can reach", () => {
    // If a status has no event type, the mirror silently stops tracking it.
    const { aidEventTypeFor } = require("../../../lib/blackout-aid")
    for (const status of Object.values(AidRequestStatus)) {
      expect(aidEventTypeFor(status)).not.toBeNull()
    }
  })
})
