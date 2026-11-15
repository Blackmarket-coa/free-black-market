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

function serviceOver(cls: Record<string, unknown>) {
  const self = {
    retrieveClassEvent: jest.fn(async () => cls),
    createClassAttendees: jest.fn(async (row: Record<string, unknown>) => ({ id: "att_1", ...row })),
    updateClassEvents: jest.fn(async (row: Record<string, unknown>) => row),
  }
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
    expect(self.updateClassEvents).not.toHaveBeenCalled()
  })

  it.each(LIVE_CLASS_STATUSES.map((s) => [s]))("a future %s class with room seats the buyer", async (status) => {
    const { self, register } = serviceOver(liveClass({ status }))

    const result = await register()

    expect(result.refused).toBeNull()
    expect(result.attendee).toEqual(expect.objectContaining({ status: "registered", order_id: "order_1" }))
    expect(self.updateClassEvents).toHaveBeenCalledWith({ id: "cls_1", seats_taken: 3, status: "open" })
  })

  it("a class in progress (started, not yet ended) still takes a registration", async () => {
    const { register } = serviceOver(liveClass({ starts_at: past(), ends_at: new Date(Date.now() + HOUR) }))
    expect((await register()).refused).toBeNull()
  })

  it("a full live class with no waitlist is full, not refused", async () => {
    const { self, register } = serviceOver(liveClass({ status: "full", capacity: 2, seats_taken: 2 }))
    expect(await register()).toEqual({ attendee: null, sold_out: false, full: true, refused: null })
    expect(self.updateClassEvents).not.toHaveBeenCalled()
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
