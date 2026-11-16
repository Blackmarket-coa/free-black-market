import FoodDistributionService from "../service"
import { DeliveryStatus } from "../models/delivery"
import { statusHistoryEntries, withStatusHistoryList } from "../status-history"

/**
 * A delivery's status history is stored as `{ entries: [...] }`, and a row
 * may hold a bare list or nothing (SD-119 (1)).
 *
 * `POST /vendor/deliveries/:id` kept its own append and treated the column as
 * a list: 500 "existingHistory is not iterable" on a delivery the service
 * made, and on one with no history a list written back, on which the
 * service's own `updateDeliveryStatus` then threw (`list.entries` is
 * `Array.prototype.entries`, a function, so there was nothing to `.push` to).
 *
 * The real method runs here against a stand-in `this` for the generated CRUD
 * it calls; Postgres sees the rows in
 * integration-tests/http/store-food-network-owner-reads.spec.ts.
 */

const FIRST = { status: "PENDING", timestamp: "2026-11-16T09:00:00.000Z" }

describe("statusHistoryEntries", () => {
  it("reads the stored shape", () => {
    expect(statusHistoryEntries({ entries: [FIRST] })).toEqual([FIRST])
  })

  it("reads the bare list the vendor route used to write", () => {
    expect(statusHistoryEntries([FIRST])).toEqual([FIRST])
  })

  it.each([
    ["no history", null],
    ["an undefined column", undefined],
    ["an object with no entries", {}],
    ["entries that are not a list", { entries: "PENDING" }],
    ["a string", "PENDING"],
  ])("reads %s as empty", (_what, history) => {
    expect(statusHistoryEntries(history)).toEqual([])
  })

  it("hands back a copy: appending to it does not change the row it was read from", () => {
    const stored = { entries: [FIRST] }
    statusHistoryEntries(stored).push({ status: "ASSIGNED", timestamp: "later" })
    const list = [FIRST]
    statusHistoryEntries(list).push({ status: "ASSIGNED", timestamp: "later" })

    expect(stored.entries).toEqual([FIRST])
    expect(list).toEqual([FIRST])
  })
})

describe("withStatusHistoryList", () => {
  it("serves either stored shape as the list of its entries", () => {
    expect(withStatusHistoryList({ id: "del_1", status_history: { entries: [FIRST] } })).toEqual({
      id: "del_1",
      status_history: [FIRST],
    })
    expect(withStatusHistoryList({ id: "del_1", status_history: [FIRST] })).toEqual({
      id: "del_1",
      status_history: [FIRST],
    })
  })

  it("keeps a delivery with no history as it is", () => {
    const row = { id: "del_1", status_history: null }
    expect(withStatusHistoryList(row)).toBe(row)
  })
})

describe("FoodDistributionService.updateDeliveryStatus", () => {
  function update(
    stored: unknown,
    args: {
      notes?: string
      by?: { actor: string; actor_type: "PRODUCER"; actor_id?: string }
    } = {}
  ) {
    const self = {
      retrieveFoodDelivery: jest.fn(async (id: string) => ({ id, status: "PENDING", status_history: stored })),
      updateFoodDeliveries: jest.fn(async (data: Record<string, unknown>) => data),
      logDeliveryEvent: jest.fn(async () => ({})),
    }
    const run = FoodDistributionService.prototype.updateDeliveryStatus.call(
      self as unknown as FoodDistributionService,
      "del_1",
      DeliveryStatus.WAITING_FOR_ORDER,
      undefined,
      args.notes,
      args.by
    )
    return { self, run }
  }
  const written = (self: ReturnType<typeof update>["self"]) =>
    (self.updateFoodDeliveries.mock.calls[0] as unknown as [{ status_history: unknown }])[0].status_history as {
      entries: Array<Record<string, unknown>>
    }

  it.each([
    ["the stored shape", { entries: [FIRST] }],
    // Left by the vendor route on a delivery that had no history: this threw
    // "statusEntries.push is not a function".
    ["a bare list", [FIRST]],
  ])("appends to %s and writes the history back as { entries }", async (_shape, stored) => {
    const { self, run } = update(stored)

    await expect(run).resolves.toBeDefined()

    const history = written(self)
    expect(Array.isArray(history)).toBe(false)
    expect(history.entries).toHaveLength(2)
    expect(history.entries[0]).toEqual(FIRST)
    expect(history.entries[1]).toMatchObject({ status: "WAITING_FOR_ORDER" })
  })

  it("starts a history on a delivery that has none", async () => {
    const { self, run } = update(null)

    await run

    expect(written(self).entries).toEqual([expect.objectContaining({ status: "WAITING_FOR_ORDER" })])
  })

  it("records who made the change on the entry and on the event, when told", async () => {
    const { self, run } = update({ entries: [FIRST] }, {
      notes: "bagged",
      by: { actor: "vendor", actor_type: "PRODUCER", actor_id: "sel_a" },
    })

    await run

    expect(written(self).entries[1]).toMatchObject({ status: "WAITING_FOR_ORDER", note: "bagged", actor: "vendor" })
    expect(self.logDeliveryEvent).toHaveBeenCalledWith(
      "del_1",
      expect.objectContaining({
        event_type: "status_change",
        previous_status: "PENDING",
        new_status: "WAITING_FOR_ORDER",
        actor_type: "PRODUCER",
        actor_id: "sel_a",
        description: "bagged",
      })
    )
  })

  it("leaves the entry and the event as they were for a caller that does not say", async () => {
    const { self, run } = update({ entries: [FIRST] })

    await run

    expect(written(self).entries[1]).not.toHaveProperty("actor")
    const [, event] = self.logDeliveryEvent.mock.calls[0] as unknown as [string, Record<string, unknown>]
    expect(event).not.toHaveProperty("actor_type")
    expect(event).not.toHaveProperty("actor_id")
  })
})
