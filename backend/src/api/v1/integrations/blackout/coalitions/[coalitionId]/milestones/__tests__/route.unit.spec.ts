import { PUT } from "../route"

/**
 * Coalition joint-drive milestones.
 *
 * Absolute totals, not increments — so a lost or duplicated delivery
 * self-heals on the next push instead of drifting forever. That is the whole
 * reason this is a PUT, and it is what these tests pin.
 */

jest.mock("../../../../../../../../lib/blackout-entitlements-auth", () => ({
  requireEntitlementsAuth: jest.fn(() => true),
}))

const updateCooperatives = jest.fn(async () => [{}])

const makeRes = () => {
  const res = {
    statusCode: 200,
    body: undefined as Record<string, unknown> | undefined,
    status(code: number) {
      res.statusCode = code
      return res
    },
    json(payload: Record<string, unknown>) {
      res.body = payload
      return res
    },
  }
  return res
}

const makeReq = (cooperatives: Record<string, unknown>[], body: Record<string, unknown>) =>
  ({
    params: { coalitionId: "coa_1" },
    body,
    headers: {},
    scope: {
      resolve: () => ({
        listCooperatives: async () => cooperatives,
        updateCooperatives,
      }),
    },
  }) as never

const linked = [{ id: "coop_1", blackout_coalition_id: "coa_1" }]

beforeEach(() => updateCooperatives.mockClear())

describe("PUT /v1/integrations/blackout/coalitions/:id/milestones", () => {
  it("mirrors the totals verbatim onto the linked cooperative", async () => {
    const res = makeRes()
    await PUT(
      makeReq(linked, { drives_completed: 3, contributing_members: 7, raised_cents: 125_00 }),
      res as never
    )
    expect(res.statusCode).toBe(200)
    const written = updateCooperatives.mock.calls[0][0][0] as Record<string, unknown>
    expect(written.id).toBe("coop_1")
    expect(written.coalition_drives_completed).toBe(3)
    expect(written.coalition_contributing_members).toBe(7)
    expect(written.coalition_drive_raised_cents).toBe(125_00)
  })

  it("overwrites rather than accumulating, so a replay is harmless", async () => {
    await PUT(makeReq(linked, { drives_completed: 3, contributing_members: 7, raised_cents: 100 }), makeRes() as never)
    await PUT(makeReq(linked, { drives_completed: 3, contributing_members: 7, raised_cents: 100 }), makeRes() as never)
    const writes = updateCooperatives.mock.calls.map(
      (c) => (c[0] as Record<string, unknown>[])[0].coalition_drives_completed
    )
    expect(writes).toEqual([3, 3])
  })

  it("accepts a correction downward", async () => {
    // A drive cancelled after it closed lowers the count; an increment API
    // could never express that.
    await PUT(makeReq(linked, { drives_completed: 5, contributing_members: 9, raised_cents: 900 }), makeRes() as never)
    await PUT(makeReq(linked, { drives_completed: 4, contributing_members: 8, raised_cents: 800 }), makeRes() as never)
    const writes = updateCooperatives.mock.calls.map(
      (c) => (c[0] as Record<string, unknown>[])[0].coalition_drives_completed
    )
    expect(writes).toEqual([5, 4])
  })

  it("rejects negative totals", async () => {
    const res = makeRes()
    await PUT(makeReq(linked, { drives_completed: -1, contributing_members: 0, raised_cents: 0 }), res as never)
    expect(res.statusCode).toBe(400)
    expect(updateCooperatives).not.toHaveBeenCalled()
  })

  it("tells Blackout to stop pushing when no cooperative is linked", async () => {
    const res = makeRes()
    await PUT(makeReq([], { drives_completed: 1, contributing_members: 1, raised_cents: 1 }), res as never)
    expect(res.statusCode).toBe(404)
    expect(res.body?.code).toBe("cooperative_unlinked")
    expect(updateCooperatives).not.toHaveBeenCalled()
  })
})
