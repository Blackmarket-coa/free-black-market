import WellnessModuleService from "../service"
import { LIVE_CLASS_STATUSES, classRegistrationRefusal } from "../class-registration"

/**
 * SD-52 review: registerForClass refuses a class that is not live or has
 * ended, and writes nothing when it does. Before the guard, a ticket bought
 * for a cancelled or finished class seated the buyer and wrote
 * `status: "open"` back onto the class. The real-database proof, through the
 * order subscriber, is integration-tests/http/order-items-quantity-read.spec.ts.
 */

const HOUR = 3_600_000
const future = () => new Date(Date.now() + 24 * HOUR)
const past = () => new Date(Date.now() - HOUR)

/**
 * The service over a class row. `takeClassSeat` stands in for the one-statement
 * conditional UPDATE (its SQL runs against Postgres in
 * integration-tests/http/wellness-seller-scope.spec.ts): it takes a seat when
 * the row is live, not ended and has room, as the WHERE clause does.
 */
function serviceOver(cls: Record<string, unknown>, reread?: Record<string, unknown>) {
  const self = {
    retrieveClassEvent: jest.fn(async () => cls),
    takeClassSeat: jest.fn(async () => {
      const capacity = Number(cls.capacity ?? 0)
      const taken = Number(cls.seats_taken ?? 0)
      if (classRegistrationRefusal(cls) || (capacity > 0 && taken >= capacity)) return null
      return { seats_taken: taken + 1, capacity }
    }),
    releaseClassSeat: jest.fn(async () => undefined),
    createClassAttendees: jest.fn(async (row: Record<string, unknown>) => ({ id: "att_1", ...row })),
    updateClassEvents: jest.fn(async (row: Record<string, unknown>) => row),
  }
  if (reread) self.retrieveClassEvent.mockResolvedValueOnce(cls).mockResolvedValueOnce(reread)
  const register = () =>
    WellnessModuleService.prototype.registerForClass.call(self as never, {
      seller_id: "sel_1",
      class_event_id: "cls_1",
      email: "buyer@example.com",
      order_id: "order_1",
    })
  return { self, register }
}

const liveClass = (overrides: Record<string, unknown> = {}) => ({
  id: "cls_1",
  status: "open",
  starts_at: new Date(Date.now() + 23 * HOUR),
  ends_at: future(),
  capacity: 10,
  seats_taken: 2,
  waitlist_enabled: false,
  ...overrides,
})

describe("registerForClass refuses a class that is not live or has ended (SD-52 review)", () => {
  it.each([
    ["cancelled", { status: "cancelled" }, "cancelled"],
    ["completed", { status: "completed" }, "completed"],
    ["an unknown status", { status: "postponed" }, "not_live"],
    ["ended (open, but ends_at has passed)", { ends_at: past() }, "ended"],
    ["ended (no readable ends_at)", { ends_at: "not a date" }, "ended"],
    ["cancelled with room and a waitlist", { status: "cancelled", capacity: 0, waitlist_enabled: true }, "cancelled"],
  ])("%s: no attendee, and the class's status and seats are not written", async (_name, overrides, reason) => {
    const { self, register } = serviceOver(liveClass(overrides))

    const result = await register()

    expect(result).toEqual({ attendee: null, sold_out: false, full: false, refused: reason })
    expect(self.createClassAttendees).not.toHaveBeenCalled()
    expect(self.takeClassSeat).not.toHaveBeenCalled()
    expect(self.updateClassEvents).not.toHaveBeenCalled()
  })

  it.each(LIVE_CLASS_STATUSES.map((s) => [s]))("a future %s class with room seats the buyer", async (status) => {
    const { self, register } = serviceOver(liveClass({ status }))

    const result = await register()

    expect(result.refused).toBeNull()
    expect(result.attendee).toEqual(expect.objectContaining({ status: "registered", order_id: "order_1" }))
    expect(result.sold_out).toBe(false)
    // The seat is taken in one conditional statement, before the attendee is
    // written; nothing writes the class's status or count back afterwards.
    expect(self.takeClassSeat).toHaveBeenCalledWith("cls_1")
    expect(self.takeClassSeat.mock.invocationCallOrder[0]).toBeLessThan(self.createClassAttendees.mock.invocationCallOrder[0])
    expect(self.updateClassEvents).not.toHaveBeenCalled()
  })

  it("taking the last seat reports sold_out", async () => {
    const { register } = serviceOver(liveClass({ capacity: 3, seats_taken: 2 }))
    expect(await register()).toEqual(expect.objectContaining({ sold_out: true, full: false, refused: null }))
  })

  it("a class in progress (started, not yet ended) still takes a registration", async () => {
    const { register } = serviceOver(liveClass({ starts_at: past(), ends_at: new Date(Date.now() + HOUR) }))
    expect((await register()).refused).toBeNull()
  })

  it("a full live class with no waitlist is full, not refused", async () => {
    const { self, register } = serviceOver(liveClass({ status: "full", capacity: 2, seats_taken: 2 }))
    expect(await register()).toEqual({ attendee: null, sold_out: false, full: true, refused: null })
    expect(self.createClassAttendees).not.toHaveBeenCalled()
    expect(self.updateClassEvents).not.toHaveBeenCalled()
  })

  it("a full live class with a waitlist waitlists the buyer and takes no seat", async () => {
    const { self, register } = serviceOver(liveClass({ status: "full", capacity: 2, seats_taken: 2, waitlist_enabled: true }))
    const result = await register()
    expect(result).toEqual(expect.objectContaining({ sold_out: false, full: false, refused: null }))
    expect(result.attendee).toEqual(expect.objectContaining({ status: "waitlisted" }))
    expect(self.updateClassEvents).not.toHaveBeenCalled()
  })

  it("a class cancelled between the read and the seat: refused, no attendee, nothing written back (SD-52 re-review)", async () => {
    // The first read sees it live; the conditional seat take finds it
    // cancelled (no row); the second read says why.
    const live = liveClass()
    const { self, register } = serviceOver(live, { ...live, status: "cancelled" })
    self.takeClassSeat.mockResolvedValueOnce(null)

    expect(await register()).toEqual({ attendee: null, sold_out: false, full: false, refused: "cancelled" })
    expect(self.createClassAttendees).not.toHaveBeenCalled()
    expect(self.updateClassEvents).not.toHaveBeenCalled()
  })

  it("an attendee row that cannot be written gives its seat back and the error goes to the caller", async () => {
    const { self, register } = serviceOver(liveClass())
    self.createClassAttendees.mockRejectedValueOnce(new Error("insert failed"))

    await expect(register()).rejects.toThrow("insert failed")
    expect(self.releaseClassSeat).toHaveBeenCalledWith("cls_1")
  })
})

describe("classRegistrationRefusal", () => {
  const now = new Date("2026-11-15T12:00:00Z")

  it("is null only for a live status with ends_at after now", () => {
    expect(classRegistrationRefusal({ status: "open", ends_at: new Date("2026-11-15T12:00:01Z") }, now)).toBeNull()
    expect(classRegistrationRefusal({ status: "scheduled", ends_at: "2026-11-16T00:00:00Z" }, now)).toBeNull()
    expect(classRegistrationRefusal({ status: "open", ends_at: now }, now)).toBe("ended")
    expect(classRegistrationRefusal({ status: "open", ends_at: null }, now)).toBe("ended")
    expect(classRegistrationRefusal({ status: undefined, ends_at: "2026-11-16T00:00:00Z" }, now)).toBe("not_live")
  })

  it("names cancelled and completed before checking the date", () => {
    expect(classRegistrationRefusal({ status: "cancelled", ends_at: "2026-11-16T00:00:00Z" }, now)).toBe("cancelled")
    expect(classRegistrationRefusal({ status: "completed", ends_at: "2026-11-01T00:00:00Z" }, now)).toBe("completed")
  })

  it("treats as live exactly the statuses the reminder job reminds", () => {
    expect([...LIVE_CLASS_STATUSES].sort()).toEqual(["full", "open", "scheduled"])
  })
})
